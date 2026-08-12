import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons.flatMap((lesson) => lesson.learningUnits).find((candidate) => candidate.learningUnitId === 'st4w-w1d4-vocabulary')
if (!unit) throw new Error('The daily vocabulary host unit is missing.')

const rows = [
  ['Could you rebook me if the flight is canceled?', '如果航班取消，您能帮我改签吗？', 'request', 'Could you rebook me if the flight is canceled?', '如果航班取消，您能帮我改签吗？'],
  ['Will I receive a meal voucher during the delay?', '延误期间我会收到餐券吗？', 'question', 'Will I receive a meal voucher during the delay?', '延误期间我会收到餐券吗？'],
  ['Could you put me on a flight with fewer stops?', '您能把我安排到经停更少的航班吗？', 'request', 'Could you put me on a flight with fewer stops?', '您能把我安排到经停更少的航班吗？'],
  ['I need to change my seat because of a medical condition.', '因为身体状况，我需要换座位。', 'statement', 'I need to change my seat because of a medical condition.', '因为身体状况，我需要换座位。'],
  ['Could you check whether my bag was loaded?', '您能确认我的行李是否已装载吗？', 'request', 'Could you check whether my bag was loaded?', '您能确认我的行李是否已装载吗？'],
  ['Where can I pick up a delayed luggage claim form?', '我在哪里可以领取延误行李申报表？', 'question', 'Where can I pick up a delayed luggage claim form?', '我在哪里可以领取延误行李申报表？'],
  ['Could you deliver the bag after I leave the hotel?', '我离开酒店后您能递送行李吗？', 'request', 'Could you deliver the bag after I leave the hotel?', '我离开酒店后您能递送行李吗？'],
  ['The room key stops working after midnight.', '房卡在午夜后失效了。', 'complaint', 'The room key stops working after midnight.', '房卡在午夜后失效了。'],
  ['Could you send extra towels when housekeeping comes?', '客房服务来时您能送额外毛巾吗？', 'request', 'Could you send extra towels when housekeeping comes?', '客房服务来时您能送额外毛巾吗？'],
  ['I would like a room that faces the courtyard.', '我想要一间朝向庭院的房间。', 'preference', 'I would like a room that faces the courtyard.', '我想要一间朝向庭院的房间。'],
  ['Can you move my reservation to tomorrow night?', '您能把我的预订改到明晚吗？', 'request', 'Can you move my reservation to tomorrow night?', '您能把我的预订改到明晚吗？'],
  ['Could you explain the resort fee?', '您能解释度假村费用吗？', 'request', 'Could you explain the resort fee on this bill?', '您能解释账单上的度假村费用吗？'],
  ['Is there a deposit that will be returned later?', '有之后会退还的押金吗？', 'question', 'Is there a deposit that will be returned later?', '有之后会退还的押金吗？'],
  ['Could you recommend a dish that is not spicy?', '您能推荐一道不辣的菜吗？', 'request', 'Could you recommend a dish that is not spicy?', '您能推荐一道不辣的菜吗？'],
  ['I need to know whether this sauce contains alcohol.', '我需要知道这个酱汁是否含酒精。', 'statement', 'I need to know whether this sauce contains alcohol.', '我需要知道这个酱汁是否含酒精。'],
  ['Could you make the dish less salty?', '您能把这道菜做得淡一点吗？', 'request', 'Could you make the dish less salty?', '您能把这道菜做得淡一点吗？'],
  ['We ordered first, but another table was served first.', '我们先点餐，但另一桌先上菜了。', 'complaint', 'We ordered first, but another table was served first.', '我们先点餐，但另一桌先上菜了。'],
  ['Could you split the bill by item?', '您能按菜品分账吗？', 'request', 'Could you split the bill by item?', '您能按菜品分账吗？'],
  ['Is there an entrance with an elevator?', '有带电梯的入口吗？', 'question', 'Is there an entrance with an elevator?', '有带电梯的入口吗？'],
  ['Could you tell me when the next bus leaves?', '您能告诉我下一班公交何时发车吗？', 'request', 'Could you tell me when the next bus leaves?', '您能告诉我下一班公交何时发车吗？'],
  ['Does this route avoid the highway?', '这条路线避开高速公路吗？', 'question', 'Does this route avoid the highway?', '这条路线避开高速公路吗？'],
  ['I need to get there before the museum closes.', '我需要在博物馆关闭前到那里。', 'statement', 'I need to get there before the museum closes.', '我需要在博物馆关闭前到那里。'],
  ['Could you tell the driver to take the scenic route?', '您能让司机走风景更好的路线吗？', 'request', 'Could you tell the driver to take the scenic route?', '您能让司机走风景更好的路线吗？'],
  ['Can I transfer to a different bus with this ticket?', '我可以用这张票换乘另一辆公交吗？', 'question', 'Can I transfer to a different bus with this ticket?', '我可以用这张票换乘另一辆公交吗？'],
  ['Could you hold this item until this afternoon?', '您能把这件商品留到今天下午吗？', 'request', 'Could you hold this item until this afternoon?', '您能把这件商品留到今天下午吗？'],
  ['I need a larger size if this one is too tight.', '如果这件太紧，我需要更大尺码。', 'statement', 'I need a larger size if this one is too tight.', '如果这件太紧，我需要更大尺码。'],
  ['Could you show me an alternative in the same price range?', '您能给我看看同价位的替代品吗？', 'request', 'Could you show me an alternative in the same price range?', '您能给我看看同价位的替代品吗？'],
  ['Is the sale price valid at every register?', '促销价在每个收银台都有效吗？', 'question', 'Is the sale price valid at every register?', '促销价在每个收银台都有效吗？'],
  ['Could you exchange this after I try it at home?', '我在家试过后可以换这件吗？', 'request', 'Could you exchange this after I try it at home?', '我在家试过后可以换这件吗？'],
  ['I need a refund because the item is defective.', '因为商品有瑕疵，我需要退款。', 'statement', 'I need a refund because the item is defective.', '因为商品有瑕疵，我需要退款。'],
  ['Could you explain how to use this medicine?', '您能解释这个药怎么用吗？', 'request', 'Could you explain how to use this medicine?', '您能解释这个药怎么用吗？'],
  ['Should I avoid sunlight while taking this medicine?', '服用这个药时我应该避光吗？', 'question', 'Should I avoid sunlight while taking this medicine?', '服用这个药时我应该避光吗？'],
  ['I need something for a cough that will not cause drowsiness.', '我需要一种不会让我困倦的止咳药。', 'statement', 'I need something for a cough that will not cause drowsiness.', '我需要一种不会让我困倦的止咳药。'],
  ['Could you call a taxi if the clinic is closed?', '如果诊所关门，您能叫出租车吗？', 'request', 'Could you call a taxi if the clinic is closed?', '如果诊所关门，您能叫出租车吗？'],
  ['Can you write down the hotel name for the pharmacist?', '您能为药剂师写下酒店名称吗？', 'request', 'Can you write down the hotel name for the pharmacist?', '您能为药剂师写下酒店名称吗？'],
  ['Could you help me reconnect to the hotel Wi-Fi?', '您能帮我重新连接酒店无线网络吗？', 'request', 'Could you help me reconnect to the hotel Wi-Fi?', '您能帮我重新连接酒店无线网络吗？'],
  ['Will my phone work after I add this data package?', '我添加这个流量套餐后手机能用吗？', 'question', 'Will my phone work after I add this data package?', '我添加这个流量套餐后手机能用吗？'],
  ['Could you send the address as a text message?', '您能把地址作为短信发送吗？', 'request', 'Could you send the address as a text message?', '您能把地址作为短信发送吗？'],
  ['I need to make an international call from this phone.', '我需要用这部电话拨打国际电话。', 'statement', 'I need to make an international call from this phone.', '我需要用这部电话拨打国际电话。'],
  ['Could you check whether this charger works with my phone?', '您能确认这个充电器是否适合我的手机吗？', 'request', 'Could you check whether this charger works with my phone?', '您能确认这个充电器是否适合我的手机吗？'],
  ['Could you wait while I check my reservation email?', '我查看预订邮件时您能稍等吗？', 'request', 'Could you wait while I check my reservation email?', '我查看预订邮件时您能稍等吗？'],
  ['I may arrive late because the train is delayed.', '因为火车延误，我可能会晚到。', 'statement', 'I may arrive late because the train is delayed.', '因为火车延误，我可能会晚到。'],
  ['Could you repeat the pickup instructions more slowly?', '您能更慢地重复接车说明吗？', 'request', 'Could you repeat the pickup instructions more slowly?', '您能更慢地重复接车说明吗？'],
  ['Could you confirm the meeting point before I leave?', '我离开前您能确认集合地点吗？', 'request', 'Could you confirm the meeting point before I leave?', '我离开前您能确认集合地点吗？'],
  ['I need directions that avoid steep hills.', '我需要避开陡坡的路线。', 'statement', 'I need directions that avoid steep hills.', '我需要避开陡坡的路线。'],
  ['Can I leave my bag here while I visit the museum?', '我参观博物馆时可以把包留在这里吗？', 'question', 'Can I leave my bag here while I visit the museum?', '我参观博物馆时可以把包留在这里吗？'],
  ['Could you recommend a nearby place to rest?', '您能推荐附近休息的地方吗？', 'request', 'Could you recommend a nearby place to rest?', '您能推荐附近休息的地方吗？'],
  ['The directions on my map do not match this street.', '我地图上的路线与这条街不一致。', 'complaint', 'The directions on my map do not match this street.', '我地图上的路线与这条街不一致。'],
  ['Could you explain the local tipping custom?', '您能解释当地的小费习惯吗？', 'request', 'Could you explain the local tipping custom?', '您能解释当地的小费习惯吗？'],
  ['Is it safer to walk here during the day?', '白天在这里步行更安全吗？', 'question', 'Is it safer to walk here during the day?', '白天在这里步行更安全吗？'],
  ['Could you help me find the nearest police station?', '您能帮我找最近的警察局吗？', 'request', 'Could you help me find the nearest police station?', '您能帮我找最近的警察局吗？'],
  ['I need to report a lost passport.', '我需要申报护照丢失。', 'statement', 'I need to report a lost passport.', '我需要申报护照丢失。'],
  ['Could you tell me what documents I need to bring?', '您能告诉我需要带哪些文件吗？', 'request', 'Could you tell me what documents I need to bring?', '您能告诉我需要带哪些文件吗？'],
  ['Could you keep my luggage until the shuttle arrives?', '班车到达前您能保管我的行李吗？', 'request', 'Could you keep my luggage until the shuttle arrives?', '班车到达前您能保管我的行李吗？'],
  ['Would a morning tour be less crowded?', '上午的旅行团会更不拥挤吗？', 'question', 'Would a morning tour be less crowded?', '上午的旅行团会更不拥挤吗？'],
]

if (rows.length !== 55) throw new Error(`Expected 55 reviewed rows, got ${rows.length}.`)
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-p4a-'))
const existing = new Set(unit.activity.items.map((item) => normalize(item.term)))
for (const [term] of rows) { if (existing.has(normalize(term))) throw new Error(`Duplicate daily term: ${term}`); existing.add(normalize(term)) }
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({ id: `r17-daily-p4a-${String(index + 1).padStart(3, '0')}`, term, meaningZh, partOfSpeech, exampleEn, exampleZh, growthDifficultyLevel: 2, dailyKnowledgeId: `daily-knowledge-v1:p4a:${String(index + 1).padStart(3, '0')}` })))
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 55 reviewed primary-4 5A daily vocabulary items.')
