import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons[0].learningUnits.find((candidate) => candidate.learningUnitId === 'st4w-w1d1-vocabulary')
if (!unit) throw new Error('The daily vocabulary host unit is missing.')

// Primary-1 2B: compact, high-frequency travel phrases. The six groups close
// concrete gaps left by 2A without borrowing identity or progress from scenes.
const rows = [
  ['what time is it', '几点了', 'question phrase', 'Excuse me, what time is it?', '劳驾，现在几点了？'],
  ['what time does it open', '几点开门', 'question phrase', 'What time does it open tomorrow?', '它明天几点开门？'],
  ['what time does it close', '几点关门', 'question phrase', 'What time does it close tonight?', '它今晚几点关门？'],
  ['change the time', '改时间', 'request phrase', 'Can I change the time?', '我能改一下时间吗？'],
  ['a later time', '晚一点的时间', 'time phrase', 'Do you have a later time?', '你们有晚一点的时间吗？'],
  ['an earlier time', '早一点的时间', 'time phrase', 'Is there an earlier time?', '有早一点的时间吗？'],
  ['next available time', '下一个可用时间', 'noun phrase', 'What is the next available time?', '下一个可用时间是什么时候？'],
  ['running late', '要迟到了', 'status phrase', 'I am running late for my tour.', '我的旅行团要迟到了。'],
  ['be there soon', '很快到', 'status phrase', 'I will be there soon.', '我很快就到。'],
  ['same day', '当天', 'time phrase', 'Can I get a same day ticket?', '我能买当天的票吗？'],
  ['hotel entrance', '酒店入口', 'noun phrase', 'Meet me at the hotel entrance.', '在酒店入口见我。'],
  ['room number', '房间号', 'noun phrase', 'Please tell me your room number.', '请告诉我你的房间号。'],
  ['bathroom light', '浴室灯', 'noun phrase', 'The bathroom light is off.', '浴室灯没亮。'],
  ['hot water', '热水', 'noun phrase', 'Is there hot water in the room?', '房间里有热水吗？'],
  ['no hot water', '没有热水', 'hotel problem', 'There is no hot water in my room.', '我的房间没有热水。'],
  ['broken shower', '坏掉的淋浴', 'noun phrase', 'The broken shower needs help.', '坏掉的淋浴需要处理。'],
  ['hotel map', '酒店地图', 'noun phrase', 'May I have a hotel map?', '我可以要一张酒店地图吗？'],
  ['laundry room', '洗衣房', 'noun phrase', 'Where is the laundry room?', '洗衣房在哪里？'],
  ['ice machine', '制冰机', 'noun phrase', 'The ice machine is near the lobby.', '制冰机在大堂附近。'],
  ['swimming pool', '游泳池', 'noun phrase', 'Is the swimming pool open now?', '游泳池现在开放吗？'],
  ['hotel gym', '酒店健身房', 'noun phrase', 'The hotel gym is on this floor.', '酒店健身房在这一层。'],
  ['quiet room', '安静的房间', 'noun phrase', 'Could I have a quiet room?', '我能要一间安静的房间吗？'],
  ['train station', '火车站', 'noun phrase', 'The train station is straight ahead.', '火车站就在前面。'],
  ['bus stop', '公交车站', 'noun phrase', 'Is this the bus stop?', '这是公交车站吗？'],
  ['platform number', '站台号', 'noun phrase', 'Check the platform number first.', '先看一下站台号。'],
  ['ticket machine', '售票机', 'noun phrase', 'The ticket machine takes cards.', '售票机可以刷卡。'],
  ['ticket office', '售票处', 'noun phrase', 'The ticket office is closed now.', '售票处现在关门了。'],
  ['transfer ticket', '换乘票', 'noun phrase', 'Do I need a transfer ticket?', '我需要换乘票吗？'],
  ['next stop', '下一站', 'noun phrase', 'What is the next stop?', '下一站是哪里？'],
  ['last stop', '终点站', 'noun phrase', 'This is the last stop.', '这里是终点站。'],
  ['train schedule', '火车时刻表', 'noun phrase', 'The train schedule is on the wall.', '火车时刻表在墙上。'],
  ['missed bus', '错过的公交车', 'noun phrase', 'I missed the bus this morning.', '我今天早上错过公交车了。'],
  ['bus pass', '公交卡', 'noun phrase', 'Where can I buy a bus pass?', '我在哪里可以买公交卡？'],
  ['boarding time', '登机时间', 'noun phrase', 'What is the boarding time?', '登机时间是什么时候？'],
  ['food allergy', '食物过敏', 'noun phrase', 'I have a food allergy.', '我有食物过敏。'],
  ['I am allergic to', '我对……过敏', 'statement phrase', 'I am allergic to nuts.', '我对坚果过敏。'],
  ['no dairy', '不要乳制品', 'food request', 'No dairy, please.', '请不要乳制品。'],
  ['no nuts', '不要坚果', 'food request', 'No nuts in my meal, please.', '我的餐里请不要坚果。'],
  ['not spicy', '不辣', 'food request', 'Not spicy, please.', '请不要辣。'],
  ['mild flavor', '清淡口味', 'noun phrase', 'I would like a mild flavor.', '我想要清淡口味。'],
  ['extra sauce', '额外酱汁', 'noun phrase', 'Can I have extra sauce?', '我能要额外酱汁吗？'],
  ['less salt', '少盐', 'food request', 'Less salt, please.', '请少放盐。'],
  ['still water', '不含气泡的水', 'noun phrase', 'Still water, please.', '请给我不含气泡的水。'],
  ['sparkling water', '气泡水', 'noun phrase', 'Do you have sparkling water?', '你们有气泡水吗？'],
  ['kids menu', '儿童菜单', 'noun phrase', 'May I see the kids menu?', '我可以看儿童菜单吗？'],
  ['my size', '我的尺码', 'noun phrase', 'Do you have my size?', '你们有我的尺码吗？'],
  ['larger size', '大一点的尺码', 'noun phrase', 'I need a larger size.', '我需要大一点的尺码。'],
  ['smaller size', '小一点的尺码', 'noun phrase', 'Do you have a smaller size?', '你们有小一点的尺码吗？'],
  ['different size', '不同的尺码', 'noun phrase', 'Can I try a different size?', '我能试一下不同的尺码吗？'],
  ['wrong size', '不合适的尺码', 'noun phrase', 'This is the wrong size for me.', '这个尺码不适合我。'],
  ['exchange this', '换这个', 'request phrase', 'Can I exchange this?', '我能换这个吗？'],
  ['store credit', '店内额度', 'noun phrase', 'Can I get store credit?', '我能换成店内额度吗？'],
  ['gift receipt', '礼品收据', 'noun phrase', 'Do you need the gift receipt?', '你需要礼品收据吗？'],
  ['open box', '已开封的盒子', 'noun phrase', 'This is an open box item.', '这是已开封的商品。'],
  ['damaged item', '损坏的商品', 'noun phrase', 'I received a damaged item.', '我收到了一件损坏的商品。'],
  ['free Wi-Fi', '免费无线网络', 'noun phrase', 'Is the free Wi-Fi working?', '免费无线网络能用吗？'],
  ['Wi-Fi signal', '无线网络信号', 'noun phrase', 'The Wi-Fi signal is weak here.', '这里的无线网络信号很弱。'],
  ['mobile data', '手机流量', 'noun phrase', 'I need more mobile data.', '我需要更多手机流量。'],
  ['data plan', '流量套餐', 'noun phrase', 'Which data plan is best?', '哪个流量套餐最好？'],
  ['phone signal', '手机信号', 'noun phrase', 'I have no phone signal here.', '我在这里没有手机信号。'],
  ['local SIM card', '本地电话卡', 'noun phrase', 'I need a local SIM card.', '我需要一张本地电话卡。'],
  ['charging cable', '充电线', 'noun phrase', 'Do you sell a charging cable?', '你们卖充电线吗？'],
  ['power outlet', '电源插座', 'noun phrase', 'Is there a power outlet nearby?', '附近有电源插座吗？'],
  ['call home', '给家里打电话', 'verb phrase', 'I want to call home tonight.', '我今晚想给家里打电话。'],
  ['send a message', '发消息', 'verb phrase', 'Can I send a message here?', '我能在这里发消息吗？'],
]

if (rows.length !== 65) throw new Error(`Expected 65 reviewed rows, got ${rows.length}.`)
const normalized = (value) => value.toLocaleLowerCase('en-US')
  .replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-p1b-'))
const existing = new Set(unit.activity.items.map((item) => normalized(item.term)))
for (const [term] of rows) {
  if (existing.has(normalized(term))) throw new Error(`Duplicate daily term after normalization: ${term}`)
  existing.add(normalized(term))
}
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({
  id: `r17-daily-p1b-${String(index + 1).padStart(3, '0')}`,
  term,
  meaningZh,
  partOfSpeech,
  exampleEn,
  exampleZh,
  growthDifficultyLevel: 0.5,
  dailyKnowledgeId: `daily-knowledge-v1:p1b:${String(index + 1).padStart(3, '0')}`,
})))
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 65 reviewed primary-1 2B daily vocabulary items.')
