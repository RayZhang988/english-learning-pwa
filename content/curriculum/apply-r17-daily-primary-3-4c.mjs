import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons.flatMap((lesson) => lesson.learningUnits).find((candidate) => candidate.learningUnitId === 'st4w-w1d4-vocabulary')
if (!unit) throw new Error('The primary-3 daily vocabulary host unit is missing.')

const rows = [
  ['Could you explain the reason for the delay?', '您能解释延误原因吗？', 'request', 'Could you explain the reason for the delay?', '您能解释延误原因吗？'],
  ['Will the delay affect my connection?', '延误会影响我的转机吗？', 'question', 'Will the delay affect my connection in Chicago?', '延误会影响我在芝加哥的转机吗？'],
  ['Could I take an earlier flight instead?', '我可以改乘更早的航班吗？', 'request', 'Could I take an earlier flight instead?', '我可以改乘更早的航班吗？'],
  ['Please put me on the next available flight.', '请把我安排到下一班有空位的航班。', 'request', 'Please put me on the next available flight.', '请把我安排到下一班有空位的航班。'],
  ['Please notify me if the departure time changes.', '如果出发时间改变请通知我。', 'request', 'Please notify me if the departure time changes.', '如果出发时间改变请通知我。'],
  ['Do I need to collect my bag after rebooking?', '改签后我需要领取行李吗？', 'question', 'Do I need to collect my bag after rebooking?', '改签后我需要领取行李吗？'],
  ['Is the gate change confirmed?', '登机口变更确认了吗？', 'question', 'Is the gate change confirmed for this flight?', '这个航班的登机口变更确认了吗？'],
  ['What happens if I miss the last train?', '如果错过末班火车会怎样？', 'question', 'What happens if I miss the last train tonight?', '如果今晚错过末班火车会怎样？'],
  ['Could you arrange a replacement bag?', '您能安排一个替换行李箱吗？', 'request', 'Could you arrange a replacement bag because mine was damaged?', '因为我的行李箱损坏了，您能安排一个替换行李箱吗？'],
  ['Can this suitcase be repaired?', '这个行李箱可以修好吗？', 'question', 'Can this suitcase be repaired?', '这个行李箱可以修好吗？'],
  ['I cannot find the baggage service desk.', '我找不到行李服务柜台。', 'statement', 'I cannot find the baggage service desk.', '我找不到行李服务柜台。'],
  ['Could you trace my delayed bag?', '您能追踪我延误的行李吗？', 'request', 'Could you trace my delayed bag?', '您能追踪我延误的行李吗？'],
  ['The air conditioner is blowing warm air.', '空调吹出的是暖风。', 'complaint', 'The air conditioner is blowing warm air.', '空调吹出的是暖风。'],
  ['Could you send someone to fix the shower?', '您能派人修一下淋浴吗？', 'request', 'Could you send someone to fix the shower?', '您能派人修一下淋浴吗？'],
  ['Could I move if the noise continues?', '如果噪音持续，我可以换房吗？', 'question', 'Could I move if the noise continues tonight?', '如果今晚噪音持续，我可以换房吗？'],
  ['Is there another room at the same rate?', '有相同房价的其他房间吗？', 'question', 'Is there another room at the same rate?', '有相同房价的其他房间吗？'],
  ['I would rather stay near the lobby.', '我更愿意住在大堂附近。', 'preference', 'I would rather stay near the lobby.', '我更愿意住在大堂附近。'],
  ['Could you reserve a table away from the kitchen?', '您能预留一张远离厨房的桌子吗？', 'request', 'Could you reserve a table away from the kitchen?', '您能预留一张远离厨房的桌子吗？'],
  ['I need a meal without dairy.', '我需要一份不含乳制品的餐。', 'statement', 'I need a meal without dairy.', '我需要一份不含乳制品的餐。'],
  ['Could you check whether the soup contains nuts?', '您能确认这道汤是否含坚果吗？', 'request', 'Could you check whether the soup contains nuts?', '您能确认这道汤是否含坚果吗？'],
  ['Could I have the dressing on the side?', '我可以把沙拉酱另放吗？', 'request', 'Could I have the dressing on the side?', '我可以把沙拉酱另放吗？'],
  ['This portion is smaller than expected.', '这份餐点比预想的少。', 'complaint', 'This portion is smaller than expected.', '这份餐点比预想的少。'],
  ['Could you replace this drink?', '您能更换这杯饮料吗？', 'request', 'Could you replace this drink because it is warm?', '因为饮料不凉，您能更换这杯饮料吗？'],
  ['We were charged twice.', '我们被重复收费了。', 'complaint', 'We were charged twice for the same meal.', '同一餐我们被重复收费了。'],
  ['Could you check why the total changed?', '您能查看总额为什么变了吗？', 'request', 'Could you check why the total changed?', '您能查看总额为什么变了吗？'],
  ['Is there a less crowded route?', '有更不拥挤的路线吗？', 'question', 'Is there a less crowded route to the museum?', '去博物馆有更不拥挤的路线吗？'],
  ['Could you point out the correct platform?', '您能指出正确的站台吗？', 'request', 'Could you point out the correct platform for the express train?', '您能指出快车正确的站台吗？'],
  ['Should I transfer at Central Station?', '我应该在中央车站换乘吗？', 'question', 'Should I transfer at Central Station?', '我应该在中央车站换乘吗？'],
  ['I want a route with fewer stairs.', '我想走楼梯更少的路线。', 'preference', 'I want a route with fewer stairs.', '我想走楼梯更少的路线。'],
  ['Could you confirm whether the subway is running?', '您能确认地铁是否在运行吗？', 'request', 'Could you confirm whether the subway is running?', '您能确认地铁是否在运行吗？'],
  ['Can I use this pass on the airport train?', '我可以在机场火车上用这张通票吗？', 'question', 'Can I use this pass on the airport train?', '我可以在机场火车上用这张通票吗？'],
  ['Could you delay the checkout time?', '您能延后退房时间吗？', 'request', 'Could you delay the checkout time by one hour?', '您能延后一个小时退房时间吗？'],
  ['Could you store my bags after checkout?', '退房后您能寄存我的行李吗？', 'request', 'Could you store my bags after checkout?', '退房后您能寄存我的行李吗？'],
  ['Can you add breakfast for tomorrow?', '您能加上明天的早餐吗？', 'request', 'Can you add breakfast for tomorrow?', '您能加上明天的早餐吗？'],
  ['I need an invoice for my stay.', '我需要住宿发票。', 'statement', 'I need an invoice for my stay.', '我需要住宿发票。'],
  ['Could you remove the minibar charge?', '您能移除迷你吧收费吗？', 'request', 'Could you remove the minibar charge because I did not use it?', '因为我没有使用，您能移除迷你吧收费吗？'],
  ['Could you compare these two ticket options?', '您能比较这两种票务选项吗？', 'request', 'Could you compare these two ticket options?', '您能比较这两种票务选项吗？'],
  ['Which option arrives sooner?', '哪个选项到得更早？', 'question', 'Which option arrives sooner?', '哪个选项到得更早？'],
  ['Is the return trip included?', '包含返程吗？', 'question', 'Is the return trip included in this fare?', '这个票价包含返程吗？'],
  ['Could you give me the shortest walking route?', '您能给我最短的步行路线吗？', 'request', 'Could you give me the shortest walking route?', '您能给我最短的步行路线吗？'],
  ['Please confirm the hotel address with the driver.', '请和司机确认酒店地址。', 'request', 'Please confirm the hotel address with the driver.', '请和司机确认酒店地址。'],
  ['Could you pick me up at the side entrance?', '您能在侧门接我吗？', 'request', 'Could you pick me up at the side entrance?', '您能在侧门接我吗？'],
  ['I will arrive later than planned.', '我会比计划晚到。', 'statement', 'I will arrive later than planned because of traffic.', '因为堵车，我会比计划晚到。'],
  ['Could you keep the reservation until I arrive?', '您能保留预订直到我到达吗？', 'request', 'Could you keep the reservation until I arrive?', '您能保留预订直到我到达吗？'],
  ['I prefer a quieter seat if possible.', '如果可以，我更想要安静的座位。', 'preference', 'I prefer a quieter seat if possible.', '如果可以，我更想要安静的座位。'],
  ['Could I sit closer to the exit?', '我可以坐得离出口更近吗？', 'request', 'Could I sit closer to the exit?', '我可以坐得离出口更近吗？'],
  ['This seat has less legroom.', '这个座位腿部空间更小。', 'complaint', 'This seat has less legroom than the other one.', '这个座位比另一个腿部空间更小。'],
  ['Could you move me if a seat opens up?', '如果有空座，您能给我换座吗？', 'request', 'Could you move me if a seat opens up?', '如果有空座，您能给我换座吗？'],
  ['I need a refund because the service was canceled.', '因为服务取消，我需要退款。', 'statement', 'I need a refund because the service was canceled.', '因为服务取消，我需要退款。'],
  ['When will the refund appear on my card?', '退款什么时候会显示在我的卡上？', 'question', 'When will the refund appear on my card?', '退款什么时候会显示在我的卡上？'],
  ['Could you give me a receipt for the refund?', '您能给我退款收据吗？', 'request', 'Could you give me a receipt for the refund?', '您能给我退款收据吗？'],
  ['My reservation name is spelled incorrectly.', '我的预订姓名拼写错了。', 'complaint', 'My reservation name is spelled incorrectly.', '我的预订姓名拼写错了。'],
  ['Could you correct the spelling before check-in?', '您能在入住前更正拼写吗？', 'request', 'Could you correct the spelling before check-in?', '您能在入住前更正拼写吗？'],
  ['I need a printed copy for the border officer.', '我需要给边检人员的打印副本。', 'statement', 'I need a printed copy for the border officer.', '我需要给边检人员的打印副本。'],
  ['Could you check this form before I submit it?', '我提交前您能检查这张表吗？', 'request', 'Could you check this form before I submit it?', '我提交前您能检查这张表吗？'],
  ['Where can I charge my phone safely?', '我在哪里可以安全给手机充电？', 'question', 'Where can I charge my phone safely?', '我在哪里可以安全给手机充电？'],
  ['Could you call me when my ride arrives?', '我的车到时您能给我打电话吗？', 'request', 'Could you call me when my ride arrives?', '我的车到时您能给我打电话吗？'],
  ['I need to change the pickup time.', '我需要更改接车时间。', 'statement', 'I need to change the pickup time.', '我需要更改接车时间。'],
  ['Could you send the confirmation again?', '您能再发一次确认信息吗？', 'request', 'Could you send the confirmation again?', '您能再发一次确认信息吗？'],
  ['Please tell me if there is a cheaper choice.', '如果有更便宜的选择请告诉我。', 'request', 'Please tell me if there is a cheaper choice.', '如果有更便宜的选择请告诉我。'],
  ['I need a medicine that will not make me sleepy.', '我需要不会让我犯困的药。', 'statement', 'I need a medicine that will not make me sleepy.', '我需要不会让我犯困的药。'],
  ['Could you explain how often I should take this?', '您能解释这个药多久服用一次吗？', 'request', 'Could you explain how often I should take this?', '您能解释这个药多久服用一次吗？'],
]

if (rows.length !== 62) throw new Error(`Expected 62 reviewed rows, got ${rows.length}.`)
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-p3c-'))
const existing = new Set(unit.activity.items.map((item) => normalize(item.term)))
for (const [term] of rows) { if (existing.has(normalize(term))) throw new Error(`Duplicate daily term: ${term}`); existing.add(normalize(term)) }
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({ id: `r17-daily-p3c-${String(index + 1).padStart(3, '0')}`, term, meaningZh, partOfSpeech, exampleEn, exampleZh, growthDifficultyLevel: 1.5, dailyKnowledgeId: `daily-knowledge-v1:p3c:${String(index + 1).padStart(3, '0')}` })))
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 62 reviewed primary-3 4C daily vocabulary items.')
