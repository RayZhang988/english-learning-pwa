import fs from 'node:fs'

const file = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(file, 'utf8'))
const unit = document.lessons.flatMap((lesson) => lesson.learningUnits).find((item) => item.learningUnitId === 'st4w-w1d4-vocabulary')
const rows = `
I would like to file a formal complaint.|我想提交正式投诉。
Please give me a case number for this complaint.|请给我这次投诉的案件编号。
I need a written record of what happened.|我需要事情经过的书面记录。
Could you escalate this issue to a supervisor?|您能把这个问题升级给主管吗？
I do not agree with the proposed resolution.|我不同意所提的解决方案。
Please explain the basis for this decision.|请说明这个决定的依据。
I would like to challenge this charge.|我想对这笔收费提出异议。
Could you review the evidence I submitted?|您能审核我提交的证据吗？
I need an itemized explanation of the bill.|我需要账单的逐项说明。
This service did not match the advertised terms.|这项服务不符合宣传条款。
The promised service was not available.|承诺的服务无法提供。
I need compensation for the inconvenience.|我需要对不便的补偿。
Could you confirm the refund amount in writing?|您能书面确认退款金额吗？
Please tell me when the refund will be processed.|请告诉我退款何时处理。
I need to know why the refund was denied.|我需要知道退款为何被拒绝。
Can the cancellation fee be waived in this case?|这种情况下能免除取消费吗？
I would like to appeal the denied refund.|我想申诉被拒绝的退款。
Please send the cancellation terms by email.|请通过邮件发送取消条款。
I need proof that the reservation was canceled.|我需要预订已取消的证明。
Could you restore my original reservation?|您能恢复我的原始预订吗？
I need to change my itinerary because of the disruption.|我需要因中断而更改行程。
Could you reroute me through a different airport?|您能让我经由另一个机场改道吗？
I need to compare the available rebooking options.|我需要比较可用的改签选项。
Please confirm that my connection is still protected.|请确认我的衔接行程仍受保护。
I need overnight accommodation because of the delay.|我因延误需要过夜住宿。
Could you arrange ground transportation to the hotel?|您能安排去酒店的地面交通吗？
I need a meal voucher during this long delay.|长时间延误期间我需要餐券。
Please confirm the new departure time.|请确认新的出发时间。
I need to know whether my seat assignment will change.|我需要知道座位安排是否会改变。
Could you transfer my checked bag to the new flight?|您能把托运行李转到新航班吗？
I need to know where to collect my rebooked ticket.|我需要知道在哪里领取改签后的机票。
Please explain the consequences of missing this connection.|请说明错过这次衔接的后果。
I need a backup plan if the next flight is canceled.|如果下一班航班取消，我需要备用方案。
Could you confirm the deadline for changing this ticket?|您能确认更改这张机票的截止时间吗？
I need the airline to honor the original fare.|我需要航空公司履行原始票价。
My luggage was delayed at the transfer airport.|我的行李在中转机场延误了。
I need to report a missing suitcase.|我需要报告行李箱丢失。
Could you trace my bag using this reference number?|您能用这个参考编号追踪我的行李吗？
I need a delivery estimate for my luggage.|我需要行李送达时间的估算。
Please document the damage before I leave.|请在我离开前记录损坏情况。
I need reimbursement for essential replacement items.|我需要报销必要替代用品。
Could you explain the baggage liability limit?|您能说明行李责任限额吗？
I need a copy of the damage report.|我需要损坏报告的副本。
Please confirm which receipts I should keep.|请确认我应保留哪些收据。
My passport was lost while I was traveling.|我的护照在旅行期间丢失了。
I need to report a stolen wallet.|我需要报告钱包被盗。
Could you help me contact the local police?|您能帮我联系当地警方吗？
I need a police report for the insurance claim.|我需要警方报告用于保险理赔。
Please cancel the stolen payment card immediately.|请立即取消被盗的支付卡。
I need to replace my travel document urgently.|我需要紧急补办旅行证件。
Could you tell me where the nearest consulate is?|您能告诉我最近的领事馆在哪里吗？
I need a safe place to wait for assistance.|我需要一个安全的地方等待协助。
Please help me secure my remaining belongings.|请帮我保护剩余物品。
I need to know whether this area is safe at night.|我需要知道这个地区夜间是否安全。
Could you call emergency services for me?|您能帮我呼叫紧急服务吗？
I need medical help as soon as possible.|我需要尽快获得医疗帮助。
Please tell the doctor about my allergy.|请告诉医生我的过敏情况。
I have had these symptoms since yesterday.|我从昨天起就有这些症状。
I need to know whether this medicine has side effects.|我需要知道这种药是否有副作用。
Could you explain how often I should take this medicine?|您能说明我应多久服用一次这种药吗？
I need a generic alternative to this prescription.|我需要这张处方的通用替代药。
Please check whether this medicine interacts with mine.|请确认这种药是否与我的药物相互作用。
I need a written summary of the treatment.|我需要治疗的书面摘要。
Could you provide a medical certificate for my flight?|您能为我的航班提供医疗证明吗？
I need to postpone travel because I am unwell.|我因身体不适需要推迟旅行。
Please explain what my travel insurance covers.|请说明我的旅行保险涵盖什么。
I need to open an insurance claim.|我需要开立保险理赔。
Could you send me the claim form?|您能把理赔表发送给我吗？
I need to know which documents the insurer requires.|我需要知道保险公司需要哪些文件。
Please confirm whether this expense is covered.|请确认这项费用是否被承保。
I need an emergency advance from the insurer.|我需要保险公司的紧急预付款。
Could you explain the deductible for this claim?|您能说明这次理赔的免赔额吗？
I need to know how long the claim review takes.|我需要知道理赔审核需要多久。
Please keep this claim open while I gather records.|请在我收集记录期间保持该理赔开放。
I need written confirmation of the coverage decision.|我需要承保决定的书面确认。
Could you explain this policy exception?|您能说明这项政策例外吗？
I need to know whether the rule applies to my situation.|我需要知道该规则是否适用于我的情况。
Please show me the official policy language.|请向我展示官方政策条文。
I need an exception because of a medical emergency.|我因医疗紧急情况需要例外处理。
Could you ask a manager to approve an exception?|您能请经理批准一个例外吗？
I need to understand the local entry requirement.|我需要了解当地入境要求。
Please confirm whether this document is sufficient.|请确认这份文件是否足够。
I need to know whether a visa extension is possible.|我需要知道是否可以延长签证。
Could you explain the consequence of overstaying?|您能说明逾期停留的后果吗？
I need a receipt that shows the tax was paid.|我需要显示已缴税的收据。
My hotel room does not meet the booking standard.|我的酒店房间不符合预订标准。
I need to move to a comparable room.|我需要换到同等房间。
Could you explain why the room type changed?|您能说明房型为何改变吗？
I need compensation for the unusable facility.|我需要对无法使用的设施获得补偿。
Please send maintenance before the problem gets worse.|请在问题恶化前派维修人员来。
I need a written guarantee that the repair is safe.|我需要维修安全的书面保证。
Could you reduce the rate for the affected nights?|您能降低受影响夜晚的房价吗？
I need an alternative hotel if this cannot be fixed.|如果无法修复，我需要替代酒店。
Please confirm who will pay the relocation cost.|请确认谁将支付搬迁费用。
I need to dispute this additional hotel charge.|我需要对这笔额外酒店费用提出异议。
The rental car has a mechanical problem.|租车有机械故障。
I need roadside assistance at this location.|我需要在此地点获得道路救援。
Could you send a replacement vehicle?|您能派一辆替代车辆吗？
I need to document the condition of the car.|我需要记录车辆状况。
Please explain the damage waiver terms.|请说明损坏豁免条款。
I need to know whether towing is covered.|我需要知道拖车是否被承保。
Could you extend the rental because of the breakdown?|您能因车辆故障延长租期吗？
I need to report an accident to the rental company.|我需要向租车公司报告事故。
Please confirm the return location after the reroute.|请确认改道后的还车地点。
I need a safer route because of the road closure.|我因道路封闭需要更安全的路线。
This train was canceled without prior notice.|这趟火车在没有提前通知的情况下取消了。
I need to know whether my ticket is valid on another service.|我需要知道我的票是否可用于另一趟班次。
Could you arrange accessible transportation for us?|您能为我们安排无障碍交通吗？
I need to reserve space for a mobility device.|我需要为助行设备预留空间。
Please confirm the platform change in writing.|请书面确认站台变更。
I need help transferring between these stations.|我需要在这些车站之间换乘帮助。
Could you explain the fare adjustment?|您能说明票价调整吗？
I need to know whether the delay qualifies for compensation.|我需要知道延误是否符合补偿资格。
Please provide a route that avoids the closed line.|请提供避开封闭线路的路线。
I need to coordinate this change with my hotel.|我需要与酒店协调这项变更。
Could you hold the reservation until I arrive?|您能在我到达前保留预订吗？
I need to explain the situation to my travel companion.|我需要向旅伴解释情况。
Please send the revised itinerary to both of us.|请把修改后的行程发给我们两人。
I need to confirm the local time before booking.|我需要在预订前确认当地时间。
Could you schedule the transfer after my delayed arrival?|您能安排在我延误到达后接送吗？
I need to separate the bookings to reduce the risk.|我需要分开预订以降低风险。
Please confirm which part of the trip is refundable.|请确认行程的哪一部分可以退款。
I need an option that keeps my appointment.|我需要一个能保留预约的选择。
Could you explain the least expensive way to rebook?|您能说明最便宜的改签方式吗？
I need a copy of all revised confirmations.|我需要所有修改后确认文件的副本。
Please tell me what happens if the weather worsens.|请告诉我天气恶化会发生什么。
I need to know whether the evacuation order is mandatory.|我需要知道疏散令是否强制。
Could you identify the nearest official shelter?|您能说明最近的官方避难所吗？
I need assistance because I cannot travel alone.|我因无法独自旅行需要协助。
Please notify me if the security alert changes.|如果安全警报变化，请通知我。
I need to verify this warning with an official source.|我需要通过官方来源核实这个警告。
Could you explain the emergency procedure?|您能说明紧急程序吗？
I need to know where we can reunite after evacuation.|我需要知道疏散后我们在哪里会合。
Please keep my contact details confidential.|请对我的联系方式保密。
I need a translator for this official conversation.|我需要一名翻译协助这次正式谈话。
Could you repeat that in simpler language?|您能用更简单的语言重复一遍吗？
I need to clarify what I am agreeing to.|我需要澄清我同意的内容。
Please give me time to review the document.|请给我时间审阅文件。
I need to consult my insurer before I decide.|我需要在决定前咨询保险公司。
Could you put the offer in writing?|您能把该提议写下来吗？
I need to compare this option with the original booking.|我需要将这个选择与原预订比较。
Please confirm that no further charge will appear.|请确认不会再出现额外收费。
I need to know who can make the final decision.|我需要知道谁能作出最终决定。
Could you explain the next step if we cannot agree?|您能说明如果无法达成一致下一步是什么吗？
I need to request a reasonable accommodation.|我需要请求合理便利安排。
Please confirm that my dietary requirement was noted.|请确认已记录我的饮食要求。
I need a quiet place because of my medical condition.|我因健康状况需要安静的地方。
Could you arrange priority assistance at the airport?|您能在机场安排优先协助吗？
I need to travel with my medical equipment.|我需要携带医疗设备旅行。
Please explain the screening procedure for this device.|请说明这个设备的安检程序。
I need to know whether the battery is allowed on board.|我需要知道该电池是否允许带上飞机。
Could you provide assistance during the connection?|您能在转机期间提供协助吗？
I need written confirmation of the accessibility service.|我需要无障碍服务的书面确认。
This charge appears to be unauthorized.|这笔收费似乎未经授权。
I need to freeze my account until this is resolved.|我需要冻结账户直到问题解决。
Could you provide a fraud reference number?|您能提供欺诈参考编号吗？
I need to dispute a duplicate transaction.|我需要对重复交易提出异议。
Please confirm that my account is secure now.|请确认我的账户现在安全。
I need an alternative payment method immediately.|我需要立即使用替代付款方式。
Could you help me contact my bank from abroad?|您能帮我从国外联系银行吗？
I need a record of the exchange rate used.|我需要使用的汇率记录。
Please explain the foreign transaction fee.|请说明境外交易费。
I need to know whether cash withdrawal is safer here.|我需要知道在这里取现是否更安全。
Could you provide a receipt for the currency exchange?|您能提供货币兑换收据吗？
I need to report an error in the exchange amount.|我需要报告兑换金额错误。
Please help me resolve this before I depart.|请帮我在出发前解决这个问题。
I need to know whether I can extend my stay legally.|我需要知道是否可以合法延长停留。
Could you confirm the address for official correspondence?|您能确认正式通信地址吗？
I need a document that explains the delay.|我需要一份说明延误的文件。
Please tell me how to submit additional evidence.|请告诉我如何提交补充证据。
I need to preserve my right to make a claim.|我需要保留提出索赔的权利。
Could you confirm that this conversation is recorded?|您能确认这次谈话已被记录吗？
I need to know whether I should contact another agency.|我需要知道是否应联系另一个机构。
Please provide the official complaint channel.|请提供官方投诉渠道。
I need a clear timeline for the resolution.|我需要解决问题的明确时间表。
Could you explain why the deadline cannot be extended?|您能说明截止时间为何不能延长吗？
I need to know whether the policy changed recently.|我需要知道政策是否近期变更。
Please confirm that this exception applies to my booking.|请确认这项例外适用于我的预订。
I need to understand the risk before I accept this option.|我需要在接受这个选择前了解风险。
Could you offer a solution that avoids further disruption?|您能提供避免进一步中断的解决方案吗？
I need a contact person for follow-up.|我需要一名后续联系人员。
Please send me the outcome after the investigation.|调查结束后请把结果发给我。
I need to know whether I can seek independent advice.|我需要知道是否可以寻求独立建议。
Could you confirm the date and time of this decision?|您能确认这个决定的日期和时间吗？
I need all future updates in writing.|我需要今后的所有更新以书面形式发送。
Please explain how this decision affects my return trip.|请说明这个决定如何影响我的返程。
I need to make a plan before the next deadline.|我需要在下一个截止时间前制定计划。
Could you verify the terms with the service provider?|您能向服务方核实条款吗？
I need to know whether the local rule has an exception.|我需要知道当地规则是否有例外。
Please preserve the records related to this incident.|请保存与这次事件相关的记录。
I need a revised plan that accounts for the restriction.|我需要一份考虑该限制的修改计划。
Could you confirm the authority that issued this notice?|您能确认发布该通知的机构吗？
I need to know which option has the lowest risk.|我需要知道哪个选择风险最低。
Please explain the process for requesting a review.|请说明申请复核的流程。
I need to arrange support for the rest of the journey.|我需要为余下旅程安排支持。
Could you provide the policy reference number?|您能提供政策参考编号吗？
I need a written explanation before I make a decision.|我需要在作出决定前获得书面说明。`.trim().split('\n').map((line) => line.split('|'))

if (rows.length !== 197) throw new Error(`Expected 197 rows, got ${rows.length}`)
unit.activity.items = unit.activity.items.filter((item) => !item.id.startsWith('r17-daily-j3-'))
const normalized = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const seen = new Set(unit.activity.items.map((item) => normalized(item.term)))
for (const [term] of rows) { if (seen.has(normalized(term))) throw new Error(`Duplicate term: ${term}`); seen.add(normalized(term)) }
unit.activity.items.push(...rows.map(([term, meaningZh], index) => ({
  id: `r17-daily-j3-${String(index + 1).padStart(3, '0')}`,
  term, meaningZh, partOfSpeech: term.startsWith('Could') || term.startsWith('Please') ? 'request' : 'statement',
  exampleEn: term, exampleZh: meaningZh, growthDifficultyLevel: 4.5,
  dailyKnowledgeId: `daily-knowledge-v1:j3:${String(index + 1).padStart(3, '0')}`,
})))
fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`)
