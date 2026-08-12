import assert from 'node:assert/strict'
import fs from 'node:fs'
const index=JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json','utf8'))
const items=index.lessonFiles.flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')).lessons).flatMap(l=>l.learningUnits.filter(u=>u.domain==='vocabulary').flatMap(u=>u.activity.items.map(item=>({...item,unit:u}))))
const difficulty=item=>item.growthDifficultyLevel??item.unit.difficultyLevel
const normalize=value=>value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()
const batch=items.filter(item=>item.id.startsWith('r17-daily-p6c-'))
assert.equal(batch.length,54)
for(const level of [0,.5,1,1.5,2,2.5,3])assert.equal(items.filter(item=>difficulty(item)===level).length,200)
for(const prefix of ['p6a','p6b'])assert.equal(items.filter(item=>item.id.startsWith(`r17-daily-${prefix}-`)).length,prefix==='p6a'?55:54)
for(const item of batch){assert.equal(item.growthDifficultyLevel,3);assert.match(item.dailyKnowledgeId,/^daily-knowledge-v1:p6c:[0-9]{3}$/);assert.ok(item.term.trim()&&item.meaningZh.trim()&&item.exampleEn.trim()&&item.exampleZh.trim());assert.ok(!/[；;/／]/u.test(item.meaningZh));assert.ok(normalize(item.exampleEn).includes(normalize(item.term)));assert.equal(items.filter(candidate=>normalize(candidate.term)===normalize(item.term)).length,1);assert.ok(!('sceneKnowledgeId'in item)&&!('sceneId'in item))}
console.log('R17 daily primary-6 7C content quality verified')
