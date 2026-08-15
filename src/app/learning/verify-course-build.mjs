import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import '../../../content/curriculum/validate-listening-bilingual-options.v1.mjs'
import '../../../content/curriculum/validate-scene-vocabulary-question-bank.v1.mjs'
import '../../../content/curriculum/validate-speaking-translations.v1.mjs'
import '../../../content/curriculum/validate-review-content-identity-lock.v1.mjs'

const distUrl = new URL('../../../dist/', import.meta.url)
const expectedCourseAssets = [
  {
    directory: 'content/curriculum/',
    prefix: 'package-index.v1-',
  },
  {
    directory: 'assets/',
    prefix: 'survival-travel-american-4w.v1-',
  },
  { directory: 'assets/', prefix: 'week-1.v1-' },
  { directory: 'assets/', prefix: 'week-2.v1-' },
  { directory: 'assets/', prefix: 'week-3.v1-' },
  { directory: 'assets/', prefix: 'week-4.v1-' },
  {
    directory: 'content/curriculum/',
    prefix: 'listening-exercise-extension-index.v1-',
  },
  {
    directory: 'content/curriculum/',
    prefix: 'training-supply-index.v1-',
  },
  {
    directory: 'content/curriculum/',
    prefix: 'review-content-index.v1-',
  },
  { directory: 'assets/', prefix: 'scene-vocabulary-questions.v1-' },
  { directory: 'assets/', prefix: 'listening-exercises.v1-' },
  {
    directory: 'assets/',
    prefix: 'listening-choice-bilingual-options.v1-',
  },
]

async function listFiles(directoryUrl, relativeDirectory = '') {
  const entries = await readdir(directoryUrl, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}${entry.name}`
    if (entry.isDirectory()) {
      files.push(
        ...(await listFiles(
          new URL(`${entry.name}/`, directoryUrl),
          `${relativePath}/`,
        )),
      )
    } else {
      files.push(relativePath)
    }
  }
  return files
}

const files = await listFiles(distUrl)
const courseAssetFiles = expectedCourseAssets.map(
  ({ directory, prefix }) => {
    const matches = files.filter(
      (fileName) =>
        fileName.startsWith(`${directory}${prefix}`) &&
        fileName.endsWith('.json'),
    )
    assert.equal(
      matches.length,
      1,
      `Expected one published course asset matching ${directory}${prefix}, found ${matches.length}.`,
    )
    return matches[0]
  },
)

const shardedCourseAssets = files.filter((fileName) =>
  (fileName.startsWith('assets/vocabulary-') ||
    fileName.startsWith('assets/listening-') ||
    fileName.startsWith('assets/speaking-') ||
    fileName.startsWith('assets/scene-vocabulary-')) &&
  fileName.endsWith('.json'),
)
assert.ok(
  shardedCourseAssets.length >= 40,
  `Expected all supply/review shards to be emitted, found ${shardedCourseAssets.length}.`,
)
courseAssetFiles.push(...shardedCourseAssets)

const migrationAssets = files.filter((fileName) =>
  (fileName.startsWith('assets/daily-level-content-') ||
    fileName.startsWith('content/curriculum/daily-level-identity-migration.v2-') ||
    fileName.startsWith('content/curriculum/wrong-answer-review-identity-migration.v1-')) &&
  fileName.endsWith('.json'),
)
assert.equal(
  migrationAssets.length,
  9,
  `Expected seven v2 level batches and two identity mappings, found ${migrationAssets.length}.`,
)
courseAssetFiles.push(...migrationAssets)

const packageIndexAssetFile = courseAssetFiles.find((fileName) =>
  fileName.startsWith('content/curriculum/package-index.v1-'),
)
assert.ok(
  packageIndexAssetFile,
  'Published package index asset is missing.',
)
const publishedPackageIndex = JSON.parse(
  await readFile(new URL(packageIndexAssetFile, distUrl), 'utf8'),
)
assert.equal(
  publishedPackageIndex.trainingSupplyIndexFile,
  'content/curriculum/training-supply-index.v1.json',
  'Published package index must declare the released training supply index.',
)

const javascriptFiles = files.filter(
  (fileName) =>
    fileName.startsWith('assets/') && fileName.endsWith('.js'),
)
const javascript = (
  await Promise.all(
    javascriptFiles.map((fileName) =>
      readFile(new URL(fileName, distUrl), 'utf8'),
    ),
  )
).join('\n')
assert.doesNotMatch(
  javascript,
  /data:application\/json/u,
  'Course JSON must remain a fetchable same-origin asset, not a data URL.',
)

const serviceWorker = await readFile(new URL('sw.js', distUrl), 'utf8')
for (const fileName of courseAssetFiles) {
  const chunkRelativeReference = fileName.startsWith('assets/')
    ? fileName.slice('assets/'.length)
    : `../${fileName}`
  assert.ok(
    javascript.includes(chunkRelativeReference),
    `Application bundle does not reference ${fileName} relative to its chunk.`,
  )
  assert.ok(
    serviceWorker.includes(fileName),
    `Service worker does not precache ${fileName}.`,
  )
  JSON.parse(await readFile(new URL(fileName, distUrl), 'utf8'))

  const deployedUrl = new URL(
    chunkRelativeReference,
    new URL(
      'assets/application.js',
      'https://rayzhang988.github.io/english-learning-pwa/',
    ),
  )
  assert.equal(
    deployedUrl.pathname,
    new URL(
      fileName,
      'https://rayzhang988.github.io/english-learning-pwa/',
    ).pathname,
    `${fileName} resolves outside its emitted GitHub Pages location.`,
  )
  assert.ok(
    deployedUrl.pathname.startsWith('/english-learning-pwa/'),
    `${fileName} escapes the GitHub Pages base path.`,
  )
}

const indexHtml = await readFile(new URL('index.html', distUrl), 'utf8')
assert.match(
  indexHtml,
  /(?:src|href)="\.\/(?:assets\/|manifest\.webmanifest)/u,
  'Production entry points must use paths relative to the deployment directory.',
)

console.log(
  JSON.stringify(
    {
      status: 'passed',
      emittedCourseAssets: courseAssetFiles,
      precachedCourseAssets: courseAssetFiles.length,
      inlinedCourseJson: 0,
    },
    null,
    2,
  ),
)
