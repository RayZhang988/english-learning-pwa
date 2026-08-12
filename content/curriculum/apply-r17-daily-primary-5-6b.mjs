import fs from 'node:fs'
const path='content/lessons/survival-travel-american-4w/week-1.v1.json'
const doc=JSON.parse(fs.readFileSync(path,'utf8'))
const unit=doc.lessons.flatMap(x=>x.learningUnits).find(x=>x.learningUnitId==='st4w-w1d4-vocabulary')
if(!unit) throw new Error('host missing')
const rows=[
['Could you confirm whether the delay qualifies for compensation?','您能确认这次延误是否符合赔偿条件吗？','request'],
['I need to change my connection because the first flight arrived late.','因为第一班航班晚到，我需要更改转机安排。','statement'],
['Could you place me on the waitlist for the earlier departure?','您能把我列入更早出发航班的候补名单吗？','request'],
['I would accept a connection if it arrives before midnight.','如果能在午夜前到达，我可以接受转机。','preference'],
['Could you explain which expenses the airline will reimburse?','您能解释航空公司会报销哪些费用吗？','request'],
['I need a hotel voucher because the next flight is tomorrow.','因为下一班航班是明天，我需要酒店券。','statement'],
['Could you update the contact number on my baggage claim?','您能更新我行李申报单上的联系电话吗？','request'],
['I need to know whether the bag will be delivered to my next hotel.','我需要知道行李是否会送到我的下一家酒店。','statement'],
['Could you arrange a room away from the ice machine?','您能安排远离制冰机的房间吗？','request'],
['I would prefer to keep the same room for the entire stay.','我更希望整个住宿期间住同一间房。','preference'],
['Could you explain why the authorization hold is still on my card?','您能解释为什么预授权仍在我的卡上吗？','request'],
['I need an itemized bill before I submit my expense report.','提交费用报告前我需要明细账单。','statement'],
['Could you store this package until I return this evening?','我今晚回来前您能保管这个包裹吗？','request'],
['I need to know whether late checkout depends on availability.','我需要知道延迟退房是否取决于房间情况。','statement'],
['Could you ask the kitchen to prepare the meal separately?','您能请厨房单独准备这份餐吗？','request'],
['I would like to replace the side dish with a salad.','我想把配菜换成沙拉。','request'],
['Could you clarify whether the soup is made with chicken stock?','您能说明这道汤是否用鸡汤做的吗？','request'],
['The server did not mention the extra charge.','服务员没有说明额外收费。','complaint'],
['Could you remove the charge for the item that never arrived?','您能移除一直没有送到的商品费用吗？','request'],
['I need to know if the restaurant can accommodate a large group.','我需要知道餐厅能否接待大团体。','statement'],
['Could you reserve a table near the entrance for my grandfather?','您能为我祖父预留靠近入口的桌子吗？','request'],
['I would rather take the subway if traffic is heavy.','如果交通拥堵，我宁愿坐地铁。','preference'],
['Could you tell me whether the station has a staffed information desk?','您能告诉我车站是否有人工咨询台吗？','request'],
['I need to know if the last bus stops at my hotel.','我需要知道末班公交是否在我的酒店停靠。','statement'],
['Could you arrange a car seat for the child in our group?','您能为我们团体中的儿童安排安全座椅吗？','request'],
['I need the driver to wait because my companion is delayed.','因为同伴延误，我需要司机等候。','statement'],
['Could you explain whether the toll is included in the quoted price?','您能解释报价是否包含通行费吗？','request'],
['I would like a route that avoids narrow roads.','我想走一条避开狭窄道路的路线。','preference'],
['Could you tell me whether this attraction requires timed entry?','您能告诉我这个景点是否需要预约时段入场吗？','request'],
['I need to change the reservation because our group size changed.','因为团体人数变了，我需要更改预订。','statement'],
['Could you explain the cancellation terms before I book?','预订前您能解释取消条款吗？','request'],
['I would prefer an activity that does not require a lot of walking.','我更希望参加不需要走很多路的活动。','preference'],
['Could you tell me where we should meet if the tour is canceled?','如果旅行团取消，您能告诉我们应该在哪里集合吗？','request'],
['I need a receipt that separates the service fee from the ticket price.','我需要一张把服务费和票价分开的收据。','statement'],
['Could you check whether this item is covered by the warranty?','您能确认这个商品是否在保修范围内吗？','request'],
['I would like to exchange this for a model that uses less power.','我想换成耗电更少的型号。','request'],
['Could you explain why the refund has not appeared yet?','您能解释为什么退款还没到账吗？','request'],
['I need to know whether the store can ship this to my hotel.','我需要知道商店能否把这个寄到酒店。','statement'],
['Could you contact the pharmacy to see if they have this medication?','您能联系药店看看他们是否有这种药吗？','request'],
['I need to confirm whether I can take this medicine before driving.','我需要确认开车前能否服用这个药。','statement'],
['Could you explain what information the doctor needs from my insurance card?','您能解释医生需要我保险卡上的哪些信息吗？','request'],
['I would prefer an appointment later in the day if possible.','如果可以，我更想约在当天晚些时候。','preference'],
['Could you help me find urgent care that is open now?','您能帮我找一家现在营业的急诊诊所吗？','request'],
['I need to report that my luggage was searched without me present.','我需要报告我的行李在我不在场时被检查过。','statement'],
['Could you tell me which documents are required for a replacement passport?','您能告诉我补办护照需要哪些文件吗？','request'],
['I need to ask the hotel to keep my mail until I return.','我需要请酒店保留邮件直到我回来。','statement'],
['Could you send a backup copy of the confirmation to another email?','您能把确认信息的备份发到另一个邮箱吗？','request'],
['I would prefer a data plan with no automatic renewal.','我更想要不会自动续费的流量套餐。','preference'],
['Could you explain what happens if I exceed the data limit?','您能解释超过流量上限后会怎样吗？','request'],
['I need to know whether the public Wi-Fi requires a password.','我需要知道公共无线网络是否需要密码。','statement'],
['Could you help me contact the host because I cannot enter the apartment?','我无法进入公寓，您能帮我联系房东吗？','request'],
['I need to confirm whether the address is correct before I send the package.','寄包裹前我需要确认地址是否正确。','statement'],
['Could you provide directions that a taxi driver can follow easily?','您能提供出租车司机容易遵循的路线吗？','request'],
['I would rather wait indoors until the weather improves.','天气好转前我宁愿在室内等候。','preference'],
['Could you explain the rule about bringing water into the venue?','您能解释携带水进入场馆的规定吗？','request'],
['I need to know whom to call if the shuttle does not arrive.','我需要知道接驳车没来时该打给谁。','statement']
]
if(rows.length!==56) throw new Error(`Expected 56 rows, got ${rows.length}`)
const norm=v=>v.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()
unit.activity.items=unit.activity.items.filter(x=>!x.id.startsWith('r17-daily-p5b-'))
const existing=new Set(unit.activity.items.map(x=>norm(x.term)))
for(const [term] of rows){if(existing.has(norm(term)))throw new Error(`Duplicate daily term: ${term}`);existing.add(norm(term))}
unit.activity.items.push(...rows.map(([term,meaningZh,partOfSpeech],i)=>({id:`r17-daily-p5b-${String(i+1).padStart(3,'0')}`,term,meaningZh,partOfSpeech,exampleEn:term,exampleZh:meaningZh,growthDifficultyLevel:2.5,dailyKnowledgeId:`daily-knowledge-v1:p5b:${String(i+1).padStart(3,'0')}`})))
fs.writeFileSync(path,`${JSON.stringify(doc,null,2)}\n`)
