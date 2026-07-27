import { useState } from 'react'
import {
  TravelVocabularyR1IntroScreen,
  TravelVocabularyR1MigrationScreen,
  TravelVocabularyR1QuestionScreen,
  TravelVocabularyR1ResultsScreen,
  TravelVocabularyR1ResumeScreen,
  TravelVocabularyR1StageResultScreen,
  TravelVocabularyR1StageReviewScreen,
  TravelVocabularyR1StatusScreen,
} from './travel-vocabulary-r1-screens.tsx'
import type {
  TravelVocabularyR1QuestionViewModel,
  TravelVocabularyR1ResultsViewModel,
  TravelVocabularyR1StageRouteItemViewModel,
} from './travel-vocabulary-r1-types.ts'
import type { TravelVocabularyR1VisualFixtureId } from './visual-fixture-ids.ts'

const demoSessionId = 'visual-travel-r1-session'

const demoStages: readonly TravelVocabularyR1StageRouteItemViewModel[] = [
  {
    id: 'stage-1-foundation',
    order: 1,
    label: '基础',
    state: 'complete',
  },
  {
    id: 'stage-2-essential',
    order: 2,
    label: '核心',
    state: 'current',
  },
  {
    id: 'stage-3-independent',
    order: 3,
    label: '独立',
    state: 'upcoming',
  },
  {
    id: 'stage-4-advanced',
    order: 4,
    label: '进阶',
    state: 'upcoming',
  },
  {
    id: 'stage-5-specialized',
    order: 5,
    label: '高阶',
    state: 'upcoming',
  },
]

const demoQuestionMap: TravelVocabularyR1QuestionViewModel['questionMap'] =
  Array.from({ length: 30 }, (_, index) => ({
    questionId: `visual-r1-question-${index + 1}`,
    questionIndex: index,
    numberLabel: String(index + 1),
    answerState:
      index < 8
        ? 'answered'
        : index === 8
          ? 'uncertain'
          : 'unanswered',
    current: index === 9,
    disabled: false,
  }))

const demoResultStages: TravelVocabularyR1ResultsViewModel['stageResults'] =
  [
    {
      id: 'stage-1-foundation',
      order: 1,
      label: '基础出行词汇',
      correctCountLabel: '27 / 30',
      masteryRateLabel: '90%',
      representativeWordCountLabel: '代表 300 词',
      estimatedWordsLabel: '估算 270 词',
      reasonableIntervalLabel: '合理区间 210–300 词',
    },
    {
      id: 'stage-2-essential',
      order: 2,
      label: '核心旅行词汇',
      correctCountLabel: '22 / 30',
      masteryRateLabel: '73%',
      representativeWordCountLabel: '代表 500 词',
      estimatedWordsLabel: '估算 370 词',
      reasonableIntervalLabel: '合理区间 260–440 词',
    },
    {
      id: 'stage-3-independent',
      order: 3,
      label: '独立旅行词汇',
      correctCountLabel: '15 / 30',
      masteryRateLabel: '50%',
      representativeWordCountLabel: '代表 650 词',
      estimatedWordsLabel: '估算 330 词',
      reasonableIntervalLabel: '合理区间 180–450 词',
    },
    {
      id: 'stage-4-advanced',
      order: 4,
      label: '进阶旅行词汇',
      correctCountLabel: '8 / 30',
      masteryRateLabel: '27%',
      representativeWordCountLabel: '代表 800 词',
      estimatedWordsLabel: '估算 210 词',
      reasonableIntervalLabel: '合理区间 60–390 词',
    },
    {
      id: 'stage-5-specialized',
      order: 5,
      label: '高阶旅行词汇',
      correctCountLabel: '4 / 30',
      masteryRateLabel: '13%',
      representativeWordCountLabel: '代表 950 词',
      estimatedWordsLabel: '估算 130 词',
      reasonableIntervalLabel: '合理区间 0–310 词',
    },
  ]

