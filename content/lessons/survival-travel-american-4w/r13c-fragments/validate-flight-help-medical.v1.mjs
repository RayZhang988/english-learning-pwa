import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../../../../', import.meta.url)
const readJson = async (relativePath) => JSON.parse(await readFile(new URL(relativePath, root), 'utf8'))
const fragmentPath = 'content/lessons/survival-travel-american-4w/r13c-fragments/flight-help-medical.v1.json'
const fragment = await readJson(fragmentPath)
const base = await readJson('content/lessons/survival-travel-american-4w/scene-vocabulary-questions.v1.json')

const expectedCounts = new Map([
  ['on-plane', 21], ['immigration', 21], ['baggage-claim', 21], ['customs-inspection', 21],
  ['currency-exchange', 21], ['airport-transport', 21], ['help-from-passersby', 21],
  ['restroom', 21], ['network-communication', 21], ['medical-pharmacy', 42],
])
const normalize = (text) => text.toLocaleLowerCase('en-US').replace(/[’']/g, "'").replace(/[^a-z0-9]+/g, ' ').trim()
const countOccurrence = (text, target) => text.toLocaleLowerCase('en-US').split(target.toLocaleLowerCase('en-US')).length - 1

assert.equal(fragment.schemaVersion, 1)
assert.equal(fragment.documentType, 'r13c-scene-vocabulary-fragment')
assert.equal(fragment.contentVersion, '1.0.0')
assert.equal(fragment.fragmentId, 'r13c-flight-help-medical')
assert.equal(fragment.entries.length, 231)
assert.deepEqual(new Set(fragment.sceneBindings.map(({ sceneId }) => sceneId)), new Set(expectedCounts.keys()))

const canonicalByScene = new Map(fragment.sceneBindings.map(({ sceneId, canonicalSceneId }) => [sceneId, canonicalSceneId]))
const existingTargets = new Map(base.scenes.map((scene) => [scene.sceneId, new Set(scene.questions.map((q) => normalize(q.targetText)))]))
const seenIds = new Set()
const groups = new Map([...expectedCounts.keys()].map((sceneId) => [sceneId, []]))

for (const entry of fragment.entries) {
  assert.match(entry.id, /^r13c-[a-z0-9-]+-[0-9]{2}$/)
  assert.ok(!seenIds.has(entry.id), `Duplicate id: ${entry.id}`)
  seenIds.add(entry.id)
  assert.ok(groups.has(entry.sceneId), `Unknown scene: ${entry.sceneId}`)
  assert.match(entry.sentenceEn, /^[^\u3400-\u9fff]+$/u)
  assert.match(entry.targetText, /^\S(?:.*\S)?$/u)
  assert.equal(countOccurrence(entry.sentenceEn, entry.targetText), 1, `${entry.id} needs one stable target span`)
  assert.ok(entry.meaningZh.trim())
  assert.equal(entry.distractorMeaningsZh.length, 3)
  assert.equal(new Set(entry.distractorMeaningsZh).size, 3)
  assert.ok(!entry.distractorMeaningsZh.includes(entry.meaningZh), `${entry.id} repeats the answer`)
  assert.deepEqual(Object.keys(entry.source).sort(), ['kind', 'rights', 'sceneBasis', 'sourceId'])
  assert.equal(entry.source.kind, 'project-authored-controlled-text')
  assert.equal(entry.source.rights, 'original-project-content')
  assert.equal(entry.source.sourceId, entry.id)
  assert.ok(entry.source.sceneBasis.trim())
  groups.get(entry.sceneId).push(entry)
}

for (const [sceneId, expectedCount] of expectedCounts) {
  const entries = groups.get(sceneId)
  assert.equal(entries.length, expectedCount, `${sceneId} count`)
  const targets = entries.map(({ targetText }) => normalize(targetText))
  assert.equal(new Set(targets).size, expectedCount, `${sceneId} has duplicate normalized targets`)
  const old = existingTargets.get(canonicalByScene.get(sceneId))
  for (const target of targets) assert.ok(!old.has(target), `${sceneId} reuses R13-B target: ${target}`)
}

console.log(JSON.stringify({
  status: 'passed', fragment: fragment.fragmentId, entries: fragment.entries.length,
  sceneCounts: Object.fromEntries([...expectedCounts]),
  targetPolicy: 'unique within scene; excludes the six existing R13-B targets in the canonical scene',
  aliases: Object.fromEntries(fragment.sceneBindings.filter(({ sceneId, canonicalSceneId }) => sceneId !== canonicalSceneId).map(({ sceneId, canonicalSceneId }) => [sceneId, canonicalSceneId])),
}, null, 2))
