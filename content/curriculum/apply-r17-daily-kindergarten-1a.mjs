import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons[0].learningUnits.find((candidate) => candidate.learningUnitId === 'st4w-w1d1-vocabulary')
if (!unit) throw new Error('The daily vocabulary host unit is missing.')

// Explicitly curated 1A content: each row was reviewed as a distinct,
// kindergarten-level travel word or practical phrase, not a surface variant.
const rows = [
  ['hello', '你好', 'interjection', 'Hello, can you help me?', '你好，你能帮我吗？'],
  ['goodbye', '再见', 'interjection', 'Goodbye, thank you.', '再见，谢谢你。'],
  ['welcome', '欢迎', 'interjection', 'Welcome to our hotel.', '欢迎来到我们的酒店。'],
  ['thank you', '谢谢', 'politeness phrase', 'Thank you for your help.', '谢谢你的帮助。'],
  ['sorry', '对不起', 'interjection', 'Sorry, I am late.', '对不起，我迟到了。'],
  ['excuse me', '劳驾；打扰一下', 'politeness phrase', 'Excuse me, where is the hotel?', '打扰一下，酒店在哪里？'],
  ['yes', '是；好的', 'response word', 'Yes, this is my bag.', '是的，这是我的包。'],
  ['no', '不；没有', 'response word', 'No, I do not understand.', '不，我不明白。'],
  ['help', '帮助', 'noun', 'I need help, please.', '请帮帮我。'],
  ['my name is', '我的名字是', 'practical phrase', 'My name is Lin.', '我的名字是林。'],
  ['friend', '朋友', 'noun', 'My friend is here.', '我的朋友在这里。'],
  ['family', '家人', 'noun', 'My family is waiting.', '我的家人在等候。'],
  ['child', '孩子', 'noun', 'The child is with me.', '孩子和我在一起。'],
  ['man', '男人', 'noun', 'The man works here.', '那位男士在这里工作。'],
  ['woman', '女人', 'noun', 'The woman can help us.', '那位女士能帮助我们。'],
  ['one', '一', 'number', 'I need one ticket.', '我需要一张票。'],
  ['two', '二', 'number', 'We need two rooms.', '我们需要两间房。'],
  ['three', '三', 'number', 'Table three is ready.', '三号桌准备好了。'],
  ['four', '四', 'number', 'Gate four is open.', '四号登机口开放了。'],
  ['five', '五', 'number', 'It is five dollars.', '这是五美元。'],
  ['noon', '中午', 'time word', 'We eat at noon.', '我们中午吃饭。'],
  ['evening', '傍晚', 'time word', 'Good evening.', '晚上好。'],
  ['now', '现在', 'time word', 'I need a taxi now.', '我现在需要出租车。'],
  ['morning', '早上', 'time word', 'Good morning.', '早上好。'],
  ['night', '夜晚', 'time word', 'The hotel is open at night.', '酒店夜晚营业。'],
  ['here', '这里', 'place word', 'Wait here, please.', '请在这里等。'],
  ['there', '那里', 'place word', 'The bus stop is there.', '公交车站在那里。'],
  ['map', '地图', 'noun', 'Can I see a map?', '我可以看地图吗？'],
  ['corner', '街角', 'noun', 'The shop is on the corner.', '商店在街角。'],
  ['crosswalk', '人行横道', 'noun', 'Use the crosswalk here.', '在这里走人行横道。'],
  ['near', '近的', 'adjective', 'Is the station near?', '车站近吗？'],
  ['far', '远的', 'adjective', 'Is the airport far?', '机场远吗？'],
  ['up', '向上', 'direction word', 'Go up the stairs.', '上楼梯。'],
  ['down', '向下', 'direction word', 'Go down one floor.', '下一层楼。'],
  ['stop', '停；车站', 'verb', 'Please stop here.', '请在这里停。'],
  ['go', '去；走', 'verb', 'Go to the hotel.', '去酒店。'],
  ['walk', '走路', 'verb', 'Can we walk there?', '我们可以走过去吗？'],
  ['taxi', '出租车', 'noun', 'The taxi is outside.', '出租车在外面。'],
  ['bus', '公交车', 'noun', 'The bus is late.', '公交车晚点了。'],
  ['train', '火车', 'noun', 'The train leaves now.', '火车现在出发。'],
  ['car', '汽车', 'noun', 'The car is waiting.', '车在等候。'],
  ['bicycle', '自行车', 'noun', 'The bicycle is for rent.', '这辆自行车可以租。'],
  ['subway', '地铁', 'noun', 'The subway is downstairs.', '地铁在楼下。'],
  ['airport', '机场', 'noun', 'We are at the airport.', '我们在机场。'],
  ['hotel', '酒店', 'noun', 'Our hotel is nearby.', '我们的酒店在附近。'],
  ['room', '房间', 'noun', 'This is my room.', '这是我的房间。'],
  ['key', '钥匙；房卡', 'noun', 'Here is your room key.', '这是你的房间钥匙。'],
  ['bed', '床', 'noun', 'The bed is clean.', '床很干净。'],
  ['door', '门', 'noun', 'Please close the door.', '请关门。'],
  ['water', '水', 'noun', 'Can I have water?', '我可以要水吗？'],
  ['food', '食物', 'noun', 'The food is good.', '食物很好。'],
  ['spoon', '勺子', 'noun', 'May I have a spoon?', '我可以要一把勺子吗？'],
  ['table', '桌子', 'noun', 'Our table is ready.', '我们的桌子准备好了。'],
  ['eat', '吃', 'verb', 'We want to eat.', '我们想吃饭。'],
  ['drink', '喝', 'verb', 'I want to drink water.', '我想喝水。'],
  ['shop', '商店', 'noun', 'The shop is open.', '商店开着。'],
  ['money', '钱', 'noun', 'I need money for the bus.', '我坐公交车需要钱。'],
  ['wallet', '钱包', 'noun', 'My wallet is in my bag.', '我的钱包在包里。'],
  ['card', '卡', 'noun', 'Can I pay by card?', '我可以刷卡吗？'],
  ['cheap', '便宜的', 'adjective', 'Is this cheap?', '这个便宜吗？'],
  ['buy', '买', 'verb', 'I want to buy this.', '我想买这个。'],
  ['small', '小的', 'adjective', 'I need a small bag.', '我需要一个小包。'],
  ['big', '大的', 'adjective', 'This suitcase is big.', '这个行李箱很大。'],
  ['lost', '丢失的', 'adjective', 'My phone is lost.', '我的手机丢了。'],
  ['phone', '手机；电话', 'noun', 'My phone is here.', '我的手机在这里。'],
  ['police', '警察', 'noun', 'Please call the police.', '请叫警察。'],
  ['doctor', '医生', 'noun', 'I need a doctor.', '我需要医生。'],
  ['hurt', '受伤；疼', 'adjective', 'My leg hurts.', '我的腿疼。'],
  ['sick', '生病的', 'adjective', 'I feel sick.', '我觉得不舒服。'],
  ['safe', '安全的', 'adjective', 'Is this area safe?', '这个地方安全吗？'],
  ['danger', '危险', 'noun', 'There is danger ahead.', '前面有危险。'],
  ['ambulance', '救护车', 'noun', 'Please call an ambulance.', '请叫救护车。'],
  ['bathroom', '洗手间', 'noun', 'Where is the bathroom?', '洗手间在哪里？'],
  ['open', '打开；营业', 'adjective', 'Is the store open?', '商店开着吗？'],
  ['closed', '关闭的', 'adjective', 'The door is closed.', '门关着。']
]

if (rows.length !== 75) throw new Error(`Expected 75 reviewed rows, got ${rows.length}.`)
const normalized = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-k1a-'))
const existing = new Set(unit.activity.items.map((item) => normalized(item.term)))
for (const [term] of rows) {
  if (existing.has(normalized(term))) throw new Error(`Duplicate daily term: ${term}`)
  existing.add(normalized(term))
}
const newItems = rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({
  id: `r17-daily-k1a-${String(index + 1).padStart(3, '0')}`,
  term,
  partOfSpeech,
  meaningZh,
  exampleEn,
  exampleZh,
  growthDifficultyLevel: 0,
  dailyKnowledgeId: `daily-knowledge-v1:k1a:${String(index + 1).padStart(3, '0')}`,
}))
unit.activity.items.push(...newItems)
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 75 reviewed kindergarten daily vocabulary items.')
