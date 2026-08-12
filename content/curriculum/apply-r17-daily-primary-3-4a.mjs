import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons.flatMap((lesson) => lesson.learningUnits).find((candidate) => candidate.learningUnitId === 'st4w-w1d4-vocabulary')
if (!unit) throw new Error('The primary-3 daily vocabulary host unit is missing.')

// 4A uses one-clause, real travel problem-solving language.  It intentionally
// avoids both the basic vocabulary in K–P2 and multi-clause upper-level prose.
const rows = [
  ['Could you confirm my reservation?', '请确认一下我的预订好吗？', 'request', 'Could you confirm my reservation, please?', '请确认一下我的预订好吗？'],
  ['I would like to change my flight.', '我想更改航班。', 'request', 'I would like to change my flight.', '我想更改航班。'],
  ['Is there an earlier flight?', '有更早的航班吗？', 'question', 'Is there an earlier flight to Seattle?', '去西雅图有更早的航班吗？'],
  ['Is there a later train?', '有更晚的火车吗？', 'question', 'Is there a later train tonight?', '今晚有更晚的火车吗？'],
  ['My flight was delayed.', '我的航班延误了。', 'statement', 'My flight was delayed this morning.', '我的航班今天早上延误了。'],
  ['My flight was canceled.', '我的航班被取消了。', 'statement', 'My flight was canceled because of the weather.', '我的航班因天气原因被取消了。'],
  ['My connecting gate has changed.', '我的转机登机口变了。', 'statement', 'My connecting gate has changed since I arrived.', '我到达后转机登机口变了。'],
  ['Where can I rebook my ticket?', '我在哪里可以改签车票？', 'question', 'Where can I rebook my ticket after the delay?', '延误后我在哪里可以改签车票？'],
  ['Could you put me on the next flight?', '您能帮我安排下一班飞机吗？', 'request', 'Could you put me on the next flight?', '您能帮我安排下一班飞机吗？'],
  ['I need to check the departure time.', '我需要确认出发时间。', 'statement', 'I need to check the departure time again.', '我需要再次确认出发时间。'],
  ['Which platform should I use?', '我应该去哪个站台？', 'question', 'Which platform should I use for this train?', '这趟火车我应该去哪个站台？'],
  ['Does this bus stop near the hotel?', '这辆公交车在酒店附近停吗？', 'question', 'Does this bus stop near the hotel?', '这辆公交车在酒店附近停吗？'],
  ['I got off at the wrong stop.', '我在错误的站下车了。', 'statement', 'I got off at the wrong stop by mistake.', '我不小心在错误的站下车了。'],
  ['Could you show me the route?', '您能给我看一下路线吗？', 'request', 'Could you show me the route on the map?', '您能在地图上给我看一下路线吗？'],
  ['How long does the transfer take?', '换乘需要多长时间？', 'question', 'How long does the transfer take?', '换乘需要多长时间？'],
  ['Is this seat available?', '这个座位有人吗？', 'question', 'Is this seat available for the whole trip?', '整个行程这个座位有人吗？'],
  ['Could I move to another seat?', '我可以换到另一个座位吗？', 'request', 'Could I move to another seat if it is quieter?', '如果那里更安静，我可以换到另一个座位吗？'],
  ['The air conditioning is too cold.', '空调太冷了。', 'complaint', 'The air conditioning is too cold in my room.', '我房间里的空调太冷了。'],
  ['The room is not ready yet.', '房间还没有准备好。', 'statement', 'The room is not ready yet, so I will wait.', '房间还没准备好，所以我会等。'],
  ['Could you store my luggage?', '您能帮我寄存行李吗？', 'request', 'Could you store my luggage until check-in?', '您能帮我把行李寄存到办理入住吗？'],
  ['I would prefer a quiet room.', '我想要一间安静的房间。', 'preference', 'I would prefer a quiet room if possible.', '如果可以，我想要一间安静的房间。'],
  ['Could I have a room away from the elevator?', '我可以要一间远离电梯的房间吗？', 'request', 'Could I have a room away from the elevator?', '我可以要一间远离电梯的房间吗？'],
  ['The key card does not work.', '房卡不能用。', 'complaint', 'The key card does not work for my room.', '我的房卡打不开房门。'],
  ['Could someone fix the shower?', '可以派人修一下淋浴吗？', 'request', 'Could someone fix the shower in my room?', '可以派人修一下我房间的淋浴吗？'],
  ['There is no hot water.', '没有热水。', 'complaint', 'There is no hot water in the bathroom.', '浴室里没有热水。'],
  ['Could I get an extra towel?', '我可以再要一条毛巾吗？', 'request', 'Could I get an extra towel, please?', '我可以再要一条毛巾吗？'],
  ['The Wi-Fi keeps disconnecting.', '无线网络总是断线。', 'complaint', 'The Wi-Fi keeps disconnecting in my room.', '我房间的无线网络总是断线。'],
  ['Could you send the bill by email?', '您能把账单发到邮箱吗？', 'request', 'Could you send the bill by email?', '您能把账单发到邮箱吗？'],
  ['I was charged twice.', '我被重复收费了。', 'statement', 'I was charged twice for the same meal.', '同一顿饭我被重复收费了。'],
  ['Could you explain this charge?', '您能解释一下这笔收费吗？', 'request', 'Could you explain this charge on the bill?', '您能解释一下账单上的这笔收费吗？'],
  ['I would like a table by the window.', '我想要靠窗的桌子。', 'preference', 'I would like a table by the window.', '我想要靠窗的桌子。'],
  ['Could we sit somewhere quieter?', '我们可以坐在更安静的地方吗？', 'request', 'Could we sit somewhere quieter?', '我们可以坐在更安静的地方吗？'],
  ['I am allergic to peanuts.', '我对花生过敏。', 'statement', 'I am allergic to peanuts, so please check the dish.', '我对花生过敏，所以请确认一下这道菜。'],
  ['Does this contain dairy?', '这个含有乳制品吗？', 'question', 'Does this contain dairy?', '这个含有乳制品吗？'],
  ['Could you leave out the onions?', '您能不放洋葱吗？', 'request', 'Could you leave out the onions from my dish?', '您能在我的菜里不放洋葱吗？'],
  ['I ordered the wrong dish.', '我点错菜了。', 'statement', 'I ordered the wrong dish by accident.', '我不小心点错菜了。'],
  ['Could I pay separately?', '我可以分开付款吗？', 'request', 'Could I pay separately from my friend?', '我可以和朋友分开付款吗？'],
  ['May I have a receipt, please?', '我可以要一张收据吗？', 'request', 'May I have a receipt, please?', '我可以要一张收据吗？'],
  ['The zipper is broken.', '拉链坏了。', 'statement', 'The zipper is broken, so I cannot close the bag.', '拉链坏了，所以我不能关上包。'],
  ['Could I exchange this for another size?', '我可以换成另一个尺码吗？', 'request', 'Could I exchange this for another size?', '我可以换成另一个尺码吗？'],
  ['I would like a refund.', '我想退款。', 'request', 'I would like a refund for this item.', '我想退这个商品的钱。'],
  ['The price on the shelf is different.', '货架上的价格不一样。', 'statement', 'The price on the shelf is different from the receipt.', '货架上的价格和收据不一样。'],
  ['Could you call a taxi for me?', '您能帮我叫一辆出租车吗？', 'request', 'Could you call a taxi for me after dinner?', '晚饭后您能帮我叫一辆出租车吗？'],
  ['Please drop me off at this address.', '请在这个地址让我下车。', 'request', 'Please drop me off at this address.', '请在这个地址让我下车。'],
  ['Could you take a different route?', '您能走另一条路线吗？', 'request', 'Could you take a different route to avoid traffic?', '您能为了避开交通拥堵走另一条路线吗？'],
  ['I left something in the taxi.', '我把东西落在出租车上了。', 'statement', 'I left something in the taxi after the ride.', '乘车后我把东西落在出租车上了。'],
  ['My bag has not arrived.', '我的行李还没有到。', 'statement', 'My bag has not arrived at baggage claim.', '我的行李还没有到行李提取处。'],
  ['Could you trace my luggage?', '您能帮我查询行李吗？', 'request', 'Could you trace my luggage with this tag number?', '您能用这个行李牌号码帮我查询行李吗？'],
  ['Could you help me fill out this form?', '您能帮我填写这张表吗？', 'request', 'Could you help me fill out this form?', '您能帮我填写这张表吗？'],
  ['I cannot find my passport.', '我找不到护照了。', 'statement', 'I cannot find my passport in my bag.', '我在包里找不到护照。'],
  ['Is there a pharmacy open nearby?', '附近有营业的药店吗？', 'question', 'Is there a pharmacy open nearby tonight?', '今晚附近有营业的药店吗？'],
  ['I need something for a sore throat.', '我需要治嗓子疼的药。', 'request', 'I need something for a sore throat.', '我需要治嗓子疼的药。'],
  ['Should I see a doctor?', '我应该去看医生吗？', 'question', 'Should I see a doctor for this pain?', '我应该因为这个疼痛去看医生吗？'],
  ['I do not feel well enough to travel.', '我身体不舒服，不能出行。', 'statement', 'I do not feel well enough to travel today.', '我今天身体不舒服，不能出行。'],
  ['Could you speak a little more slowly?', '您能说得再慢一点吗？', 'request', 'Could you speak a little more slowly?', '您能说得再慢一点吗？'],
  ['Could you write that down for me?', '您能帮我写下来吗？', 'request', 'Could you write that down for me?', '您能帮我写下来吗？'],
  ['I am not sure I understood correctly.', '我不确定自己是否理解正确。', 'statement', 'I am not sure I understood correctly.', '我不确定自己是否理解正确。'],
  ['Could you repeat the address?', '您能重复一下地址吗？', 'request', 'Could you repeat the address more clearly?', '您能更清楚地重复一下地址吗？'],
  ['I would rather pay by card.', '我更愿意刷卡付款。', 'preference', 'I would rather pay by card than carry cash.', '我更愿意刷卡付款而不是带现金。'],
  ['This option is better for me.', '这个选项更适合我。', 'statement', 'This option is better for me because it is closer.', '这个选项更适合我，因为它更近。'],
  ['Could you check whether my booking is confirmed?', '您能确认我的预订是否已确认吗？', 'request', 'Could you check whether my booking is confirmed?', '您能确认我的预订是否已确认吗？'],
  ['Could you send me the updated itinerary?', '您能把更新后的行程发给我吗？', 'request', 'Could you send me the updated itinerary by email?', '您能把更新后的行程发到邮箱吗？'],
]

if (rows.length !== 62) throw new Error(`Expected 62 reviewed rows, got ${rows.length}.`)
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-p3a-'))
const existing = new Set(unit.activity.items.map((item) => normalize(item.term)))
for (const [term] of rows) { if (existing.has(normalize(term))) throw new Error(`Duplicate daily term: ${term}`); existing.add(normalize(term)) }
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({ id: `r17-daily-p3a-${String(index + 1).padStart(3, '0')}`, term, meaningZh, partOfSpeech, exampleEn, exampleZh, growthDifficultyLevel: 1.5, dailyKnowledgeId: `daily-knowledge-v1:p3a:${String(index + 1).padStart(3, '0')}` })))
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 62 reviewed primary-3 4A daily vocabulary items.')
