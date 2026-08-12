import fs from 'node:fs'
const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons.flatMap((lesson) => lesson.learningUnits).find((candidate) => candidate.learningUnitId === 'st4w-w1d4-vocabulary')
if (!unit) throw new Error('The daily vocabulary host unit is missing.')
const rows = [
['Could you confirm whether the flight is on time?', '您能确认航班是否准点吗？', 'request', 'Could you confirm whether the flight is on time?', '您能确认航班是否准点吗？'],
['I need to change terminals if the gate changes.', '如果登机口改变，我需要换航站楼。', 'statement', 'I need to change terminals if the gate changes.', '如果登机口改变，我需要换航站楼。'],
['Could you explain why my boarding pass has no seat number?', '您能解释为什么我的登机牌没有座位号吗？', 'request', 'Could you explain why my boarding pass has no seat number?', '您能解释为什么我的登机牌没有座位号吗？'],
['Will there be another security check after the transfer?', '转机后还会再安检吗？', 'question', 'Will there be another security check after the transfer?', '转机后还会再安检吗？'],
['Could you tell me if the hotel shuttle is free?', '您能告诉我酒店班车是否免费吗？', 'request', 'Could you tell me if the hotel shuttle is free?', '您能告诉我酒店班车是否免费吗？'],
['I need a receipt that shows the hotel address.', '我需要一张显示酒店地址的收据。', 'statement', 'I need a receipt that shows the hotel address.', '我需要一张显示酒店地址的收据。'],
['Could you arrange an early breakfast if I leave before dawn?', '如果我黎明前离开，您能安排提前早餐吗？', 'request', 'Could you arrange an early breakfast if I leave before dawn?', '如果我黎明前离开，您能安排提前早餐吗？'],
['The room is too cold even after I adjust the thermostat.', '即使调了温控器，房间还是太冷。', 'complaint', 'The room is too cold even after I adjust the thermostat.', '即使调了温控器，房间还是太冷。'],
['Could you send a technician if the television still does not work?', '如果电视仍然不能用，您能派技术人员来吗？', 'request', 'Could you send a technician if the television still does not work?', '如果电视仍然不能用，您能派技术人员来吗？'],
['Is there a rule about bringing food into the room?', '有带食物进房间的规定吗？', 'question', 'Is there a rule about bringing food into the room?', '有带食物进房间的规定吗？'],
['Could you let me know when the laundry is ready?', '洗衣准备好时您能通知我吗？', 'request', 'Could you let me know when the laundry is ready?', '洗衣准备好时您能通知我吗？'],
['I would choose the smaller room if it is closer to the elevator.', '如果离电梯更近，我会选小一点的房间。', 'preference', 'I would choose the smaller room if it is closer to the elevator.', '如果离电梯更近，我会选小一点的房间。'],
['Could you check whether the restaurant takes reservations?', '您能确认这家餐厅是否接受预订吗？', 'request', 'Could you check whether the restaurant takes reservations?', '您能确认这家餐厅是否接受预订吗？'],
['I need a meal that does not contain soy.', '我需要一份不含大豆的餐。', 'statement', 'I need a meal that does not contain soy.', '我需要一份不含大豆的餐。'],
['Could you serve the children first if possible?', '如果可以，您能先给孩子上菜吗？', 'request', 'Could you serve the children first if possible?', '如果可以，您能先给孩子上菜吗？'],
['The food arrived after we had finished our drinks.', '我们喝完饮料后食物才上来。', 'complaint', 'The food arrived after we had finished our drinks.', '我们喝完饮料后食物才上来。'],
['Could you bring the check when we finish eating?', '我们吃完后您能把账单拿来吗？', 'request', 'Could you bring the check when we finish eating?', '我们吃完后您能把账单拿来吗？'],
['Is the service charge already included?', '服务费已经包含了吗？', 'question', 'Is the service charge already included?', '服务费已经包含了吗？'],
['Could you show me a route that stays indoors?', '您能给我看一条室内路线吗？', 'request', 'Could you show me a route that stays indoors?', '您能给我看一条室内路线吗？'],
['I need to know whether this station has lockers.', '我需要知道这个车站是否有储物柜。', 'statement', 'I need to know whether this station has lockers.', '我需要知道这个车站是否有储物柜。'],
['Could you tell me if the ticket is valid all day?', '您能告诉我车票是否全天有效吗？', 'request', 'Could you tell me if the ticket is valid all day?', '您能告诉我车票是否全天有效吗？'],
['The train is more crowded than usual today.', '今天火车比平常更拥挤。', 'statement', 'The train is more crowded than usual today.', '今天火车比平常更拥挤。'],
['Could you help me find a seat near the door?', '您能帮我找一个靠门的座位吗？', 'request', 'Could you help me find a seat near the door?', '您能帮我找一个靠门的座位吗？'],
['I need to take a break before we continue walking.', '我们继续走之前我需要休息一下。', 'statement', 'I need to take a break before we continue walking.', '我们继续走之前我需要休息一下。'],
['Could you wait here while I buy the tickets?', '我买票时您能在这里等吗？', 'request', 'Could you wait here while I buy the tickets?', '我买票时您能在这里等吗？'],
['Is there a discount for buying tickets online?', '网上买票有折扣吗？', 'question', 'Is there a discount for buying tickets online?', '网上买票有折扣吗？'],
['Could you explain the difference between a day pass and a single ticket?', '您能解释日票和单程票的区别吗？', 'request', 'Could you explain the difference between a day pass and a single ticket?', '您能解释日票和单程票的区别吗？'],
['I need to know if this path is safe after dark.', '我需要知道这条路天黑后是否安全。', 'statement', 'I need to know if this path is safe after dark.', '我需要知道这条路天黑后是否安全。'],
['Could you call the store to check if they have this in stock?', '您能给商店打电话确认他们是否有库存吗？', 'request', 'Could you call the store to check if they have this in stock?', '您能给商店打电话确认他们是否有库存吗？'],
['I would like to compare the warranty on these two items.', '我想比较这两件商品的保修。', 'statement', 'I would like to compare the warranty on these two items.', '我想比较这两件商品的保修。'],
['Could you check whether the tax is included in this price?', '您能确认这个价格是否含税吗？', 'request', 'Could you check whether the tax is included in this price?', '您能确认这个价格是否含税吗？'],
['Can I return this item if the size is wrong?', '如果尺码不对，我可以退这个商品吗？', 'question', 'Can I return this item if the size is wrong?', '如果尺码不对，我可以退这个商品吗？'],
['Could you put the fragile items in a separate bag?', '您能把易碎物品放在单独的袋子里吗？', 'request', 'Could you put the fragile items in a separate bag?', '您能把易碎物品放在单独的袋子里吗？'],
['I need to pay with two different cards.', '我需要用两张不同的卡付款。', 'statement', 'I need to pay with two different cards.', '我需要用两张不同的卡付款。'],
['Could you tell me what exchange rate you are using?', '您能告诉我您使用的汇率吗？', 'request', 'Could you tell me what exchange rate you are using?', '您能告诉我您使用的汇率吗？'],
['I need a receipt in case my company reimburses me.', '我需要收据，以备公司报销。', 'statement', 'I need a receipt in case my company reimburses me.', '我需要收据，以备公司报销。'],
['Could you tell me whether the pharmacy is open on Sundays?', '您能告诉我药店周日是否营业吗？', 'request', 'Could you tell me whether the pharmacy is open on Sundays?', '您能告诉我药店周日是否营业吗？'],
['I need to know if this medicine can be taken with coffee.', '我需要知道这个药是否可以和咖啡一起服用。', 'statement', 'I need to know if this medicine can be taken with coffee.', '我需要知道这个药是否可以和咖啡一起服用。'],
['Could you explain the warning label on this package?', '您能解释这个包装上的警告标签吗？', 'request', 'Could you explain the warning label on this package?', '您能解释这个包装上的警告标签吗？'],
['Can you recommend a clinic that is open at night?', '您能推荐一家夜间营业的诊所吗？', 'request', 'Can you recommend a clinic that is open at night?', '您能推荐一家夜间营业的诊所吗？'],
['I need to speak to someone about a billing problem.', '我需要和人谈一下账单问题。', 'statement', 'I need to speak to someone about a billing problem.', '我需要和人谈一下账单问题。'],
['Could you help me report that my phone was stolen?', '您能帮我报告手机被盗吗？', 'request', 'Could you help me report that my phone was stolen?', '您能帮我报告手机被盗吗？'],
['I need to cancel the phone service if I leave early.', '如果提前离开，我需要取消电话服务。', 'statement', 'I need to cancel the phone service if I leave early.', '如果提前离开，我需要取消电话服务。'],
['Could you tell me if I can use this SIM card in another phone?', '您能告诉我这张电话卡能否用在另一部手机上吗？', 'request', 'Could you tell me if I can use this SIM card in another phone?', '您能告诉我这张电话卡能否用在另一部手机上吗？'],
['Could you send me a map link instead of written directions?', '您能给我发地图链接而不是书面路线吗？', 'request', 'Could you send me a map link instead of written directions?', '您能给我发地图链接而不是书面路线吗？'],
['I need to verify the address before I order a ride.', '叫车前我需要确认地址。', 'statement', 'I need to verify the address before I order a ride.', '叫车前我需要确认地址。'],
['Could you notify me if the tour meeting time changes?', '如果旅行团集合时间改变，您能通知我吗？', 'request', 'Could you notify me if the tour meeting time changes?', '如果旅行团集合时间改变，您能通知我吗？'],
['I would prefer to join a smaller tour group.', '我更想参加较小的旅行团。', 'preference', 'I would prefer to join a smaller tour group.', '我更想参加较小的旅行团。'],
['Could you check whether photography is allowed inside?', '您能确认里面是否允许拍照吗？', 'request', 'Could you check whether photography is allowed inside?', '您能确认里面是否允许拍照吗？'],
['I need to leave before the last shuttle stops running.', '末班接驳车停运前我需要离开。', 'statement', 'I need to leave before the last shuttle stops running.', '末班接驳车停运前我需要离开。'],
['Could you suggest a place to wait out the rain?', '您能推荐一个躲雨的地方吗？', 'request', 'Could you suggest a place to wait out the rain?', '您能推荐一个躲雨的地方吗？'],
['I need to find a restroom that is accessible.', '我需要找一个无障碍洗手间。', 'statement', 'I need to find a restroom that is accessible.', '我需要找一个无障碍洗手间。'],
['Could you describe the building entrance for my driver?', '您能向我的司机描述大楼入口吗？', 'request', 'Could you describe the building entrance for my driver?', '您能向我的司机描述大楼入口吗？'],
['Could you check whether there is a fee for using the luggage cart?', '您能确认使用行李车是否收费吗？', 'request', 'Could you check whether there is a fee for using the luggage cart?', '您能确认使用行李车是否收费吗？'],
['Could you tell me which exit is closest to the taxi stand?', '您能告诉我哪个出口离出租车站最近吗？', 'request', 'Could you tell me which exit is closest to the taxi stand?', '您能告诉我哪个出口离出租车站最近吗？'],
]
if (rows.length !== 55) throw new Error(`Expected 55 reviewed rows, got ${rows.length}.`)
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-p4c-'))
const existing = new Set(unit.activity.items.map((item) => normalize(item.term)))
for (const [term] of rows) { if (existing.has(normalize(term))) throw new Error(`Duplicate daily term: ${term}`); existing.add(normalize(term)) }
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({ id: `r17-daily-p4c-${String(index + 1).padStart(3, '0')}`, term, meaningZh, partOfSpeech, exampleEn, exampleZh, growthDifficultyLevel: 2, dailyKnowledgeId: `daily-knowledge-v1:p4c:${String(index + 1).padStart(3, '0')}` })))
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 55 reviewed primary-4 5C daily vocabulary items.')
