import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons.flatMap((lesson) => lesson.learningUnits).find((candidate) => candidate.learningUnitId === 'st4w-w1d4-vocabulary')
if (!unit) throw new Error('The primary-3 daily vocabulary host unit is missing.')

const rows = [
  ['The delay was caused by weather.', '延误是天气造成的。', 'statement', 'The delay was caused by weather.', '延误是天气造成的。'],
  ['The flight is waiting for a crew.', '航班正在等机组人员。', 'statement', 'The flight is waiting for a crew.', '航班正在等机组人员。'],
  ['Can I change to a different date?', '我可以改到别的日期吗？', 'question', 'Can I change to a different date without a fee?', '我可以免手续费改到别的日期吗？'],
  ['What is the change fee?', '改签费用是多少？', 'question', 'What is the change fee for this ticket?', '这张票的改签费用是多少？'],
  ['Could you waive the fee?', '您能免除这项费用吗？', 'request', 'Could you waive the fee because the flight was canceled?', '因为航班取消，您能免除这项费用吗？'],
  ['I need a boarding pass for the new flight.', '我需要新航班的登机牌。', 'statement', 'I need a boarding pass for the new flight.', '我需要新航班的登机牌。'],
  ['Where should I wait for updates?', '我应该在哪里等待通知？', 'question', 'Where should I wait for updates about the flight?', '我应该在哪里等待航班通知？'],
  ['Could you add me to the standby list?', '您能把我加到候补名单吗？', 'request', 'Could you add me to the standby list?', '您能把我加到候补名单吗？'],
  ['My luggage tag is missing.', '我的行李牌不见了。', 'statement', 'My luggage tag is missing from my suitcase.', '我的行李箱上的行李牌不见了。'],
  ['The suitcase arrived damaged.', '行李箱到达时损坏了。', 'statement', 'The suitcase arrived damaged after the flight.', '行李箱在航班后到达时损坏了。'],
  ['Could you file a damage report?', '您能提交损坏报告吗？', 'request', 'Could you file a damage report for this suitcase?', '您能为这个行李箱提交损坏报告吗？'],
  ['I need to update the delivery address.', '我需要更新送达地址。', 'statement', 'I need to update the delivery address for my bag.', '我需要更新行李的送达地址。'],
  ['When will my bag be delivered?', '我的行李什么时候送到？', 'question', 'When will my bag be delivered to the hotel?', '我的行李什么时候送到酒店？'],
  ['The room is noisier than expected.', '房间比预想的更吵。', 'complaint', 'The room is noisier than expected at night.', '晚上房间比预想的更吵。'],
  ['Could I switch to a quieter floor?', '我可以换到更安静的楼层吗？', 'request', 'Could I switch to a quieter floor?', '我可以换到更安静的楼层吗？'],
  ['The room has a strong smell.', '房间有很重的气味。', 'complaint', 'The room has a strong smell near the door.', '房门附近有很重的气味。'],
  ['Could you send housekeeping?', '您能派客房服务员来吗？', 'request', 'Could you send housekeeping to my room?', '您能派客房服务员到我房间吗？'],
  ['The safe will not open.', '保险箱打不开。', 'complaint', 'The safe will not open with my code.', '保险箱用我的密码打不开。'],
  ['Could you check the thermostat?', '您能检查一下温控器吗？', 'request', 'Could you check the thermostat in my room?', '您能检查一下我房间的温控器吗？'],
  ['I prefer a room with a bathtub.', '我更想要有浴缸的房间。', 'preference', 'I prefer a room with a bathtub if one is available.', '如果有空房，我更想要有浴缸的房间。'],
  ['Is breakfast included in the rate?', '房价包含早餐吗？', 'question', 'Is breakfast included in the rate?', '房价包含早餐吗？'],
  ['Could you recommend a less expensive option?', '您能推荐一个更便宜的选项吗？', 'request', 'Could you recommend a less expensive option?', '您能推荐一个更便宜的选项吗？'],
  ['Which route has fewer transfers?', '哪条路线换乘更少？', 'question', 'Which route has fewer transfers to downtown?', '去市中心哪条路线换乘更少？'],
  ['Is the express train faster?', '快车更快吗？', 'question', 'Is the express train faster than the local train?', '快车比慢车更快吗？'],
  ['Could you mark the meeting point?', '您能标出集合地点吗？', 'request', 'Could you mark the meeting point on this map?', '您能在这张地图上标出集合地点吗？'],
  ['Let us meet outside the station.', '我们在车站外见面吧。', 'suggestion', 'Let us meet outside the station at noon.', '我们中午在车站外见面吧。'],
  ['Please confirm the pickup location.', '请确认接车地点。', 'request', 'Please confirm the pickup location for tomorrow.', '请确认明天的接车地点。'],
  ['Could you hold the train for a minute?', '您能让火车等一分钟吗？', 'request', 'Could you hold the train for a minute?', '您能让火车等一分钟吗？'],
  ['I need to get off at the next stop.', '我需要在下一站下车。', 'statement', 'I need to get off at the next stop.', '我需要在下一站下车。'],
  ['Does this ticket allow reentry?', '这张票可以再次进入吗？', 'question', 'Does this ticket allow reentry to the museum?', '这张票可以再次进入博物馆吗？'],
  ['The machine did not print a ticket.', '机器没有打印出票。', 'complaint', 'The machine did not print a ticket after payment.', '付款后机器没有打印出票。'],
  ['Could you help me use the ticket machine?', '您能帮我使用售票机吗？', 'request', 'Could you help me use the ticket machine?', '您能帮我使用售票机吗？'],
  ['Does this dish contain shellfish?', '这道菜含有贝类吗？', 'question', 'Does this dish contain shellfish?', '这道菜含有贝类吗？'],
  ['I cannot eat gluten.', '我不能吃麸质。', 'statement', 'I cannot eat gluten, so I need another option.', '我不能吃麸质，所以我需要另一个选项。'],
  ['Could you separate the sauce?', '您能把酱汁分开放吗？', 'request', 'Could you separate the sauce from the dish?', '您能把酱汁和菜分开放吗？'],
  ['I would prefer grilled fish.', '我更想要烤鱼。', 'preference', 'I would prefer grilled fish instead of fried fish.', '我更想要烤鱼而不是炸鱼。'],
  ['The meal is colder than it should be.', '这顿饭比应有的温度更凉。', 'complaint', 'The meal is colder than it should be.', '这顿饭比应有的温度更凉。'],
  ['Could you warm this up?', '您能把这个加热一下吗？', 'request', 'Could you warm this up, please?', '您能把这个加热一下吗？'],
  ['We have been waiting for a long time.', '我们已经等很久了。', 'complaint', 'We have been waiting for a long time.', '我们已经等很久了。'],
  ['Could you check on our order?', '您能查看一下我们的订单吗？', 'request', 'Could you check on our order, please?', '您能查看一下我们的订单吗？'],
  ['Is there a vegetarian alternative?', '有素食替代选项吗？', 'question', 'Is there a vegetarian alternative to this dish?', '这道菜有素食替代选项吗？'],
  ['Can I return this without the box?', '没有盒子我可以退这个吗？', 'question', 'Can I return this without the box?', '没有盒子我可以退这个吗？'],
  ['The item does not match the description.', '商品与描述不符。', 'statement', 'The item does not match the description online.', '商品与网上描述不符。'],
  ['Could you check the stock in another store?', '您能查一下另一家店的库存吗？', 'request', 'Could you check the stock in another store?', '您能查一下另一家店的库存吗？'],
  ['This size fits better.', '这个尺码更合适。', 'statement', 'This size fits better than the smaller one.', '这个尺码比小一号的更合适。'],
  ['Could you match the advertised price?', '您能按广告价格算吗？', 'request', 'Could you match the advertised price?', '您能按广告价格算吗？'],
  ['I need to cancel this booking.', '我需要取消这个预订。', 'statement', 'I need to cancel this booking before tonight.', '我需要在今晚前取消这个预订。'],
  ['What is the cancellation policy?', '取消政策是什么？', 'question', 'What is the cancellation policy for this hotel?', '这家酒店的取消政策是什么？'],
  ['Could you send a cancellation confirmation?', '您能发送取消确认吗？', 'request', 'Could you send a cancellation confirmation by email?', '您能通过邮件发送取消确认吗？'],
  ['My phone battery is running low.', '我的手机电量快没了。', 'statement', 'My phone battery is running low, so I need a charger.', '我的手机电量快没了，所以我需要充电器。'],
  ['Is there a charging station nearby?', '附近有充电站吗？', 'question', 'Is there a charging station nearby?', '附近有充电站吗？'],
  ['Could you reset the Wi-Fi password?', '您能重设无线网络密码吗？', 'request', 'Could you reset the Wi-Fi password for me?', '您能帮我重设无线网络密码吗？'],
  ['The signal is weaker in my room.', '我房间里的信号更弱。', 'complaint', 'The signal is weaker in my room than in the lobby.', '我房间里的信号比大堂更弱。'],
  ['Could you write the address in English?', '您能用英文写下地址吗？', 'request', 'Could you write the address in English for the driver?', '您能用英文为司机写下地址吗？'],
  ['I need help because I feel dizzy.', '我因为头晕需要帮助。', 'statement', 'I need help because I feel dizzy.', '我因为头晕需要帮助。'],
  ['Could you call a clinic for me?', '您能帮我联系诊所吗？', 'request', 'Could you call a clinic for me?', '您能帮我联系诊所吗？'],
  ['Is there a doctor who speaks English?', '有会说英语的医生吗？', 'question', 'Is there a doctor who speaks English nearby?', '附近有会说英语的医生吗？'],
  ['I need to take this medicine with food.', '我需要随餐服用这个药。', 'statement', 'I need to take this medicine with food.', '我需要随餐服用这个药。'],
  ['Could you tell me where the restroom is?', '您能告诉我洗手间在哪里吗？', 'request', 'Could you tell me where the restroom is?', '您能告诉我洗手间在哪里吗？'],
  ['Please call me when the room is ready.', '房间准备好时请给我打电话。', 'request', 'Please call me when the room is ready.', '房间准备好时请给我打电话。'],
  ['Could you check both names on the reservation?', '您能核对预订上的两个名字吗？', 'request', 'Could you check both names on the reservation?', '您能核对预订上的两个名字吗？'],
  ['Could you print the directions for me?', '您能为我打印路线吗？', 'request', 'Could you print the directions for me?', '您能为我打印路线吗？'],
]

if (rows.length !== 62) throw new Error(`Expected 62 reviewed rows, got ${rows.length}.`)
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-p3b-'))
const existing = new Set(unit.activity.items.map((item) => normalize(item.term)))
for (const [term] of rows) { if (existing.has(normalize(term))) throw new Error(`Duplicate daily term: ${term}`); existing.add(normalize(term)) }
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({ id: `r17-daily-p3b-${String(index + 1).padStart(3, '0')}`, term, meaningZh, partOfSpeech, exampleEn, exampleZh, growthDifficultyLevel: 1.5, dailyKnowledgeId: `daily-knowledge-v1:p3b:${String(index + 1).padStart(3, '0')}` })))
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 62 reviewed primary-3 4B daily vocabulary items.')
