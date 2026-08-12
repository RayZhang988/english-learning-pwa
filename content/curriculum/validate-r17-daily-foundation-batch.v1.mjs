import assert from 'node:assert/strict'
import fs from 'node:fs'

const audit = JSON.parse(fs.readFileSync('content/curriculum/r17-knowledge-capacity-audit.v2.json', 'utf8'))
const kindergarten = audit.levelCapacity.levels.find((level) => level.id === 'kindergarten')
assert(kindergarten, 'Kindergarten level is missing.')
assert.equal(kindergarten.currentDailyKnowledgePoints, 200, 'Kindergarten 1A + 1B + 1C must contain exactly 200 daily knowledge points.')
assert.equal(kindergarten.missingDailyKnowledgePoints, 0, 'Kindergarten capacity gap must be closed after 1C.')
assert.equal(audit.identityBoundary.sceneParticipatesInR17Growth, false)
assert.equal(audit.identityBoundary.lexicalOverlapCreatesReference, false)
console.log('R17 daily foundation batch capacity verified')
