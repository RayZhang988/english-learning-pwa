import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const defaultChromePath =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class CdpClient {
  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timed out connecting to ${url}`)),
        10_000,
      )
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timeout)
          resolve()
        },
        { once: true },
      )
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timeout)
          reject(new Error(`Could not connect to ${url}`))
        },
        { once: true },
      )
    })
    return new CdpClient(socket)
  }

  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) {
          return
        }
        this.pending.delete(message.id)
        clearTimeout(pending.timeout)
        if (message.error) {
          pending.reject(
            new Error(
              `${pending.method}: ${message.error.message ?? 'CDP error'}`,
            ),
          )
        } else {
          pending.resolve(message.result ?? {})
        }
        return
      }

      for (const listener of this.listeners.get(message.method) ?? []) {
        listener(message.params ?? {})
      }
    })
  }

  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, 20_000)
      this.pending.set(id, { method, resolve, reject, timeout })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set()
    listeners.add(listener)
    this.listeners.set(method, listeners)
    return () => listeners.delete(listener)
  }

  async close() {
    if (this.socket.readyState < WebSocket.CLOSING) {
      this.socket.close()
    }
  }
}

async function waitForDevToolsUrl(child) {
  return new Promise((resolve, reject) => {
    let stderr = ''
    const timeout = setTimeout(() => {
      reject(new Error(`Chrome DevTools did not start.\n${stderr}`))
    }, 15_000)

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/u)
      if (match) {
        clearTimeout(timeout)
        resolve({ url: match[1], stderr })
      }
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      reject(
        new Error(
          `Chrome exited before DevTools was ready (${code ?? signal}).\n${stderr}`,
        ),
      )
    })
  })
}

async function waitForPageTarget(httpOrigin) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const response = await fetch(`${httpOrigin}/json/list`)
    const targets = await response.json()
    const page = targets.find((target) => target.type === 'page')
    if (page?.webSocketDebuggerUrl) {
      return page
    }
    await delay(100)
  }
  throw new Error('Chrome did not expose a page target')
}

export async function launchQaChrome(options = {}) {
  const profileDirectory = await mkdtemp(
    join(tmpdir(), 'english-pwa-qa-chrome-'),
  )
  const chromePath =
    options.chromePath ?? process.env.QA_CHROME_PATH ?? defaultChromePath
  const chromeArguments = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
  ]
  if (options.fakeMedia !== false) {
    chromeArguments.push(
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    )
  }
  chromeArguments.push('about:blank')
  const child = spawn(
    chromePath,
    chromeArguments,
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  const { url: browserWebSocketUrl } = await waitForDevToolsUrl(child)
  const browserUrl = new URL(browserWebSocketUrl)
  const httpOrigin = `http://${browserUrl.host}`
  const pageTarget = await waitForPageTarget(httpOrigin)
  const browser = await CdpClient.connect(browserWebSocketUrl)
  const page = await CdpClient.connect(pageTarget.webSocketDebuggerUrl)

  async function close() {
    try {
      await browser.send('Browser.close')
    } catch {
      child.kill('SIGTERM')
    }
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(2_000),
    ])
    await page.close()
    await browser.close()
    if (process.env.QA_KEEP_PROFILE !== '1') {
      await rm(profileDirectory, { recursive: true, force: true })
    }
  }

  return {
    browser,
    page: new QaPage(page),
    profileDirectory,
    close,
  }
}

export class QaPage {
  constructor(client) {
    this.client = client
    this.consoleMessages = []
    this.pageErrors = []
    this.requests = []
  }

  async initialize() {
    await Promise.all([
      this.client.send('Page.enable'),
      this.client.send('Runtime.enable'),
      this.client.send('Network.enable'),
      this.client.send('Log.enable'),
    ])
    this.client.on('Runtime.consoleAPICalled', (event) => {
      this.consoleMessages.push({
        type: event.type,
        text: event.args
          .map((argument) => argument.value ?? argument.description ?? '')
          .join(' '),
      })
    })
    this.client.on('Runtime.exceptionThrown', (event) => {
      this.pageErrors.push(
        event.exceptionDetails?.exception?.description ??
          event.exceptionDetails?.text ??
          'Unknown page error',
      )
    })
    this.client.on('Network.requestWillBeSent', (event) => {
      this.requests.push(event.request.url)
    })
  }

  async addInitScript(source) {
    await this.client.send('Page.addScriptToEvaluateOnNewDocument', {
      source,
    })
  }

