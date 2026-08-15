import fs from 'node:fs'

const writeMode = process.argv.includes('--write')
const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'))
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
const normalizeZh = (value) => value.trim().replace(/\s+/g, '')
function fingerprint(value) { let hash = 0x811c9dc5; for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 0x01000193) } return (hash >>> 0).toString(16).padStart(8, '0') }
const pair = (line) => { const [term, meaningZh] = line.split('|'); return { term, meaningZh } }

const groups = {
  'complex-rebooking-disruption': [
    'Will my checked bag follow me onto the later flight automatically?|如果我改乘晚班航班，托运行李会自动跟过去吗？',
    'What route gives me the safest connection without another overnight stop?|哪条路线衔接最稳妥，而且不会增加一次过夜停留？',
    'Please check the final train schedule prior to rebooking me.|给我改签前，请确认末班火车届时是否仍在运行。',
    'The new arrival time leaves only twenty minutes for immigration and security.|新的到达时间只给我二十分钟办理入境和安检。',
    'Can you protect tomorrow’s seat during my review of tonight’s alternative?|我比较今晚的替代方案时，能先保留明天的座位吗？',
    'I can accept the detour provided my onward ticket remains valid.|只要后续车票仍然有效，我可以接受绕行。',
    'Would changing airports make me responsible for the transfer cost?|更换机场后，转场费用需要由我承担吗？',
    'Please recheck the connection due to the first flight’s current delay.|请重新检查衔接安排，因为第一段航班已经延误。',
    'What backup have you arranged for another service cancellation?|如果这班也取消，你们安排了什么备用方案？',
    'The replacement reaches my destination sooner but separates me from my luggage.|替代路线更早到达，却会让我与行李分开。',
    'Could you keep both segments together so another delay does not break the booking?|能否把两段行程保留在同一预订中，避免再次延误时断开？',
    'Does accepting this route remove my refund option?|我需要知道接受这条路线后是否会失去退款选择。',
    'Can the operational delay justify waiving the change fee?|既然延误属于运营原因，可以免除改签费吗？',
    'The proposed arrival misses my hotel’s midnight check-in deadline.|酒店午夜停止办理入住，因此建议的到达时间太晚。',
    'Please confirm my assistance contact during the six-hour overnight connection.|请确认六小时过夜转机期间由谁为我提供协助。',
    'Can the unused rail segment be refunded separately from the replacement flight?|未使用的火车段能否与替代航班分开退款？',
    'I would rather travel tomorrow than risk missing two connections tonight.|我宁愿明天出发，也不想冒今晚错过两次衔接的风险。',
    'Does this rebooking preserve the assistance already attached to my reservation?|这次改签会保留预订中已有的协助服务吗？',
    'The alternative works only with my companion on the same service.|只有同行人也改到同一班次，这个替代方案才可行。',
    'Whom should I contact about a replacement bus missing the terminal?|如果替代巴士没有到达航站楼，我该联系谁？',
    'Please show me the complete journey prior to cancelling my original seats.|取消原座位前，请先向我展示完整的新行程。',
    'Can you record my rejection due to the impossible connection?|能否注明我拒绝该路线是因为衔接时间根本不可行？',
    'Does rerouting through another country require a transit visa?|改道会经过另一个国家，我在那里需要过境签证吗？',
    'Will another first-leg change update the remaining segments together?|如果第一段再次变更，后续各段会一起更新吗？',
    'I need meal support during the wait instead of another travel voucher.|等待期间我需要餐食安排，而不是另一张旅行代金券。',
    'Could the airline send my revised itinerary prior to my departure?|我离开柜台前，航空公司能把修改后的行程发给我吗？',
    'This flight arrives after public transport stops and increases my total cost.|提供的航班在公共交通停运后降落，会增加我的总费用。',
    'Would the morning departure include accommodation for tonight’s forced stay?|改乘早班航班是否包含今晚被迫滞留的住宿？',
    'Please compare actual arrival times including every airport transfer.|请把每次机场转场算进去后，再比较实际到达时间。',
    'The connection requires prior confirmation of the mobility service.|除非先确认无障碍协助，否则我无法使用这次衔接。',
    'How would an outbound-only change affect my return journey?|如果只更改去程票，我的返程行程会怎样？',
    'Could you mark the rebooking as involuntary so my benefits remain protected?|能否把这次改签标为非自愿，以保留我的权益？',
    'The more expensive direct flight avoids two unreliable connections.|虽然直飞更贵，但可以避开两次不可靠的衔接。',
    'I need enough time to collect and recheck my baggage between airports.|我需要足够时间在两个机场之间提取并重新托运行李。',
    'Please explain the consequences of another missed connection on this route.|如果我保留这条路线，请说明再次误接会有什么后果。',
    'Can one agent confirm every segment instead of sending me between counters?|能否由一名工作人员确认所有行程段，而不是让我在柜台间奔波？',
    'The workable schedule comes with a different baggage allowance.|时间安排可行，但新票显示的行李额度不同。',
    'Please record the reason, selected alternative, and claimable costs.|请记录原因、选定的替代方案以及我需要索赔的费用。',
    'Will an impossible protected connection trigger an alert?|如果受保障的衔接变得不可行，我会收到提醒吗？',
    'A useful same-day reroute requires transfer of all confirmed services.|只有所有已确认服务都随之转移，当日改道才有用。',
  ].map(pair),
  'accommodation-dispute-alternative': [
    'What rate reduction applies to the smaller substitute room?|替代房间更小，因此房价的哪一部分会减免？',
    'I can move tonight with staff luggage transfer and breakfast included.|如果员工帮我转运行李并保留早餐，我今晚可以换房。',
    'The room remains unsuitable for sleep despite the noise stopping.|虽然噪音停了，我仍需要一间能睡觉的房间。',
    'Would accepting one free night prevent me claiming the other unusable nights?|接受一晚免费住宿会妨碍我申请其他无法入住夜晚的赔偿吗？',
    'Please inspect the damp wall prior to offering another room here.|再提供本层其他房间前，请先检查这面潮湿的墙。',
    'Losing the promised kitchen significantly increases my food costs.|公寓没有承诺的厨房，这会显著增加我的餐饮费用。',
    'Can the hotel arrange equivalent accessible accommodation nearby at the confirmed price?|酒店能否按确认价格在附近安排同等无障碍住宿？',
    'The broken lock remains unsecured despite my report yesterday.|我昨天报告了门锁损坏，但至今没人确保房间安全。',
    'How are unused nights calculated for an immediate checkout?|如果我现在退房，未入住夜晚的费用如何计算？',
    'Who covers the farther hotel’s daily transport difference?|建议的酒店更远，额外的每日交通费用由谁承担？',
    'Please keep my current room until I have inspected the replacement myself.|在我亲自查看替代房间前，请保留当前房间。',
    'The unavailable lift makes this upper-floor room unsuitable for my needs.|由于电梯停用，这间高层房间不符合我的需求。',
    'Could you confirm whether the relocation includes taxes, breakfast, and late arrival?|能否确认搬迁安排包含税费、早餐和晚到入住？',
    'I need a written breakdown separating the room refund from incidental charges.|我需要一份书面明细，将房费退款与杂费分开。',
    'The replacement has two beds, but we booked connecting rooms for childcare.|替代房有两张床，但我们因照看孩子预订的是连通房。',
    'What can you offer while maintenance checks whether the water is safe?|维修人员检查用水是否安全期间，你们能提供什么安排？',
    'I will accept the downgrade only if the price difference is refunded immediately.|只有立即退还差价，我才接受降级房型。',
    'Can you arrange secure storage while I wait for the new room?|等待新房间期间，能否安排安全的行李寄存？',
    'The listing showed step-free access, yet every entrance has several stairs.|房源页面标注无台阶通道，但每个入口都有几级楼梯。',
    'Please explain why the confirmed late checkout disappeared after my arrival.|请说明为何我抵达后，已确认的延迟退房不见了。',
    'If repairs continue tomorrow, I need a definite relocation time tonight.|如果明天继续维修，我今晚就需要明确的搬迁时间。',
    'A voucher for a future stay does not cover tonight’s unusable room.|未来住宿券无法补偿今晚无法使用的房间。',
    'Could the manager approve a comparable suite instead of splitting our family?|经理能否批准同等套房，避免把我们一家分开？',
    'I need confirmation that moving rooms will not create a second deposit.|我需要确认换房不会产生第二笔押金。',
    'The heating fails every evening, despite three visits from maintenance staff.|尽管维修人员来过三次，暖气每晚仍然失灵。',
    'Before I leave, please photograph the damage that existed when I arrived.|我离开前，请拍下我入住时已经存在的损坏。',
    'Who will reimburse the taxi if the alternative property cannot provide transport?|如果替代住宿无法提供交通，出租车费由谁报销？',
    'The offered room is smoke-free, but smoke still enters through the ventilation.|提供的是无烟房，但烟味仍通过通风系统进入。',
    'Can you preserve our original checkout date after transferring the reservation?|转移预订后，能否保留原来的退房日期？',
    'I cannot wait indefinitely; please give me a decision by ten tonight.|我不能无限等待，请在今晚十点前给出决定。',
    'Would a partial refund still allow the hotel to fix the issue tomorrow?|部分退款后，酒店明天仍会处理这个问题吗？',
    'Please note that the replacement key also failed at the room door.|请记录替换后的房卡在房门处也无法使用。',
    'Since the room was double-booked, I should not pay a cancellation charge.|由于房间被重复预订，我不应支付取消费用。',
    'The alternative property accepts pets, but does it honor our cleaning agreement?|替代住宿允许宠物，但会遵守我们的清洁约定吗？',
    'Can the unused minibar charge be removed before you release my deposit?|退还押金前，能否删除这笔未使用的迷你吧费用？',
    'I need the complaint number in case the promised refund does not arrive.|我需要投诉编号，以防承诺的退款没有到账。',
    'Moving twice would disrupt my treatment, so I need one stable solution.|搬两次会影响我的治疗，因此我需要一个稳定方案。',
    'Please confirm the replacement address before my airport transfer is redirected.|改派机场接送前，请确认替代住宿的地址。',
    'If no equivalent room exists, what combination of refund and support is available?|如果没有同等房间，可以提供怎样的退款与协助组合？',
    'I can leave the property once you confirm where my refund will be sent.|只要确认退款会汇到哪里，我就可以离开这处住宿。',
  ].map(pair),
  'transport-connection-safety': [
    'The last ferry arrives after dark; is transport available from the remote pier?|末班渡轮天黑后抵达，偏远码头还有交通工具吗？',
    'If the mountain road closes, where will the coach leave passengers safely?|如果山路封闭，长途车会在哪里安全放下乘客？',
    'This connection requires crossing six lanes with luggage in twelve minutes.|这次衔接要求我拖着行李在十二分钟内穿过六条车道。',
    'Can you confirm the driver is licensed for the overnight border route?|能否确认司机具备夜间跨境路线的驾驶资质？',
    'The replacement bus has no seat belts, so I need another option.|替代巴士没有安全带，因此我需要其他选择。',
    'Who monitors the transfer when separate companies operate each segment?|不同公司分别运营各段时，由谁监督转乘衔接？',
    'Please avoid routing me through a station that closes before my arrival.|请不要安排我经过一个在我抵达前就关闭的车站。',
    'Although the route is faster, the walking section is unsafe after midnight.|虽然这条路线更快，但午夜后的步行路段不安全。',
    'Would missing the reserved shuttle invalidate the rest of my ticket?|错过预订的接驳车会使剩余车票失效吗？',
    'I need a staffed meeting point because the terminal signs are unclear.|我需要有人值守的集合点，因为航站楼标识不清。',
    'Can the operator hold the connection when this train arrives late?|这班火车晚点时，运营方能否等待衔接乘客？',
    'The platform change leaves no accessible route between the two services.|站台变更后，两班交通之间没有无障碍路线。',
    'Please tell the next driver that my child requires an approved safety seat.|请告知下一位司机，我的孩子需要合规安全座椅。',
    'If severe weather returns, which shelter should passengers use while waiting?|如果恶劣天气再次出现，乘客等待时应使用哪个避难处？',
    'The app suggests an unofficial taxi; how can I verify the vehicle?|应用推荐了一辆非官方出租车，我怎样核实车辆？',
    'Could you move my reservation to a daylight departure without a penalty?|能否免费把我的预订改到白天出发？',
    'I cannot carry this wheelchair upstairs during the emergency platform closure.|紧急关闭站台期间，我无法把轮椅搬上楼。',
    'Where will assistance meet me if the arrival gate changes again?|如果到达口再次变更，协助人员会在哪里接我？',
    'The driver ended the trip early, leaving us beside an unlit road.|司机提前结束行程，把我们留在没有照明的路边。',
    'Before departure, please confirm the boat has enough life jackets for everyone.|出发前，请确认船上有足够所有人使用的救生衣。',
    'Does the through ticket protect us if border checks delay the connection?|如果边检耽误衔接，联程票是否为我们提供保障？',
    'I need the exact pickup side, not only the street name.|我需要准确的上车一侧，而不只是街道名称。',
    'Can station staff escort me through the construction area to platform nine?|车站工作人员能否护送我穿过施工区到九号站台？',
    'The rental car warning light appeared; should I stop driving immediately?|租车的警示灯亮了，我是否应立即停止驾驶？',
    'If I return the unsafe vehicle here, how will you continue my journey?|如果我在这里退还不安全的车辆，你们如何让我继续行程？',
    'Please record that the helmet provided was damaged before the tour began.|请记录旅行开始前，提供的头盔已经损坏。',
    'A shorter transfer is useless unless the baggage route is also confirmed.|除非行李路线也得到确认，否则更短的转乘没有意义。',
    'Who is responsible for checking passengers after the unplanned roadside stop?|临时路边停车后，由谁负责清点乘客？',
    'The night train compartment will not lock from inside as promised.|夜班火车包厢无法像承诺的那样从内部上锁。',
    'Can you separate my booking from the route affected by the strike?|能否把我的预订从受罢工影响的路线中分离出来？',
    'If the cable car stops, what evacuation support is available for children?|如果缆车停运，可以为儿童提供什么疏散协助？',
    'Please confirm whether the replacement driver knows the agreed accessible entrance.|请确认替代司机知道约定的无障碍入口。',
    'The connection is technically possible, but only by running across the terminal.|这次衔接理论上可行，但必须跑着穿过航站楼。',
    'Would waiting for the escorted route cause my ticket to expire?|等待有人护送的路线会导致我的车票过期吗？',
    'I need a safe alternative because flooding has covered the pedestrian tunnel.|我需要安全替代路线，因为积水已经淹没步行隧道。',
    'Can dispatch track the vehicle while it travels through this isolated area?|车辆穿过这片偏僻区域时，调度中心能否追踪它？',
    'The transfer point changed without notice, and several passengers are missing.|换乘点未经通知就改变了，还有几名乘客没有到。',
    'Please arrange onward transport before closing this station for the night.|车站夜间关闭前，请安排好后续交通。',
    'If the operator refuses boarding, which company must provide the alternative?|如果运营方拒绝登乘，应由哪家公司提供替代安排？',
    'I will take the slower route because it has staffed connections throughout.|我会选择较慢的路线，因为全程衔接点都有人值守。',
  ].map(pair),
  'medical-medication-insurance': [
    'Before changing this medicine, could you check how it interacts with my regular prescription?|更换这种药之前，能否确认它与我长期服用的处方药如何相互作用？',
    'If the fever rises overnight, which symptoms mean I should return immediately?|如果夜间发烧加重，出现哪些症状意味着我应立即回来？',
    'My insurer requires prior approval, but the clinic says treatment cannot wait.|我的保险公司要求事先批准，但诊所说治疗不能等待。',
    'Can the doctor explain whether flying tomorrow would make the condition worse?|医生能否说明明天乘飞机是否会使病情恶化？',
    'I need an alternative without the ingredient responsible for my last reaction.|我需要一种不含上次引起过敏反应成分的替代药物。',
    'Please record when the first dose was given and what reaction followed.|请记录第一次给药的时间以及随后出现的反应。',
    'The pharmacy has a different brand; how can we confirm the strength is equivalent?|药店只有另一个品牌，我们怎样确认剂量强度相同？',
    'If I start this treatment here, who will monitor me after I travel onward?|如果我在这里开始治疗，继续旅行后由谁监测我的情况？',
    'Could you separate the consultation charge from the tests for my insurance claim?|能否把问诊费与检查费分开列出，供我申请保险理赔？',
    'I can manage the pain, but the numbness is spreading farther up my arm.|疼痛我还能忍受，但麻木正在沿手臂向上扩散。',
    'Does this prescription need refrigeration during the twelve-hour journey?|这张处方中的药物在十二小时行程中需要冷藏吗？',
    'Please confirm whether I should stop the old medicine before taking the new one.|请确认服用新药前是否应该停用原来的药。',
    'The discharge note lists a test I never received; can you correct the record?|出院记录列出了一项我从未做过的检查，能否更正？',
    'What follow-up is necessary if the swelling improves but does not disappear?|如果肿胀有所缓解但没有消失，需要进行什么复查？',
    'My policy covers emergencies abroad, so why was this visit classified as routine?|我的保单承保境外急诊，为何这次就诊被归为普通门诊？',
    'Can you write the generic drug name in case this brand is unavailable later?|能否写出药物通用名，以防之后买不到这个品牌？',
    'I need enough medication to cover the delay without exceeding the safe dose.|我需要足够的药物应对行程延误，但不能超过安全剂量。',
    'If these tablets cause dizziness, should I avoid driving or stop them completely?|如果这些药片引起头晕，我应避免驾驶还是完全停药？',
    'Please send the scan results to the hospital that will continue my care.|请把扫描结果发送给将继续为我治疗的医院。',
    'The wound looks cleaner, but the redness has moved beyond the marked line.|伤口看起来更干净了，但红肿已经越过标记线。',
    'Would waiting until morning change the treatment options available to me?|等到早上会不会影响我可选择的治疗方案？',
    'Can the clinic provide a translator before I consent to the procedure?|在我同意操作前，诊所能否提供翻译？',
    'I was charged for an ambulance although the hotel arranged ordinary transport.|账单收取了救护车费用，但酒店安排的只是普通车辆。',
    'Which part of this treatment is essential now, and which can wait until home?|这项治疗中哪些现在必须进行，哪些可以等回国后再做？',
    'Please note my allergy on every page before another department treats me.|在另一个科室为我治疗前，请在每页记录上注明我的过敏情况。',
    'If the insurer refuses direct billing, what documents should I collect today?|如果保险公司拒绝直接结算，我今天应该收集哪些文件？',
    'The dosage instructions differ between the label and the doctor’s note.|药品标签与医生记录上的剂量说明不一致。',
    'Could this medication affect the altitude symptoms I am already experiencing?|这种药会不会影响我已经出现的高原反应症状？',
    'I need written clearance if you believe continuing the tour is medically safe.|如果你认为继续行程在医学上安全，我需要书面许可。',
    'Who should receive the laboratory invoice when the insurer has two claim numbers?|保险公司给了两个理赔编号，化验账单应该提交给谁？',
    'My symptoms improved after treatment, then returned more strongly this afternoon.|治疗后症状有所改善，但今天下午又更严重地出现了。',
    'Can you explain the risk of delaying this procedure until I return home?|能否说明把这项操作推迟到回国后进行有什么风险？',
    'The replacement inhaler feels different; please show me the correct technique.|替代吸入器用起来不同，请示范正确的使用方法。',
    'I need the diagnosis code to match the condition described in the medical report.|我需要诊断代码与医疗报告中描述的病情一致。',
    'How should I safely adjust the next dose after missing one in transit?|如果转乘途中漏服一次，下一次应如何安全调整？',
    'Please confirm that this clinic can manage a severe reaction before giving the injection.|注射前，请确认这家诊所有能力处理严重反应。',
    'The insurer approved the scan, but not the contrast material required for it.|保险公司批准了扫描，却没有批准检查所需的造影剂。',
    'Could you provide both the original report and an English summary for follow-up?|能否提供原始报告和英文摘要，供后续治疗使用？',
    'I will postpone the excursion if rest today reduces the chance of complications.|如果今天休息能降低并发症风险，我会推迟游览。',
    'Before discharge, please identify the nearest facility that can handle a relapse.|出院前，请指出最近能够处理病情复发的医疗机构。',
  ].map(pair),
  'payment-document-tracing': [
    'The refund shows as completed here, but my bank cannot trace the reference number.|这里显示退款已完成，但我的银行无法追踪该参考号。',
    'Please separate the cancelled service from the charges I actually used.|请把已取消的服务与我实际使用的费用分开列出。',
    'If the deposit was released, which date and currency should appear on my statement?|如果押金已解冻，账单上应显示哪个日期和币种？',
    'The total is correct despite two tax amounts appearing under wrong items.|收据总额正确，但两笔税费被列在了错误项目下。',
    'Can you trace the second payment before asking me to pay the balance again?|让我再次支付余额前，能否先追踪第二笔付款？',
    'I need proof of authorization cancellation rather than only booking cancellation.|我需要证明商户取消了预授权，而不只是取消了预订。',
    'Which exchange rate was applied when the original charge was partly refunded?|原始扣款部分退款时采用了哪一个汇率？',
    'Please link this credit note to the invoice it is meant to correct.|请把这张贷项通知单关联到它要更正的发票。',
    'The card was charged after checkout, so I need the time-stamped supporting record.|退房后银行卡又被扣款，因此我需要带时间戳的支持记录。',
    'If the transfer failed, when will the reserved funds become available again?|如果转账失败，预留资金何时会重新可用？',
    'Could you issue one document showing the original amount, adjustment, and final balance?|能否出具一份同时显示原金额、调整额和最终余额的文件？',
    'My bank recognizes the charge, but the merchant name does not match this property.|我的银行识别到这笔扣款，但商户名称与这家住宿不符。',
    'Please confirm whether the refund returns to the old card or the replacement card.|请确认退款会退回旧卡还是补发的新卡。',
    'The cash receipt has no booking number, making the payment impossible to match.|现金收据没有预订编号，导致无法匹配这笔付款。',
    'Who can correct the passenger name without changing the invoice date?|谁能在不改变发票日期的情况下更正乘客姓名？',
    'I paid in local currency, yet the terminal receipt records a converted amount.|我用当地货币支付，但终端收据记录的是换算后的金额。',
    'Can the agency explain why its invoice and the airline receipt differ?|代理机构能否解释为何其发票与航空公司收据金额不同？',
    'Please record the dispute number before the temporary credit expires.|临时退款额度到期前，请记录争议编号。',
    'The refund covers the ticket but omits the seat and baggage fees.|退款包含票款，却遗漏了选座费和行李费。',
    'If you cannot reverse the duplicate charge today, what tracking evidence can you provide?|如果今天无法撤销重复扣款，你们能提供什么追踪凭证？',
    'The final invoice must show the applied deposit rather than a separate refund.|我需要最终发票显示押金已抵扣，而不是单独退款。',
    'The payment link expired after authorization; did any charge still reach you?|付款链接在授权后失效，是否仍有款项到达你们账户？',
    'Could you identify which company collected each part of this combined booking?|能否说明这个组合预订的每一部分分别由哪家公司收款？',
    'My statement shows three small charges before the main transaction.|我的账单在主要交易前显示了三笔小额扣款。',
    'Please provide the cancellation timestamp because the fee depends on that exact time.|请提供取消操作的时间戳，因为费用取决于那个确切时间。',
    'The voucher reduced the price, but the receipt still shows the unreduced taxable total.|代金券降低了价格，但收据仍显示未减免的应税总额。',
    'Can you resend the document with an itemized breakdown instead of one combined line?|能否重新发送逐项明细，而不是只列一个合计项目？',
    'I need confirmation that the chargeback will not cancel the service already delivered.|我需要确认拒付不会取消已经提供的服务。',
    'Which reference should my bank quote when contacting your payment processor?|我的银行联系你们的支付处理机构时应引用哪个编号？',
    'The receipt was reissued, but the original incorrect version remains in my account.|收据已重新开具，但账户中仍保留着原来的错误版本。',
    'If the merchant settles in another currency, who absorbs the conversion difference?|如果商户用另一种货币结算，汇率差额由谁承担？',
    'Please show how the partial cancellation changed each traveler’s share of the total.|请说明部分取消后，每位旅客分摊的总额如何变化。',
    'The tax refund desk kept my form; how can I track the submission now?|退税柜台收走了我的表格，我现在怎样追踪申请？',
    'Can you confirm delivery of the corrected invoice to me and the insurer?|能否确认更正后的发票已同时发送给我和保险公司？',
    'The security deposit and the damage charge use the same transaction description.|押金和损坏费用使用了相同的交易描述。',
    'I need a receipt for the amount retained, not only for the amount returned.|我需要被扣留金额的收据，而不只是退回金额的收据。',
    'Before closing the case, please verify that every promised refund has a traceable reference.|结案前，请核实每笔承诺退款都有可追踪的参考号。',
    'Splitting the invoice after payment made its totals differ from my statement.|付款后发票被拆分，导致总额与银行卡账单不再一致。',
    'Could you explain which document proves that the disputed charge was withdrawn?|能否说明哪份文件可以证明有争议的扣款已撤回？',
    'I will keep the case open until the corrected amount appears in my account.|在更正金额显示到我的账户之前，我会保持案件未结状态。',
  ].map(pair),
}

