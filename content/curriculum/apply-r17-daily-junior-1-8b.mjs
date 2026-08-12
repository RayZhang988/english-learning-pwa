import fs from 'node:fs'

const file = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(file, 'utf8'))
const unit = document.lessons.flatMap((lesson) => lesson.learningUnits)
  .find((candidate) => candidate.learningUnitId === 'st4w-w1d4-vocabulary')
if (!unit) throw new Error('daily vocabulary host is missing')

const rows = [
['Could you explain which rule applies to this ticket?', '您能说明这张票适用哪条规定吗？', 'request'],
['I need to know whether the fee is charged per passenger.', '我需要知道这项费用是否按乘客收取。', 'statement'],
['Could you confirm who is responsible for the missed connection?', '您能确认谁负责错过的联程吗？', 'request'],
['I need a record of the time when I reported the problem.', '我需要一份我报告问题时间的记录。', 'statement'],
['Could you explain what documents are required for this change?', '您能说明这项变更需要哪些文件吗？', 'request'],
['I need to know whether the new reservation has the same conditions.', '我需要知道新预订是否具有相同条件。', 'statement'],
['Could you review the charges before I approve the payment?', '我批准付款前您能核对收费吗？', 'request'],
['I need to ask for an exception because the delay was not my fault.', '我需要申请例外，因为延误不是我的过错。', 'statement'],
['Could you tell me what option is available if I decline this offer?', '如果我拒绝这个方案，您能告诉我还有什么选择吗？', 'request'],
['I need confirmation that the cancellation has been processed.', '我需要确认取消已经处理完成。', 'statement'],
['Could you explain why the original arrangement is no longer available?', '您能说明原安排为何不再可用吗？', 'request'],
['I need a practical solution before my next appointment.', '我下一个预约前需要一个可行的解决方案。', 'statement'],
['Could you contact the supervisor if this request cannot be approved here?', '如果这里无法批准，您能联系主管吗？', 'request'],
['I need to know whether I can keep the same confirmation number.', '我需要知道能否保留相同确认号码。', 'statement'],
['Could you explain how the schedule change affects my transfer?', '您能说明日程变更如何影响我的换乘吗？', 'request'],
['I need to make sure the new route is suitable for my luggage.', '我需要确保新路线适合携带行李。', 'statement'],
['Could you offer a comparable option instead of a full refund?', '您能提供一个相当的替代方案而不是全额退款吗？', 'request'],
['I need to know the deadline for choosing the alternative option.', '我需要知道选择替代方案的截止时间。', 'statement'],
['Could you explain whether this policy applies during a weather emergency?', '您能说明这项政策是否适用于天气紧急情况吗？', 'request'],
['I need a written note that explains the service interruption.', '我需要一份说明服务中断的书面说明。', 'statement'],
['Could you help me compare the arrival times of these two options?', '您能帮我比较这两个选项的到达时间吗？', 'request'],
['I need to know which option has fewer changes along the way.', '我需要知道哪个选项途中变更较少。', 'statement'],
['Could you arrange assistance at the point where I change trains?', '我换乘火车的地方能安排协助吗？', 'request'],
['I need to explain that I cannot carry the bag up several flights of stairs.', '我需要说明我无法把包搬上多层楼梯。', 'statement'],
['Could you confirm whether the elevator is working at the station?', '您能确认车站电梯是否正常吗？', 'request'],
['I need to know whether the driver has been told about the delay.', '我需要知道司机是否已经被告知延误。', 'statement'],
['Could you explain the rule for bringing medical supplies through security?', '您能说明携带医疗用品通过安检的规定吗？', 'request'],
['I need a place to sit while I wait for the boarding update.', '我等待登机更新时需要一个坐的地方。', 'statement'],
['Could you confirm that the room rate includes all mandatory charges?', '您能确认房价包含所有强制费用吗？', 'request'],
['I need to know who can fix the air-conditioning problem tonight.', '我需要知道今晚谁能解决空调问题。', 'statement'],
['Could you move my reservation to a room away from the elevator?', '您能把我的预订换到远离电梯的房间吗？', 'request'],
['I need to explain that the noise continues after quiet hours.', '我需要说明安静时段后噪音仍在持续。', 'statement'],
['Could you provide a temporary key while the lock is being repaired?', '门锁维修时您能提供一张临时钥匙吗？', 'request'],
['I need to know whether the hotel can arrange a late check-in.', '我需要知道酒店能否安排延迟入住。', 'statement'],
['Could you ask the restaurant to prepare the dish without the sauce?', '您能让餐厅做这道菜时不放酱汁吗？', 'request'],
['I need to confirm that the meal does not contain dairy.', '我需要确认这份餐不含乳制品。', 'statement'],
['Could you explain why this item cannot be exchanged?', '您能说明为何这件商品不能换货吗？', 'request'],
['I need to know whether the store can issue the refund in cash.', '我需要知道商店能否以现金退款。', 'statement'],
['Could you hold the receipt while I check the item at the counter?', '我在柜台检查商品时您能保留收据吗？', 'request'],
['I need to explain that the price on the shelf was different.', '我需要说明货架上的价格不同。', 'statement'],
['Could you show me where to update my contact information?', '您能告诉我在哪里更新联系方式吗？', 'request'],
['I need to know whether my data plan will work after I cross the border.', '我需要知道过境后流量套餐是否可用。', 'statement'],
['Could you help me restore access after the account was locked?', '账户被锁后您能帮我恢复访问吗？', 'request'],
['I need to explain that I did not receive the verification code.', '我需要说明我没有收到验证码。', 'statement'],
['Could you tell me which number to call outside business hours?', '您能告诉我营业时间外该拨哪个号码吗？', 'request'],
['I need to know whether this clinic accepts travel insurance directly.', '我需要知道这家诊所是否直接接受旅行保险。', 'statement'],
['Could you explain what the medicine is supposed to treat?', '您能说明这药是用来治疗什么的吗？', 'request'],
['I need to ask whether I should avoid any food with this medicine.', '我需要询问服这种药时是否应避免某些食物。', 'statement'],
['Could you help me explain the injury happened during the trip?', '您能帮我说明受伤发生在旅途中吗？', 'request'],
['I need to know which report the insurer will accept as evidence.', '我需要知道保险公司接受哪份报告作为证据。', 'statement'],
['Could you explain how to replace an identification document that was lost?', '您能说明如何补办丢失的身份证件吗？', 'request'],
['I need to report that someone used my payment card without permission.', '我需要报告有人未经许可使用了我的支付卡。', 'statement'],
['Could you confirm that the police report includes the item description?', '您能确认警方报告包含物品描述吗？', 'request'],
['I need to know whether the embassy needs an appointment for this service.', '我需要知道大使馆办理这项服务是否需要预约。', 'statement'],
['Could you explain what I should do if the warning level changes?', '您能说明警报级别变化时我该做什么吗？', 'request'],
['I need a clear plan for meeting my group after an evacuation.', '疏散后我需要一个与团队会合的明确计划。', 'statement'],
['Could you help me arrange a safe place to wait for assistance?', '您能帮我安排一个安全地点等待协助吗？', 'request'],
['I need to confirm that the address is correct before the driver leaves.', '司机离开前我需要确认地址正确。', 'statement'],
['Could you explain why the route has changed from the map?', '您能说明路线为何与地图不同吗？', 'request'],
['I need to know whether the attraction has a separate entrance for groups.', '我需要知道景点是否有团队专用入口。', 'statement'],
['Could you ask the guide to repeat the safety instruction slowly?', '您能请导游慢一点重复安全指示吗？', 'request'],
['I need to explain that I need extra time because of a mobility issue.', '我需要说明因为行动不便我需要更多时间。', 'statement'],
['Could you confirm whether the service desk is open on holidays?', '您能确认服务台节假日是否开放吗？', 'request'],
]
if (rows.length !== 63) throw new Error(`Expected 63 rows, got ${rows.length}`)
const norm = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-j1b-'))
const existing = new Set(unit.activity.items.map((item) => norm(item.term)))
for (const [term] of rows) { if (existing.has(norm(term))) throw new Error(`Duplicate daily term: ${term}`); existing.add(norm(term)) }
unit.activity.items.push(...rows.map(([term, meaningZh, partOfSpeech], index) => ({
  id: `r17-daily-j1b-${String(index + 1).padStart(3, '0')}`, term, meaningZh, partOfSpeech,
  exampleEn: term, exampleZh: meaningZh, growthDifficultyLevel: 3.5,
  dailyKnowledgeId: `daily-knowledge-v1:j1b:${String(index + 1).padStart(3, '0')}`,
})))
fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`)
