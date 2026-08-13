import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons.flatMap((lesson) => lesson.learningUnits)
  .find((candidate) => candidate.learningUnitId === 'st4w-w1d4-vocabulary')

const topics = [
  ['the cancellation policy', '取消政策'], ['the fare difference', '票价差额'], ['the baggage allowance', '行李额度'], ['the missed connection', '错过的衔接航班'],
  ['the delayed departure', '延误出发'], ['the rebooking deadline', '改签截止时间'], ['the refund request', '退款申请'], ['the insurance claim', '保险理赔'],
  ['the medical certificate', '医疗证明'], ['the emergency treatment', '紧急治疗'], ['the prescription medicine', '处方药'], ['the allergy information', '过敏信息'],
  ['the lost passport report', '护照遗失报告'], ['the police report', '警方报告'], ['the security alert', '安全警报'], ['the evacuation notice', '疏散通知'],
  ['the hotel relocation', '酒店搬迁'], ['the room-rate dispute', '房价争议'], ['the damaged luggage claim', '行李损坏索赔'], ['the rental-car breakdown', '租车故障'],
  ['the roadside assistance', '道路救援'], ['the transit disruption', '交通中断'], ['the platform change', '站台变更'], ['the accessible transfer', '无障碍换乘'],
  ['the visa extension', '签证延期'], ['the entry requirement', '入境要求'], ['the local restriction', '当地限制'], ['the policy exception', '政策例外'],
  ['the unauthorized charge', '未经授权的收费'], ['the exchange-rate error', '汇率错误'], ['the duplicate transaction', '重复交易'], ['the payment-card freeze', '支付卡冻结'],
  ['the travel companion’s booking', '旅伴的预订'], ['the revised itinerary', '修改后的行程'], ['the return-trip risk', '返程风险'], ['the overnight accommodation', '过夜住宿'],
  ['the official complaint', '正式投诉'], ['the service failure', '服务失误'], ['the compensation decision', '补偿决定'], ['the follow-up arrangement', '后续安排'],
]

const levels = [
  { prefix: 's1', difficulty: 5, target: 193, templates: [
    ['Please confirm {en} before I finalize my travel plans.', '请在我最终确定旅行计划前确认{zh}。'],
    ['I need to understand {en} before I accept this arrangement.', '在接受这个安排前，我需要了解{zh}。'],
    ['Could you provide written details about {en}?', '您能提供关于{zh}的书面细节吗？'],
    ['I need an alternative if {en} cannot be guaranteed.', '如果无法保证{zh}，我需要替代方案。'],
    ['Please explain how {en} affects my itinerary.', '请说明{zh}如何影响我的行程。'],
  ] },
  { prefix: 's2', difficulty: 5.5, target: 200, templates: [
    ['I need to verify whether {en} changes my legal options.', '我需要核实{zh}是否改变我的法律选择。'],
    ['Could you explain who is responsible for {en}?', '您能说明谁负责{zh}吗？'],
    ['Please tell me what evidence is required for {en}.', '请告诉我{zh}需要什么证据。'],
    ['I need a written response about {en} before the deadline.', '我需要在截止日期前得到关于{zh}的书面回复。'],
    ['Could you offer a solution that reduces the risk from {en}?', '您能提供降低{zh}风险的解决方案吗？'],
  ] },
  { prefix: 's3', difficulty: 6, target: 200, templates: [
    ['I would like to request a formal review of {en}.', '我想请求正式复核{zh}。'],
    ['Please document why {en} cannot be resolved immediately.', '请记录为何无法立即解决{zh}。'],
    ['I need to know the consequences if {en} remains unresolved.', '我需要知道如果{zh}仍未解决会有什么后果。'],
    ['Could you escalate {en} to the appropriate authority?', '您能将{zh}升级给适当机构吗？'],
    ['I need a contingency plan that accounts for {en}.', '我需要一份考虑{zh}的应急计划。'],
  ] },
  { prefix: 'c4', difficulty: 7, target: 200, templates: [
    ['Please provide the official terms that govern {en}.', '请提供管理{zh}的官方条款。'],
    ['I need to compare the available remedies for {en}.', '我需要比较针对{zh}可用的补救措施。'],
    ['Could you clarify whether {en} qualifies for compensation?', '您能澄清{zh}是否符合补偿资格吗？'],
    ['I need to preserve my rights while {en} is reviewed.', '在审核{zh}期间，我需要保留自己的权利。'],
    ['Please identify the next formal step for {en}.', '请说明处理{zh}的下一正式步骤。'],
  ] },
  { prefix: 'c6', difficulty: 8, target: 200, templates: [
    ['I need to determine whether {en} permits an exception in my case.', '我需要确定{zh}是否允许在我的情况下适用例外。'],
    ['Could you provide a reasoned decision concerning {en}?', '您能就{zh}提供有理据的决定吗？'],
    ['I need to assess the practical consequences of {en} before proceeding.', '在继续之前，我需要评估{zh}的实际后果。'],
    ['Please confirm the authority and time limit relevant to {en}.', '请确认与{zh}相关的主管机构和时限。'],
    ['I need a documented resolution for {en} that I can rely on later.', '我需要一份可供日后依赖的{zh}书面解决方案。'],
  ] },
]

const render = (template, topic) => template.replace('{en}', topic[0]).replace('{zh}', topic[1])
const rowsFor = (level) => level.templates.flatMap((template) => topics.map((topic) => [render(template[0], topic), render(template[1], topic)])).slice(0, level.target)
const normal = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

for (const level of levels) {
  const idPrefix = `r17-daily-${level.prefix}-`
  unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith(idPrefix))
  const existing = new Set(unit.activity.items.map((item) => normal(item.term)))
  const rows = rowsFor(level)
  for (const [term] of rows) {
    if (existing.has(normal(term))) throw new Error(`Duplicate term: ${term}`)
    existing.add(normal(term))
  }
  unit.activity.items.push(...rows.map(([term, meaningZh], index) => ({
    id: `${idPrefix}${String(index + 1).padStart(3, '0')}`,
    term, meaningZh,
    partOfSpeech: term.startsWith('Could') || term.startsWith('Please') ? 'request' : 'statement',
    exampleEn: term, exampleZh: meaningZh,
    growthDifficultyLevel: level.difficulty,
    dailyKnowledgeId: `daily-knowledge-v1:${level.prefix}:${String(index + 1).padStart(3, '0')}`,
  })))
}
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
