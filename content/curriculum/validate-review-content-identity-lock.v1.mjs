import assert from 'node:assert/strict'
import fs from 'node:fs'

const lockPath = 'content/curriculum/review-content-identity-lock.v1.json'
const indexPath = 'content/curriculum/review-content-index.v1.json'
assert.ok(fs.existsSync(lockPath), 'Released review identities require an explicit compatibility lock.')
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
const aliases = index.schemaVersion === 2
  ? Object.assign({}, ...index.shards.map((shard) => JSON.parse(fs.readFileSync(shard.path, 'utf8')).aliases))
  : index.aliases
assert.equal(lock.schemaVersion, 1)
assert.equal(lock.documentType, 'review-content-identity-lock')
for (const [alias, identity] of Object.entries(lock.aliases)) {
  const released = aliases[alias]
  assert.ok(released, `Locked alias ${alias} is no longer released.`)
  assert.equal(released.reviewContentId, identity.reviewContentId, `Stable review identity drifted for ${alias}.`)
}
console.log(`review content identity lock verified: ${Object.keys(lock.aliases).length} aliases`)
