import fs from 'node:fs'

const packageIndex = JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json', 'utf8'))
const weeks = packageIndex.lessonFiles.map((path) => ({ path, document: JSON.parse(fs.readFileSync(path, 'utf8')) }))
const levels = [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8]
const levelPatterns = [
  ['Please say this simple travel answer.', '请说出这个简单旅行回答。', 'I need {term}.'],
  ['Answer with this short travel phrase.', '请用这个简短旅行短语回答。', 'I need {term}, please.'],
  ['Give the staff this complete answer.', '请对工作人员说出这个完整回答。', 'I would like {term}, please.'],
  ['Make this clear request.', '请提出这个明确请求。', 'Could you help me with {term}?'],
  ['Explain this travel need politely.', '请礼貌说明这个旅行需求。', 'I need help with {term} because it affects my trip.'],
  ['Confirm this travel detail.', '请确认这个旅行细节。', 'Could you confirm {term} before I continue?'],
  ['Describe the problem and ask for help.', '请说明问题并请求帮助。', 'There is a problem with {term}, and I need help.'],
  ['State your preference and ask for an option.', '请说明偏好并询问可选方案。', 'I prefer {term}; could you offer an available option?'],
  ['Explain the change and request a solution.', '请说明变化并请求解决方案。', 'Because of {term}, I need a practical solution today.'],
  ['Make a polite complaint and request action.', '请礼貌投诉并请求处理。', 'I am concerned about {term}; could you please review it?'],
  ['Clarify the policy and your next step.', '请澄清政策与下一步。', 'Please explain how {term} applies before I decide what to do.'],
  ['Describe a safety or service issue clearly.', '请清楚描述安全或服务问题。', 'I need assistance with {term}, and I can provide the details.'],
  ['Explain the reason and request an alternative.', '请解释原因并请求替代方案。', 'Since {term} has changed, I would like to discuss an alternative.'],
  ['Request a documented resolution.', '请请求有记录的解决方案。', 'Please confirm in writing how {term} will be resolved.'],
  ['Negotiate a complex travel solution.', '请协商一个复杂旅行解决方案。', 'Given {term}, I need to confirm the safest available arrangement.'],
]
const topics = [
  ['a boarding pass', '登机牌'], ['a gate change', '登机口变更'], ['a delayed flight', '航班延误'], ['a missed connection', '错过转机'], ['a baggage allowance', '行李额度'], ['a lost suitcase', '遗失的行李箱'], ['a damaged bag', '损坏的行李'], ['a passport problem', '护照问题'], ['a visa question', '签证问题'], ['a security check', '安检'],
  ['a hotel reservation', '酒店预订'], ['an early check-in', '提前入住'], ['a late checkout', '延迟退房'], ['a room key', '房间钥匙'], ['a noisy room', '嘈杂的房间'], ['a broken shower', '损坏的淋浴设施'], ['a room change', '换房'], ['a hotel receipt', '酒店收据'], ['an airport shuttle', '机场接驳车'], ['a taxi fare', '出租车费用'],
  ['a train platform', '火车站台'], ['a bus transfer', '公交换乘'], ['a subway ticket', '地铁票'], ['a rental car', '租车'], ['a parking fee', '停车费'], ['a driving direction', '行车路线'], ['a restaurant table', '餐厅座位'], ['a menu allergy', '菜单过敏信息'], ['a meal bill', '餐费账单'], ['a food substitution', '餐点替换'],
  ['a clothing size', '衣服尺码'], ['a return request', '退货请求'], ['a refund status', '退款状态'], ['a payment dispute', '付款争议'], ['a currency exchange', '货币兑换'], ['a bank card issue', '银行卡问题'], ['a phone plan', '电话套餐'], ['a Wi-Fi connection', '无线网络连接'], ['a charging cable', '充电线'], ['a medical symptom', '医疗症状'],
  ['a pharmacy order', '药房订单'], ['an emergency contact', '紧急联系人'], ['a police report', '警方报告'], ['a stolen wallet', '被盗的钱包'], ['a travel insurance claim', '旅行保险理赔'], ['a cancellation policy', '取消政策'], ['a booking amendment', '预订修改'], ['an accessible entrance', '无障碍入口'], ['a mobility service', '行动辅助服务'], ['a lost property report', '失物报告'],
  ['a tour cancellation', '旅行团取消'], ['a schedule conflict', '行程冲突'], ['a weather warning', '天气警报'], ['an evacuation notice', '疏散通知'], ['a safety concern', '安全顾虑'], ['a service charge', '服务费'], ['a written confirmation', '书面确认'], ['a customer service case', '客服案件'], ['a policy exception', '政策例外'], ['a revised itinerary', '修改后的行程'],
]
const lessons = weeks.flatMap(({ document, path }) => document.lessons.map((lesson) => ({ lesson, path })))
const speakingUnit = (lesson) => lesson.learningUnits.find((unit) => unit.domain === 'speaking')
const existingByLevel = new Map(levels.map((level) => [level, 0]))
for (const { lesson } of lessons) {
  const unit = speakingUnit(lesson)
  unit.activity.prompts = unit.activity.prompts.filter((prompt) => !prompt.id.startsWith('r17-speaking-'))
  for (const prompt of unit.activity.prompts) {
    const level = prompt.growthDifficultyLevel ?? unit.difficultyLevel
    if (existingByLevel.has(level)) existingByLevel.set(level, existingByLevel.get(level) + 1)
  }
  for (const _quiz of lesson.sceneQuiz.filter((quiz) => quiz.domain === 'speaking')) {
    if (existingByLevel.has(unit.difficultyLevel)) existingByLevel.set(unit.difficultyLevel, existingByLevel.get(unit.difficultyLevel) + 1)
  }
}
for (const [levelIndex, level] of levels.entries()) {
  const missing = 60 - existingByLevel.get(level)
  if (missing < 0) throw new Error(`Speaking level ${level} already exceeds 60.`)
  const [partnerLine, cueZh, modelTemplate] = levelPatterns[levelIndex]
  for (let offset = 0; offset < missing; offset += 1) {
    const [term, termZh] = topics[offset]
    const id = `r17-speaking-l${String(levelIndex + 1).padStart(2, '0')}-${String(offset + 1).padStart(3, '0')}`
    const modelAnswer = modelTemplate.replace('{term}', term)
    const lesson = lessons[(levelIndex * 11 + offset) % lessons.length].lesson
    speakingUnit(lesson).activity.prompts.push({
      id,
      growthDifficultyLevel: level,
      cueZh: `${cueZh}主题是“${termZh}”。`,
      partnerLine: `${partnerLine} Topic: ${term}.`,
      modelAnswer,
      modelAnswerTranslationZh: `示范表达：${termZh}。`,
      acceptedAnswers: [modelAnswer],
      requiredConcepts: [term.replaceAll(' ', '-'), `level-${levelIndex + 1}`],
    })
  }
}
for (const { path, document } of weeks) fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
