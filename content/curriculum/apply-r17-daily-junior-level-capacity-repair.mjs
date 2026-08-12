import fs from 'node:fs'

const file = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(file, 'utf8'))
const unit = document.lessons.flatMap((lesson) => lesson.learningUnits)
  .find((candidate) => candidate.learningUnitId === 'st4w-w1d4-vocabulary')
const additions = [
  ['r17-daily-j1-repair-001', 'I will check the departure board.', '我会查看出发显示屏。', 3.5, 'daily-knowledge-v1:j1-repair:001'],
  ['r17-daily-j2-repair-001', 'I need to know whether the revised schedule changes the hotel check-in.', '我需要知道修改后的日程是否改变酒店入住。', 4, 'daily-knowledge-v1:j2-repair:001'],
]
const existing = new Set(unit.activity.items.map((item) => item.id))
for (const [id, term, meaningZh, growthDifficultyLevel, dailyKnowledgeId] of additions) {
  if (existing.has(id)) continue
  unit.activity.items.push({
    id,
    term,
    meaningZh,
    partOfSpeech: 'statement',
    exampleEn: term,
    exampleZh: meaningZh,
    growthDifficultyLevel,
    dailyKnowledgeId,
  })
}
fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`)
