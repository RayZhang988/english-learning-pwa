import { spawn } from 'node:child_process'

const scripts = [
  'tests/e2e/r13b-scene-vocabulary-browser-acceptance.mjs',
  'tests/e2e/r13c-indexeddb-recovery-browser-acceptance.mjs',
]

for (const script of scripts) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  if (result.code !== 0) {
    throw new Error(`${script} failed with ${result.signal ?? `exit code ${result.code}`}.`)
  }
}
