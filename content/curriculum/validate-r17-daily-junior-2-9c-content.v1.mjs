import assert from 'node:assert/strict';import fs from 'node:fs'
const p=JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json','utf8')),xs=p.lessonFiles.flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')).lessons).flatMap(l=>l.learningUnits.filter(u=>u.domain==='vocabulary').flatMap(u=>u.activity.items.map(i=>({...i,u})))),d=i=>i.growthDifficultyLevel??i.u.difficultyLevel,b=xs.filter(i=>i.id.startsWith('r17-daily-j2c-'))
assert.equal(b.length,65);assert.equal(xs.filter(i=>d(i)===4).length,201)
for(const i of b){assert.equal(i.growthDifficultyLevel,4);assert.match(i.dailyKnowledgeId,/^daily-knowledge-v1:j2c:[0-9]{3}$/);assert.ok(i.term&&i.meaningZh&&i.exampleEn&&i.exampleZh);assert.ok(!/[；;/／]/u.test(i.meaningZh))}
console.log('R17 junior-2 9C verified')
