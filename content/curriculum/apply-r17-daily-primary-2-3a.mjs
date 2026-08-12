import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons[0].learningUnits.find((candidate) => candidate.learningUnitId === 'st4w-w1d1-vocabulary')
if (!unit) throw new Error('The daily vocabulary host unit is missing.')

// Primary-2 3A: complete, short travel utterances. These are intentionally
// beyond primary-1 labels and fixed phrases, but avoid multi-clause reasoning.
const rows = [
  ["I'd like to check in", '我想办理值机', 'airport request', "I'd like to check in for my flight.", '我想为我的航班办理值机。'],
  ['here is my passport', '这是我的护照', 'airport statement', 'Here is my passport and boarding pass.', '这是我的护照和登机牌。'],
  ['I have a checked bag', '我有托运行李', 'airport statement', 'I have a checked bag for this flight.', '我这趟航班有托运行李。'],
  ['where do I drop my bag', '我在哪里托运行李', 'airport question', 'Where do I drop my bag after check-in?', '办完值机后我在哪里托运行李？'],
  ['can I change my seat', '我能换座位吗', 'airport request', 'Can I change my seat before boarding?', '登机前我能换座位吗？'],
  ['is my flight on time', '我的航班准点吗', 'airport question', 'Is my flight on time today?', '我的航班今天准点吗？'],
  ['which gate should I use', '我该去哪个登机口', 'airport question', 'Which gate should I use for this flight?', '这趟航班我该去哪个登机口？'],
  ['when does boarding begin', '什么时候开始登机', 'airport question', 'When does boarding begin?', '什么时候开始登机？'],
  ['my flight is delayed', '我的航班延误了', 'airport statement', 'My flight is delayed by an hour.', '我的航班延误了一小时。'],
  ['I missed my connection', '我错过了转机', 'airport statement', 'I missed my connection in Chicago.', '我在芝加哥错过了转机。'],
  ["I'd like to check in at the hotel", '我想在酒店办理入住', 'hotel request', "I'd like to check in at the hotel now.", '我现在想在酒店办理入住。'],
  ['I have a reservation', '我有预订', 'hotel statement', 'I have a reservation under my name.', '我有一个用我名字预订的房间。'],
  ['is breakfast included', '含早餐吗', 'hotel question', 'Is breakfast included with this room?', '这个房间含早餐吗？'],
  ['could you call a taxi', '你能叫一辆出租车吗', 'hotel request', 'Could you call a taxi for me?', '你能帮我叫一辆出租车吗？'],
  ['can you store my luggage', '你能寄存我的行李吗', 'hotel request', 'Can you store my luggage until tonight?', '你能帮我把行李寄存到今晚吗？'],
  ['the room is too noisy', '房间太吵了', 'hotel problem', 'The room is too noisy at night.', '房间晚上太吵了。'],
  ['the air conditioner is not working', '空调坏了', 'hotel problem', 'The air conditioner is not working in my room.', '我房间的空调坏了。'],
  ['could you send someone up', '你能派人上来吗', 'hotel request', 'Could you send someone up to my room?', '你能派人到我房间来吗？'],
  ['I need a late check-out', '我需要延迟退房', 'hotel request', 'I need a late check-out tomorrow.', '我明天需要延迟退房。'],
  ['can I get another key', '我能再要一张房卡吗', 'hotel request', 'Can I get another key for the room?', '我能再要一张房间卡吗？'],
  ['which bus goes downtown', '哪辆公交车去市中心', 'transport question', 'Which bus goes downtown from here?', '从这里哪辆公交车去市中心？'],
  ['does this train stop at', '这趟火车停靠……吗', 'transport question', 'Does this train stop at the airport?', '这趟火车停靠机场吗？'],
  ['how many stops is it', '有几站', 'transport question', 'How many stops is it to the museum?', '到博物馆有几站？'],
  ['where should I transfer', '我该在哪里换乘', 'transport question', 'Where should I transfer to the subway?', '我该在哪里换乘地铁？'],
  ['I need to get off here', '我要在这里下车', 'transport statement', 'I need to get off here, please.', '请让我在这里下车。'],
  ['is this seat taken', '这个座位有人吗', 'transport question', 'Is this seat taken?', '这个座位有人吗？'],
  ['how long does the ride take', '车程要多久', 'transport question', 'How long does the ride take to the hotel?', '到酒店车程要多久？'],
  ['can I pay on the bus', '我能在公交车上付费吗', 'transport question', 'Can I pay on the bus with cash?', '我能在公交车上用现金付费吗？'],
  ['I bought the wrong ticket', '我买错票了', 'transport problem', 'I bought the wrong ticket by mistake.', '我不小心买错票了。'],
  ['when is the next train', '下一班火车什么时候来', 'transport question', 'When is the next train to Boston?', '去波士顿的下一班火车什么时候来？'],
  ['could we have a table for two', '我们能要一张两人桌吗', 'restaurant request', 'Could we have a table for two, please?', '我们能要一张两人桌吗？'],
  ["I'd like to order", '我想点餐', 'restaurant request', "I'd like to order the chicken.", '我想点鸡肉。'],
  ['what do you recommend', '你推荐什么', 'restaurant question', 'What do you recommend for lunch?', '午餐你推荐什么？'],
  ['does this contain nuts', '这个含坚果吗', 'restaurant question', 'Does this contain nuts or dairy?', '这个含坚果或乳制品吗？'],
  ['could I have it without cheese', '我能不要奶酪吗', 'restaurant request', 'Could I have it without cheese, please?', '我能不要奶酪吗？'],
  ['I ordered the soup', '我点的是汤', 'restaurant statement', 'I ordered the soup, not the salad.', '我点的是汤，不是沙拉。'],
  ['this is not what I ordered', '这不是我点的', 'restaurant problem', 'This is not what I ordered.', '这不是我点的。'],
  ['could we split the bill', '我们能分开结账吗', 'restaurant request', 'Could we split the bill?', '我们能分开结账吗？'],
  ['can I pay separately', '我能单独付款吗', 'restaurant question', 'Can I pay separately by card?', '我能单独刷卡付款吗？'],
  ['is service included', '包含服务费吗', 'restaurant question', 'Is service included in the bill?', '账单里包含服务费吗？'],
  ["I'd like to return this", '我想退这个', 'shopping request', "I'd like to return this item.", '我想退这个商品。'],
  ['do you have this in my size', '你们有我的尺码吗', 'shopping question', 'Do you have this in my size?', '你们有我的尺码吗？'],
  ['can I get a refund', '我能退款吗', 'shopping question', 'Can I get a refund for this?', '这个我能退款吗？'],
  ['I paid by card', '我是刷卡付款的', 'shopping statement', 'I paid by card yesterday.', '我昨天是刷卡付款的。'],
  ['could you print a receipt', '你能打印收据吗', 'shopping request', 'Could you print a receipt for me?', '你能帮我打印一张收据吗？'],
  ['this item is damaged', '这个商品坏了', 'shopping problem', 'This item is damaged inside the box.', '这个商品在盒子里就坏了。'],
  ['can I exchange it for another size', '我能换成另一个尺码吗', 'shopping request', 'Can I exchange it for another size?', '我能换成另一个尺码吗？'],
  ['is there a fitting room', '有试衣间吗', 'shopping question', 'Is there a fitting room nearby?', '附近有试衣间吗？'],
  ['can I try this on', '我能试穿这个吗', 'shopping question', 'Can I try this on before I buy it?', '我买之前能试穿这个吗？'],
  ['this price is wrong', '这个价格不对', 'shopping problem', 'I think this price is wrong.', '我觉得这个价格不对。'],
  ['I need something for a headache', '我需要治疗头痛的药', 'medical request', 'I need something for a headache.', '我需要治疗头痛的药。'],
  ['where is the nearest pharmacy', '最近的药店在哪里', 'medical question', 'Where is the nearest pharmacy?', '最近的药店在哪里？'],
  ['I have a fever', '我发烧了', 'medical statement', 'I have a fever today.', '我今天发烧了。'],
  ['I need to see a doctor', '我需要看医生', 'medical statement', 'I need to see a doctor soon.', '我需要尽快看医生。'],
  ['do I need an appointment', '我需要预约吗', 'medical question', 'Do I need an appointment first?', '我需要先预约吗？'],
  ['is this medicine safe', '这个药安全吗', 'medical question', 'Is this medicine safe for adults?', '这个药对成年人安全吗？'],
  ['can you help me connect to Wi-Fi', '你能帮我连接无线网络吗', 'connection request', 'Can you help me connect to Wi-Fi?', '你能帮我连接无线网络吗？'],
  ['the Wi-Fi will not connect', '无线网络连不上', 'connection problem', 'The Wi-Fi will not connect on my phone.', '我的手机连不上无线网络。'],
  ['my phone has no signal', '我的手机没有信号', 'connection problem', 'My phone has no signal here.', '我的手机在这里没有信号。'],
  ['where can I charge my phone', '我在哪里能给手机充电', 'connection question', 'Where can I charge my phone?', '我在哪里能给手机充电？'],
  ['can I use your phone', '我能用一下你的手机吗', 'connection request', 'Can I use your phone for a call?', '我能用一下你的手机打电话吗？'],
  ['I need to make an international call', '我需要打国际电话', 'connection statement', 'I need to make an international call tonight.', '我今晚需要打国际电话。'],
]

if (rows.length !== 62) throw new Error(`Expected 62 reviewed rows, got ${rows.length}.`)
const normalized = (value) => value.toLocaleLowerCase('en-US')
  .replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-p2a-'))
const existing = new Set(unit.activity.items.map((item) => normalized(item.term)))
for (const [term] of rows) {
  if (existing.has(normalized(term))) throw new Error(`Duplicate daily term after normalization: ${term}`)
  existing.add(normalized(term))
}
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({
  id: `r17-daily-p2a-${String(index + 1).padStart(3, '0')}`,
  term,
  meaningZh,
  partOfSpeech,
  exampleEn,
  exampleZh,
  growthDifficultyLevel: 1,
  dailyKnowledgeId: `daily-knowledge-v1:p2a:${String(index + 1).padStart(3, '0')}`,
})))
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 62 reviewed primary-2 3A daily vocabulary items.')
