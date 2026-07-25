import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { assessmentIntroViewModel } from '../../src/app/assessment/assessment-view-model.ts'
import {
  AssessmentIntroScreen,
  SpeakingTrainingScreen,
  type SpeakingScreenViewModel,
} from '../../src/ui/index.ts'
import {
  exercises,
  extensionIndex,
  lessonsByPath,
  manifest,
  packageIndex,
  releasedCatalogs,
} from './fixtures/production-course.ts'

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return sourceFiles(fullPath)
      }
      return /\.(?:ts|tsx)$/.test(entry.name) &&
        !entry.name.includes('.test.')
        ? [fullPath]
        : []
    }),
  )
  return nested.flat()
}

describe('09 released content acceptance', () => {
  it('contains exactly four weeks, 28 days and 84 unique 15-minute units', () => {
    const lessonDocuments = Object.values(lessonsByPath)
    const lessons = lessonDocuments.flatMap(
      (week) => week.lessons,
    )
    const units = lessons.flatMap((lesson) => lesson.learningUnits)

    expect(packageIndex.status).toBe('released')
    expect(packageIndex.lessonFiles).toHaveLength(4)
    expect(manifest.recommendedDays).toBe(28)
    expect(lessons).toHaveLength(28)
    expect(
      lessons.map((lesson) => lesson.recommendedDay),
    ).toEqual(Array.from({ length: 28 }, (_, index) => index + 1))
    expect(units).toHaveLength(84)
    expect(
      units.every((unit) => unit.estimatedSeconds === 900),
    ).toBe(true)
    expect(
      lessons.every(
        (lesson) =>
          lesson.learningUnits.reduce(
            (sum, unit) => sum + unit.estimatedSeconds,
            0,
          ) === 2_700,
      ),
    ).toBe(true)
    expect(new Set(units.map((unit) => unit.learningUnitId)).size).toBe(
      84,
    )
    expect(new Set(units.map((unit) => unit.contentRef)).size).toBe(84)
    expect(
      new Set(units.map((unit) => unit.domain)),
    ).toEqual(new Set(['vocabulary', 'listening', 'speaking']))
  })

  it('keeps prerequisite chains backward-only within the same domain', () => {
    const lessons = Object.values(lessonsByPath).flatMap(
      (week) => week.lessons,
    )
    const units = lessons.flatMap((lesson) =>
      lesson.learningUnits.map((unit) => ({
        ...unit,
        recommendedDay: lesson.recommendedDay,
      })),
    )
    const byId = new Map(
      units.map((unit) => [unit.learningUnitId, unit]),
    )

    for (const unit of units) {
      for (const prerequisiteId of unit.prerequisiteUnitIds) {
        const prerequisite = byId.get(prerequisiteId)
        expect(prerequisite, prerequisiteId).toBeDefined()
        expect(prerequisite?.domain).toBe(unit.domain)
        expect(prerequisite?.recommendedDay).toBeLessThan(
          unit.recommendedDay,
        )
      }
    }
  })

  it('loads all production catalogs and validates the listening extension', () => {
    const catalogs = releasedCatalogs()
    expect(catalogs.vocabulary.units).toHaveLength(28)
    expect(catalogs.listening.units).toHaveLength(28)
    expect(catalogs.speaking.units).toHaveLength(28)
    expect(
      catalogs.speaking.units.flatMap((unit) => unit.prompts),
    ).toHaveLength(94)

    const listeningQuestions = catalogs.listening.units.flatMap(
      (unit) => unit.questions,
    )
    expect(
      listeningQuestions.filter(
        (question) => question.type === 'word-discrimination',
      ),
    ).toHaveLength(28)
    expect(
      listeningQuestions.filter(
        (question) => question.type === 'short-sentence-choice',
      ),
    ).toHaveLength(28)
    expect(
      listeningQuestions.filter(
        (question) => question.type === 'keyword-dictation',
      ),
    ).toHaveLength(28)
    expect(extensionIndex.totals.exercises).toBe(84)
    expect(exercises.lessons).toHaveLength(28)
  })

  it('contains no placeholders and keeps urgent-help content non-diagnostic', () => {
    const contentText = JSON.stringify({
      packageIndex,
      manifest,
      lessonsByPath,
      extensionIndex,
      exercises,
    })
    expect(contentText).not.toMatch(
      /\b(?:TODO|TBD|PLACEHOLDER)\b|待补|占位/i,
    )
    expect(contentText).not.toMatch(/\b(?:911|112|999)\b/)

    const helpLesson = Object.values(lessonsByPath)
      .flatMap((week) => week.lessons)
      .find((lesson) => lesson.sceneIds.includes('simple-help'))
    expect(helpLesson?.safetyNoteZh).toContain(
      '不提供医疗、法律或安全处置建议',
    )
    expect(helpLesson?.safetyNoteZh).toContain('当地紧急服务')
  })
})

