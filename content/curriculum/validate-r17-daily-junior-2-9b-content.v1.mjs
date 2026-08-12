import assert from 'node:assert/strict';import fs from 'node:fs'
const p=JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json','utf8')),xs=p.lessonFiles.flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')).lessons).flatMap(l=>l.learningUnits.filter(u=>u.domain==='vocabulary').flatMap(u=>u.activity.items.map(i=>({...i,u})))),d=i=>i.growthDifficultyLevel??i.u.difficultyLevel,n=v=>v.toLowerCase().replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim(),b=xs.filter(i=>i.id.startsWith('r17-daily-j2b-'))
assert.equal(b.length,66);assert.equal(xs.filter(i=>d(i)===4).length,135)
for(const i of b){assert.equal(i.growthDifficultyLevel,4);assert.match(i.dailyKnowledgeId,/^daily-knowledge-v1:j2b:[0-9]{3}$/);assert.ok(i.term&&i.meaningZh&&i.exampleEn&&i.exampleZh);assert.ok(!/[；;/／]/u.test(i.meaningZh));assert.equal(xs.filter(x=>n(x.term)===n(i.term)).length,1)}
console.log('R17 junior-2 9B verified')
