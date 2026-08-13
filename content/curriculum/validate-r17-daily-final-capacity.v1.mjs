import assert from 'node:assert/strict'
import fs from 'node:fs'

const audit = JSON.parse(fs.readFileSync('content/curriculum/r17-knowledge-capacity-audit.v2.json', 'utf8'))
const expected = new Map([
  ['senior-1', 200], ['senior-2', 200], ['senior-3', 200],
  ['cet-4-reference', 200], ['cet-6-reference', 200],
])
for (const level of audit.levelCapacity.levels) {
  if (expected.has(level.id)) assert.equal(level.currentDailyKnowledgePoints, expected.get(level.id), level.id)
}
assert.equal(audit.levelCapacity.levels.reduce((sum, level) => sum + level.currentDailyKnowledgePoints, 0), 3000)
console.log('R17 final daily capacity verified')
