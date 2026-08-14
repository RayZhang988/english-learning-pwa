import fs from 'node:fs'

const writeMode = process.argv.includes('--write')
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
const normalizeZh = (value) => value.trim().replace(/\s+/g, '')
const tokens = (value) => value.toLocaleLowerCase('en-US').trim().split(/\s+/u).map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, '')).filter(Boolean)
const completeOpeners = new Set(['i','you','we','they','he','she','it','is','are','can','could','would','will','do','does','did','please','where','what','when','why','how'])
const isComplete = (value) => tokens(value).length >= 2 && completeOpeners.has(tokens(value)[0])
const isComplex = (value) => tokens(value).length >= 4 && (/\b(if|unless|although|because|whether|while|before|after|which|who|that)\b/iu.test(value) || /[,;]/u.test(value))
const opening = (value) => tokens(value).slice(0, 4).join(' ')
const skeleton = (value) => {
  if (tokens(value).length < 4) return `short:${normalize(value)}`
  const stop = new Set(['a','an','the','i','you','my','me','this','that','it','is','are','was','were','to','for','of','in','on','at','with'])
  return tokens(value).map((token) => stop.has(token) ? token : '{x}').join(' ')
}
function fingerprint(value) { let hash=0x811c9dc5;for(const character of value){hash^=character.charCodeAt(0);hash=Math.imul(hash,0x01000193)}return(hash>>>0).toString(16).padStart(8,'0') }
const key = (row) => `${normalize(row.term)}|${normalizeZh(row.meaningZh)}`
const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'))

