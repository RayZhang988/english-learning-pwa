import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe,expect,it } from 'vitest'
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'))
describe('QA-R17-003 C1 senior-1 content',()=>{
  it('authors and validates 200 natural high-school travel expressions',()=>{expect(()=>execFileSync(process.execPath,['content/curriculum/author-daily-level-c1.v2.mjs'],{encoding:'utf8'})).not.toThrow();expect(()=>execFileSync(process.execPath,['content/curriculum/validate-daily-level-c1.v2.mjs'],{encoding:'utf8'})).not.toThrow();const report=read('content/curriculum/daily-level-c1-quality-audit.v2.json');expect(report.records).toBe(200);expect(report.crossLevelDuplicateForms).toBe(0);expect(report.templateMaximums.sharedOpeningFourTokens).toBeLessThanOrEqual(5);expect(report.templateMaximums.sharedSkeleton).toBeLessThanOrEqual(5)})
  it('retires rewritten identities rather than transferring evidence',()=>{const migration=read('content/curriculum/daily-level-identity-migration-c1.v1.json');expect(migration.entries).toHaveLength(202);expect(migration.entries.every((row:{disposition:string;evidenceTransferAllowed:boolean})=>row.disposition==='retired'&&!row.evidenceTransferAllowed)).toBe(true)})
})
