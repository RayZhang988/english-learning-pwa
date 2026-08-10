import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const translations = {
  'w1d1-s1': '你好，Maya。我是 Lin。',
  'w1d1-s2': '我来自上海。',
  'w1d1-s3': '不，我正在纽约旅行。',
  'w1d1-q3': '我也很高兴认识你。',
  'w1d2-s1': '当然。是 L-I。',
  'w1d2-s2': '我的电话号码是 555-0136。',
  'w1d2-s3': '请你再说一遍好吗？',
  'w1d2-q3': '请你拼一下你的名字好吗？',
  'w1d3-s1': '这张票多少钱？',
  'w1d3-s2': '十二美元五十美分。',
  'w1d3-s3': '是十五美元还是五十美元？',
  'w1d3-q3': '这个多少钱？',
  'w1d4-s1': '早餐几点开始？',
  'w1d4-s2': '我们明天上午九点见吧。',
  'w1d4-s3': '我确认一下：它是六点十五分出发吗？',
  'w1d4-q3': '它几点开始？',
  'w1d5-s1': '打扰一下，洗手间在哪里？',
  'w1d5-s2': '请给我一些水好吗？',
  'w1d5-s3': '对不起，我没听懂。你能说慢一点吗？',
  'w1d5-q3': '请你再说一遍好吗？',
  'w1d6-s1': '我想要一杯小杯咖啡。',
  'w1d6-s2': '请打包带走。',
  'w1d6-s3': '三明治可以不加洋葱吗？',
  'w1d6-q3': '我想要一杯中杯茶，在这里喝。',
  'w1d7-s1': '你好，Jordan。我是 Mei。我来自杭州。',
  'w1d7-s2': '好啊。我们明天上午十点去喝咖啡吧。',
  'w1d7-s3': '我想要一杯中杯咖啡，打包带走。',
  'w1d7-s4': '对不起，请你再说一遍总金额好吗？',
  'w1d7-q3': '你好，我是 Yun。我来自南京，正在西雅图旅行。',
  'w2d8-s1': '没有预订。请给我们一张两人桌。',
  'w2d8-s2': '预订在 Chen 名下，时间是七点。',
  'w2d8-s3': '没问题。我们等候时可以看看菜单吗？',
  'w2d8-q3': '请给我们一张三人桌。',
  'w2d9-s1': '我想要烤鸡配沙拉。',
  'w2d9-s2': '可以不加奶酪吗？',
  'w2d9-s3': '是的，我对花生过敏。',
  'w2d9-q3': '我想要意面，不加肉。',
  'w2d10-s1': '不用了，谢谢。请把账单给我们好吗？',
  'w2d10-s2': '我觉得账单上多算了一份甜点。',
  'w2d10-s3': '我刷卡付款。',
  'w2d10-q3': '打扰一下，我觉得这道菜送错了。',
  'w2d11-s1': '好的，谢谢。请问怎么去火车站？',
  'w2d11-s2': '我确认一下：在第二个街角左转，对吗？',
  'w2d11-s3': '它在公园附近吗？',
  'w2d11-q3': '请问怎么去博物馆？',
  'w2d12-s1': '去市中心需要坐哪条线路？',
  'w2d12-s2': '我需要换乘吗？',
  'w2d12-s3': '所以我在下一站下车，对吗？',
  'w2d12-q3': '我在哪里换乘？',
  'w2d13-s1': '请给我一张去 Salem 的往返票。',
  'w2d13-s2': '车费多少钱？',
  'w2d13-s3': '请在酒店正门让我下车。',
  'w2d13-q3': '请给我一张去机场的单程票。',
  'w2d14-s1': '我想要鸡肉三明治，不加洋葱。我对花生过敏。',
  'w2d14-s2': '不用了，谢谢。请给我账单好吗？我刷卡付款。',
  'w2d14-s3': '好的。请问怎么去中央车站？',
  'w2d14-s4': '请给我两张去市中心的单程票。',
  'w2d14-q3': '我确认一下：直走两个街区，然后左转，对吗？',
  'w3d15-s1': '这件衬衫有大码吗？',
  'w3d15-s2': '好的。我可以试穿这双吗？',
  'w3d15-s3': '它们太小了。',
  'w3d15-q3': '这个有蓝色的吗？',
  'w3d16-s1': '它在打折吗？',
  'w3d16-s2': '我想退掉这双鞋。它们太大了。',
  'w3d16-s3': '可以把退款退回我的银行卡吗？',
  'w3d16-q3': '我可以把小码换成中码吗？',
  'w3d17-s1': '我想办理入住。我在 Zhang 名下有预订。',
  'w3d17-s2': '谢谢。包含早餐吗？',
  'w3d17-s3': '谢谢。明天几点退房？',
  'w3d17-q3': '我在 Kim 名下有预订。',
  'w3d18-s1': '你好，我是 420 房的客人。可以给我两条额外的毛巾吗？',
  'w3d18-s2': '我房间里的 Wi-Fi 用不了。',
  'w3d18-s3': '我可以延迟到下午一点退房吗？',
  'w3d18-q3': '请给我一条额外的毯子好吗？',
  'w3d19-s1': '我要办理飞往芝加哥的 316 航班值机。',
  'w3d19-s2': '我有一件随身行李和两件要托运的行李。',
  'w3d19-s3': '如果可以，我想要靠窗的座位。',
  'w3d19-q3': '这是我的护照。',
  'w3d20-s1': '登机口从 B7 改了吗？',
  'w3d20-s2': '几点开始登机？',
  'w3d20-s3': '我确认一下：航班延误四十分钟，是吗？',
  'w3d20-q3': '航班准时吗？',
  'w3d21-s1': '我想凭收据把这件黑色衬衫换成蓝色中码。',
  'w3d21-s2': '我住在 518 房，准备退房。',
  'w3d21-s3': '我乘坐 620 航班，有一件行李要托运。',
  'w3d21-s4': '我确认一下：登机口是 D9，四点五十分开始登机，对吗？',
  'w3d21-q3': '空调坏了。我还可以延迟到一点退房吗？',
  'w4d22-s1': '是的。我要在哪里转乘去丹佛的航班？',
  'w4d22-s2': '打扰一下，行李提取处在哪里？',
  'w4d22-s3': '我的蓝色大行李箱没有到。',
  'w4d22-q3': '我要在芝加哥转机。',
  'w4d23-s1': '我迷路了。你能帮帮我吗？',
  'w4d23-s2': '我的脚踝疼。我需要坐下来。',
  'w4d23-s3': '最近的药店在哪里？',
  'w4d23-s4': '是的，这是紧急情况。请马上叫救护车。',
  'w4d23-q3': '我在西门，我需要警察帮助。',
  'w4d24-s1': '是啊。我打算去公园。',
  'w4d24-s2': '你今天下午有什么计划？',
  'w4d24-s3': '你能推荐一家附近的咖啡馆吗？',
  'w4d24-s4': '谢谢你的推荐。祝你今天愉快！',
  'w4d24-q3': '我今晚打算去河边散步。',
  'w4d25-s1': 'River Hotel 的接驳车在哪里上车，车费多少钱？',
  'w4d25-s2': '请送我到 River Hotel 的正门。我确认一下：地址是 Pine Street 18号，对吗？',
  'w4d25-s3': '我在 Zhou 名下有预订。包含早餐吗？几点退房？',
  'w4d25-s4': '你好，我是 624 房的客人。我连不上 Wi-Fi。',
  'w4d25-q3': '我在 Wu 名下有预订。几点退房？',
  'w4d26-s1': '我可以改坐公交车吗？哪条线路去市中心？',
  'w4d26-s2': '我确认一下：在第四站下车，然后左转，对吗？',
  'w4d26-s3': '我想要牛肉汉堡，不加洋葱。我对花生过敏。',
  'w4d26-s4': '它们太小了。我有收据。可以把它们换成九码的黑色鞋吗？',
  'w4d26-q3': '我对花生过敏。你能确认一下这份沙拉对我是否安全吗？',
  'w4d27-s1': '我的航班是四点。可以改为帮我叫一辆出租车吗？',
  'w4d27-s2': '我的护照不见了。我最后一次看到它是在酒店前台。',
  'w4d27-s3': '你能帮我马上联系酒店吗？',
  'w4d27-s4': '我确认一下：登机口是 A12，四点半登机，五点十分起飞，对吗？',
  'w4d27-q3': '我的黑色护照夹不见了。我最后一次看到它是在安检处。',
  'w4d28-s1': '我想从 407 房退房。可以帮我寄存一件行李到下午两点吗？',
  'w4d28-s2': '我想要火鸡三明治，不加奶酪。我对花生过敏。',
  'w4d28-s3': '可以改在二号航站楼让我下车吗？我确认一下：是二号航站楼下客区，对吗？',
  'w4d28-s4': '我确认一下：905 航班现在在 B16 登机口，五点开始登机，对吗？',
  'w4d28-s5': 'B16 登机口附近有人需要帮助。一位旅客感到头晕，但意识清醒。',
  'w4d28-q3': '我的护照不见了。我最后一次看到它是在酒店前台。你能帮我马上联系酒店吗？',
}

