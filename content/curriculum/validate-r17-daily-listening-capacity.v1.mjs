import assert from 'node:assert/strict'
import fs from 'node:fs'
const bundle = JSON.parse(fs.readFileSync('content/lessons/survival-travel-american-4w/listening-exercises.v1.json', 'utf8'))
const manifest = JSON.parse(fs.readFileSync('content/curriculum/training-supply-index.v1.json', 'utf8'))
const candidates = manifest.shards.flatMap((shard) => JSON.parse(fs.readFileSync(shard.path, 'utf8')).candidates)
const levels = [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8]
const exercises = bundle.lessons.flatMap((lesson) => lesson.exercises)
const additions = exercises.filter((exercise) => exercise.exerciseId.startsWith('r17-listening-'))
assert.equal(exercises.length, 900)
assert.equal(additions.length, 760)
const uniqueAudioAnswerPairs = new Set()
for (const level of levels) {
  const exercisesAtLevel = candidates.filter((candidate) => candidate.domain === 'listening' && candidate.source.sourceType === 'listening-extension' && candidate.difficultyLevel === level)
  assert.equal(exercisesAtLevel.length, 60, `listening level ${level}`)
}
for (const exercise of additions) {
  assert.ok(exercise.targetKeywords.length === 1 && exercise.standardAnswer && exercise.acceptedAnswers.length)
  assert.ok(exercise.answerGuidance.guidanceZh.includes('共 1 项'))
  assert.ok(exercise.audioSource.ttsText && exercise.rationaleZh)
  const pair = `${exercise.audioSource.ttsText}\u0000${exercise.standardAnswer}`
  assert.ok(!uniqueAudioAnswerPairs.has(pair), `duplicate listening audio/answer pair: ${exercise.exerciseId}`)
  uniqueAudioAnswerPairs.add(pair)
}
console.log('R17 listening extension additions verified')
