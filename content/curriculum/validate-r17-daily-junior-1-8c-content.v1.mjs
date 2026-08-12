import assert from 'node:assert/strict'
import fs from 'node:fs'
const index=JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json','utf8'))
const items=index.lessonFiles.flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')).lessons).flatMap(l=>l.learningUnits.filter(u=>u.domain==='vocabulary').flatMap(u=>u.activity.items.map(item=>({...item,unit:u}))))
const level=item=>item.growthDifficultyLevel??item.unit.difficultyLevel
const norm=value=>value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()
const batch=items.filter(item=>item.id.startsWith('r17-daily-j1c-'))
assert.equal(batch.length,63)
for(const difficulty of [0,.5,1,1.5,2,2.5,3])assert.equal(items.filter(item=>level(item)===difficulty).length,200)
assert.equal(items.filter(item=>level(item)===3.5).length,200)
for(const item of batch){assert.equal(item.growthDifficultyLevel,3.5);assert.match(item.dailyKnowledgeId,/^daily-knowledge-v1:j1c:[0-9]{3}$/);assert.ok(item.term&&item.meaningZh&&item.exampleEn&&item.exampleZh);assert.ok(!/[；;/／]/u.test(item.meaningZh));assert.ok(norm(item.exampleEn).includes(norm(item.term)));assert.equal(items.filter(candidate=>norm(candidate.term)===norm(item.term)).length,1);assert.ok(!('sceneKnowledgeId'in item)&&!('sceneId'in item))}
console.log('R17 daily junior-1 8C content quality verified')
