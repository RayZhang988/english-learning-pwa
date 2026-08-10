import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const candidates = []
for (let week = 1; week <= 4; week += 1) {
  const document = JSON.parse(
    await readFile(
      new URL(
        `../lessons/survival-travel-american-4w/week-${week}.v1.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  )
  for (const lesson of document.lessons) {
    for (const unit of lesson.learningUnits) {
      if (unit.domain !== 'speaking') continue
      for (const prompt of unit.activity.prompts ?? []) {
        candidates.push({ ...prompt, source: 'activity-prompt' })
      }
    }
    for (const item of lesson.sceneQuiz) {
      if (item.domain === 'speaking') {
        candidates.push({ ...item, source: 'scene-fixed-response' })
      }
    }
  }
}

assert.equal(candidates.length, 122, 'Published speaking translation coverage must match all 122 supply candidates.')
assert.equal(new Set(candidates.map(({ id }) => id)).size, 122, 'Published speaking translation identities must be unique.')

for (const candidate of candidates) {
  assert.equal(typeof candidate.id, 'string', 'Speaking translation identity must be a string.')
  assert.ok(candidate.id.trim(), 'Speaking translation identity must not be empty.')
  assert.equal(typeof candidate.modelAnswer, 'string', `${candidate.id}.modelAnswer must be a string.`)
  assert.ok(candidate.modelAnswer.trim(), `${candidate.id}.modelAnswer must not be empty.`)
  assert.equal(
    typeof candidate.modelAnswerTranslationZh,
    'string',
    `${candidate.id}.modelAnswerTranslationZh must be a string.`,
  )
  assert.ok(
    candidate.modelAnswerTranslationZh.trim(),
    `${candidate.id}.modelAnswerTranslationZh must not be empty.`,
  )
}

const activityPrompts = candidates.filter(({ source }) => source === 'activity-prompt').length
const sceneFixedResponses = candidates.filter(({ source }) => source === 'scene-fixed-response').length
assert.equal(activityPrompts, 94)
assert.equal(sceneFixedResponses, 28)

console.log(
  JSON.stringify(
    {
      status: 'passed',
      speakingTranslations: candidates.length,
      activityPrompts,
      sceneFixedResponses,
    },
    null,
    2,
  ),
)
