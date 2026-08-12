import assert from 'node:assert/strict'
import fs from 'node:fs'

const audit = JSON.parse(fs.readFileSync('content/curriculum/r17-knowledge-capacity-audit.v2.json', 'utf8'))
const kindergarten = audit.levelCapacity.levels.find((level) => level.id === 'kindergarten')
assert(kindergarten, 'Kindergarten level is missing.')
assert.equal(kindergarten.currentDailyKnowledgePoints, 75, 'Kindergarten 1A must contain exactly 75 daily knowledge points.')
assert.equal(kindergarten.missingDailyKnowledgePoints, 125, 'Kindergarten must honestly report its remaining terminal gap.')
assert.equal(audit.identityBoundary.sceneParticipatesInR17Growth, false)
assert.equal(audit.identityBoundary.lexicalOverlapCreatesReference, false)
console.log('R17 daily foundation batch capacity verified')
