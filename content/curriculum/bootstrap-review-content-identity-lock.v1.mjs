import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const baseline = process.argv[2]
if (!baseline) throw new Error('Usage: node bootstrap-review-content-identity-lock.v1.mjs <baseline-ref>')
const manifestPath = 'content/curriculum/review-content-index.v1.json'
const current = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const baselineManifest = JSON.parse(execFileSync('git', ['show', `${baseline}:${manifestPath}`], { encoding: 'utf8' }))
const baselineShards = {}
for (const descriptor of baselineManifest.shards) {
  const shard = JSON.parse(execFileSync('git', ['show', `${baseline}:${descriptor.path}`], { encoding: 'utf8' }))
  Object.assign(baselineShards, shard.aliases)
}
const currentShards = {}
for (const descriptor of current.shards) {
  const shard = JSON.parse(fs.readFileSync(descriptor.path, 'utf8'))
  Object.assign(currentShards, shard.aliases)
}
const aliases = {}
for (const [alias, prior] of Object.entries(baselineShards)) {
  const currentIdentity = currentShards[alias]
  if (!currentIdentity) throw new Error(`Baseline alias is no longer released: ${alias}`)
  aliases[alias] = { reviewContentId: prior.reviewContentId, scoredFingerprint: currentIdentity.reviewContentId }
}
fs.writeFileSync('content/curriculum/review-content-identity-lock.v1.json', `${JSON.stringify({ schemaVersion: 1, documentType: 'review-content-identity-lock', baseReviewIndexRef: baseline, aliases })}\n`)
console.log(`review content identity lock created: ${Object.keys(aliases).length} aliases`)
