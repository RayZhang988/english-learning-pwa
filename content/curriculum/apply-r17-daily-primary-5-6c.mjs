import fs from 'node:fs'
const path='content/lessons/survival-travel-american-4w/week-1.v1.json'
const doc=JSON.parse(fs.readFileSync(path,'utf8'))
const unit=doc.lessons.flatMap(x=>x.learningUnits).find(x=>x.learningUnitId==='st4w-w1d4-vocabulary')
if(!unit)throw new Error('host missing')
const rows=[
['Could you explain the difference between a refund and a travel credit?','您能解释退款和旅行抵用金的区别吗？','request'],
['I need to know whether the credit expires before I can use it.','我需要知道抵用金是否会在我使用前过期。','statement'],
['Could you reissue the ticket under the corrected name?','您能以更正后的姓名重新出票吗？','request'],
['I would prefer to keep the same itinerary if possible.','如果可以，我更希望保留相同行程。','preference'],
['Could you tell me which airport has the shorter transfer time?','您能告诉我哪个机场的转机时间更短吗？','request'],
['I need confirmation that my request was added to the reservation.','我需要确认我的请求已添加到预订中。','statement'],
['Could you explain why the luggage delivery estimate changed?','您能解释为什么行李递送预计时间变了吗？','request'],
['I need to know whether I can buy essentials while my bag is missing.','我需要知道行李丢失期间是否可以购买必需品。','statement'],
['Could you provide a written record of the baggage report?','您能提供行李报告的书面记录吗？','request'],
['I would accept a room change if you can move my luggage.','如果您能搬运行李，我可以接受换房。','preference'],
['Could you waive the charge because the room was not usable?','因为房间不能使用，您能免除收费吗？','request'],
['I need to know whether the hotel can hold my reservation after a flight delay.','我需要知道航班延误后酒店是否能保留我的预订。','statement'],
['Could you arrange transportation if the shuttle service has ended?','如果班车服务结束，您能安排交通吗？','request'],
['I would prefer breakfast to be packed because I leave early.','因为我早走，我更希望早餐打包。','preference'],
['Could you explain whether the room rate changes on the weekend?','您能解释周末房价是否会变化吗？','request'],
['I need a copy of the policy before I agree to the charge.','同意收费前我需要一份政策副本。','statement'],
['Could you ask the manager to review the incorrect charge?','您能请经理审核错误收费吗？','request'],
['The replacement meal still does not meet the allergy request.','更换的餐点仍不符合过敏要求。','complaint'],
['Could you tell me which dishes can be prepared without dairy?','您能告诉我哪些菜可以不含乳制品吗？','request'],
['I would like to choose a quieter table even if it takes longer.','即使需要等更久，我也想选安静一点的桌子。','preference'],
['Could you split the payment between cash and a card?','您能把付款分成现金和银行卡吗？','request'],
['I need to know whether a service charge is optional.','我需要知道服务费是否可选。','statement'],
['Could you explain why the reservation was canceled without notice?','您能解释为什么预订未经通知就被取消了吗？','request'],
['I need another option because the accessible entrance is closed.','因为无障碍入口关闭，我需要另一个选项。','statement'],
['Could you tell me whether the elevator is working at this station?','您能告诉我这个车站的电梯是否正常吗？','request'],
['I would rather change trains than wait for an hour.','我宁愿换乘火车，也不想等一个小时。','preference'],
['Could you confirm whether my transfer requires a new ticket?','您能确认我的换乘是否需要新票吗？','request'],
['I need to know how far the taxi stand is from this exit.','我需要知道出租车站离这个出口有多远。','statement'],
['Could you explain why the ride estimate increased?','您能解释为什么车费预估增加了吗？','request'],
['I would prefer a driver who can help with the stroller.','我更希望司机能帮忙搬婴儿车。','preference'],
['Could you change the pickup location to the main entrance?','您能把接车地点改到主入口吗？','request'],
['I need to know whether the ferry operates in bad weather.','我需要知道渡轮在恶劣天气下是否运营。','statement'],
['Could you tell me if there is a reduced price for a return ticket?','您能告诉我往返票是否有优惠价吗？','request'],
['I would choose the guided visit if it includes admission.','如果包含门票，我会选择导览参观。','preference'],
['Could you explain the rule about bringing a camera inside?','您能解释携带相机进入的规定吗？','request'],
['I need to know whether the exhibit is suitable for young children.','我需要知道展览是否适合幼儿。','statement'],
['Could you reserve a wheelchair for the tour?','您能为旅行团预留轮椅吗？','request'],
['I need an alternative date because the attraction is sold out.','因为景点售罄，我需要另一个日期。','statement'],
['Could you explain whether the ticket can be transferred to another person?','您能解释门票是否可以转给别人吗？','request'],
['I would prefer a store that can deliver the purchase to my hotel.','我更希望商店能把购买的商品送到酒店。','preference'],
['Could you check whether the price is the same online and in store?','您能确认线上和店内价格是否相同吗？','request'],
['I need to know what happens if the package arrives after I leave.','我需要知道包裹在我离开后到达会怎样。','statement'],
['Could you provide a receipt with the tax listed separately?','您能提供税费单列的收据吗？','request'],
['I need to ask whether the medication can be carried on the plane.','我需要询问药物是否可以带上飞机。','statement'],
['Could you explain how to get a refill while traveling?','您能解释旅行期间如何续配药吗？','request'],
['I would prefer a pharmacy that stays open late.','我更希望药店营业到较晚。','preference'],
['Could you help me describe the symptoms to the nurse?','您能帮我向护士描述症状吗？','request'],
['I need to know whether my insurance requires approval first.','我需要知道我的保险是否需要先批准。','statement'],
['Could you contact the clinic to confirm the appointment time?','您能联系诊所确认预约时间吗？','request'],
['I need a temporary phone number until my SIM card is replaced.','电话卡补发前我需要一个临时号码。','statement'],
['Could you explain whether this charger supports fast charging?','您能解释这个充电器是否支持快速充电吗？','request'],
['I would prefer a plan that lets me add data only when needed.','我更想要只在需要时加流量的套餐。','preference'],
['Could you reset the account after you verify my identity?','您核实身份后能重置账户吗？','request'],
['I need to know whether the building has an accessible restroom.','我需要知道这栋楼是否有无障碍洗手间。','statement'],
['Could you give me a landmark that I can share with the driver?','您能给我一个可以告诉司机的地标吗？','request'],
['I would rather meet somewhere indoors because of the heat.','因为天气炎热，我宁愿在室内见面。','preference'],
]
if(rows.length!==56)throw new Error(`Expected 56 rows, got ${rows.length}`)
const norm=v=>v.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()
unit.activity.items=unit.activity.items.filter(x=>!x.id.startsWith('r17-daily-p5c-'))
const existing=new Set(unit.activity.items.map(x=>norm(x.term)))
for(const [term] of rows){if(existing.has(norm(term)))throw new Error(`Duplicate daily term: ${term}`);existing.add(norm(term))}
unit.activity.items.push(...rows.map(([term,meaningZh,partOfSpeech],i)=>({id:`r17-daily-p5c-${String(i+1).padStart(3,'0')}`,term,meaningZh,partOfSpeech,exampleEn:term,exampleZh:meaningZh,growthDifficultyLevel:2.5,dailyKnowledgeId:`daily-knowledge-v1:p5c:${String(i+1).padStart(3,'0')}`})))
fs.writeFileSync(path,`${JSON.stringify(doc,null,2)}\n`)
