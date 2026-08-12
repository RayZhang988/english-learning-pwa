import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons[0].learningUnits.find((candidate) => candidate.learningUnitId === 'st4w-w1d1-vocabulary')
if (!unit) throw new Error('The daily vocabulary host unit is missing.')

// 1C closes kindergarten by covering hygiene, health, payment, signs, spatial
// relations, and emergency instructions not already taught by 1A/1B.
const rows = [
  ['soap', '肥皂', 'noun', 'The soap is by the sink.', '肥皂在水槽旁边。'],
  ['tissue', '纸巾', 'noun', 'Please take a tissue.', '请拿一张纸巾。'],
  ['toilet paper', '卫生纸', 'noun phrase', 'We need toilet paper.', '我们需要卫生纸。'],
  ['toothbrush', '牙刷', 'noun', 'My toothbrush is in my bag.', '我的牙刷在包里。'],
  ['toothpaste', '牙膏', 'noun', 'I need toothpaste.', '我需要牙膏。'],
  ['shower', '淋浴', 'noun', 'The shower is in the room.', '淋浴间在房间里。'],
  ['sink', '水槽', 'noun', 'The sink is clean.', '水槽很干净。'],
  ['mirror', '镜子', 'noun', 'The mirror is on the wall.', '镜子在墙上。'],
  ['trash can', '垃圾桶', 'noun phrase', 'Put it in the trash can.', '把它放进垃圾桶。'],
  ['clean', '干净的', 'adjective', 'The table is clean.', '桌子很干净。'],
  ['dirty', '脏的', 'adjective', 'My shoes are dirty.', '我的鞋子脏了。'],
  ['tired', '累的', 'adjective', 'I am tired now.', '我现在累了。'],
  ['thirsty', '口渴的', 'adjective', 'I am thirsty.', '我口渴了。'],
  ['hungry', '饿的', 'adjective', 'The child is hungry.', '孩子饿了。'],
  ['sleepy', '困的', 'adjective', 'The baby is sleepy.', '婴儿困了。'],
  ['fever', '发烧', 'noun', 'I have a fever.', '我发烧了。'],
  ['cough', '咳嗽', 'noun', 'I have a cough.', '我咳嗽。'],
  ['headache', '头痛', 'noun', 'I have a headache.', '我头痛。'],
  ['stomachache', '胃痛', 'noun', 'I have a stomachache.', '我胃痛。'],
  ['medicine', '药', 'noun', 'I need medicine.', '我需要药。'],
  ['bandage', '绷带', 'noun', 'I need a bandage.', '我需要绷带。'],
  ['six', '六', 'number', 'I need six tickets.', '我需要六张票。'],
  ['seven', '七', 'number', 'Gate seven is open.', '七号登机口开放了。'],
  ['eight', '八', 'number', 'Our table is eight.', '我们是八号桌。'],
  ['nine', '九', 'number', 'The bus comes at nine.', '公交车九点来。'],
  ['ten', '十', 'number', 'It is ten dollars.', '这是十美元。'],
  ['how much', '多少钱', 'question phrase', 'How much is this?', '这个多少钱？'],
  ['coin', '硬币', 'noun', 'This coin is small.', '这枚硬币很小。'],
  ['banknote', '纸币', 'noun', 'This banknote is for the bus.', '这张纸币用来坐公交车。'],
  ['bill', '账单', 'noun', 'Can I have the bill?', '我可以要账单吗？'],
  ['expensive', '贵的', 'adjective', 'The room is expensive.', '房间很贵。'],
  ['exit', '出口', 'noun', 'The exit is there.', '出口在那里。'],
  ['push', '推', 'verb', 'Push the door.', '推门。'],
  ['pull', '拉', 'verb', 'Pull the door.', '拉门。'],
  ['stairs', '楼梯', 'noun', 'The stairs are here.', '楼梯在这里。'],
  ['escalator', '自动扶梯', 'noun', 'Take the escalator down.', '乘自动扶梯下去。'],
  ['inside', '里面', 'place word', 'Wait inside.', '在里面等。'],
  ['outside', '外面', 'place word', 'The taxi is outside.', '出租车在外面。'],
  ['above', '上方', 'place word', 'The sign is above the door.', '标志在门上方。'],
  ['below', '下方', 'place word', 'The number is below the map.', '号码在地图下方。'],
  ['behind', '后面', 'place word', 'The hotel is behind the shop.', '酒店在商店后面。'],
  ['between', '在两者之间', 'place word', 'The bank is between two shops.', '银行在两家商店之间。'],
  ['fire', '火', 'noun', 'There is a fire.', '有火。'],
  ['smoke', '烟', 'noun', 'I can smell smoke.', '我闻到烟味。'],
  ['alarm', '警报', 'noun', 'The alarm is loud.', '警报很响。'],
  ['first aid', '急救', 'noun phrase', 'First aid is here.', '急救处在这里。'],
  ['careful', '小心', 'adjective', 'Be careful on the stairs.', '走楼梯要小心。'],
  ['follow', '跟随', 'verb', 'Follow me, please.', '请跟着我。'],
  ['touch', '触摸', 'verb', 'Do not touch this.', '不要碰这个。'],
  ['run', '跑', 'verb', 'Do not run here.', '不要在这里跑。']
]

if (rows.length !== 50) throw new Error(`Expected 50 reviewed rows, got ${rows.length}.`)
const normalized = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-k1c-'))
const existing = new Set(unit.activity.items.map((item) => normalized(item.term)))
for (const [term] of rows) {
  if (existing.has(normalized(term))) throw new Error(`Duplicate daily term: ${term}`)
  existing.add(normalized(term))
}
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({
  id: `r17-daily-k1c-${String(index + 1).padStart(3, '0')}`,
  term,
  meaningZh,
  partOfSpeech,
  exampleEn,
  exampleZh,
  growthDifficultyLevel: 0,
  dailyKnowledgeId: `daily-knowledge-v1:k1c:${String(index + 1).padStart(3, '0')}`,
})))
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 50 reviewed kindergarten 1C daily vocabulary items.')
