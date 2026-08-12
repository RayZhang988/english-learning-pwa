import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons[0].learningUnits.find((candidate) => candidate.learningUnitId === 'st4w-w1d1-vocabulary')
if (!unit) throw new Error('The daily vocabulary host unit is missing.')

// Primary-2 3B: short complete travel utterances, deliberately distinct from
// labels and fixed phrases in primary-1 and without scene identity reuse.
const rows = [
  ['my flight was changed', '我的航班改了', 'airport statement', 'My flight was changed this morning.', '我的航班今天早上改了。'],
  ['what is my new gate', '我的新登机口是哪个', 'airport question', 'What is my new gate now?', '我现在的新登机口是哪个？'],
  ['can I rebook my flight', '我能改签航班吗', 'airport request', 'Can I rebook my flight for tomorrow?', '我能把航班改签到明天吗？'],
  ['my bag did not arrive', '我的行李没到', 'airport problem', 'My bag did not arrive with my flight.', '我的行李没有和航班一起到。'],
  ['where can I report lost luggage', '我在哪里申报丢失行李', 'airport question', 'Where can I report lost luggage?', '我在哪里申报丢失行李？'],
  ['I need a baggage receipt', '我需要行李收据', 'airport request', 'I need a baggage receipt, please.', '请给我一张行李收据。'],
  ['my suitcase is damaged', '我的行李箱坏了', 'airport problem', 'My suitcase is damaged after the flight.', '我的行李箱在飞行后坏了。'],
  ['can I bring this on the plane', '我能带这个上飞机吗', 'airport question', 'Can I bring this on the plane?', '我能带这个上飞机吗？'],
  ['where is the security screening', '安检在哪里', 'airport question', 'Where is the security screening area?', '安检区域在哪里？'],
  ['I need help with my boarding pass', '我需要登机牌帮助', 'airport request', 'I need help with my boarding pass.', '我需要登机牌方面的帮助。'],
  ['the room key does not work', '房卡打不开门', 'hotel problem', 'The room key does not work on my door.', '房卡打不开我的房门。'],
  ['could you fix the shower', '你能修一下淋浴吗', 'hotel request', 'Could you fix the shower in my room?', '你能修一下我房间的淋浴吗？'],
  ['the bathroom needs cleaning', '浴室需要清洁', 'hotel problem', 'The bathroom needs cleaning, please.', '请清洁一下浴室。'],
  ['could I get more towels', '我能多要几条毛巾吗', 'hotel request', 'Could I get more towels for the room?', '我能给房间多要几条毛巾吗？'],
  ['the television has no sound', '电视没有声音', 'hotel problem', 'The television has no sound.', '电视没有声音。'],
  ['can you move me to another room', '你能给我换个房间吗', 'hotel request', 'Can you move me to another room?', '你能给我换个房间吗？'],
  ['where is the breakfast room', '早餐厅在哪里', 'hotel question', 'Where is the breakfast room?', '早餐厅在哪里？'],
  ['could I borrow an umbrella', '我能借一把伞吗', 'hotel request', 'Could I borrow an umbrella today?', '我今天能借一把伞吗？'],
  ['the hotel elevator is slow', '酒店电梯很慢', 'hotel problem', 'The hotel elevator is slow today.', '酒店电梯今天很慢。'],
  ['can you book a tour for me', '你能帮我订旅行团吗', 'hotel request', 'Can you book a tour for me?', '你能帮我订旅行团吗？'],
  ['which line do I need', '我需要坐哪条线', 'transport question', 'Which line do I need for downtown?', '去市中心我需要坐哪条线？'],
  ['does this bus accept cards', '这辆公交车能刷卡吗', 'transport question', 'Does this bus accept cards?', '这辆公交车能刷卡吗？'],
  ['where is the subway platform', '地铁站台在哪里', 'transport question', 'Where is the subway platform for this line?', '这条线的地铁站台在哪里？'],
  ['I got on the wrong train', '我上错火车了', 'transport problem', 'I got on the wrong train.', '我上错火车了。'],
  ['should I change trains here', '我应该在这里换火车吗', 'transport question', 'Should I change trains here?', '我应该在这里换火车吗？'],
  ['does this route go to the airport', '这条线路去机场吗', 'transport question', 'Does this route go to the airport?', '这条线路去机场吗？'],
  ['where can I buy a day pass', '我在哪里可以买日票', 'transport question', 'Where can I buy a day pass?', '我在哪里可以买日票？'],
  ['the bus is very crowded', '公交车非常拥挤', 'transport statement', 'The bus is very crowded this morning.', '今天早上公交车非常拥挤。'],
  ['please tell me when to get off', '请告诉我何时下车', 'transport request', 'Please tell me when to get off.', '请告诉我何时下车。'],
  ['is there a direct train', '有直达火车吗', 'transport question', 'Is there a direct train to the city?', '有去市区的直达火车吗？'],
  ['what ingredients are in this', '这道菜有什么配料', 'restaurant question', 'What ingredients are in this dish?', '这道菜有什么配料？'],
  ['is this dish vegetarian', '这道菜是素食吗', 'restaurant question', 'Is this dish vegetarian?', '这道菜是素食吗？'],
  ['could you make it less spicy', '你能少放点辣吗', 'restaurant request', 'Could you make it less spicy?', '你能少放点辣吗？'],
  ['I cannot eat shellfish', '我不能吃贝类', 'restaurant statement', 'I cannot eat shellfish.', '我不能吃贝类。'],
  ['could I have a glass of water', '我能要一杯水吗', 'restaurant request', 'Could I have a glass of water?', '我能要一杯水吗？'],
  ['we are ready to order', '我们准备好点餐了', 'restaurant statement', 'We are ready to order now.', '我们现在准备好点餐了。'],
  ['could you bring the check', '你能拿账单来吗', 'restaurant request', 'Could you bring the check, please?', '请你能拿账单来吗？'],
  ['I think I was charged twice', '我觉得被重复收费了', 'restaurant problem', 'I think I was charged twice.', '我觉得我被重复收费了。'],
  ['can I take the rest with me', '我能把剩下的带走吗', 'restaurant question', 'Can I take the rest with me?', '我能把剩下的带走吗？'],
  ['is the tip already included', '小费已经包含了吗', 'restaurant question', 'Is the tip already included?', '小费已经包含了吗？'],
  ['I would like to exchange this', '我想换这个', 'shopping request', 'I would like to exchange this shirt.', '我想换这件衬衫。'],
  ['this does not fit me', '这个不适合我', 'shopping problem', 'This does not fit me well.', '这个不太适合我。'],
  ['can you check the price', '你能查一下价格吗', 'shopping request', 'Can you check the price for me?', '你能帮我查一下价格吗？'],
  ['I need the original receipt', '我需要原始收据', 'shopping statement', 'I need the original receipt for a return.', '退货我需要原始收据。'],
  ['can I return this tomorrow', '我明天能退这个吗', 'shopping question', 'Can I return this tomorrow?', '我明天能退这个吗？'],
  ['I bought this yesterday', '我昨天买的这个', 'shopping statement', 'I bought this yesterday.', '我昨天买的这个。'],
  ['the color looks different', '颜色看起来不一样', 'shopping problem', 'The color looks different in daylight.', '这个颜色在日光下看起来不一样。'],
  ['where is the customer service desk', '客服台在哪里', 'shopping question', 'Where is the customer service desk?', '客服台在哪里？'],
  ['can you wrap this as a gift', '你能把这个包装成礼物吗', 'shopping request', 'Can you wrap this as a gift?', '你能把这个包装成礼物吗？'],
  ['I have a bad cough', '我咳嗽得厉害', 'medical statement', 'I have a bad cough today.', '我今天咳嗽得厉害。'],
  ['my stomach feels upset', '我胃不舒服', 'medical statement', 'My stomach feels upset after lunch.', '午饭后我胃不舒服。'],
  ['I need allergy medicine', '我需要过敏药', 'medical request', 'I need allergy medicine, please.', '请给我过敏药。'],
  ['how often should I take this', '我应该多久吃一次', 'medical question', 'How often should I take this medicine?', '我应该多久吃一次这个药？'],
  ['do you have a thermometer', '你们有体温计吗', 'medical question', 'Do you have a thermometer?', '你们有体温计吗？'],
  ['I need a bandage', '我需要创可贴', 'medical request', 'I need a bandage for my hand.', '我的手需要创可贴。'],
  ['can I speak to a pharmacist', '我能和药剂师说话吗', 'medical request', 'Can I speak to a pharmacist?', '我能和药剂师说话吗？'],
  ['I feel better now', '我现在感觉好些了', 'medical statement', 'I feel better now, thank you.', '我现在感觉好些了，谢谢。'],
  ['where can I buy a SIM card', '我在哪里可以买电话卡', 'connection question', 'Where can I buy a SIM card?', '我在哪里可以买电话卡？'],
  ['I need help setting up my phone', '我需要设置手机的帮助', 'connection request', 'I need help setting up my phone.', '我需要设置手机的帮助。'],
  ['the internet is not working', '网络不能用', 'connection problem', 'The internet is not working in my room.', '我房间的网络不能用。'],
  ['can I use mobile data here', '我能在这里用手机流量吗', 'connection question', 'Can I use mobile data here?', '我能在这里用手机流量吗？'],
  ['my charger is not working', '我的充电器坏了', 'connection problem', 'My charger is not working.', '我的充电器坏了。'],
]

if (rows.length !== 62) throw new Error(`Expected 62 reviewed rows, got ${rows.length}.`)
const normalized = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-p2b-'))
const existing = new Set(unit.activity.items.map((item) => normalized(item.term)))
for (const [term] of rows) { if (existing.has(normalized(term))) throw new Error(`Duplicate daily term after normalization: ${term}`); existing.add(normalized(term)) }
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({ id: `r17-daily-p2b-${String(index + 1).padStart(3, '0')}`, term, meaningZh, partOfSpeech, exampleEn, exampleZh, growthDifficultyLevel: 1, dailyKnowledgeId: `daily-knowledge-v1:p2b:${String(index + 1).padStart(3, '0')}` })))
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 62 reviewed primary-2 3B daily vocabulary items.')
