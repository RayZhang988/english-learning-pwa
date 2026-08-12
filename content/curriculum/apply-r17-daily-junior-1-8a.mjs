import fs from 'node:fs'

const file = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(file, 'utf8'))
const unit = document.lessons.flatMap((lesson) => lesson.learningUnits)
  .find((candidate) => candidate.learningUnitId === 'st4w-w1d4-vocabulary')
if (!unit) throw new Error('daily vocabulary host is missing')

const rows = [
['Could you explain whether this fare is flexible?', '您能说明这个票价是否可以改签吗？', 'request'],
['I need to confirm the change before the deadline.', '我需要在截止时间前确认变更。', 'statement'],
['Can you separate the airline charge from the airport tax?', '您能把航空公司收费与机场税分开吗？', 'request'],
['Could you note the reason for the delay in writing?', '您能书面注明延误原因吗？', 'request'],
['I need an alternative flight that arrives the same day.', '我需要一趟当天到达的替代航班。', 'statement'],
['Could you protect my connecting reservation while you rebook me?', '您改签时能保留我的联程预订吗？', 'request'],
['I need to know whether my checked bag follows the new itinerary.', '我需要知道托运行李是否随新行程转运。', 'statement'],
['Can you issue a revised itinerary with the new flight number?', '您能开一份含新航班号的更新行程单吗？', 'request'],
['Could you explain the baggage allowance on the replacement flight?', '您能说明替代航班的行李额度吗？', 'request'],
['I need confirmation that my meal request was transferred.', '我需要确认餐食要求已经转到新航班。', 'statement'],
['Could you arrange an airport hotel because the connection is overnight?', '因为转机要过夜，您能安排机场酒店吗？', 'request'],
['I need a receipt for the transportation the airline authorized.', '我需要航空公司批准交通的收据。', 'statement'],
['Could you help me file a report before I leave the airport?', '我离开机场前您能帮我提交报告吗？', 'request'],
['I need to know how long the baggage search usually takes.', '我需要知道寻找行李通常需要多久。', 'statement'],
['Could you deliver the bag after you confirm my address?', '您确认我的地址后能递送行李吗？', 'request'],
['I need to explain that the room problem is affecting my sleep.', '我需要说明房间问题影响了我的睡眠。', 'statement'],
['Could you move me if the repair cannot be completed today?', '如果今天无法修好，您能给我换房吗？', 'request'],
['I need to know whether the deposit is returned automatically.', '我需要知道押金是否会自动退还。', 'statement'],
['Could you provide a written breakdown of the room charges?', '您能提供房费的书面明细吗？', 'request'],
['I need a quieter room because I am traveling with a child.', '因为我带着孩子旅行，我需要一间更安静的房间。', 'statement'],
['Could you waive the fee if the advertised amenity is unavailable?', '如果宣传的设施无法使用，您能免除费用吗？', 'request'],
['I need to know which employee can approve this request.', '我需要知道哪位员工能批准这个请求。', 'statement'],
['Could you reserve a table where a wheelchair can fit?', '您能预订一张轮椅能进入的桌子吗？', 'request'],
['I need to explain that even a small amount of nuts is unsafe for me.', '我需要说明即使少量坚果对我也不安全。', 'statement'],
['Could you ask the chef whether the sauce is prepared separately?', '您能问问厨师酱汁是否单独制作吗？', 'request'],
['I need an alternative meal that meets the allergy requirement.', '我需要一份符合过敏要求的替代餐。', 'statement'],
['Could you correct the bill before the payment is processed?', '付款处理前您能更正账单吗？', 'request'],
['I need to know whether the service charge is mandatory.', '我需要知道服务费是否强制收取。', 'statement'],
['Could you hold the order while I check with my companion?', '我和同伴确认时您能暂缓下单吗？', 'request'],
['I need to know if the transfer is guaranteed when the train is late.', '我需要知道火车晚点时是否保证换乘。', 'statement'],
['Could you recommend a route that avoids stairs and steep hills?', '您能推荐一条避开楼梯和陡坡的路线吗？', 'request'],
['I need confirmation that the last bus stops near my hotel.', '我需要确认末班车在酒店附近停靠。', 'statement'],
['Could you arrange a pickup if public transit service ends?', '如果公共交通停运，您能安排接送吗？', 'request'],
['I need to know which platform has staff available to help.', '我需要知道哪个站台有工作人员可以帮忙。', 'statement'],
['Could you explain whether this pass covers buses and trains?', '您能说明这张通票是否涵盖公交和火车吗？', 'request'],
['I need to change the tour date because my flight was rescheduled.', '因为航班改期，我需要更改旅行团日期。', 'statement'],
['Could you tell me what happens if weather closes the attraction?', '如果天气导致景点关闭，您能告诉我会怎样吗？', 'request'],
['I need an accessible route between the entrance and the exhibit.', '我需要入口和展区之间的无障碍路线。', 'statement'],
['Could you reserve a later time slot as a backup option?', '您能预订一个更晚的时间段作为备用吗？', 'request'],
['I need to know whether the guide can adjust the pace for our group.', '我需要知道导游能否为我们团队调整节奏。', 'statement'],
['Could you explain the condition for returning an opened item?', '您能说明退回已拆封商品的条件吗？', 'request'],
['I need to know whether the refund goes to the original card.', '我需要知道退款是否退回原来的卡。', 'statement'],
['Could you keep the item aside until I verify the measurements?', '我确认尺寸前您能先把商品留出来吗？', 'request'],
['I need a receipt that shows the exchange rate used.', '我需要一张显示所用汇率的收据。', 'statement'],
['Could you explain whether the tax refund requires a passport stamp?', '您能说明退税是否需要护照盖章吗？', 'request'],
['I need to know whether the pharmacy can transfer a prescription.', '我需要知道药房能否转移处方。', 'statement'],
['Could you help me describe the side effects to the pharmacist?', '您能帮我向药剂师描述副作用吗？', 'request'],
['I need to confirm if this medicine is safe before driving.', '我需要在开车前确认这药是否安全。', 'statement'],
['Could you explain what information the travel insurer needs?', '您能说明旅行保险公司需要哪些信息吗？', 'request'],
['I need to know which clinic can provide an English medical summary.', '我需要知道哪家诊所能提供英文病历摘要。', 'statement'],
['Could you help me contact the clinic if the symptoms get worse?', '如果症状恶化，您能帮我联系诊所吗？', 'request'],
['I need to know whether my SIM card supports receiving calls abroad.', '我需要知道我的电话卡在国外是否能接电话。', 'statement'],
['Could you explain how to stop automatic renewal on this plan?', '您能说明如何停止这个套餐自动续费吗？', 'request'],
['I need a backup way to reach my hotel if my phone battery dies.', '如果手机没电，我需要备用方式联系酒店。', 'statement'],
['Could you send the confirmation to a second email address?', '您能把确认信息发送到第二个邮箱吗？', 'request'],
['I need to know who to call if the host does not respond.', '如果房东不回复，我需要知道该联系谁。', 'statement'],
['Could you provide directions that include a recognizable landmark?', '您能提供包含明显地标的路线吗？', 'request'],
['I need to know whether the building has a secure place for luggage.', '我需要知道这栋楼是否有安全的行李寄存处。', 'statement'],
['Could you explain the local rule about carrying identification?', '您能说明当地携带身份证件的规定吗？', 'request'],
['I need to report that my card was charged without my approval.', '我需要报告我的卡在未经同意时被扣款。', 'statement'],
['Could you help me find a police station that can take a report?', '您能帮我找一家可以受理报告的警察局吗？', 'request'],
['I need to know which documents I should keep in an emergency.', '我需要知道紧急情况下该保留哪些文件。', 'statement'],
['Could you confirm the meeting place if the schedule changes?', '如果日程变更，您能确认集合地点吗？', 'request'],
['I need to know whether the hotel can store my luggage after checkout.', '我需要知道酒店能否在退房后寄存行李。', 'statement'],
]
if (rows.length !== 64) throw new Error(`Expected 64 rows, got ${rows.length}`)
const norm = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-j1a-'))
const existing = new Set(unit.activity.items.map((item) => norm(item.term)))
for (const [term] of rows) { if (existing.has(norm(term))) throw new Error(`Duplicate daily term: ${term}`); existing.add(norm(term)) }
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech], index) => ({
  id: `r17-daily-j1a-${String(index + 1).padStart(3, '0')}`, term, meaningZh, partOfSpeech,
  exampleEn: term, exampleZh: meaningZh, growthDifficultyLevel: 3.5,
  dailyKnowledgeId: `daily-knowledge-v1:j1a:${String(index + 1).padStart(3, '0')}`,
})))
fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`)