assert.equal(Object.keys(translations).length, 122)

function insertTranslation(source, id, translation) {
  const idMarker = `"id": ${JSON.stringify(id)}`
  const idIndex = source.indexOf(idMarker)
  assert.notEqual(idIndex, -1, `Missing speaking item ${id}`)
  assert.equal(source.indexOf(idMarker, idIndex + idMarker.length), -1, `Duplicate speaking item ${id}`)

  const nextIdIndex = source.indexOf('"id":', idIndex + idMarker.length)
  const itemEnd = nextIdIndex === -1 ? source.length : nextIdIndex
  const modelMarker = '"modelAnswer": '
  const modelIndex = source.indexOf(modelMarker, idIndex + idMarker.length)
  assert.ok(modelIndex > idIndex && modelIndex < itemEnd, `${id} has no modelAnswer`)
  const valueStart = modelIndex + modelMarker.length
  assert.equal(source[valueStart], '"')
  let valueEnd = valueStart + 1
  for (; valueEnd < source.length; valueEnd += 1) {
    if (source[valueEnd] === '"' && source[valueEnd - 1] !== '\\') break
  }
  assert.ok(valueEnd < itemEnd, `${id} modelAnswer is not a JSON string`)
  assert.notEqual(source.slice(idIndex, itemEnd).includes('"modelAnswerTranslationZh"'), true, `${id} already has a translation`)

  const lineStart = source.lastIndexOf('\n', modelIndex) + 1
  const indentation = source.slice(lineStart, modelIndex)
  const inlineItem = lineStart <= idIndex
  const addition = inlineItem
    ? `, "modelAnswerTranslationZh": ${JSON.stringify(translation)}`
    : `,\n${indentation}"modelAnswerTranslationZh": ${JSON.stringify(translation)}`
  return `${source.slice(0, valueEnd + 1)}${addition}${source.slice(valueEnd + 1)}`
}

for (let week = 1; week <= 4; week += 1) {
  const path = new URL(`../lessons/survival-travel-american-4w/week-${week}.v1.json`, import.meta.url)
  let source = readFileSync(path, 'utf8')
  const weekPrefix = `w${week}d`
  for (const [id, translation] of Object.entries(translations)) {
    if (id.startsWith(weekPrefix)) source = insertTranslation(source, id, translation)
  }
  JSON.parse(source)
  writeFileSync(path, source)
}

console.log(JSON.stringify({ status: 'authored', speakingTranslations: Object.keys(translations).length }))
