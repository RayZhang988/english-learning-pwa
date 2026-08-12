import fs from 'node:fs';const f='content/lessons/survival-travel-american-4w/week-1.v1.json',d=JSON.parse(fs.readFileSync(f,'utf8')),u=d.lessons.flatMap(l=>l.learningUnits).find(x=>x.learningUnitId==='st4w-w1d4-vocabulary');
const rows=`Could you provide the written policy for this cancellation?|请提供这次取消的书面政策。
I need to know whether the revised route affects my entry permission.|我需要知道修改路线是否影响入境许可。
Could you explain why this expense is excluded from reimbursement?|请说明这项费用为何不在报销范围内。
I need an alternative booking that preserves the original conditions.|我需要保留原条件的替代预订。
Could you confirm who will be accountable for the delay?|请确认谁对延误负责。
I need evidence that the service was not delivered as promised.|我需要服务未按承诺提供的证据。
Could you explain how to submit a formal dispute?|请说明如何提交正式争议。
I need to know whether the provider can waive the penalty.|我需要知道服务方能否免除罚金。
Could you identify the deadline for appealing this decision?|请说明申诉这个决定的截止时间。
I need a safer option while the issue remains unresolved.|问题未解决期间我需要更安全的选择。
Could you explain whether the delay changes the insurance coverage?|请说明延误是否改变保险保障。
I need to know which documents support the claim.|我需要知道哪些文件支持索赔。
Could you confirm that the replacement service is equivalent?|请确认替代服务是否等同。
I need an explanation of the additional charge before paying.|付款前我需要解释额外收费。
Could you explain what happens if the carrier refuses responsibility?|请说明承运方拒绝责任会怎样。
I need to know whether the hotel can relocate us at its expense.|我需要知道酒店能否自费安置我们。
Could you provide an alternative that meets my accessibility needs?|请提供符合无障碍需求的替代方案。
I need to know whether the operator has a contingency plan.|我需要知道运营方是否有应急计划。
Could you explain the consequence of missing the revised departure?|请说明错过修改后出发的后果。
I need a record of every contact about this dispute.|我需要这次争议每次联系的记录。
Could you confirm that the complaint was received on time?|请确认投诉按时收到。
I need to know whether the refund includes the service fee.|我需要知道退款是否包含服务费。
Could you explain the risk of accepting a partial refund?|请说明接受部分退款的风险。
I need a replacement arrangement before the current booking expires.|当前预订到期前我需要替代安排。
Could you identify the authority responsible for this restriction?|请说明负责这项限制的机构。
I need to know whether the warning changes the evacuation route.|我需要知道警告是否改变疏散路线。
Could you explain how the provider will prevent further loss?|请说明服务方将如何防止进一步损失。
I need a clear estimate of the expected repair time.|我需要预计维修时间的明确估算。
Could you confirm whether the medication requires special storage?|请确认药物是否需要特殊储存。
I need to know whether treatment can wait until the next destination.|我需要知道治疗能否等到下一目的地。
Could you explain which emergency number works without a local SIM card?|请说明没有本地电话卡时哪个紧急号码可用。
I need an alternative contact if the embassy is closed.|大使馆关闭时我需要替代联系人。
Could you provide a written explanation for the denied boarding?|请提供拒绝登机的书面说明。
I need to know whether the airline can reroute me through another city.|我需要知道航空公司能否经另一城市改道。
Could you explain how the missed transfer affects the luggage claim?|请说明错过换乘如何影响行李索赔。
I need confirmation that the new booking includes the same baggage allowance.|我需要确认新预订包含相同行李额度。
Could you identify which costs are covered during an overnight disruption?|请说明过夜中断期间哪些费用被承担。
I need to know whether a police report is enough for the insurer.|我需要知道警方报告对保险公司是否足够。
Could you explain the reason the claim needs further review?|请说明索赔为何需要进一步审核。
I need a plan that minimizes the impact on my return flight.|我需要一个将对返程航班影响最小化的计划。
Could you confirm that this alternative does not create a new fee?|请确认这个替代方案不会产生新费用。
I need to know whether the travel credit can be transferred.|我需要知道旅行额度能否转让。
Could you explain what proof is needed for a service failure?|请说明服务失败需要什么证明。
I need a contact who can authorize an immediate exception.|我需要能批准立即例外的联系人。
Could you explain how the policy applies to a medical emergency?|请说明政策如何适用于医疗紧急情况。
I need to know whether the cancellation changes my visa appointment.|我需要知道取消是否改变签证预约。
Could you confirm that the route avoids the restricted area?|请确认路线避开限制区域。
I need an explanation before I accept the proposed settlement.|我接受所提和解前需要解释。
Could you identify the next escalation step if this fails?|如果失败请说明下一升级步骤。
I need to know whether the provider will reimburse local transportation.|我需要知道服务方是否报销本地交通。
Could you explain why the emergency service was unavailable?|请说明紧急服务为何不可用。
I need a safer way to store my travel documents.|我需要更安全的旅行证件保存方式。
Could you confirm that the replacement room meets the booking details?|请确认替换房间符合预订细节。
I need to know whether the operator can change the activity safely.|我需要知道运营方能否安全更改活动。
Could you explain the responsibility for the damaged rental car?|请说明租车受损的责任。
I need an alternative transportation plan for severe weather.|恶劣天气时我需要替代交通计划。
Could you confirm that the change will not affect my medical appointment?|请确认变更不会影响医疗预约。
I need to know whether the new deadline is legally binding.|我需要知道新截止时间是否具有约束力。
Could you explain why the proposed option is less suitable?|请说明所提选择为何不太合适。
I need a written summary of the agreement we reached.|我需要我们达成协议的书面摘要。
Could you identify the risk if I continue without confirmation?|请说明未确认继续前行的风险。
I need to know whether the dispute pauses the payment deadline.|我需要知道争议是否暂停付款截止时间。
Could you explain how to protect my booking while the case is reviewed?|请说明案件审核期间如何保护我的预订。
I need an option that allows me to leave if conditions worsen.|情况恶化时我需要能离开的选择。
Could you confirm that the final decision will be sent in writing?|请确认最终决定会以书面发送。`.split('\n').map(x=>x.split('|'));
if(rows.length!==65)throw Error(rows.length);const n=x=>x.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();u.activity.items=u.activity.items.filter(i=>!i.id.startsWith('r17-daily-j2c-'));const seen=new Set(u.activity.items.map(i=>n(i.term)));for(const [t]of rows){if(seen.has(n(t)))throw Error('duplicate '+t);seen.add(n(t))}u.activity.items.push(...rows.map(([term,meaningZh],i)=>({id:`r17-daily-j2c-${String(i+1).padStart(3,'0')}`,term,meaningZh,partOfSpeech:term.startsWith('Could')?'request':'statement',exampleEn:term,exampleZh:meaningZh,growthDifficultyLevel:4,dailyKnowledgeId:`daily-knowledge-v1:j2c:${String(i+1).padStart(3,'0')}`})));fs.writeFileSync(f,JSON.stringify(d,null,2)+'\n')