function parseAssessment() {
  const source=fs.readFileSync('content/assessment/travel-vocabulary-data.r1.ts','utf8')
  return Object.fromEntries([...source.matchAll(/'([^']+)': `([\s\S]*?)`/gu)].map((match)=>[match[1],match[2].trim().split('\n').map((row)=>{const[term,meaningZh]=row.split('|');return{term,meaningZh}})]))
}
function releasedItems() {
  const index=read('content/curriculum/package-index.v1.json')
  return index.lessonFiles.flatMap((file)=>read(file).lessons).flatMap((lesson)=>lesson.learningUnits.filter((unit)=>unit.domain==='vocabulary').flatMap((unit)=>unit.activity.items.map((item)=>({...item,difficulty:item.growthDifficultyLevel??unit.difficultyLevel}))))
}

function author() {
  const stages=parseAssessment(), released=releasedItems(), batchA=read('content/curriculum/daily-level-content-batch-a.v2.json')
  const usedForms=new Set(batchA.records.map((row)=>normalize(row.term)))
  const stage5Priority=['embark','disembark','evacuation','overbooking','manifest','capacity','dispatch','routing','operator','credential','biometric','terrain','peninsula','archipelago','glacier','ecotourism','shrine','cathedral','mosque','fortress','delicacy','fermentation','seasoning','garnish','dietary','intolerance','hygiene','advisory','precaution','hazard','exposure','outbreak','pickpocket','humidity','visibility','forecast','claim','coverage','verify']
  const stage5ByTerm=new Map(stages['stage-5-specialized'].map((row)=>[normalize(row.term),row]))
  const wordPool=[...stages['stage-4-advanced'],...stage5Priority.map((term)=>stage5ByTerm.get(term))].filter((row)=>row&&!usedForms.has(normalize(row.term)))
  const wordCounts=[50,30,20,10,6,0]
  let wordCursor=0
  const words=wordCounts.map((count)=>{const rows=wordPool.slice(wordCursor,wordCursor+count);wordCursor+=count;rows.forEach((row)=>usedForms.add(normalize(row.term)));return rows})

  const curatedPhrases=fs.readFileSync('content/curriculum/daily-level-batch-b-phrases.v2.txt','utf8').trim().split('\n').map((line,index)=>{const[term,meaningZh]=line.split('|');return{term,meaningZh,difficulty:2+Math.min(2.5,Math.floor(index/32)*0.5),authorPriority:0,id:`qa-r17-003-b-phrase-${String(index+1).padStart(3,'0')}`}})
  const curatedUtterances=fs.readFileSync('content/curriculum/daily-level-batch-b-utterances.v2.txt','utf8').trim().split('\n').map((line,index)=>{const[term,meaningZh]=line.split('|');return{term,meaningZh,difficulty:index<130?4:4.5,authorPriority:0,reservedForJunior3:index>=130,id:`qa-r17-003-b-utterance-${String(index+1).padStart(3,'0')}`}})
  const unnatural=/\b(legal options|available remedies|next formal step|official terms|preserve my rights|reasoned decision|documented resolution|authority and time limit|qualifies for compensation|appropriate authority|please document why|provide written details about|explain how .* affects my itinerary|tell me what evidence is required for|before i finalize my travel plans)\b/iu
  const tooEasyForIntermediate=/\b(refund appear on my card|when my ride arrives|room away from the elevator|boarding pass for the new flight|get off at the next stop|table away from the kitchen|pass on the airport train|pick me up at the side entrance|receipt for the refund|printed copy for the border officer|table for two|this in my size|exchange it for another size|connect to wi-fi|make an international call|bring this on the plane|help with my boarding pass|move me to another room)\b/iu
  const phrasePool=[...new Map([...curatedPhrases,...curatedUtterances,...released.filter((row)=>tokens(row.term).length>=2)].filter((row)=>!usedForms.has(normalize(row.term))&&!unnatural.test(row.term)).map((row)=>[normalize(row.term),row])).values()]
    .sort((left,right)=>left.difficulty-right.difficulty||(left.authorPriority??1)-(right.authorPriority??1)||tokens(left.term).length-tokens(right.term).length||left.id.localeCompare(right.id))
  const usedPhraseForms=new Set()
  const takeRows=({count,complete,minTokens,maxTokens,complexTarget,levelDifficulty})=>{
    const candidates=phrasePool.filter((row)=>!usedPhraseForms.has(normalize(row.term))&&isComplete(row.term)===complete&&tokens(row.term).length>=minTokens&&tokens(row.term).length<=maxTokens&&(!row.reservedForJunior3||levelDifficulty===4.5)&&(levelDifficulty!==4.5||!complete||row.authorPriority===0)&&(levelDifficulty<4||!tooEasyForIntermediate.test(row.term)))
      .sort((left,right)=>Math.abs(left.difficulty-levelDifficulty)-Math.abs(right.difficulty-levelDifficulty)||(left.authorPriority??1)-(right.authorPriority??1)||tokens(left.term).length-tokens(right.term).length||left.id.localeCompare(right.id))
    const complex=candidates.filter((row)=>isComplex(row.term)), simple=candidates.filter((row)=>!isComplex(row.term))
    const desired=[...simple.slice(0,count-complexTarget),...complex.slice(0,complexTarget)]
    const selected=[],openingCounts=new Map(),skeletonCounts=new Map()
    let selectedComplex=0
    const accept=(row)=>{const o=opening(row.term),s=skeleton(row.term),complexRow=isComplex(row.term);if((openingCounts.get(o)??0)>=6||(skeletonCounts.get(s)??0)>=8||(complexRow&&selectedComplex>=complexTarget))return false;selected.push(row);if(complexRow)selectedComplex+=1;openingCounts.set(o,(openingCounts.get(o)??0)+1);skeletonCounts.set(s,(skeletonCounts.get(s)??0)+1);return true}
    for(const row of desired)accept(row)
    if(selected.length<count){for(const row of candidates){if(selected.includes(row))continue;accept(row);if(selected.length===count)break}}
    if(selected.length!==count)throw new Error(`Only ${selected.length}/${count} ${complete?'complete':'phrase'} rows satisfy level ${levelDifficulty}.`)
    selected.forEach((row)=>usedPhraseForms.add(normalize(row.term)))
    return selected.map(({term,meaningZh})=>({term,meaningZh}))
  }
  const definitions=[
    {id:'primary-4',labelZh:'四年级',difficulty:2,frequency:'common',abstraction:'immediate-function',words:50,phrases:80,complete:70,minComplete:4,max:6,complex:5},
    {id:'primary-5',labelZh:'五年级',difficulty:2.5,frequency:'common',abstraction:'immediate-function',words:30,phrases:70,complete:100,minComplete:5,max:7,complex:12},
    {id:'primary-6',labelZh:'六年级',difficulty:3,frequency:'functional',abstraction:'immediate-function',words:20,phrases:60,complete:120,minComplete:6,max:8,complex:20},
    {id:'junior-1',labelZh:'初一',difficulty:3.5,frequency:'functional',abstraction:'multi-step-function',words:10,phrases:50,complete:140,minComplete:7,max:9,complex:30},
    {id:'junior-2',labelZh:'初二',difficulty:4,frequency:'functional',abstraction:'multi-step-function',words:6,phrases:34,complete:160,minComplete:7,max:10,complex:40},
    {id:'junior-3',labelZh:'初三',difficulty:4.5,frequency:'functional',abstraction:'multi-step-function',words:0,phrases:20,complete:180,minComplete:8,max:11,complex:55},
  ]
  const rowsByLevel=definitions.map((definition,index)=>[
    ...words[index],
    ...takeRows({count:definition.phrases,complete:false,minTokens:2,maxTokens:Math.min(6,definition.max),complexTarget:0,levelDifficulty:definition.difficulty}),
    ...takeRows({count:definition.complete,complete:true,minTokens:definition.minComplete,maxTokens:definition.max,complexTarget:definition.complex,levelDifficulty:definition.difficulty}),
  ])
  const records=definitions.flatMap((definition,index)=>{
    const rows=rowsByLevel[index];if(rows.length!==200)throw new Error(`${definition.id} has ${rows.length} records.`)
    return rows.map((row,sequence)=>{const form=normalize(row.term),tokenCount=tokens(row.term).length,surfaceType=tokenCount===1?'word':isComplete(row.term)?'functional-utterance':'short-phrase';return{
      sourceItemId:`qa-r17-003-b:${definition.id}:${String(sequence+1).padStart(3,'0')}`,
      dailyKnowledgeId:`daily-knowledge-v2:${tokenCount===1?'word':'phrase'}:${fingerprint(`${form}|${normalizeZh(row.meaningZh)}`)}`,
      levelId:definition.id,labelZh:definition.labelZh,growthDifficultyLevel:definition.difficulty,term:row.term,meaningZh:row.meaningZh,partOfSpeech:surfaceType,exampleEn:row.term,exampleZh:row.meaningZh,
      authoring:{lexicalFrequencyBand:definition.frequency,abstractionBand:definition.abstraction,surfaceType,grammarFeatures:surfaceType==='functional-utterance'?(isComplex(row.term)?['complex-spoken-turn']:['simple-spoken-turn']):[],travelUse:'daily-travel-independent',contentReviewStatus:'candidate-reviewed'},
    }})
  })
  const combined=[...batchA.records,...records]
  if(new Set(records.map((row)=>row.dailyKnowledgeId)).size!==1200||new Set(records.map((row)=>normalize(row.term))).size!==1200)throw new Error('Batch B identities or forms are not unique.')
  if(new Set(combined.map((row)=>normalize(row.term))).size!==2000)throw new Error('Batch A and B have duplicate English forms.')

  const oldBatch=released.filter((row)=>row.difficulty>=2&&row.difficulty<=4.5),newByContent=new Map(records.map((row)=>[key(row),row]))
  const entries=oldBatch.map((old)=>{
    const target=newByContent.get(key(old))
    return target ? {
      sourceDailyKnowledgeId:old.dailyKnowledgeId??`legacy-daily-source-v1:${old.id}`,
      sourceIdentityKind:old.dailyKnowledgeId?'stable-daily-knowledge-v1':'legacy-source-item-fallback',
      sourceItemId:old.id,
      disposition:old.difficulty===target.growthDifficultyLevel?'equivalent':'moved-equivalent',
      targetDailyKnowledgeId:target.dailyKnowledgeId,
      evidenceTransferAllowed:true,
    } : {
      sourceDailyKnowledgeId:old.dailyKnowledgeId??`legacy-daily-source-v1:${old.id}`,
      sourceIdentityKind:old.dailyKnowledgeId?'stable-daily-knowledge-v1':'legacy-source-item-fallback',
      sourceItemId:old.id,
      disposition:'retired',
      evidenceTransferAllowed:false,
    }
  })
  const mappedTargets=new Set(entries.flatMap((entry)=>entry.targetDailyKnowledgeId?[entry.targetDailyKnowledgeId]:[]))
  return{
    content:{schemaVersion:1,documentType:'daily-level-content-batch',contentVersion:'2.0.0-b',identityVersion:'daily-knowledge-v2',releaseStatus:'candidate-not-deployable-until-batch-c',levels:definitions.map(({id,labelZh})=>({id,labelZh,recordCount:200})),records},
    migration:{schemaVersion:1,documentType:'daily-level-identity-migration',migrationVersion:'daily-level-v1-to-v2-batch-b',releaseStatus:'candidate',sourceIdentityVersion:'daily-knowledge-v1',targetIdentityVersion:'daily-knowledge-v2',sourceRecordCount:oldBatch.length,canonicalTargetCount:1200,entries,newIdentities:records.filter((row)=>!mappedTargets.has(row.dailyKnowledgeId)).map((row)=>row.dailyKnowledgeId)},
  }
}

const{content,migration}=author();for(const[path,value]of[['content/curriculum/daily-level-content-batch-b.v2.json',content],['content/curriculum/daily-level-identity-migration-batch-b.v1.json',migration]]){const serialized=`${JSON.stringify(value,null,2)}\n`;if(writeMode)fs.writeFileSync(path,serialized);else if(fs.readFileSync(path,'utf8')!==serialized)throw new Error(`${path} is stale; run with --write.`)}
console.log(`Batch B authored: ${content.records.length} records; ${migration.entries.filter((row)=>row.disposition.includes('equivalent')).length} exact equivalents; ${migration.entries.filter((row)=>row.disposition==='retired').length} retired sources; ${migration.newIdentities.length} new v2 identities.`)
