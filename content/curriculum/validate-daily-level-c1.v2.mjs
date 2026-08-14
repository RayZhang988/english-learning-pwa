import fs from 'node:fs'
import { auditDailyLevelQuality } from './audit-daily-level-quality.v2.mjs'
const writeMode=process.argv.includes('--write'),read=(path)=>JSON.parse(fs.readFileSync(path,'utf8'))
const normalize=(value)=>value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g,' ').trim(),normalizeZh=(value)=>value.trim().replace(/\s+/g,'')
const assert=(condition,message)=>{if(!condition)throw new Error(`C1: ${message}`)}
const a=read('content/curriculum/daily-level-content-batch-a.v2.json'),b=read('content/curriculum/daily-level-content-batch-b.v2.json'),c=read('content/curriculum/daily-level-content-c1.v2.json'),migration=read('content/curriculum/daily-level-identity-migration-c1.v1.json'),rubric=read('content/curriculum/daily-level-rubric.v2.json'),index=read('content/curriculum/package-index.v1.json')
const released=index.lessonFiles.flatMap((file)=>read(file).lessons).flatMap((lesson)=>lesson.learningUnits.filter((unit)=>unit.domain==='vocabulary').flatMap((unit)=>unit.activity.items.map((item)=>({...item,difficulty:item.growthDifficultyLevel??unit.difficultyLevel}))))
const old=released.filter((row)=>row.difficulty===5),later=released.filter((row)=>row.difficulty>5)
assert(c.records.length===200&&new Set(c.records.map((row)=>row.dailyKnowledgeId)).size===200,'C1 must contain 200 unique v2 identities.')
assert(new Set([...a.records,...b.records,...c.records].map((row)=>normalize(row.term))).size===2200,'A+B+C1 English forms overlap.')
assert(c.records.every((row)=>row.authoring?.contentReviewStatus==='candidate-reviewed'&&row.authoring.travelUse==='complex-travel-resolution'),'author metadata is incomplete.')
const banned=/\b(legal options|formal review|official terms|permits an exception|travel companion.?s booking|before i finalize my travel plans|provide written details about|affects my itinerary)\b/iu
assert(c.records.every((row)=>!banned.test(row.term)),'mechanical or legalistic language remains.')
const audit=auditDailyLevelQuality([...a.records,...b.records,...c.records].map((row)=>({...row,difficulty:row.growthDifficultyLevel})),rubric),level=audit.levels[10]
assert(level.metrics.count===200&&level.violations.length===0,`rubric violations: ${level.violations.join(', ')}`)
assert(audit.crossLevelDuplicateForms.length===0,'cross-level English forms remain.')
assert(level.metrics.averageTokens>audit.levels[9].metrics.averageTokens,'C1 average tokens do not exceed junior-3.')
assert(level.metrics.maximumOpeningCluster<=5&&level.metrics.maximumSkeletonCluster<=5,'C1 template cluster exceeds five.')
assert(migration.sourceRecordCount===old.length&&migration.entries.length===old.length,'migration does not cover every old senior-1 source.')
const oldById=new Map(old.map((row)=>[row.id,row])),newById=new Map(c.records.map((row)=>[row.dailyKnowledgeId,row]))
for(const entry of migration.entries){const source=oldById.get(entry.sourceItemId);assert(source,`unknown source ${entry.sourceItemId}`);if(entry.disposition==='equivalent'){const target=newById.get(entry.targetDailyKnowledgeId);assert(target&&normalize(source.term)===normalize(target.term)&&normalizeZh(source.meaningZh)===normalizeZh(target.meaningZh),'false equivalent')}else assert(entry.disposition==='retired'&&!entry.evidenceTransferAllowed&&!entry.targetDailyKnowledgeId,'unsafe retirement')}
const dispositions=Object.fromEntries(Object.entries(Object.groupBy(migration.entries,(row)=>row.disposition)).map(([name,rows])=>[name,rows.length])),laterForms=new Set(later.map((row)=>normalize(row.term))),conflicts=c.records.filter((row)=>laterForms.has(normalize(row.term))).map((row)=>({dailyKnowledgeId:row.dailyKnowledgeId,term:row.term}))
const report={schemaVersion:1,documentType:'daily-level-batch-quality-audit',auditVersion:'2.0.0-c1',releaseStatus:'candidate-blocked-until-c2-c5',records:200,combinedRecords:2200,level:{id:level.id,labelZh:level.labelZh,metrics:level.metrics},crossLevelDuplicateForms:0,templateMaximums:{sharedOpeningFourTokens:level.metrics.maximumOpeningCluster,sharedSkeleton:level.metrics.maximumSkeletonCluster},identityMigration:{sourceRecords:old.length,...dispositions,newV2Identities:migration.newIdentities.length},remainingWork:{levels:['高二','高三','大学四级','大学六级'],pendingOldLaterConflictCount:conflicts.length,pendingOldLaterConflicts:conflicts,formalIndexesRegenerated:false}}
const output='content/curriculum/daily-level-c1-quality-audit.v2.json',serialized=`${JSON.stringify(report,null,2)}\n`;if(writeMode)fs.writeFileSync(output,serialized);else assert(fs.readFileSync(output,'utf8')===serialized,`${output} is stale.`)
console.log(`C1 valid: 200 records; ${dispositions.equivalent??0} equivalent; ${dispositions.retired??0} retired.`)
