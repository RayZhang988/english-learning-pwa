import fs from 'node:fs'
const path = 'content/lessons/survival-travel-american-4w/week-1.v1.json'
const document = JSON.parse(fs.readFileSync(path, 'utf8'))
const unit = document.lessons[0].learningUnits.find((x) => x.learningUnitId === 'st4w-w1d1-vocabulary')
if (!unit) throw new Error('Missing daily vocabulary unit')
const rows = [
['where is the airline desk','航空公司柜台在哪里'],['can I check this bag','我能托运这个包吗'],['my boarding pass is missing','我的登机牌不见了'],['where is baggage claim','行李提取处在哪里'],['I need to change my flight','我需要改签航班'],['is this the departure gate','这是出发登机口吗'],['can you print my boarding pass','你能打印我的登机牌吗'],['my flight leaves tonight','我的航班今晚起飞'],['where can I charge my laptop','我在哪里能给电脑充电'],['is there a flight to Denver','有去丹佛的航班吗'],
['could you check my reservation','你能查一下我的预订吗'],['I need a room on a higher floor','我需要高一点楼层的房间'],['can I pay for the room now','我现在能付房费吗'],['the light in my room is broken','我房间的灯坏了'],['could you bring some soap','你能拿一些肥皂来吗'],['is there a laundry service','有洗衣服务吗'],['my room has no hot water','我的房间没有热水'],['can you call a doctor','你能叫医生吗'],['where can I leave my bags','我能把包放在哪里'],['I need an extra blanket','我需要一条额外毛毯'],
['which platform is for this train','这趟火车是哪个站台'],['can I transfer at the next stop','我能在下一站换乘吗'],['does this ticket work on the subway','这张票能坐地铁吗'],['where do I buy a metro card','我在哪里可以买地铁卡'],['is the station open now','车站现在开门吗'],['how much is a taxi to the hotel','打车去酒店多少钱'],['please stop at this address','请在这个地址停车'],['can you show me the route','你能给我看路线吗'],['I need to catch the last bus','我需要赶末班公交车'],['is there a seat near the door','门边有座位吗'],
['can I see the drink menu','我能看饮料单吗'],['I would like the same dish','我想要同样的菜'],['could you heat this up','你能加热一下这个吗'],['is there any meat in this','这里面有肉吗'],['I need a table outside','我需要一张室外的桌子'],['can we sit somewhere quieter','我们能坐安静一点的地方吗'],['this food is too salty','这道菜太咸了'],['could I get another fork','我能再要一把叉子吗'],['we would like to pay now','我们现在想付款'],['can I have the receipt please','请给我收据好吗'],
['where can I return this item','我在哪里能退这个商品'],['I would like a different color','我想要另一种颜色'],['can you check if this is on sale','你能查一下这个是否打折吗'],['this is missing a part','这个少了一个部件'],['can I get a larger bag','我能要一个大一点的袋子吗'],['I need help at the checkout','我在收银台需要帮助'],['can you hold this for me','你能帮我留着这个吗'],['where is the nearest store','最近的商店在哪里'],['I need to cancel this order','我需要取消这个订单'],['can I pay in cash','我能用现金付款吗'],
['I have a rash on my arm','我胳膊上起疹子了'],['my head hurts a lot','我头很疼'],['I need something for a cold','我需要治感冒的药'],['can you write down the medicine name','你能写下药名吗'],['how much does this medicine cost','这个药多少钱'],['I need to rest for a while','我需要休息一会儿'],['where is the nearest clinic','最近的诊所在哪里'],['I feel dizzy today','我今天头晕'],
['can you help me activate this SIM card','你能帮我激活这张电话卡吗'],['my phone cannot make calls','我的手机不能打电话'],['where can I find free Wi-Fi','我在哪里能找到免费无线网络'],['can you send me the address','你能把地址发给我吗'],['my phone is almost out of battery','我的手机快没电了']
]
if (rows.length !== 63) throw new Error(`Expected 63 rows, got ${rows.length}`)
const norm = (v) => v.toLowerCase().replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()
unit.activity.items = unit.activity.items.filter((x) => !x.id.startsWith('r17-daily-p2c-'))
const existing = new Set(unit.activity.items.map((x) => norm(x.term)))
for (const [term] of rows) { if (existing.has(norm(term))) throw new Error(`Duplicate ${term}`); existing.add(norm(term)) }
unit.activity.items.push(...rows.map(([term, meaningZh], i) => ({ id:`r17-daily-p2c-${String(i+1).padStart(3,'0')}`, term, meaningZh, partOfSpeech:'travel sentence', exampleEn:term[0].toUpperCase()+term.slice(1)+'.', exampleZh:meaningZh+'。', growthDifficultyLevel:1, dailyKnowledgeId:`daily-knowledge-v1:p2c:${String(i+1).padStart(3,'0')}` })))
fs.writeFileSync(path, `${JSON.stringify(document,null,2)}\n`)
