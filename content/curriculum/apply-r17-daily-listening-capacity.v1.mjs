import fs from 'node:fs'

const extensionPath = 'content/lessons/survival-travel-american-4w/listening-exercises.v1.json'
const packagePath = 'content/curriculum/package-index.v1.json'
const extension = JSON.parse(fs.readFileSync(extensionPath, 'utf8'))
const packageIndex = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const lessons = packageIndex.lessonFiles.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).lessons)
const difficultyByRef = new Map(lessons.map((lesson) => {
  const unit = lesson.learningUnits.find((candidate) => candidate.domain === 'listening')
  return [unit.contentRef, unit.difficultyLevel]
}))
const levels = [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8]
const topics = [
  ['my boarding gate', '我的登机口'], ['the departure time', '出发时间'], ['the delayed flight', '延误航班'], ['the transfer desk', '中转服务台'], ['my checked luggage', '我的托运行李'],
  ['the hotel reservation', '酒店预订'], ['the room problem', '房间问题'], ['the checkout time', '退房时间'], ['the rental car', '租车'], ['the transit ticket', '交通票'],
  ['the restaurant allergy', '餐厅过敏情况'], ['the medical symptoms', '医疗症状'], ['the prescription medicine', '处方药'], ['the insurance claim', '保险理赔'], ['the police report', '警方报告'],
  ['the lost passport', '遗失护照'], ['the safety warning', '安全警告'], ['the evacuation plan', '疏散计划'], ['the payment dispute', '付款争议'], ['the exchange receipt', '兑换收据'],
  ['the cancellation policy', '取消政策'], ['the refund request', '退款申请'], ['the policy exception', '政策例外'], ['the accessibility service', '无障碍服务'], ['the travel companion', '旅伴'],
  ['the revised itinerary', '修改后的行程'], ['the return trip', '返程'], ['the official complaint', '正式投诉'], ['the written confirmation', '书面确认'], ['the emergency contact', '紧急联系人'],
]
const templatesByLevel = [
  [['Please say {en}.', '请写下听到的{zh}。'], ['Listen for {en}.', '请听清{zh}。']],
  [['At the counter, ask about {en}.', '在柜台询问{zh}。'], ['The staff can help with {en}.', '工作人员可以协助处理{zh}。']],
  [['Please confirm {en} before you go.', '出发前请确认{zh}。'], ['I need to check {en} now.', '我现在需要核对{zh}。']],
  [['Could you repeat the detail about {en}?', '请重复与{zh}有关的细节。'], ['The agent explained {en} clearly.', '工作人员清楚说明了{zh}。']],
  [['Before boarding, verify {en}.', '登机前请核实{zh}。'], ['Please keep a record of {en}.', '请保留{zh}的记录。']],
  [['The traveler asked for an update on {en}.', '旅客询问了{zh}的最新情况。'], ['Please report any change to {en}.', '如有变化请告知{zh}。']],
  [['The notice gives instructions about {en}.', '通知给出了与{zh}有关的指示。'], ['We need accurate details about {en}.', '我们需要{zh}的准确信息。']],
  [['Please explain the problem with {en}.', '请说明{zh}出现的问题。'], ['The supervisor will review {en}.', '主管将核查{zh}。']],
  [['The policy includes a condition about {en}.', '政策包含与{zh}有关的条件。'], ['Please provide evidence for {en}.', '请提供与{zh}有关的证明。']],
  [['The traveler requested a solution for {en}.', '旅客要求解决{zh}的问题。'], ['Please confirm responsibility for {en}.', '请确认{zh}的责任归属。']],
  [['The written notice clarifies {en}.', '书面通知澄清了{zh}。'], ['We must compare the options for {en}.', '我们必须比较{zh}的不同方案。']],
  [['The exception may affect {en}.', '该例外可能影响{zh}。'], ['Please document the decision about {en}.', '请记录关于{zh}的决定。']],
  [['The complaint describes an issue with {en}.', '投诉说明了{zh}存在的问题。'], ['Please explain the consequence of {en}.', '请解释{zh}可能带来的后果。']],
  [['The agreement sets out the terms for {en}.', '协议列出了{zh}的条款。'], ['Please verify the final arrangement for {en}.', '请核实{zh}的最终安排。']],
  [['The emergency plan addresses {en}.', '应急方案涵盖了{zh}。'], ['Please state the next action for {en}.', '请说明处理{zh}的下一步行动。']],
]
const levelLabel = ['幼儿园','一年级','二年级','三年级','四年级','五年级','六年级','初一','初二','初三','高一','高二','高三','大学四级','大学六级']
const exerciseDifficulty = (exercise, lesson) => exercise.growthDifficultyLevel ?? difficultyByRef.get(lesson.baseContentRef)
for (const lesson of extension.lessons) lesson.exercises = lesson.exercises.filter((exercise) => !exercise.exerciseId.startsWith('r17-listening-'))
const existingByLevel = new Map(levels.map((level) => [level, 0]))
for (const lesson of extension.lessons) for (const exercise of lesson.exercises) {
  const level = exerciseDifficulty(exercise, lesson)
  if (existingByLevel.has(level)) existingByLevel.set(level, existingByLevel.get(level) + 1)
}
for (const [levelIndex, level] of levels.entries()) {
  const missing = 60 - existingByLevel.get(level)
  if (missing < 0) throw new Error(`${levelLabel[levelIndex]} already exceeds 60`) 
  for (let offset = 0; offset < missing; offset += 1) {
    const topic = topics[offset % topics.length]
    const template = templatesByLevel[levelIndex][Math.floor(offset / topics.length) % 2]
    const ttsText = template[0].replace('{en}', topic[0])
    const lesson = extension.lessons[(levelIndex * 7 + offset) % extension.lessons.length]
    const id = `r17-listening-l${String(levelIndex + 1).padStart(2, '0')}-${String(offset + 1).padStart(3, '0')}`
    lesson.exercises.push({
      exerciseId: id,
      type: 'keyword-dictation',
      growthDifficultyLevel: level,
      audioSource: { sourceType: 'tts-text', segmentId: `seg-${id}`, locale: 'en-US', ttsText },
      promptZh: template[1].replace('{zh}', topic[1]),
      answerGuidance: { answerType: 'manner-or-short-phrase', guidanceZh: '填写听到的英文短语；共 1 项，不涉及先后顺序，使用英文单词输入。', acceptedInputFormats: ['english-words'] },
      targetKeywords: [topic[0]], standardAnswer: topic[0], acceptedAnswers: [topic[0]],
      normalizationHints: { trim: true, caseFoldLocale: 'en-US', collapseWhitespace: true, normalizeApostrophes: true, stripTerminalPunctuation: true },
      playbackPolicy: { allowSegmentSelection: true, allowRepeat: true, allowedRates: [0.75, 1] },
      rationaleZh: `音频中的关键信息是“${topic[1]}”。`,
    })
  }
}
// The extension remains schema-compatible with the published 1.2 contract.
extension.extensionVersion = '1.2.0'
fs.writeFileSync(extensionPath, `${JSON.stringify(extension, null, 2)}\n`)