export function TravelVocabularyR1VisualFixture({
  id,
}: {
  readonly id: TravelVocabularyR1VisualFixtureId
}) {
  const [answer, setAnswer] = useState<
    | { readonly kind: 'choice'; readonly optionId: string }
    | { readonly kind: 'uncertain' }
    | null
  >({
    kind: 'choice',
    optionId: 'meaning-reservation',
  })

  if (id === 'travel-r1-intro') {
    return (
      <TravelVocabularyR1IntroScreen
        viewModel={{
          sessionId: demoSessionId,
          startAction: {
            label: '开始第 1 阶段',
            disabled: false,
          },
        }}
        onStart={() => undefined}
        onExit={() => undefined}
      />
    )
  }

  if (id === 'travel-r1-question') {
    return (
      <TravelVocabularyR1QuestionScreen
        viewModel={{
          sessionId: demoSessionId,
          stage: {
            id: 'stage-2-essential',
            order: 2,
            label: '核心旅行词汇',
            representativeWordCountLabel: '代表 500 个旅游词汇',
          },
          stages: demoStages,
          headerProgress: {
            label: '总进度 40 / 150',
            value: 27,
          },
          stageProgressLabel: '第 10 / 30 题',
          answeredLabel: '本阶段已答 9 题',
          elapsedLabel: '有效时间 08:20',
          question: {
            id: 'visual-r1-question-10',
            index: 9,
            numberLabel: '10',
            prompt: '请选择最接近的中文释义',
            word: 'reservation',
            answerState:
              answer === null
                ? 'unanswered'
                : answer.kind === 'uncertain'
                  ? 'uncertain'
                  : 'choice',
            options: [
              {
                id: 'meaning-reservation',
                label: '预订；预约',
                selected:
                  answer?.kind === 'choice' &&
                  answer.optionId === 'meaning-reservation',
                disabled: false,
              },
              {
                id: 'meaning-claim',
                label: '行李领取处',
                selected:
                  answer?.kind === 'choice' &&
                  answer.optionId === 'meaning-claim',
                disabled: false,
              },
              {
                id: 'meaning-platform',
                label: '站台',
                selected:
                  answer?.kind === 'choice' &&
                  answer.optionId === 'meaning-platform',
                disabled: false,
              },
              {
                id: 'meaning-receipt',
                label: '收据',
                selected:
                  answer?.kind === 'choice' &&
                  answer.optionId === 'meaning-receipt',
                disabled: false,
              },
            ],
          },
          questionMap: demoQuestionMap,
          previousTarget: {
            sessionId: demoSessionId,
            questionId: 'visual-r1-question-9',
            questionIndex: 8,
          },
          nextTarget: {
            sessionId: demoSessionId,
            questionId: 'visual-r1-question-11',
            questionIndex: 10,
          },
          previousAction: { label: '上一题', disabled: false },
          nextAction: { label: '下一题', disabled: false },
          uncertainAction: {
            label: '不认识 / 不确定',
            disabled: false,
          },
          clearAction: {
            label: '清除本题选择',
            disabled: answer === null,
          },
          reviewAction: {
            label: '检查本阶段',
            disabled: false,
            disabledReason: '仍有 20 题未作答，可以先检查。',
          },
          pauseAction: {
            label: '暂停并保存',
            disabled: false,
          },
          notice: {
            kind: 'restored',
            title: '已恢复本机进度',
            description: '继续使用上次保存的原题和选项顺序。',
          },
        }}
        onExit={() => undefined}
        onSelectChoice={(intent) =>
          setAnswer({ kind: 'choice', optionId: intent.optionId })
        }
        onMarkUncertain={() => setAnswer({ kind: 'uncertain' })}
        onClearAnswer={() => setAnswer(null)}
        onNavigate={() => undefined}
        onReviewStage={() => undefined}
        onPause={() => undefined}
      />
    )
  }

  if (id === 'travel-r1-review') {
    return (
      <TravelVocabularyR1StageReviewScreen
        viewModel={{
          sessionId: demoSessionId,
          stage: {
            id: 'stage-2-essential',
            order: 2,
            label: '核心旅行词汇',
          },
          headerProgress: {
            label: '总进度 58 / 150',
            value: 39,
          },
          answeredLabel: '已答 28 / 30',
          reviewDescription: '完成剩余题目后才能提交本阶段。',
          unansweredQuestions: [
            {
              questionId: 'visual-r1-question-9',
              questionIndex: 8,
              numberLabel: '9',
              answerState: 'unanswered',
            },
            {
              questionId: 'visual-r1-question-24',
              questionIndex: 23,
              numberLabel: '24',
              answerState: 'unanswered',
            },
          ],
          submitAction: {
            label: '确认提交本阶段',
            disabled: true,
            disabledReason: '还有 2 题未作答。',
          },
          backAction: {
            label: '返回继续检查',
            disabled: false,
          },
        }}
        onExit={() => undefined}
        onBack={() => undefined}
        onNavigate={() => undefined}
        onSubmitStage={() => undefined}
      />
    )
  }

  if (id === 'travel-r1-stage-result') {
    return (
      <TravelVocabularyR1StageResultScreen
        viewModel={{
          sessionId: demoSessionId,
          stage: {
            id: 'stage-2-essential',
            order: 2,
            label: '核心旅行词汇',
          },
          stages: demoStages.map((stage) =>
            stage.order <= 2
              ? { ...stage, state: 'complete' as const }
              : stage.order === 3
                ? { ...stage, state: 'current' as const }
                : stage,
          ),
          headerProgress: {
            label: '已完成第 2 / 5 阶段',
            value: 40,
          },
          correctCountLabel: '15 / 30',
          incorrectCountLabel: '10',
          uncertainCountLabel: '5',
          masteryRateLabel: '50%',
          representativeWordCountLabel: '500 词',
          estimatedWordsLabel: '250 词',
          reasonableIntervalLabel: '120–370 词',
          continueAction: {
            label: '进入下一阶段',
            disabled: false,
          },
          pauseAction: {
            label: '暂停并保存',
            disabled: false,
          },
        }}
        onExit={() => undefined}
        onContinueToNextStage={() => undefined}
        onPause={() => undefined}
      />
    )
  }

  if (id === 'travel-r1-resume') {
    return (
      <TravelVocabularyR1ResumeScreen
        viewModel={{
          sessionId: demoSessionId,
          stages: demoStages,
          headerProgress: {
            label: '总进度 40 / 150',
            value: 27,
          },
          currentPositionLabel: '第 2 阶段 · 第 10 题',
          answeredLabel: '已答 39 题',
          elapsedLabel: '08 分 20 秒',
          resumeAction: {
            label: '继续原测试',
            disabled: false,
          },
          notice: {
            kind: 'offline',
            title: '当前离线',
            description: '本机保存的原题仍可恢复。',
          },
        }}
        onExit={() => undefined}
        onResume={() => undefined}
      />
    )
  }

  if (id === 'travel-r1-migration') {
    return (
      <TravelVocabularyR1MigrationScreen
        viewModel={{
          sessionId: demoSessionId,
          legacySourceLabel: '旧版 v1 / v2 测试记录',
          startAction: {
            label: '重新开始旅游英语词汇测试',
            disabled: false,
          },
        }}
        onExit={() => undefined}
        onStartNewAssessment={() => undefined}
      />
    )
  }

  if (id === 'travel-r1-results') {
    return (
      <TravelVocabularyR1ResultsScreen
        viewModel={{
          sessionId: demoSessionId,
          levelLabel: '初中一年级',
          estimatedWordsLabel: '1,330 词',
          reasonableIntervalLabel: '合理区间 830–1,820 词',
          answeredCountLabel: '150 题',
          correctCountLabel: '76 题',
          uncertainCountLabel: '18 题',
          elapsedLabel: '31 分 42 秒',
          stageResults: demoResultStages,
          vocabularyCalibrationLabel: '已估算',
          listeningCalibrationLabel: '待校准',
          speakingCalibrationLabel: '待校准',
          calibrationDescription:
            '听力和口语会在后续正常训练中逐步校准。',
          disclaimer:
            '这是基于五阶段随机样本的旅游英语词汇量估算，不是精确词数。',
          levelDisclaimer:
            '内部学习标签不代表学历、学校成绩，也不代表通过 CET-4 或 CET-6。',
          continueAction: {
            label: '生成首日计划',
            disabled: false,
          },
        }}
        onExit={() => undefined}
        onContinue={() => undefined}
      />
    )
  }

  return (
    <TravelVocabularyR1StatusScreen
      viewModel={{
        kind: 'offline',
        title: '当前离线',
        description: '可以恢复本机已保存的固定题目。',
        restoreAction: {
          label: '恢复本机进度',
          disabled: false,
        },
      }}
      onExit={() => undefined}
      onRestoreLocal={() => undefined}
    />
  )
}
