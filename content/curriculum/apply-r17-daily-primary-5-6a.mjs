import fs from 'node:fs'

const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons.flatMap((lesson) => lesson.learningUnits).find((candidate) => candidate.learningUnitId === 'st4w-w1d4-vocabulary')
if (!unit) throw new Error('The daily vocabulary host unit is missing.')

const rows = [
  ['Could you explain my rebooking options after the cancellation?', '航班取消后您能解释我的改签选项吗？', 'request', 'Could you explain my rebooking options after the cancellation?', '航班取消后您能解释我的改签选项吗？'],
  ['I would prefer a refund if no direct flight is available.', '如果没有直飞航班，我更想退款。', 'preference', 'I would prefer a refund if no direct flight is available.', '如果没有直飞航班，我更想退款。'],
  ['Could you confirm whether the new fare includes the same baggage allowance?', '您能确认新票价是否包含相同的行李额度吗？', 'request', 'Could you confirm whether the new fare includes the same baggage allowance?', '您能确认新票价是否包含相同的行李额度吗？'],
  ['I need written confirmation because my employer requires it.', '因为雇主要求，我需要书面确认。', 'statement', 'I need written confirmation because my employer requires it.', '因为雇主要求，我需要书面确认。'],
  ['Could you tell me why my seat assignment changed?', '您能告诉我为什么座位安排变了吗？', 'request', 'Could you tell me why my seat assignment changed?', '您能告诉我为什么座位安排变了吗？'],
  ['Would it be possible to move closer to the front?', '可以换到更靠前的位置吗？', 'request', 'Would it be possible to move closer to the front?', '可以换到更靠前的位置吗？'],
  ['Could you arrange a hotel because the connection is overnight?', '因为转机要过夜，您能安排酒店吗？', 'request', 'Could you arrange a hotel because the connection is overnight?', '因为转机要过夜，您能安排酒店吗？'],
  ['I need to know whether my bag will be transferred automatically.', '我需要知道行李是否会自动转运。', 'statement', 'I need to know whether my bag will be transferred automatically.', '我需要知道行李是否会自动转运。'],
  ['Could you check the status of the damage claim I filed?', '您能查询我提交的损坏索赔状态吗？', 'request', 'Could you check the status of the damage claim I filed?', '您能查询我提交的损坏索赔状态吗？'],
  ['I would accept a different room if the rate stays the same.', '如果房价不变，我可以接受不同的房间。', 'preference', 'I would accept a different room if the rate stays the same.', '如果房价不变，我可以接受不同的房间。'],
  ['Could you clarify which amenities are included in the resort fee?', '您能说明度假村费用包括哪些设施吗？', 'request', 'Could you clarify which amenities are included in the resort fee?', '您能说明度假村费用包括哪些设施吗？'],
  ['I need a quieter room because I have an early meeting.', '因为我有早会，我需要更安静的房间。', 'statement', 'I need a quieter room because I have an early meeting.', '因为我有早会，我需要更安静的房间。'],
  ['Could you adjust the bill before I check out?', '我退房前您能调整账单吗？', 'request', 'Could you adjust the bill before I check out?', '我退房前您能调整账单吗？'],
  ['Is there a penalty for shortening my stay?', '缩短住宿时间有罚金吗？', 'question', 'Is there a penalty for shortening my stay?', '缩短住宿时间有罚金吗？'],
  ['Could you arrange a luggage pickup after I check out?', '退房后您能安排取行李吗？', 'request', 'Could you arrange a luggage pickup after I check out?', '退房后您能安排取行李吗？'],
  ['I need to know whether the kitchen can avoid cross-contact.', '我需要知道厨房能否避免交叉接触。', 'statement', 'I need to know whether the kitchen can avoid cross-contact.', '我需要知道厨房能否避免交叉接触。'],
  ['Could you ask the chef to leave out the sesame?', '您能请厨师不要放芝麻吗？', 'request', 'Could you ask the chef to leave out the sesame?', '您能请厨师不要放芝麻吗？'],
  ['The dish was served differently from what I ordered.', '这道菜和我点的不同。', 'complaint', 'The dish was served differently from what I ordered.', '这道菜和我点的不同。'],
  ['Could you replace it without charging me again?', '您能更换而不再次收费吗？', 'request', 'Could you replace it without charging me again?', '您能更换而不再次收费吗？'],
  ['I would like to know how long the wait for a table will be.', '我想知道等桌需要多久。', 'statement', 'I would like to know how long the wait for a table will be.', '我想知道等桌需要多久。'],
  ['Could you explain whether gratuity is already included for a group?', '您能解释团体是否已包含小费吗？', 'request', 'Could you explain whether gratuity is already included for a group?', '您能解释团体是否已包含小费吗？'],
  ['Could you help us choose a route with the fewest transfers?', '您能帮我们选择换乘最少的路线吗？', 'request', 'Could you help us choose a route with the fewest transfers?', '您能帮我们选择换乘最少的路线吗？'],
  ['I need to know which exit is safest after dark.', '我需要知道天黑后哪个出口最安全。', 'statement', 'I need to know which exit is safest after dark.', '我需要知道天黑后哪个出口最安全。'],
  ['Could you let the driver know that I need assistance with luggage?', '您能告诉司机我需要搬运行李协助吗？', 'request', 'Could you let the driver know that I need assistance with luggage?', '您能告诉司机我需要搬运行李协助吗？'],
  ['I would rather take a longer route if it avoids heavy traffic.', '如果能避开严重堵车，我宁愿走更长的路线。', 'preference', 'I would rather take a longer route if it avoids heavy traffic.', '如果能避开严重堵车，我宁愿走更长的路线。'],
  ['Could you explain the difference between regular and express service?', '您能解释普通服务和快速服务的区别吗？', 'request', 'Could you explain the difference between regular and express service?', '您能解释普通服务和快速服务的区别吗？'],
  ['I need a ticket that remains valid if the departure is delayed.', '我需要延误后仍有效的车票。', 'statement', 'I need a ticket that remains valid if the departure is delayed.', '我需要延误后仍有效的车票。'],
  ['Could you check if this pass covers the ferry as well?', '您能确认这张通票是否也包含渡轮吗？', 'request', 'Could you check if this pass covers the ferry as well?', '您能确认这张通票是否也包含渡轮吗？'],
  ['I need to exchange this because it was not as described.', '我需要换这个，因为它与描述不符。', 'statement', 'I need to exchange this because it was not as described.', '我需要换这个，因为它与描述不符。'],
  ['Could you tell me whether the sale can be applied later?', '您能告诉我促销是否可以之后补用吗？', 'request', 'Could you tell me whether the sale can be applied later?', '您能告诉我促销是否可以之后补用吗？'],
  ['I would like an alternative that is easier to pack.', '我想要一个更容易打包的替代品。', 'preference', 'I would like an alternative that is easier to pack.', '我想要一个更容易打包的替代品。'],
  ['Could you explain the return policy for opened items?', '您能解释已拆封商品的退货政策吗？', 'request', 'Could you explain the return policy for opened items?', '您能解释已拆封商品的退货政策吗？'],
  ['I need to know whether the discount applies to children.', '我需要知道折扣是否适用于儿童。', 'statement', 'I need to know whether the discount applies to children.', '我需要知道折扣是否适用于儿童。'],
  ['Could you help me find a pharmacy that accepts my insurance?', '您能帮我找一家接受我保险的药店吗？', 'request', 'Could you help me find a pharmacy that accepts my insurance?', '您能帮我找一家接受我保险的药店吗？'],
  ['I need to confirm whether this medicine causes drowsiness.', '我需要确认这个药是否会导致困倦。', 'statement', 'I need to confirm whether this medicine causes drowsiness.', '我需要确认这个药是否会导致困倦。'],
  ['Could you explain what I should do if the symptoms continue?', '您能解释如果症状持续我该怎么办吗？', 'request', 'Could you explain what I should do if the symptoms continue?', '您能解释如果症状持续我该怎么办吗？'],
  ['I would prefer a clinic that can provide an English receipt.', '我更希望诊所能提供英文收据。', 'preference', 'I would prefer a clinic that can provide an English receipt.', '我更希望诊所能提供英文收据。'],
  ['Could you help me contact my insurance assistance line?', '您能帮我联系保险援助热线吗？', 'request', 'Could you help me contact my insurance assistance line?', '您能帮我联系保险援助热线吗？'],
  ['I need to report the card because it was used without my permission.', '我需要报告这张卡，因为它被未经允许使用。', 'statement', 'I need to report the card because it was used without my permission.', '我需要报告这张卡，因为它被未经允许使用。'],
  ['Could you block the SIM card and issue a replacement?', '您能停用电话卡并补发一张吗？', 'request', 'Could you block the SIM card and issue a replacement?', '您能停用电话卡并补发一张吗？'],
  ['I need to know whether this plan includes international roaming.', '我需要知道这个套餐是否包含国际漫游。', 'statement', 'I need to know whether this plan includes international roaming.', '我需要知道这个套餐是否包含国际漫游。'],
  ['Could you show me how to change the data limit?', '您能告诉我怎样更改流量上限吗？', 'request', 'Could you show me how to change the data limit?', '您能告诉我怎样更改流量上限吗？'],
  ['I would prefer a printed map because my battery is low.', '因为电量低，我更想要纸质地图。', 'preference', 'I would prefer a printed map because my battery is low.', '因为电量低，我更想要纸质地图。'],
  ['Could you explain the rule for bringing bags inside?', '您能解释带包进入的规定吗？', 'request', 'Could you explain the rule for bringing bags inside?', '您能解释带包进入的规定吗？'],
  ['I need to change the tour date because my flight was moved.', '因为航班改期，我需要更改旅行团日期。', 'statement', 'I need to change the tour date because my flight was moved.', '因为航班改期，我需要更改旅行团日期。'],
  ['Could you hold our tickets until the rest of the group arrives?', '其他团员到达前您能保留我们的票吗？', 'request', 'Could you hold our tickets until the rest of the group arrives?', '其他团员到达前您能保留我们的票吗？'],
  ['I would like to know whether the guide speaks slowly enough for beginners.', '我想知道导游是否说得足够慢，适合初学者。', 'statement', 'I would like to know whether the guide speaks slowly enough for beginners.', '我想知道导游是否说得足够慢，适合初学者。'],
  ['Could you suggest an indoor activity if it rains all afternoon?', '如果整个下午下雨，您能推荐室内活动吗？', 'request', 'Could you suggest an indoor activity if it rains all afternoon?', '如果整个下午下雨，您能推荐室内活动吗？'],
  ['I need to clarify whether photography is allowed without a flash.', '我需要确认是否允许不用闪光灯拍照。', 'statement', 'I need to clarify whether photography is allowed without a flash.', '我需要确认是否允许不用闪光灯拍照。'],
  ['Could you tell me who to contact if I lose something here?', '如果我在这里丢东西，您能告诉我联系谁吗？', 'request', 'Could you tell me who to contact if I lose something here?', '如果我在这里丢东西，您能告诉我联系谁吗？'],
  ['I need a place to wait that has an outlet and seating.', '我需要一个有插座和座位的等候地方。', 'statement', 'I need a place to wait that has an outlet and seating.', '我需要一个有插座和座位的等候地方。'],
  ['Could you confirm whether the pickup time is local time?', '您能确认接车时间是否为当地时间吗？', 'request', 'Could you confirm whether the pickup time is local time?', '您能确认接车时间是否为当地时间吗？'],
  ['I would rather meet at the lobby because it is easier to find.', '因为更容易找到，我宁愿在大堂见面。', 'preference', 'I would rather meet at the lobby because it is easier to find.', '因为更容易找到，我宁愿在大堂见面。'],
  ['Could you let me know if there is an additional fee for this service?', '您能告诉我这项服务是否有额外费用吗？', 'request', 'Could you let me know if there is an additional fee for this service?', '您能告诉我这项服务是否有额外费用吗？'],
  ['I need to understand the rule before I agree to it.', '在同意前我需要了解这条规定。', 'statement', 'I need to understand the rule before I agree to it.', '在同意前我需要了解这条规定。'],
  ['Could you provide a contact number in case the plans change?', '如果计划改变，您能提供联系电话吗？', 'request', 'Could you provide a contact number in case the plans change?', '如果计划改变，您能提供联系电话吗？'],
]

if (rows.length !== 56) throw new Error(`Expected 56 reviewed rows, got ${rows.length}.`)
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-p5a-'))
const existing = new Set(unit.activity.items.map((item) => normalize(item.term)))
for (const [term] of rows) { if (existing.has(normalize(term))) throw new Error(`Duplicate daily term: ${term}`); existing.add(normalize(term)) }
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech, exampleEn, exampleZh], index) => ({ id: `r17-daily-p5a-${String(index + 1).padStart(3, '0')}`, term, meaningZh, partOfSpeech, exampleEn, exampleZh, growthDifficultyLevel: 2.5, dailyKnowledgeId: `daily-knowledge-v1:p5a:${String(index + 1).padStart(3, '0')}` })))
fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log('Added 56 reviewed primary-5 6A daily vocabulary items.')
