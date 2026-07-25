export async function startFreshAssessment(page, baseUrl) {
  await page.setViewport(390, 844)
  await page.navigate(new URL('#/', baseUrl).href)
  await page.waitFor(
    `!document.body.innerText.includes('正在恢复今日学习计划')`,
  )
  await page.clickByText('开始水平测试')
  await page.waitFor(
    `location.hash.includes('/assessment') && !document.body.innerText.includes('正在恢复水平测试')`,
  )
  await page.clickByText('检查设备并开始')
}

export async function advanceAssessmentToSpeaking(page) {
  for (let iteration = 0; iteration < 70; iteration += 1) {
    await page.waitFor(`!document.body.innerText.includes('正在继续')`)
    const text = await page.bodyText()
    const interactive = await page.interactiveElements()
    const labels = interactive
      .filter((element) => element.tag === 'button')
      .map((element) => element.text)

    if (text.includes('SPEAKING') && labels.includes('开始录音')) {
      return { text, interactive }
    }
    if (labels.includes('继续下一题')) {
      await page.clickByText('继续下一题')
      continue
    }
    if (text.includes('LISTENING') && labels.includes('跳过本题')) {
      await page.clickByText('跳过本题')
      await page.waitFor(
        `document.body.innerText.includes('继续下一题')`,
      )
      continue
    }
    if (
      interactive.some((element) =>
        element.className?.includes('choice-row'),
      )
    ) {
      await page.clickFirstEnabledChoice()
      await page.waitFor(
        `[...document.querySelectorAll('button')].some((button) => button.innerText.trim() === '提交答案' && !button.disabled)`,
      )
      await page.clickByText('提交答案')
      await page.waitFor(
        `document.body.innerText.includes('继续下一题')`,
      )
      continue
    }
    throw new Error(
      `Could not advance assessment to speaking.\n${text}\n${JSON.stringify(interactive)}`,
    )
  }
  throw new Error('Assessment did not reach speaking')
}
