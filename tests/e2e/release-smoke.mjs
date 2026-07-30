import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const distDirectory = path.join(projectRoot, 'dist')

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function referencedAssets(html) {
  return [...html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)].map(
    (match) => match[1],
  )
}

async function verifyLocalBuild() {
  assert.equal(
    await exists(distDirectory),
    true,
    'dist/ is missing; run pnpm build before release smoke.',
  )
  const [html, manifestText, serviceWorker, entries] =
    await Promise.all([
      readFile(path.join(distDirectory, 'index.html'), 'utf8'),
      readFile(
        path.join(distDirectory, 'manifest.webmanifest'),
        'utf8',
      ),
      readFile(path.join(distDirectory, 'sw.js'), 'utf8'),
      readdir(path.join(distDirectory, 'assets')),
    ])
  const manifest = JSON.parse(manifestText)

  assert.equal(manifest.name, '英语学习')
  assert.equal(manifest.short_name, '英语学习')
  assert.equal(manifest.lang, 'zh-CN')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.orientation, 'portrait')
  assert.equal(manifest.start_url, './')
  assert.equal(manifest.scope, './')
  assert.equal(manifest.id, './')
  assert.ok(
    manifest.icons.some(
      (icon) =>
        icon.sizes === '192x192' &&
        icon.type === 'image/png',
    ),
  )
  assert.ok(
    manifest.icons.some(
      (icon) =>
        icon.sizes === '512x512' &&
        String(icon.purpose).includes('maskable'),
    ),
  )

  for (const asset of referencedAssets(html)) {
    assert.equal(
      await exists(path.join(distDirectory, asset)),
      true,
      `index.html references missing ${asset}`,
    )
  }
  for (const icon of manifest.icons) {
    assert.equal(
      await exists(path.join(distDirectory, icon.src)),
      true,
      `manifest references missing ${icon.src}`,
    )
  }

  const jsonAssets = entries.filter((entry) => entry.endsWith('.json'))
  assert.equal(
    jsonAssets.length,
    7,
    'Expected the manifest, four weeks, listening exercises, and bilingual option JSON.',
  )
  for (const asset of jsonAssets) {
    assert.ok(
      serviceWorker.includes(`assets/${asset}`),
      `Service Worker does not precache assets/${asset}`,
    )
  }
  assert.ok(serviceWorker.includes('index.html'))
  assert.ok(serviceWorker.includes('manifest.webmanifest'))
  assert.ok(
    serviceWorker.includes('SKIP_WAITING') ||
      serviceWorker.includes('self.skipWaiting()'),
    'Service Worker does not activate new releases automatically.',
  )
  assert.ok(
    serviceWorker.includes('clientsClaim()') ||
      serviceWorker.includes('clients.claim()'),
    'Service Worker does not claim existing clients.',
  )
  assert.ok(
    serviceWorker.includes('cleanupOutdatedCaches()'),
    'Service Worker does not clean outdated precaches.',
  )

  return {
    mode: 'local-dist',
    manifest: 'pass',
    serviceWorker: 'pass',
    precachedCourseJson: jsonAssets.length,
    referencedAssets: referencedAssets(html).length,
  }
}

async function fetchOk(url) {
  const response = await fetch(url, { redirect: 'follow' })
  assert.equal(response.ok, true, `${url} returned ${response.status}`)
  return response
}

async function verifyLive(baseUrl) {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const [home, manifestResponse, worker] = await Promise.all([
    fetchOk(normalized),
    fetchOk(new URL('manifest.webmanifest', normalized)),
    fetchOk(new URL('sw.js', normalized)),
  ])
  assert.match(home.headers.get('content-type') ?? '', /text\/html/)
  assert.match(
    manifestResponse.headers.get('content-type') ?? '',
    /manifest|json|octet-stream/,
  )
  assert.match(
    worker.headers.get('content-type') ?? '',
    /javascript|octet-stream/,
  )
  const [html, manifest, serviceWorker] = await Promise.all([
    home.text(),
    manifestResponse.json(),
    worker.text(),
  ])
  const indexAssetMatch = html.match(
    /assets\/(index-[A-Za-z0-9_-]+\.js)/u,
  )
  assert.ok(indexAssetMatch, 'Live home does not reference an index asset.')
  const indexAsset = indexAssetMatch[1]
  const assetResponse = await fetchOk(
    new URL(`assets/${indexAsset}`, normalized),
  )
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.start_url, './')
  assert.ok(
    serviceWorker.includes('SKIP_WAITING') ||
      serviceWorker.includes('self.skipWaiting()'),
    'Live Service Worker does not activate new releases automatically.',
  )
  assert.ok(
    serviceWorker.includes('clientsClaim()') ||
      serviceWorker.includes('clients.claim()'),
    'Live Service Worker does not claim existing clients.',
  )
  assert.ok(
    serviceWorker.includes('cleanupOutdatedCaches()'),
    'Live Service Worker does not clean outdated precaches.',
  )
  for (const icon of manifest.icons) {
    await fetchOk(new URL(icon.src, normalized))
  }
  return {
    mode: 'live-http',
    baseUrl: normalized,
    home: home.status,
    manifest: manifestResponse.status,
    serviceWorker: worker.status,
    indexAsset,
    indexAssetStatus: assetResponse.status,
    icons: manifest.icons.length,
  }
}

const result = process.env.QA_BASE_URL
  ? await verifyLive(process.env.QA_BASE_URL)
  : await verifyLocalBuild()

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
