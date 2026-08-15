import fs from 'node:fs'
const W=process.argv.includes('--write'),R=p=>JSON.parse(fs.readFileSync(p,'utf8')),A=(c,m)=>{if(!c)throw Error(`QA-R17-003 complete: ${m}`)}
const cf=['daily-level-content-batch-a.v2.json','daily-level-content-batch-b.v2.json','daily-level-content-c1.v2.json','daily-level-content-c2.v2.json','daily-level-content-c3.v2.json','daily-level-content-c4.v2.json','daily-level-content-c5.v2.json']
const mf=['daily-level-identity-migration-batch-a.v1.json','daily-level-identity-migration-batch-b.v1.json','daily-level-identity-migration-c1.v1.json','daily-level-identity-migration-c2.v1.json','daily-level-identity-migration-c3.v1.json','daily-level-identity-migration-c4.v1.json','daily-level-identity-migration-c5.v1.json']
const records=cf.flatMap(f=>R(`content/curriculum/${f}`).records),ms=mf.map(f=>R(`content/curriculum/${f}`)),entries=ms.flatMap(x=>x.entries),newIds=ms.flatMap(x=>x.newIdentities),targets=new Set(records.map(x=>x.dailyKnowledgeId)),mapped=entries.flatMap(x=>x.targetDailyKnowledgeId?[x.targetDailyKnowledgeId]:[])
A(records.length===3000&&targets.size===3000,'candidate identities must be 3000 unique')
A(entries.length===3005&&new Set(entries.map(x=>x.sourceItemId)).size===3005,'must cover 3005 unique sources')
A(mapped.every(x=>targets.has(x))&&new Set([...mapped,...newIds]).size===3000,'migration coverage mismatch')
A(entries.filter(x=>x.evidenceTransferAllowed).every(x=>['equivalent','moved-equivalent'].includes(x.disposition)&&x.targetDailyKnowledgeId),'unsafe evidence transfer')
const byLevel=Object.fromEntries(Object.entries(Object.groupBy(records,x=>x.levelId)).map(([k,v])=>[k,v.length]))
A(Object.keys(byLevel).length===15&&Object.values(byLevel).every(x=>x===200),'every level must own 200')
const dispositions=Object.fromEntries(Object.entries(Object.groupBy(entries,x=>x.disposition)).map(([k,v])=>[k,v.length]))
const formal='content/curriculum/daily-level-formal-publication.v2.json',published=fs.existsSync(formal)&&R(formal).formalIndexesRegenerated===true
const report={schemaVersion:1,documentType:'daily-level-rebuild-complete-handoff',version:'2.0.0',releaseStatus:published?'formal-content-generated-awaiting-04-01-09-integration':'candidate-awaiting-04-01-09-integration',sourceRecords:3005,candidateRecords:3000,uniqueCandidateIdentities:3000,levels:byLevel,migration:{entries:3005,dispositions,evidenceTransfers:entries.filter(x=>x.evidenceTransferAllowed).length,newIdentityDeclarations:new Set(newIds).size,mappedTargetIdentities:new Set(mapped).size,completeCoverage:true},formalIndexesRegenerated:published,...(published?{formalPublicationReport:formal,formalMigrationFile:'content/curriculum/daily-level-identity-migration.v2.json'}:{}),nextOwners:{'04':'validate growth thresholds and migration semantics','01':'atomically switch daily content, supply, review and storage migration','09':'full local, deployed and device acceptance'},partialDeploymentAllowed:false}
const p='content/curriculum/daily-level-rebuild-complete-handoff.v2.json',s=`${JSON.stringify(report,null,2)}\n`
if(W)fs.writeFileSync(p,s);else A(fs.readFileSync(p,'utf8')===s,`${p} stale`)
console.log(`QA-R17-003 candidate complete: ${entries.length} sources -> ${records.length} candidates`)
