import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons[0].learningUnits.find((candidate) => candidate.learningUnitId === 'st4w-w1d1-vocabulary')
if (!unit) throw new Error('The daily vocabulary host unit is missing.')

// Explicitly curated 1B content. These are separate survival concepts rather
// than spelling, plurality, capitalization, or near-synonym variants of 1A.
const rows = [
  ['enter', '进入', 'verb', 'Please enter here.', '请从这里进入。'],
  ['leave', '离开', 'verb', 'We leave the hotel now.', '我们现在离开酒店。'],
  ['come', '来', 'verb', 'Please come with me.', '请跟我来。'],
  ['sit', '坐', 'verb', 'Please sit here.', '请坐在这里。'],
  ['stand', '站立', 'verb', 'Please stand in line.', '请站在队伍里。'],
  ['start', '开始', 'verb', 'The tour starts now.', '旅行团现在开始。'],
  ['turn on', '打开电源', 'phrasal verb', 'Turn on the light, please.', '请打开灯。'],
  ['turn off', '关闭电源', 'phrasal verb', 'Turn off the TV, please.', '请关闭电视。'],
  ['put', '放', 'verb', 'Put your bag here.', '把你的包放在这里。'],
  ['take', '拿', 'verb', 'Take this map.', '拿这张地图。'],
  ['give', '给', 'verb', 'Give me the key, please.', '请把钥匙给我。'],
  ['show', '出示', 'verb', 'Show your passport here.', '请在这里出示护照。'],
  ['look', '看', 'verb', 'Look at the sign.', '看这个标志。'],
  ['listen', '听', 'verb', 'Listen to the guide.', '听导游说。'],
  ['say', '说', 'verb', 'Say your name slowly.', '慢慢说你的名字。'],
  ['tell', '告诉', 'verb', 'Tell me the gate number.', '告诉我登机口号码。'],
  ['ask', '询问', 'verb', 'Ask the hotel staff.', '询问酒店工作人员。'],
  ['call', '打电话', 'verb', 'Call a taxi, please.', '请叫一辆出租车。'],
  ['use', '使用', 'verb', 'Use this card.', '使用这张卡。'],
  ['carry', '携带', 'verb', 'Carry your bag with you.', '随身携带你的包。'],
  ['hold', '拿着', 'verb', 'Hold my hand.', '拿着我的手。'],
  ['find', '找到', 'verb', 'Can you find the station?', '你能找到车站吗？'],
  ['choose', '选择', 'verb', 'Choose a seat.', '选择一个座位。'],
  ['pay', '付款', 'verb', 'Pay here, please.', '请在这里付款。'],
  ['keep', '保管', 'verb', 'Keep your passport safe.', '保管好你的护照。'],
  ['bring', '带来', 'verb', 'Bring your ID, please.', '请带上你的证件。'],
  ['wear', '穿', 'verb', 'Wear your coat.', '穿上你的外套。'],
  ['wash', '洗', 'verb', 'Wash your hands.', '洗手。'],
  ['want', '想要', 'verb', 'I want some water.', '我想要一些水。'],
  ['can', '可以', 'modal verb', 'You can sit here.', '你可以坐在这里。'],
  ["can't", '不能', 'modal verb', "I can't find my bag.", '我找不到我的包。'],
  ['sunny', '晴朗的', 'adjective', 'It is sunny today.', '今天是晴天。'],
  ['rainy', '下雨的', 'adjective', 'It is rainy today.', '今天在下雨。'],
  ['cloudy', '多云的', 'adjective', 'It is cloudy today.', '今天多云。'],
  ['windy', '有风的', 'adjective', 'It is windy outside.', '外面有风。'],
  ['hot', '热的', 'adjective', 'The bus is hot.', '公交车里很热。'],
  ['cold', '冷的', 'adjective', 'The water is cold.', '水很冷。'],
  ['warm', '温暖的', 'adjective', 'The room is warm.', '房间很温暖。'],
  ['cool', '凉爽的', 'adjective', 'The room is cool.', '房间很凉爽。'],
  ['coat', '外套', 'noun', 'My coat is on the chair.', '我的外套在椅子上。'],
  ['jacket', '夹克', 'noun', 'This jacket is mine.', '这件夹克是我的。'],
  ['shirt', '衬衫', 'noun', 'This shirt is clean.', '这件衬衫很干净。'],
  ['pants', '裤子', 'noun', 'These pants are blue.', '这条裤子是蓝色的。'],
  ['shoes', '鞋子', 'noun', 'My shoes are wet.', '我的鞋子湿了。'],
  ['socks', '袜子', 'noun', 'I need dry socks.', '我需要干袜子。'],
  ['hat', '帽子', 'noun', 'Put on your hat.', '戴上你的帽子。'],
  ['umbrella', '雨伞', 'noun', 'Take an umbrella.', '带一把雨伞。'],
  ['red', '红色', 'color word', 'The red bus is here.', '红色公交车在这里。'],
  ['blue', '蓝色', 'color word', 'My bag is blue.', '我的包是蓝色的。'],
  ['yellow', '黄色', 'color word', 'The taxi is yellow.', '出租车是黄色的。'],
  ['green', '绿色', 'color word', 'The green light is on.', '绿灯亮着。'],
  ['black', '黑色', 'color word', 'My suitcase is black.', '我的行李箱是黑色的。'],
  ['white', '白色', 'color word', 'The door is white.', '门是白色的。'],
  ['wet', '湿的', 'adjective', 'My clothes are wet.', '我的衣服湿了。'],
  ['dry', '干的', 'adjective', 'The towel is dry.', '毛巾是干的。'],
  ['mother', '母亲', 'noun', 'My mother is with me.', '我妈妈和我在一起。'],
  ['father', '父亲', 'noun', 'My father is waiting.', '我爸爸在等候。'],
  ['baby', '婴儿', 'noun', 'The baby is asleep.', '婴儿睡着了。'],
  ['boy', '男孩', 'noun', 'The boy is with his family.', '男孩和家人在一起。'],
  ['girl', '女孩', 'noun', 'The girl has a ticket.', '女孩有一张票。'],
  ['husband', '丈夫', 'noun', 'My husband is here.', '我丈夫在这里。'],
  ['wife', '妻子', 'noun', 'My wife needs help.', '我妻子需要帮助。'],
  ['grandma', '祖母', 'noun', 'My grandma needs a seat.', '我祖母需要一个座位。'],
  ['grandpa', '祖父', 'noun', 'My grandpa walks slowly.', '我祖父走得很慢。'],
  ['group', '团队', 'noun', 'Our group is ready.', '我们的团队准备好了。'],
  ['alone', '独自', 'adverb', 'I am traveling alone.', '我独自旅行。'],
  ['together', '一起', 'adverb', 'We travel together.', '我们一起旅行。'],
  ['photo', '照片', 'noun', 'This photo is for my ID.', '这张照片用于我的证件。'],
  ['address', '地址', 'noun', 'Write the hotel address.', '写下酒店地址。'],
  ['bag', '包', 'noun', 'My bag is heavy.', '我的包很重。'],
  ['luggage', '行李', 'noun', 'My luggage is here.', '我的行李在这里。'],
  ['lock', '锁', 'noun', 'The lock is on my bag.', '锁在我的包上。'],
  ['zipper', '拉链', 'noun', 'The zipper is broken.', '拉链坏了。'],
  ['handle', '把手', 'noun', 'Hold the suitcase handle.', '抓住行李箱把手。'],
  ['pocket', '口袋', 'noun', 'My phone is in my pocket.', '我的电话在口袋里。']
]

if (rows.length !== 75) throw new Error(`Expected 75 reviewed rows, got ${rows.length}.`)
const normalized = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-k1b-'))
const existing = new Set(unit.activity.items.map((item) => normalized(item.term)))
for (const [term] of rows) {
  if (existing.has(normalized(term))) throw new Error(`Duplicate daily term: ${term}`)
  existing.add(normalized(term))
}
const newItems = rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({
  id: `r17-daily-k1b-${String(index + 1).padStart(3, '0')}`,
  term,
  partOfSpeech,
  meaningZh,
  exampleEn,
  exampleZh,
  growthDifficultyLevel: 0,
  dailyKnowledgeId: `daily-knowledge-v1:k1b:${String(index + 1).padStart(3, '0')}`,
}))
unit.activity.items.push(...newItems)
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 75 reviewed kindergarten 1B daily vocabulary items.')