if (Object.values(groups).some((rows) => rows.length !== 40)) throw new Error('Every C3 topic must contain 40 reviewed rows.')

function released() {
  const index = read('content/curriculum/package-index.v1.json')
  return index.lessonFiles.flatMap((file) => read(file).lessons).flatMap((lesson) => lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary').flatMap((unit) => unit.activity.items.map((item) => ({ ...item, difficulty: item.growthDifficultyLevel ?? unit.difficultyLevel }))))
}

function author() {
  const earlier = ['daily-level-content-batch-a.v2.json', 'daily-level-content-batch-b.v2.json', 'daily-level-content-c1.v2.json', 'daily-level-content-c2.v2.json'].flatMap((file) => read(`content/curriculum/${file}`).records)
  const rows = Object.entries(groups).flatMap(([topic, entries]) => entries.map((row) => ({ ...row, topic })))
  if (rows.length !== 200) throw new Error(`C3 expected 200 rows, got ${rows.length}`)
  if (new Set([...earlier, ...rows].map((row) => normalize(row.term))).size !== 2600) throw new Error('C3 overlaps earlier levels.')
  const records = rows.map((row, index) => {
    const form = normalize(row.term)
    return {
      sourceItemId: `qa-r17-003-c3:${String(index + 1).padStart(3, '0')}`,
      dailyKnowledgeId: `daily-knowledge-v2:phrase:${fingerprint(`${form}|${normalizeZh(row.meaningZh)}`)}`,
      levelId: 'senior-3', labelZh: '高三', growthDifficultyLevel: 6,
      term: row.term, meaningZh: row.meaningZh, partOfSpeech: 'complex-utterance', exampleEn: row.term, exampleZh: row.meaningZh,
      authoring: { lexicalFrequencyBand: 'specialized', abstractionBand: 'abstract-risk-or-policy', surfaceType: 'complex-utterance', grammarFeatures: ['conditions-consequences-and-follow-up'], travelUse: 'complex-travel-resolution', topic: row.topic, contentReviewStatus: 'candidate-reviewed' },
    }
  })
  const old = released().filter((row) => row.difficulty === 6)
  const byContent = new Map(records.map((row) => [`${normalize(row.term)}|${normalizeZh(row.meaningZh)}`, row]))
  const entries = old.map((source) => {
    const target = byContent.get(`${normalize(source.term)}|${normalizeZh(source.meaningZh)}`)
    return target ? { sourceDailyKnowledgeId: source.dailyKnowledgeId ?? `legacy-daily-source-v1:${source.id}`, sourceItemId: source.id, disposition: 'equivalent', targetDailyKnowledgeId: target.dailyKnowledgeId, evidenceTransferAllowed: true } : { sourceDailyKnowledgeId: source.dailyKnowledgeId ?? `legacy-daily-source-v1:${source.id}`, sourceItemId: source.id, disposition: 'retired', evidenceTransferAllowed: false }
  })
  const mapped = new Set(entries.flatMap((entry) => entry.targetDailyKnowledgeId ? [entry.targetDailyKnowledgeId] : []))
  return {
    content: { schemaVersion: 1, documentType: 'daily-level-content-batch', contentVersion: '2.0.0-c3', identityVersion: 'daily-knowledge-v2', releaseStatus: 'candidate-not-deployable-until-c4-c5', levels: [{ id: 'senior-3', labelZh: '高三', recordCount: 200 }], records },
    migration: { schemaVersion: 1, documentType: 'daily-level-identity-migration', migrationVersion: 'daily-level-v1-to-v2-c3', releaseStatus: 'candidate', sourceIdentityVersion: 'daily-knowledge-v1', targetIdentityVersion: 'daily-knowledge-v2', sourceRecordCount: old.length, canonicalTargetCount: 200, entries, newIdentities: records.filter((row) => !mapped.has(row.dailyKnowledgeId)).map((row) => row.dailyKnowledgeId) },
  }
}

const { content, migration } = author()
for (const [path, value] of [['content/curriculum/daily-level-content-c3.v2.json', content], ['content/curriculum/daily-level-identity-migration-c3.v1.json', migration]]) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  if (writeMode) fs.writeFileSync(path, serialized)
  else if (fs.readFileSync(path, 'utf8') !== serialized) throw new Error(`${path} stale`)
}
console.log(`C3 authored: ${content.records.length}; retired ${migration.entries.filter((row) => row.disposition === 'retired').length}.`)
