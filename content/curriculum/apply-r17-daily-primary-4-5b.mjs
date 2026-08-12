import fs from 'node:fs'
const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons.flatMap((lesson) => lesson.learningUnits).find((candidate) => candidate.learningUnitId === 'st4w-w1d4-vocabulary')
if (!unit) throw new Error('The daily vocabulary host unit is missing.')
const rows = [
['Could you check if the fare includes checked baggage?', '您能确认票价是否包含托运行李吗？', 'request', 'Could you check if the fare includes checked baggage?', '您能确认票价是否包含托运行李吗？'],
['I need to cancel the second part of my trip.', '我需要取消行程的第二部分。', 'statement', 'I need to cancel the second part of my trip.', '我需要取消行程的第二部分。'],
['Could you issue a new itinerary after the change?', '变更后您能签发新行程单吗？', 'request', 'Could you issue a new itinerary after the change?', '变更后您能签发新行程单吗？'],
['Is there a charge if I change airports?', '如果更换机场会收费吗？', 'question', 'Is there a charge if I change airports?', '如果更换机场会收费吗？'],
['Could you check whether my passport is still valid for entry?', '您能确认我的护照是否仍可用于入境吗？', 'request', 'Could you check whether my passport is still valid for entry?', '您能确认我的护照是否仍可用于入境吗？'],
['I need extra time because I use a wheelchair.', '因为我使用轮椅，我需要额外时间。', 'statement', 'I need extra time because I use a wheelchair.', '因为我使用轮椅，我需要额外时间。'],
['Could you arrange assistance at the arrival gate?', '您能在到达登机口安排协助吗？', 'request', 'Could you arrange assistance at the arrival gate?', '您能在到达登机口安排协助吗？'],
['Will the hotel accept a late arrival?', '酒店会接受晚到吗？', 'question', 'Will the hotel accept a late arrival?', '酒店会接受晚到吗？'],
['Could you note that I need a non-smoking room?', '您能注明我需要无烟房吗？', 'request', 'Could you note that I need a non-smoking room?', '您能注明我需要无烟房吗？'],
['The water pressure is too low to take a shower.', '水压太低，无法洗澡。', 'complaint', 'The water pressure is too low to take a shower.', '水压太低，无法洗澡。'],
['Could you send maintenance before I leave?', '我离开前您能派维修人员来吗？', 'request', 'Could you send maintenance before I leave?', '我离开前您能派维修人员来吗？'],
['Is there a quiet area where I can work?', '有我可以安静工作的区域吗？', 'question', 'Is there a quiet area where I can work?', '有我可以安静工作的区域吗？'],
['Could you extend my parking reservation by one day?', '您能把我的停车预订延长一天吗？', 'request', 'Could you extend my parking reservation by one day?', '您能把我的停车预订延长一天吗？'],
['I need to check out early because of an emergency.', '因为紧急情况，我需要提前退房。', 'statement', 'I need to check out early because of an emergency.', '因为紧急情况，我需要提前退房。'],
['Could you waive the late checkout fee this time?', '这次您能免除延迟退房费吗？', 'request', 'Could you waive the late checkout fee this time?', '这次您能免除延迟退房费吗？'],
['Does the breakfast area open before six?', '早餐区六点前开放吗？', 'question', 'Does the breakfast area open before six?', '早餐区六点前开放吗？'],
['Could you tell me which ingredients are raw?', '您能告诉我哪些食材是生的吗？', 'request', 'Could you tell me which ingredients are raw?', '您能告诉我哪些食材是生的吗？'],
['I need a table that is easier to reach with a stroller.', '我需要一张更方便推婴儿车到达的桌子。', 'statement', 'I need a table that is easier to reach with a stroller.', '我需要一张更方便推婴儿车到达的桌子。'],
['Could you replace the order if it was prepared incorrectly?', '如果订单做错了，您能更换吗？', 'request', 'Could you replace the order if it was prepared incorrectly?', '如果订单做错了，您能更换吗？'],
['The menu price is different from the bill.', '菜单价格和账单不同。', 'complaint', 'The menu price is different from the bill.', '菜单价格和账单不同。'],
['Could you remove the item I did not order?', '您能移除我没有点的项目吗？', 'request', 'Could you remove the item I did not order?', '您能移除我没有点的项目吗？'],
['Can I pay separately if we share the meal?', '如果我们分享餐点，可以分开付款吗？', 'question', 'Can I pay separately if we share the meal?', '如果我们分享餐点，可以分开付款吗？'],
['Could you recommend a restaurant with outdoor seating?', '您能推荐有户外座位的餐厅吗？', 'request', 'Could you recommend a restaurant with outdoor seating?', '您能推荐有户外座位的餐厅吗？'],
['Which train is more reliable during rush hour?', '高峰时段哪趟火车更可靠？', 'question', 'Which train is more reliable during rush hour?', '高峰时段哪趟火车更可靠？'],
['Could you tell me where the elevator connects to the platform?', '您能告诉我电梯通往哪个站台吗？', 'request', 'Could you tell me where the elevator connects to the platform?', '您能告诉我电梯通往哪个站台吗？'],
['I need to leave earlier if the weather gets worse.', '如果天气变差，我需要更早离开。', 'statement', 'I need to leave earlier if the weather gets worse.', '如果天气变差，我需要更早离开。'],
['Could you estimate how long the walk will take?', '您能估计步行需要多久吗？', 'request', 'Could you estimate how long the walk will take?', '您能估计步行需要多久吗？'],
['Does this bus stop near the public library?', '这辆公交在公共图书馆附近停吗？', 'question', 'Does this bus stop near the public library?', '这辆公交在公共图书馆附近停吗？'],
['Could you wait at the entrance while I get my bags?', '我拿行李时您能在入口等吗？', 'request', 'Could you wait at the entrance while I get my bags?', '我拿行李时您能在入口等吗？'],
['I need a ride that can fit two large suitcases.', '我需要能放下两个大行李箱的车。', 'statement', 'I need a ride that can fit two large suitcases.', '我需要能放下两个大行李箱的车。'],
['Could you explain the difference between these passes?', '您能解释这两种通票的区别吗？', 'request', 'Could you explain the difference between these passes?', '您能解释这两种通票的区别吗？'],
['Is there a refund if the attraction closes early?', '如果景点提前关闭，可以退款吗？', 'question', 'Is there a refund if the attraction closes early?', '如果景点提前关闭，可以退款吗？'],
['Could you hold my place while I use the restroom?', '我去洗手间时您能帮我保留位置吗？', 'request', 'Could you hold my place while I use the restroom?', '我去洗手间时您能帮我保留位置吗？'],
['I need to buy a ticket for the child traveling with me.', '我需要为与我同行的儿童买票。', 'statement', 'I need to buy a ticket for the child traveling with me.', '我需要为与我同行的儿童买票。'],
['Could you tell me whether children enter free?', '您能告诉我儿童是否免费入场吗？', 'request', 'Could you tell me whether children enter free?', '您能告诉我儿童是否免费入场吗？'],
['Can I return this gift without a receipt?', '没有收据我可以退这份礼物吗？', 'question', 'Can I return this gift without a receipt?', '没有收据我可以退这份礼物吗？'],
['Could you wrap this so it is easier to carry?', '您能包装一下让它更容易携带吗？', 'request', 'Could you wrap this so it is easier to carry?', '您能包装一下让它更容易携带吗？'],
['I need an adapter because my plug does not fit.', '因为插头不合适，我需要转换插头。', 'statement', 'I need an adapter because my plug does not fit.', '因为插头不合适，我需要转换插头。'],
['Could you check whether this store accepts contactless payment?', '您能确认这家店是否接受非接触付款吗？', 'request', 'Could you check whether this store accepts contactless payment?', '您能确认这家店是否接受非接触付款吗？'],
['Can I use this card if I enter my PIN?', '如果输入密码，我可以使用这张卡吗？', 'question', 'Can I use this card if I enter my PIN?', '如果输入密码，我可以使用这张卡吗？'],
['Could you direct me to an ATM that is open now?', '您能告诉我现在营业的自动取款机在哪里吗？', 'request', 'Could you direct me to an ATM that is open now?', '您能告诉我现在营业的自动取款机在哪里吗？'],
['I need to exchange money before the bank closes.', '银行关闭前我需要换钱。', 'statement', 'I need to exchange money before the bank closes.', '银行关闭前我需要换钱。'],
['Could you tell me whether this medicine needs a prescription?', '您能告诉我这个药是否需要处方吗？', 'request', 'Could you tell me whether this medicine needs a prescription?', '您能告诉我这个药是否需要处方吗？'],
['I need to see a doctor if the pain gets worse.', '如果疼痛加剧，我需要看医生。', 'statement', 'I need to see a doctor if the pain gets worse.', '如果疼痛加剧，我需要看医生。'],
['Could you write the dosage in simple English?', '您能用简单英语写下剂量吗？', 'request', 'Could you write the dosage in simple English?', '您能用简单英语写下剂量吗？'],
['Is there a clinic that accepts walk-in patients?', '有接受直接就诊患者的诊所吗？', 'question', 'Is there a clinic that accepts walk-in patients?', '有接受直接就诊患者的诊所吗？'],
['Could you help me call my travel insurance company?', '您能帮我联系旅行保险公司吗？', 'request', 'Could you help me call my travel insurance company?', '您能帮我联系旅行保险公司吗？'],
['I need a place to sit while I wait for help.', '我等待帮助时需要一个坐的地方。', 'statement', 'I need a place to sit while I wait for help.', '我等待帮助时需要一个坐的地方。'],
['Could you give me a landmark near the meeting point?', '您能告诉我集合地点附近的地标吗？', 'request', 'Could you give me a landmark near the meeting point?', '您能告诉我集合地点附近的地标吗？'],
['I need to update my family about the delay.', '我需要告诉家人延误的情况。', 'statement', 'I need to update my family about the delay.', '我需要告诉家人延误的情况。'],
['Could you help me find a place with free Wi-Fi?', '您能帮我找有免费无线网络的地方吗？', 'request', 'Could you help me find a place with free Wi-Fi?', '您能帮我找有免费无线网络的地方吗？'],
['Will this data plan work in another state?', '这个流量套餐在另一个州能用吗？', 'question', 'Will this data plan work in another state?', '这个流量套餐在另一个州能用吗？'],
['Could you send the instructions to my email address?', '您能把说明发送到我的邮箱吗？', 'request', 'Could you send the instructions to my email address?', '您能把说明发送到我的邮箱吗？'],
['I need to reset my password before I can connect.', '我需要重设密码才能连接。', 'statement', 'I need to reset my password before I can connect.', '我需要重设密码才能连接。'],
['Could you verify the time zone for my flight?', '您能确认我航班所在的时区吗？', 'request', 'Could you verify the time zone for my flight?', '您能确认我航班所在的时区吗？'],
]
if (rows.length !== 55) throw new Error(`Expected 55 reviewed rows, got ${rows.length}.`)
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-p4b-'))
const existing = new Set(unit.activity.items.map((item) => normalize(item.term)))
for (const [term] of rows) { if (existing.has(normalize(term))) throw new Error(`Duplicate daily term: ${term}`); existing.add(normalize(term)) }
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({ id: `r17-daily-p4b-${String(index + 1).padStart(3, '0')}`, term, meaningZh, partOfSpeech, exampleEn, exampleZh, growthDifficultyLevel: 2, dailyKnowledgeId: `daily-knowledge-v1:p4b:${String(index + 1).padStart(3, '0')}` })))
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 55 reviewed primary-4 5B daily vocabulary items.')
