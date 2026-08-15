import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditDailyLevelQuality, createCurrentAudit, validateRubric } from './audit-daily-level-quality.v2.mjs'

const rubric = JSON.parse(readFileSync('content/curriculum/daily-level-rubric.v2.json', 'utf8'))
const report = JSON.parse(readFileSync('content/curriculum/daily-level-quality-audit.v2.json', 'utf8'))

describe('QA-R17-003 daily level quality gate', () => {
  it('defines all fifteen levels and stable identity migration rules', () => {
    expect(() => validateRubric(rubric)).not.toThrow()
    expect(rubric.levels.map((level: { labelZh: string }) => level.labelZh)).toEqual([
      '幼儿园','一年级','二年级','三年级','四年级','五年级','六年级','初一','初二','初三','高一','高二','高三','大学四级','大学六级',
    ])
    expect(rubric.globalRules.oneLevelPerKnowledgePoint).toBe(true)
    expect(rubric.globalRules.dailyAndSceneProgressRemainIndependent).toBe(true)
  })

  it('confirms the formally published corpus passes every level rubric', () => {
    const actual = createCurrentAudit()
    expect(actual).toEqual(report)
    expect(actual.releaseStatus).toBe('pass')
    expect(actual.levels).toHaveLength(15)
    expect(actual.levels.every((level) => level.violations.length === 0)).toBe(true)
    expect(actual.crossLevelDuplicateForms).toEqual([])
  })

  it('rejects cross-level duplicate forms even when IDs differ', () => {
    const tinyRubric = structuredClone(rubric)
    tinyRubric.globalRules.knowledgePointsPerLevel = 1
    const result = auditDailyLevelQuality([
      { id:'a', dailyKnowledgeId:'v2:a', term:'confirm', meaningZh:'确认', difficulty:0 },
      { id:'b', dailyKnowledgeId:'v2:b', term:'Confirm', meaningZh:'确认', difficulty:0.5 },
    ], tinyRubric)
    expect(result.crossLevelDuplicateForms).toEqual([{ form:'confirm', levels:['kindergarten','primary-1'] }])
    expect(result.releaseStatus).toBe('blocked')
  })
})