  async setViewport(width, height) {
    await this.client.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 3,
      mobile: true,
      screenWidth: width,
      screenHeight: height,
    })
    await this.client.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 5,
    })
  }

  async setOffline(offline) {
    await this.client.send('Network.emulateNetworkConditions', {
      offline,
      latency: 0,
      downloadThroughput: offline ? 0 : -1,
      uploadThroughput: offline ? 0 : -1,
      connectionType: offline ? 'none' : 'wifi',
    })
  }

  async pressKey(key, code = key) {
    await this.client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
    })
    await this.client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
    })
  }

  async insertText(text) {
    await this.client.send('Input.insertText', { text })
  }

  async navigate(url) {
    await this.client.send('Page.navigate', { url })
    await this.waitFor(
      `document.readyState === 'complete' && location.href === ${JSON.stringify(url)}`,
      20_000,
    )
  }

  async reload() {
    await this.client.send('Page.reload', { ignoreCache: false })
    await this.waitFor(`document.readyState === 'complete'`, 20_000)
  }

  async evaluate(expression) {
    const response = await this.client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text ??
          'Page evaluation failed',
      )
    }
    return response.result?.value
  }

  async waitFor(expression, timeout = 10_000) {
    const deadline = Date.now() + timeout
    let lastError
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(`Boolean(${expression})`)) {
          return
        }
      } catch (error) {
        lastError = error
      }
      await delay(100)
    }
    throw new Error(
      `Timed out waiting for: ${expression}${
        lastError ? `\n${String(lastError)}` : ''
      }`,
    )
  }

  bodyText() {
    return this.evaluate(`document.body?.innerText ?? ''`)
  }

  url() {
    return this.evaluate(`location.href`)
  }

  async interactiveElements() {
    return this.evaluate(`(() => {
      const selector = 'button, a, input, select, textarea, [role="button"]'
      return [...document.querySelectorAll(selector)].map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: (element.innerText || element.value || element.getAttribute('aria-label') || '').trim(),
        type: element.getAttribute('type'),
        disabled: Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true',
        name: element.getAttribute('name'),
        id: element.id || null,
        className: typeof element.className === 'string' ? element.className : null,
      }))
    })()`)
  }

  async clickByText(...labels) {
    const result = await this.evaluate(`(() => {
      const labels = ${JSON.stringify(labels)}
      const elements = [...document.querySelectorAll('button, a, [role="button"]')]
      const element = elements.find((candidate) => {
        const text = (candidate.innerText || candidate.getAttribute('aria-label') || '').trim()
        return labels.includes(text) && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true'
      })
      if (!element) {
        return { clicked: false, available: elements.map((candidate) => (candidate.innerText || candidate.getAttribute('aria-label') || '').trim()) }
      }
      element.click()
      return { clicked: true }
    })()`)
    if (!result.clicked) {
      throw new Error(
        `Could not click any of ${labels.join(', ')}. Available: ${result.available.join(' | ')}`,
      )
    }
  }

  async clickFirstEnabledChoice() {
    const result = await this.evaluate(`(() => {
      const explicitChoices = [...document.querySelectorAll(
        'button.choice-row, button.choice-card, [role="radio"]'
      )]
      const candidates = explicitChoices.length > 0
        ? explicitChoices
        : [...document.querySelectorAll('input[type="radio"]')]
      const element = candidates.find((candidate) => !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true')
      if (!element) {
        return { clicked: false, available: candidates.map((candidate) => (candidate.innerText || candidate.value || '').trim()) }
      }
      element.click()
      return { clicked: true, text: (element.innerText || element.value || '').trim() }
    })()`)
    if (!result.clicked) {
      throw new Error(
        `No enabled choice was found. Available: ${result.available.join(' | ')}`,
      )
    }
    return result.text
  }

  async layoutSnapshot() {
    return this.evaluate(`({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      focusedText: (document.activeElement?.innerText || document.activeElement?.getAttribute?.('aria-label') || '').trim(),
    })`)
  }

  async serviceWorkerSnapshot() {
    return this.evaluate(`(async () => {
      if (!('serviceWorker' in navigator)) {
        return { supported: false }
      }
      const registration = await navigator.serviceWorker.ready
      const cacheNames = await caches.keys()
      const cachesWithEntries = []
      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName)
        const requests = await cache.keys()
        cachesWithEntries.push({
          cacheName,
          urls: requests.map((request) => request.url),
        })
      }
      return {
        supported: true,
        scope: registration.scope,
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        active: registration.active?.scriptURL ?? null,
        waiting: registration.waiting?.scriptURL ?? null,
        installing: registration.installing?.scriptURL ?? null,
        caches: cachesWithEntries,
      }
    })()`)
  }

  async dumpIndexedDb() {
    return this.evaluate(`(async () => {
      const databases = typeof indexedDB.databases === 'function'
        ? await indexedDB.databases()
        : []
      const output = []
      for (const databaseInfo of databases) {
        if (!databaseInfo.name) continue
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseInfo.name)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const stores = {}
        for (const storeName of database.objectStoreNames) {
          stores[storeName] = await new Promise((resolve, reject) => {
            const request = database
              .transaction(storeName, 'readonly')
              .objectStore(storeName)
              .getAll()
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
        }
        database.close()
        output.push({ name: databaseInfo.name, version: databaseInfo.version, stores })
      }
      return output
    })()`)
  }
}

export const fakeAssessmentClockScript = `(() => {
  const NativeDate = Date
  let offsetMilliseconds = 0
  class QaDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [NativeDate.now() + offsetMilliseconds]))
    }
    static now() {
      return NativeDate.now() + offsetMilliseconds
    }
  }
  QaDate.parse = NativeDate.parse
  QaDate.UTC = NativeDate.UTC
  globalThis.Date = QaDate
  globalThis.__qaAdvanceTime = (milliseconds) => {
    offsetMilliseconds += milliseconds
    return offsetMilliseconds
  }
})()`
