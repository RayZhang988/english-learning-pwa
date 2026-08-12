import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons[0].learningUnits.find((candidate) => candidate.learningUnitId === 'st4w-w1d1-vocabulary')
if (!unit) throw new Error('The daily vocabulary host unit is missing.')

// Primary-1 2C closes the level with short, concrete travel phrases. The
// groups fill airport, hotel, transport, health, help, connection and refund
// gaps without copying identity or progress from the independent scene bank.
const rows = [
  ['check-in counter', '值机柜台', 'noun phrase', 'The check-in counter is on the left.', '值机柜台在左边。'],
  ['flight number', '航班号', 'noun phrase', 'Please check your flight number.', '请查看你的航班号。'],
  ['departure board', '出发信息牌', 'noun phrase', 'The departure board is near the gate.', '出发信息牌在登机口附近。'],
  ['travel document', '旅行证件', 'noun phrase', 'Keep your travel document ready.', '请准备好旅行证件。'],
  ['security line', '安检队伍', 'noun phrase', 'The security line is long today.', '今天安检队伍很长。'],
  ['security check', '安检', 'noun phrase', 'The security check is downstairs.', '安检在楼下。'],
  ['boarding group', '登机组别', 'noun phrase', 'What is my boarding group?', '我的登机组别是什么？'],
  ['window seat', '靠窗座位', 'noun phrase', 'I would like a window seat.', '我想要一个靠窗座位。'],
  ['lost passport', '丢失的护照', 'noun phrase', 'I need help with a lost passport.', '我的护照丢了，需要帮助。'],
  ['flight information', '航班信息', 'noun phrase', 'Where can I get flight information?', '我在哪里可以获得航班信息？'],
  ['airport staff', '机场工作人员', 'noun phrase', 'Ask an airport staff member.', '问一下机场工作人员。'],
  ['extra pillow', '额外枕头', 'noun phrase', 'Could I have an extra pillow?', '我能要一个额外枕头吗？'],
  ['room cleaning', '房间清洁', 'noun phrase', 'Room cleaning is in the morning.', '房间清洁在早上。'],
  ['do not disturb', '请勿打扰', 'hotel phrase', 'Please put up the do not disturb sign.', '请挂上请勿打扰的牌子。'],
  ['late arrival', '晚到', 'noun phrase', 'I have a late arrival tonight.', '我今晚会晚到。'],
  ['early check-in', '提前入住', 'noun phrase', 'Is early check-in possible?', '可以提前入住吗？'],
  ['luggage storage', '行李寄存', 'noun phrase', 'Do you have luggage storage?', '你们有行李寄存吗？'],
  ['hotel address', '酒店地址', 'noun phrase', 'Please write down the hotel address.', '请写下酒店地址。'],
  ['guest elevator', '住客电梯', 'noun phrase', 'Use the guest elevator for the rooms.', '去房间请用住客电梯。'],
  ['room phone', '房间电话', 'noun phrase', 'The room phone is by the bed.', '房间电话在床边。'],
  ['hotel parking', '酒店停车场', 'noun phrase', 'Is hotel parking free?', '酒店停车场免费吗？'],
  ['subway map', '地铁地图', 'noun phrase', 'I need a subway map.', '我需要一张地铁地图。'],
  ['subway entrance', '地铁入口', 'noun phrase', 'The subway entrance is across the street.', '地铁入口在马路对面。'],
  ['fare card', '交通卡', 'noun phrase', 'Can I use a fare card here?', '我可以在这里用交通卡吗？'],
  ['ticket price', '票价', 'noun phrase', 'What is the ticket price?', '票价是多少？'],
  ['service delay', '服务延误', 'noun phrase', 'There is a service delay on this line.', '这条线路有服务延误。'],
  ['seat available', '有空座位', 'status phrase', 'Is there a seat available?', '有空座位吗？'],
  ['exit sign', '出口标志', 'noun phrase', 'Follow the exit sign.', '跟着出口标志走。'],
  ['walking distance', '步行距离', 'noun phrase', 'Is the hotel within walking distance?', '酒店在步行距离内吗？'],
  ['transfer station', '换乘站', 'noun phrase', 'This is the transfer station.', '这里是换乘站。'],
  ['I feel sick', '我感觉不舒服', 'statement phrase', 'I feel sick after the ride.', '坐完车后我感觉不舒服。'],
  ['I need a doctor', '我需要医生', 'statement phrase', 'I need a doctor, please.', '请帮我找医生。'],
  ['pain medicine', '止痛药', 'noun phrase', 'Do you have pain medicine?', '你们有止痛药吗？'],
  ['medicine label', '药品标签', 'noun phrase', 'Please read the medicine label.', '请看一下药品标签。'],
  ['sore throat', '喉咙痛', 'noun phrase', 'I have a sore throat.', '我喉咙痛。'],
  ['stomach pain', '胃痛', 'noun phrase', 'I have stomach pain today.', '我今天胃痛。'],
  ['fever medicine', '退烧药', 'noun phrase', 'I need fever medicine.', '我需要退烧药。'],
  ['medical clinic', '诊所', 'noun phrase', 'The medical clinic is open now.', '诊所现在开门。'],
  ['emergency room', '急诊室', 'noun phrase', 'Where is the emergency room?', '急诊室在哪里？'],
  ['health insurance', '医疗保险', 'noun phrase', 'Do you take my health insurance?', '你们接受我的医疗保险吗？'],
  ['I am lost', '我迷路了', 'statement phrase', 'I am lost near the station.', '我在车站附近迷路了。'],
  ['lost phone', '丢失的手机', 'noun phrase', 'I need help with a lost phone.', '我的手机丢了，需要帮助。'],
  ['lost bag', '丢失的包', 'noun phrase', 'Have you seen my lost bag?', '你见过我丢失的包吗？'],
  ['help desk', '服务台', 'noun phrase', 'The help desk is by the entrance.', '服务台在入口旁边。'],
  ['police station', '警察局', 'noun phrase', 'Where is the police station?', '警察局在哪里？'],
  ['safe place', '安全的地方', 'noun phrase', 'Please show me a safe place.', '请带我去一个安全的地方。'],
  ['call the police', '报警', 'request phrase', 'Please call the police.', '请报警。'],
  ['need help', '需要帮助', 'request phrase', 'I need help with my bag.', '我的包需要帮助处理。'],
  ['show me on the map', '在地图上给我指一下', 'request phrase', 'Can you show me on the map?', '你能在地图上给我指一下吗？'],
  ['my address', '我的地址', 'noun phrase', 'This is my address.', '这是我的地址。'],
  ['hotel name', '酒店名称', 'noun phrase', 'What is the hotel name?', '酒店名称是什么？'],
  ['meet here', '在这里见面', 'request phrase', 'Let us meet here at noon.', '我们中午在这里见面。'],
  ['phone battery', '手机电池', 'noun phrase', 'My phone battery is low.', '我的手机电池快没电了。'],
  ['battery low', '电量低', 'status phrase', 'My phone says battery low.', '我的手机显示电量低。'],
  ['charging station', '充电站', 'noun phrase', 'Where is the charging station?', '充电站在哪里？'],
  ['internet connection', '网络连接', 'noun phrase', 'The internet connection is slow.', '网络连接很慢。'],
  ['Wi-Fi network', '无线网络', 'noun phrase', 'Which Wi-Fi network should I use?', '我该用哪个无线网络？'],
  ['phone call', '电话', 'noun phrase', 'I need to make a phone call.', '我需要打一个电话。'],
  ['text message', '短信', 'noun phrase', 'I sent a text message.', '我发了一条短信。'],
  ['keep the receipt', '保留收据', 'request phrase', 'Please keep the receipt.', '请保留收据。'],
  ['refund request', '退款申请', 'noun phrase', 'I would like a refund request form.', '我想要一张退款申请表。'],
  ['money back', '退款', 'payment phrase', 'Can I get my money back?', '我能拿回退款吗？'],
  ['return this item', '退还这件商品', 'verb phrase', 'I want to return this item.', '我想退还这件商品。'],
  ['proof of payment', '付款凭证', 'noun phrase', 'Do you need proof of payment?', '你需要付款凭证吗？'],
  ['credit card', '信用卡', 'noun phrase', 'Can I pay by credit card?', '我可以用信用卡付款吗？'],
]

if (rows.length !== 65) throw new Error(`Expected 65 reviewed rows, got ${rows.length}.`)
const normalized = (value) => value.toLocaleLowerCase('en-US')
  .replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-p1c-'))
const existing = new Set(unit.activity.items.map((item) => normalized(item.term)))
for (const [term] of rows) {
  if (existing.has(normalized(term))) throw new Error(`Duplicate daily term after normalization: ${term}`)
  existing.add(normalized(term))
}
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({
  id: `r17-daily-p1c-${String(index + 1).padStart(3, '0')}`,
  term,
  meaningZh,
  partOfSpeech,
  exampleEn,
  exampleZh,
  growthDifficultyLevel: 0.5,
  dailyKnowledgeId: `daily-knowledge-v1:p1c:${String(index + 1).padStart(3, '0')}`,
})))
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 65 reviewed primary-1 2C daily vocabulary items.')
