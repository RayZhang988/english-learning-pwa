import fs from 'node:fs'
const audit = JSON.parse(fs.readFileSync('content/curriculum/r17-growth-level-capacity-audit.v1.json', 'utf8'))
const levels = audit.domains.vocabulary.levels.filter((level) => level.isUpgradeTarget)
const blocked = levels.filter((level) => level.uniqueSourcePromptCount < 20)
if (blocked.length > 0) {
  throw new Error(`R17 vocabulary growth capacity is insufficient: ${blocked.map((level) => `${level.id}=${level.uniqueSourcePromptCount}/20`).join(', ')}`)
}
console.log('R17 vocabulary growth capacity verified: every upgrade target has 20 unique source prompts')