describe('09 static PWA, narrow-screen and accessibility acceptance', () => {
  it('declares install metadata, safe areas and narrow-screen rules', async () => {
    const [html, appCss, trainingCss] = await Promise.all([
      readFile('index.html', 'utf8'),
      readFile('src/ui/styles/app.css', 'utf8'),
      readFile('src/ui/styles/training.css', 'utf8'),
    ])

    expect(html).toContain('<html lang="zh-CN">')
    expect(html).toContain('width=device-width')
    expect(html).toContain('viewport-fit=cover')
    expect(html).toContain('rel="apple-touch-icon"')
    expect(html).toContain(
      'name="apple-mobile-web-app-capable" content="yes"',
    )
    expect(appCss).toContain('env(safe-area-inset-top)')
    expect(appCss).toContain(':focus-visible')
    expect(appCss).toContain('@media (width <= 360px)')
    expect(appCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(trainingCss).toContain('@media (width <= 360px)')
  })

  it('renders semantic assessment and device-fallback surfaces on the server', () => {
    const introMarkup = renderToStaticMarkup(
      createElement(AssessmentIntroScreen, {
        viewModel: assessmentIntroViewModel,
        onStart() {},
        onExit() {},
      }),
    )
    expect(introMarkup).toContain('<main')
    expect(introMarkup).toContain('aria-label="测试专项"')
    expect(introMarkup).toContain('约 15–20 分钟')
    expect(introMarkup).toContain('词汇')
    expect(introMarkup).toContain('听力')
    expect(introMarkup).toContain('口语')

    const fallbackViewModel: SpeakingScreenViewModel = {
      header: {
        eyebrow: '口语学习',
        title: '口语训练',
        progress: { label: '已完成 1 / 1', value: 100 },
      },
      instruction: '按提示完成口语练习。',
      prompt: 'Respond in English',
      cueZh: '说明你来自哪里。',
      partnerLine: 'Where are you from?',
      modelAnswer: "I'm from Shanghai.",
      recorder: {
        status: 'review',
        statusLabel: '录音完成',
        timeLabel: '2 秒',
        description: '语音识别失败；录音仍可回放。',
        playbackAvailable: true,
      },
      feedback: {
        tone: 'device',
        title: '文本识别不可用，录音仍可回放',
        description: '本题不生成文本接近度，也不记为答错。',
      },
      action: { label: '完成训练' },
    }
    const speakingMarkup = renderToStaticMarkup(
      createElement(SpeakingTrainingScreen, {
        viewModel: fallbackViewModel,
        onExit() {},
        onRecorderAction() {},
        onPlayback() {},
        onAction() {},
      }),
    )
    expect(speakingMarkup).toContain('lang="en-US"')
    expect(speakingMarkup).toContain('文本识别不可用，录音仍可回放')
    expect(speakingMarkup).toContain('本题不生成文本接近度，也不记为答错')
    expect(speakingMarkup).toContain('type="button"')
  })

  it('contains no hard-coded external API origin in production TypeScript', async () => {
    const files = await sourceFiles('src')
    const matches: string[] = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      const withoutLocalFallbacks = source.replaceAll(
        'http://localhost/',
        '',
      )
      if (/https?:\/\//.test(withoutLocalFallbacks)) {
        matches.push(file)
      }
    }
    expect(matches).toEqual([])
  })
})
