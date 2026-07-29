import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const contractsPath = 'src/learning-engine/contracts.ts'

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const contracts = readText(contractsPath)
const requestMatch = contracts.match(
  /export interface ExtraTrainingSupplyRequest \{([\s\S]*?)\n\}/,
)

assert(requestMatch, '04 must publish ExtraTrainingSupplyRequest.')

const request = requestMatch[1]
const priorityItemIdsType = contracts.match(
  /export type ExtraTrainingPriorityItemIds\s*=\s*Readonly<\s*Record<\s*ExtraTrainingContentPriority,\s*readonly string\[\]\s*>\s*>/,
)

// Priority names alone are not executable. 05 can return an exact published
// candidate only when 04 supplies the prior candidate identities that justify
// each priority bucket. `new-optional-content` intentionally needs no input.
assert(
  /readonly priorityItemIds:\s*ExtraTrainingPriorityItemIds/.test(request) && priorityItemIdsType,
  'ExtraTrainingSupplyRequest must publish priorityItemIds as published training-supply item IDs for recent-error, due-review, and same-day-variant resolution.',
)

console.log(JSON.stringify({
  schemaVersion: 1,
  contract: 'extra-training-priority-input',
  status: 'passed',
}, null, 2))
