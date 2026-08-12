import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons[0].learningUnits.find((candidate) => candidate.learningUnitId === 'st4w-w1d1-vocabulary')
if (!unit) throw new Error('The daily vocabulary host unit is missing.')

// Primary-1 2A: high-frequency travel collocations, compact requests, and
// basic compound nouns. Each row is individually authored, not sourced from
// the independent scene question bank.
const rows = [
  ['could you help me', '你能帮我吗', 'request phrase', 'Could you help me with this bag?', '你能帮我拿这个包吗？'],
  ['could you repeat that', '你能重复一下吗', 'request phrase', 'Could you repeat that more slowly?', '你能慢一点重复一下吗？'],
  ['please speak slowly', '请说慢一点', 'request phrase', 'Please speak slowly for me.', '请对我说慢一点。'],
  ['where is the restroom', '洗手间在哪里', 'question phrase', 'Excuse me, where is the restroom?', '劳驾，洗手间在哪里？'],
  ['where is the elevator', '电梯在哪里', 'question phrase', 'Where is the elevator for the hotel rooms?', '酒店房间的电梯在哪里？'],
  ['where is the taxi stand', '出租车候车点在哪里', 'question phrase', 'Where is the taxi stand outside?', '外面的出租车候车点在哪里？'],
  ['how do I get there', '我怎么去那里', 'question phrase', 'How do I get there by bus?', '我怎么坐公交车去那里？'],
  ['I am looking for', '我在找', 'request phrase', 'I am looking for the hotel.', '我在找这家酒店。'],
  ['I need to go to', '我需要去', 'request phrase', 'I need to go to the airport.', '我需要去机场。'],
  ['I have a question', '我有一个问题', 'statement phrase', 'I have a question about the ticket.', '我有一个关于票的问题。'],
  ['can you show me', '你能给我看吗', 'request phrase', 'Can you show me the way?', '你能给我指路吗？'],
  ['can you write it down', '你能写下来吗', 'request phrase', 'Can you write it down for me?', '你能帮我写下来吗？'],
  ['please wait a moment', '请稍等', 'request phrase', 'Please wait a moment by the door.', '请在门边稍等。'],
  ['just a minute', '等一下', 'time phrase', 'Just a minute, please.', '请等一下。'],
  ["I don't know", '我不知道', 'statement phrase', "I don't know the room number.", '我不知道房间号。'],
  ["I don't understand", '我不明白', 'statement phrase', "I don't understand this sign.", '我不明白这个标志。'],
  ['I am sorry', '我很抱歉', 'statement phrase', 'I am sorry, I am late.', '我很抱歉，我迟到了。'],
  ['thank you very much', '非常感谢', 'politeness phrase', 'Thank you very much for your help.', '非常感谢你的帮助。'],
  ['you are welcome', '不客气', 'politeness phrase', 'You are welcome. Have a good day.', '不客气。祝你今天愉快。'],
  ['after you', '您先请', 'politeness phrase', 'After you, please.', '您先请。'],
  ['this way please', '请这边走', 'direction phrase', 'This way please, the bus is here.', '请这边走，公交车在这里。'],
  ['right here', '就在这里', 'place phrase', 'The ticket machine is right here.', '售票机就在这里。'],
  ['over there', '在那边', 'place phrase', 'The hotel entrance is over there.', '酒店入口在那边。'],
  ['next door', '隔壁', 'place phrase', 'The pharmacy is next door.', '药店在隔壁。'],
  ['near the entrance', '靠近入口', 'place phrase', 'Please wait near the entrance.', '请在入口附近等候。'],
  ['at the corner', '在拐角处', 'place phrase', 'The bank is at the corner.', '银行在拐角处。'],
  ['on this floor', '在这一层', 'place phrase', 'The restaurant is on this floor.', '餐厅在这一层。'],
  ['on the first floor', '在一楼', 'place phrase', 'The lobby is on the first floor.', '大堂在一楼。'],
  ['hotel guest', '酒店住客', 'noun phrase', 'Every hotel guest needs a room number.', '每位酒店住客都需要房间号。'],
  ['room service', '客房服务', 'noun phrase', 'Room service brings food to the room.', '客房服务把食物送到房间。'],
  ['air conditioning', '空调', 'noun phrase', 'The air conditioning is too cold.', '空调太冷了。'],
  ['Wi-Fi password', '无线网络密码', 'noun phrase', 'What is the Wi-Fi password?', '无线网络密码是什么？'],
  ['wake-up call', '叫醒服务', 'noun phrase', 'I need a wake-up call at seven.', '我需要七点的叫醒服务。'],
  ['extra blanket', '额外毛毯', 'noun phrase', 'Could I have an extra blanket?', '我能要一条额外毛毯吗？'],
  ['clean towel', '干净毛巾', 'noun phrase', 'Please bring a clean towel.', '请拿一条干净毛巾来。'],
  ['reservation number', '预订号码', 'noun phrase', 'My reservation number is on this email.', '我的预订号码在这封邮件里。'],
  ['confirmation number', '确认号码', 'noun phrase', 'Please show your confirmation number.', '请出示你的确认号码。'],
  ['single bed', '单人床', 'noun phrase', 'This room has a single bed.', '这个房间有一张单人床。'],
  ['double bed', '双人床', 'noun phrase', 'We need a double bed.', '我们需要一张双人床。'],
  ['breakfast included', '含早餐', 'hotel phrase', 'Is breakfast included in the room price?', '房价里含早餐吗？'],
  ['cold drink', '冷饮', 'noun phrase', 'I would like a cold drink.', '我想要一杯冷饮。'],
  ['hot meal', '热餐', 'noun phrase', 'Do you have a hot meal?', '你们有热餐吗？'],
  ['vegetarian option', '素食选项', 'noun phrase', 'Is there a vegetarian option?', '有素食选项吗？'],
  ['no onions', '不要洋葱', 'food request', 'No onions, please.', '请不要洋葱。'],
  ['with ice', '加冰', 'food request', 'Water with ice, please.', '请给我加冰的水。'],
  ['without sugar', '不加糖', 'food request', 'Coffee without sugar, please.', '请给我不加糖的咖啡。'],
  ['small coffee', '小杯咖啡', 'noun phrase', 'I would like a small coffee.', '我想要一杯小咖啡。'],
  ['table by the window', '靠窗的桌子', 'noun phrase', 'Can we have a table by the window?', '我们能坐靠窗的桌子吗？'],
  ['to take away', '带走', 'food phrase', 'I would like this to take away.', '我想把这个带走。'],
  ['the bill please', '请给我账单', 'restaurant request', 'The bill please, when you are ready.', '方便时请给我账单。'],
  ['cash only', '只收现金', 'payment phrase', 'This small shop is cash only.', '这家小店只收现金。'],
  ['exact amount', '准确金额', 'noun phrase', 'Please pay the exact amount.', '请支付准确金额。'],
  ['small bills', '小面额纸币', 'noun phrase', 'Do you have small bills?', '你有小面额纸币吗？'],
  ['change please', '请找零', 'payment request', 'Change please, if you have it.', '如果有的话，请找零。'],
  ['price list', '价目表', 'noun phrase', 'The price list is by the counter.', '价目表在柜台旁边。'],
  ['sale price', '促销价', 'noun phrase', 'Is this the sale price?', '这是促销价吗？'],
  ['store clerk', '店员', 'noun phrase', 'The store clerk can help you.', '店员可以帮你。'],
  ['shopping bag', '购物袋', 'noun phrase', 'I need a shopping bag.', '我需要一个购物袋。'],
  ['return policy', '退货规定', 'noun phrase', 'Please read the return policy.', '请阅读退货规定。'],
  ['bus ticket', '公交车票', 'noun phrase', 'Buy a bus ticket here.', '在这里买公交车票。'],
  ['taxi ride', '出租车行程', 'noun phrase', 'The taxi ride takes ten minutes.', '出租车行程要十分钟。'],
  ['airport shuttle', '机场接驳车', 'noun phrase', 'The airport shuttle stops here.', '机场接驳车在这里停。'],
  ['elevator button', '电梯按钮', 'noun phrase', 'Press the elevator button.', '按电梯按钮。'],
  ['phone charger', '手机充电器', 'noun phrase', 'My phone charger is missing.', '我的手机充电器不见了。'],
  ['power adapter', '电源转换插头', 'noun phrase', 'I need a power adapter.', '我需要一个电源转换插头。']
]

if (rows.length !== 65) throw new Error(`Expected 65 reviewed rows, got ${rows.length}.`)
const normalized = (value) => value.toLocaleLowerCase('en-US')
  .replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-p1a-'))
const existing = new Set(unit.activity.items.map((item) => normalized(item.term)))
for (const [term] of rows) {
  if (existing.has(normalized(term))) throw new Error(`Duplicate daily term after normalization: ${term}`)
  existing.add(normalized(term))
}
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({
  id: `r17-daily-p1a-${String(index + 1).padStart(3, '0')}`,
  term,
  meaningZh,
  partOfSpeech,
  exampleEn,
  exampleZh,
  growthDifficultyLevel: 0.5,
  dailyKnowledgeId: `daily-knowledge-v1:p1a:${String(index + 1).padStart(3, '0')}`,
})))
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 65 reviewed primary-1 2A daily vocabulary items.')
