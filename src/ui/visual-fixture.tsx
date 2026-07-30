import { useState } from 'react'
import {
  AssessmentChoiceScreen,
  AssessmentIntroScreen,
  AssessmentPausedScreen,
  AssessmentResultsScreen,
  AssessmentSpeechScreen,
} from './assessment-screens.tsx'
import {
  ListeningTrainingScreen,
  SpeakingTrainingScreen,
  VocabularyTrainingScreen,
} from './practice-screens.tsx'
import {
  LearningAppPrototype,
  type DailyPlanViewModel,
  type PracticeModuleViewModel,
  type ProgressViewModel,
} from './learning-app-prototype.tsx'
import {
  DailyEffectiveDurationSummary,
  TrainingCompletionDurationScreen,
} from './duration-surfaces.tsx'
import {
  ExtraTrainingCompletionScreen,
  ExtraTrainingPickerScreen,
  ExtraVocabularyTrainingScreen,
} from './extra-training-surfaces.tsx'
import { ProgressOverviewScreen } from './progress-overview-screen.tsx'
import { MicrophonePermissionCard } from './system-state-surfaces.tsx'
import { TravelVocabularyR1VisualFixture } from './travel-vocabulary-r1-fixture.tsx'
import {
  isTravelVocabularyR1VisualFixtureId,
  type UiVisualFixtureId,
} from './visual-fixture-ids.ts'
import type { ChoiceViewModel } from './view-models.ts'

const selectedChoices = (
  labels: readonly string[],
  selectedId: string,
): readonly ChoiceViewModel[] =>
  labels.map((label, index) => {
    const id = String(index + 1)
    return {
      id,
      label,
      state: id === selectedId ? 'selected' : 'default',
    }
  })

const demoPlan: DailyPlanViewModel = {
  dateLabel: '周五 · 7月24日',
  greeting: '晚上好，Ray',
  streakDays: 5,
  planTargetLabel: '今日目标约 45 分钟 · 3 项训练',
  progressLabel: '已完成 1 项',
  progressPercent: 34,
  tasks: [
    {
      moduleId: 'vocabulary',
      taskId: 'demo-plan-2026-07-24:task:1',
      title: '词汇复习',
      contentSummary: '12 个词',
      status: 'pending',
      statusLabel: '未完成',
      availability: 'startable',
      recommended: false,
      actionLabel: '开始训练',
      trainingBudget: { targetEffectiveSeconds: 900 },
      icon: 'book',
      accent: 'mint',
    },
    {
      moduleId: 'listening',
      taskId: 'demo-plan-2026-07-24:task:2',
      title: '听力训练',
      contentSummary: '1 组对话',
      status: 'active',
      statusLabel: '进行中',
      availability: 'startable',
      recommended: true,
      actionLabel: '继续训练',
      trainingBudget: { targetEffectiveSeconds: 900 },
      icon: 'headphones',
      accent: 'indigo',
    },
    {
      moduleId: 'speaking',
      taskId: 'demo-plan-2026-07-24:task:3',
      title: '口语跟读',
      contentSummary: '1 组跟读',
      status: 'pending',
      statusLabel: '未完成',
      availability: 'startable',
      recommended: false,
      actionLabel: '开始训练',
      trainingBudget: { targetEffectiveSeconds: 900 },
      icon: 'mic',
      accent: 'coral',
    },
  ],
}

const demoProgress: ProgressViewModel = {
  studyDays: '5',
  studyMinutes: '86',
  completedSessions: '18',
  weeklyBars: [
    { label: '一', value: 48 },
    { label: '二', value: 72 },
    { label: '三', value: 38 },
    { label: '四', value: 84 },
    { label: '五', value: 62, isToday: true },
    { label: '六', value: 0 },
    { label: '日', value: 0 },
  ],
}

const demoPracticeModules: readonly PracticeModuleViewModel[] = [
  {
    moduleId: 'assessment',
    request: {
      state: 'disabled',
      label: '已完成',
      reason: '首次水平测试已完成，第一版暂不支持重复测试。',
    },
  },
  {
    moduleId: 'vocabulary',
    taskId: 'demo-plan-2026-07-24:task:1',
    status: 'pending',
    statusLabel: '未完成',
    availability: 'startable',
    recommended: false,
    actionLabel: '开始训练',
    trainingBudget: { targetEffectiveSeconds: 900 },
  },
  {
    moduleId: 'listening',
    taskId: 'demo-plan-2026-07-24:task:2',
    status: 'active',
    statusLabel: '进行中',
    availability: 'startable',
    recommended: true,
    actionLabel: '继续训练',
    trainingBudget: { targetEffectiveSeconds: 900 },
  },
  {
    moduleId: 'speaking',
    taskId: 'demo-plan-2026-07-24:task:3',
    status: 'pending',
    statusLabel: '未完成',
    availability: 'startable',
    recommended: false,
    actionLabel: '开始训练',
    trainingBudget: { targetEffectiveSeconds: 900 },
  },
]

export function LearningAppVisualDemo() {
  const [requestedTaskId, setRequestedTaskId] = useState<string>()
  const [assessmentRequested, setAssessmentRequested] = useState(false)

  return (
    <div
      data-demo-requested-task-id={requestedTaskId ?? ''}
      data-demo-assessment-requested={assessmentRequested}
    >
      <LearningAppPrototype
        plan={demoPlan}
        progress={demoProgress}
        practiceModules={demoPracticeModules}
        onAssessmentRequested={() => setAssessmentRequested(true)}
        onTaskRequested={setRequestedTaskId}
      />
    </div>
  )
}

export function UiVisualFixture({ id }: { readonly id: UiVisualFixtureId }) {
  const [selectedId, setSelectedId] = useState('1')
  const [dictationValue, setDictationValue] = useState('terminal')

  if (id === 'today-task-request') {
    return <LearningAppVisualDemo />
  }

  if (id === 'r3-training-completion') {
    return (
      <TrainingCompletionDurationScreen
        viewModel={{
          moduleId: 'listening',
          title: '听力训练完成',
          description: '本次练习结果已保存。这里显示的是前台有效练习，不包含后台、暂停和长时间无操作。',
          score: { state: 'available', correctCount: 14, totalCount: 18, percentage: 78, unscorableCount: 0 },
          actualDuration: {
            state: 'reliable',
            effectiveSeconds: 247,
            source: 'timing-segments',
          },
          trainingBudget: {
            status: 'completed',
            targetEffectiveSeconds: 900,
            remainingEffectiveSeconds: 0,
            completedItemCount: 18,
          },
          actionLabel: '返回今日计划',
        }}
        onAction={() => undefined}
      />
    )
  }

  if (id === 'r3-daily-duration-summary') {
    return (
      <main className="visual-fixture-canvas">
        <DailyEffectiveDurationSummary
          viewModel={{
            items: [
              {
                moduleId: 'vocabulary',
                label: '词汇',
                duration: {
                  state: 'reliable',
                  effectiveSeconds: 183,
                  source: 'timing-segments',
                },
              },
              {
                moduleId: 'listening',
                label: '听力',
                duration: {
                  state: 'reliable',
                  effectiveSeconds: 247,
                  source: 'timing-segments',
                },
              },
              {
                moduleId: 'speaking',
                label: '口语',
                duration: {
                  state: 'unavailable',
                  reason: 'legacy-event-duration',
                },
              },
            ],
            total: {
              coverage: 'partial',
              effectiveSeconds: 430,
              source: 'timing-segments',
            },
          }}
        />
      </main>
    )
  }

  if (id === 'r6-daily-complete') {
    return (
      <TrainingCompletionDurationScreen
        viewModel={{
          moduleId: 'speaking',
          title: '口语训练完成',
          description: '最后一个每日任务已经保存。',
          score: { state: 'available', correctCount: 8, totalCount: 10, percentage: 80, unscorableCount: 1 },
          actualDuration: {
            state: 'reliable',
            effectiveSeconds: 2_734,
            source: 'timing-segments',
          },
          extraTrainingEntry: {
            action: { label: '继续训练' },
          },
          actionLabel: '返回今日计划',
        }}
        onAction={() => undefined}
        onContinueTraining={() => undefined}
      />
    )
  }

  if (id === 'r6-extra-training-picker') {
    return (
      <ExtraTrainingPickerScreen
        viewModel={{
          modules: [
            {
              moduleId: 'vocabulary',
              title: '词汇额外训练',
              description: '继续巩固旅游场景中的高频表达。',
              status: 'available',
              startAction: { label: '开始训练' },
            },
            {
              moduleId: 'listening',
              title: '听力额外训练',
              description: '从上次保存的旅行听力继续。',
              status: 'paused',
              sessionId: 'demo-extra-listening',
              effectiveSeconds: 166,
              completedItemCount: 5,
              resumeAction: { label: '继续上次训练' },
              newRoundAction: { label: '开始新一轮' },
            },
            {
              moduleId: 'speaking',
              title: '口语额外训练',
              description: '继续练习旅行场景表达。',
              status: 'content-exhausted',
              sessionId: 'demo-extra-speaking',
              effectiveSeconds: 382,
              completedItemCount: 7,
              failureDescription:
                '当前范围内的近期题目已全部使用，进度已经保存。',
              retryAction: { label: '重新获取题目' },
            },
          ],
          returnAction: { label: '返回今日完成' },
        }}
        onStartRequested={() => undefined}
        onResumeRequested={() => undefined}
        onRetryRequested={() => undefined}
        onReturnToCompletedPlan={() => undefined}
      />
    )
  }

  if (id === 'r6-extra-training-active') {
    return (
      <ExtraVocabularyTrainingScreen
        viewModel={{
          header: {
            eyebrow: 'VOCABULARY',
            title: '旅行词汇',
          },
          instruction: '选择最合适的含义',
          term: 'departure',
          pronunciation: '/dɪˈpɑːrtʃər/',
          partOfSpeech: '名词',
          choices: selectedChoices(
            ['出发', '到达', '换乘', '延误'],
            selectedId,
          ),
          action: { label: '提交答案' },
        }}
        extraTraining={{
          sessionId: 'demo-extra-vocabulary',
          moduleId: 'vocabulary',
          progress: {
            status: 'running',
            effectiveSeconds: 288,
            completedItemCount: 6,
            accuracyPercentage: 67,
          },
          exitAction: { label: '退出并保存' },
        }}
        onExitRequested={() => undefined}
        onRetryRequested={() => undefined}
        onSelect={setSelectedId}
        onAction={() => undefined}
      />
    )
  }

  if (id === 'r6-extra-training-complete') {
    return (
      <ExtraTrainingCompletionScreen
        viewModel={{
          sessionId: 'demo-extra-listening-complete',
          moduleId: 'listening',
          title: '额外听力训练完成',
          description: '这轮有效训练已经保存，不会改变今日 3/3。',
          completedItemCount: 21,
          score: { state: 'available', correctCount: 17, totalCount: 20, percentage: 85, unscorableCount: 1 },
          actualDuration: {
            state: 'reliable',
            effectiveSeconds: 917,
            source: 'timing-segments',
          },
          chooseAgainAction: { label: '再练 15 分钟' },
          returnAction: { label: '返回今日完成' },
        }}
        onChooseAnotherRequested={() => undefined}
        onReturnToCompletedPlan={() => undefined}
      />
    )
  }

  if (isTravelVocabularyR1VisualFixtureId(id)) {
    return <TravelVocabularyR1VisualFixture id={id} />
  }

  if (id === 'assessment-intro') {
    return (
      <AssessmentIntroScreen
        viewModel={{
          title: '找到适合你的起点',
          description: '词汇、听力和口语分别估算，之后用于安排第一阶段学习。',
          durationLabel: '约 15–20 分钟',
          sections: [
            {
              id: 'vocabulary',
              label: '词汇',
              description: '词义与句子理解',
            },
            {
              id: 'listening',
              label: '听力',
              description: '主旨、细节与推断',
            },
            {
              id: 'speaking',
              label: '口语',
              description: '朗读、跟读与简单表达',
            },
          ],
          readinessNote: '开始前会检查音频和麦克风；识别失败时仍可回放录音。',
          disclaimer: '结果只作为学习起点参考，大致参考 CEFR 范围，不是官方认证。',
        }}
        onStart={() => undefined}
        onExit={() => undefined}
      />
    )
  }

  if (id === 'assessment-choice') {
    return (
      <AssessmentChoiceScreen
        viewModel={{
          sessionId: 'demo-assessment-session',
          itemId: 'demo-vocabulary-item-03',
          header: {
            eyebrow: 'VOCABULARY',
            title: '水平测试',
            progress: { label: '词汇阶段 · 第 3 题', value: 32 },
          },
          instruction: '选择最合适的含义',
          prompt: 'What does “check in” mean here?',
          stimulus: 'We need to check in at the hotel before six.',
          choices: selectedChoices(
            ['办理入住', '查看里面', '支付账单', '取消预订'],
            selectedId,
          ),
          primaryAction: {
            kind: 'submit',
            label: '提交答案',
            disabled: false,
          },
          skipAction: {
            label: '跳过本题',
            disabled: false,
          },
          pauseAction: {
            label: '暂停测试',
            disabled: false,
          },
        }}
        onExit={() => undefined}
        onSelect={(intent) => setSelectedId(intent.optionId)}
        onSubmit={() => undefined}
        onContinue={() => undefined}
        onSkip={() => undefined}
        onPause={() => undefined}
      />
    )
  }

  if (id === 'assessment-feedback') {
    return (
      <AssessmentChoiceScreen
        viewModel={{
          sessionId: 'demo-assessment-session',
          itemId: 'demo-listening-item-05',
          header: {
            eyebrow: 'LISTENING',
            title: '水平测试',
            progress: { label: '听力阶段 · 第 5 题', value: 61 },
          },
          instruction: '本题记录结果',
          prompt: 'What time does breakfast finish?',
          choices: [
            { id: 'seven', label: '7:00', state: 'disabled' },
            { id: 'nine', label: '9:00', state: 'disabled' },
            { id: 'nine-thirty', label: '9:30', state: 'disabled' },
          ],
          submission: {
            itemId: 'demo-listening-item-05',
            status: 'unscorable',
            failureReason: 'audio-playback-failed',
            fallback: {
              kind: 'retry-audio',
              label: '可以检查音频后再继续',
              description: '本题没有按答错记录；下一题仍会继续评估听力。',
            },
            feedback: {
              tone: 'device',
              title: '这段音频没有成功播放',
              description: '本题未计入能力结果。',
            },
          },
          primaryAction: {
            kind: 'continue',
            label: '继续下一题',
            disabled: false,
          },
          pauseAction: {
            label: '暂停测试',
            disabled: false,
          },
        }}
        onExit={() => undefined}
        onSelect={() => undefined}
        onSubmit={() => undefined}
        onContinue={() => undefined}
        onSkip={() => undefined}
        onPause={() => undefined}
      />
    )
  }

  if (id === 'assessment-speech-fallback') {
    return (
      <AssessmentSpeechScreen
        viewModel={{
          sessionId: 'demo-assessment-session',
          itemId: 'demo-speaking-item-02',
          header: {
            eyebrow: 'SPEAKING',
            title: '水平测试',
            progress: { label: '口语阶段 · 第 2 题', value: 82 },
          },
          instruction: '先听音频，再跟读',
          prompt: 'Could you show me where the restroom is?',
          audio: {
            status: 'paused',
            elapsedLabel: '00:00',
            durationLabel: '系统语音',
            progressValue: 0,
            rateLabel: '标准速度',
            playCountLabel: '0/2 次',
            statusLabel: '可以播放',
          },
          recorder: {
            status: 'review',
            statusLabel: '录音已保存',
            description: '识别没有完成，但你仍可以回放这段录音。',
            playbackAvailable: true,
          },
          submission: {
            itemId: 'demo-speaking-item-02',
            status: 'unscorable',
            failureReason: 'recognition-failed',
            fallback: {
              kind: 'recording-playback',
              label: '录音仍可回放',
              description: '本题未计分，也不会按答错处理。',
            },
            feedback: {
              tone: 'device',
              title: '这次识别没有成功',
              description: '录音已经保留，本题不会影响口语估算。',
            },
          },
          primaryAction: {
            kind: 'continue',
            label: '继续下一题',
            disabled: false,
          },
          pauseAction: {
            label: '暂停测试',
            disabled: false,
          },
        }}
        onExit={() => undefined}
        onToggleAudio={() => undefined}
        onRecorderAction={() => undefined}
        onPlayback={() => undefined}
        onSubmit={() => undefined}
        onContinue={() => undefined}
        onSkip={() => undefined}
        onPause={() => undefined}
      />
    )
  }

  if (id === 'assessment-paused') {
    return (
      <AssessmentPausedScreen
        viewModel={{
          sessionId: 'demo-assessment-session',
          header: {
            eyebrow: 'ASSESSMENT',
            title: '水平测试',
            progress: { label: '已完成 8 题', value: 44 },
          },
          statusLabel: '测试已暂停',
          title: '准备好后继续',
          description: '离开期间不会计入测试时间；恢复后会回到刚才的题目或反馈。',
          resumeAction: {
            label: '继续测试',
            disabled: false,
          },
          stopAction: {
            label: '结束并保留部分结果',
            disabled: false,
          },
        }}
        onExit={() => undefined}
        onResume={() => undefined}
        onStop={() => undefined}
      />
    )
  }

  if (id === 'assessment-results') {
    return (
      <AssessmentResultsScreen
        viewModel={{
          outcomeLabel: '部分结果',
          completedAtLabel: '本次测试用时 17 分钟',
          abilities: [
            {
              domain: 'vocabulary',
              label: '词汇',
              status: 'estimated',
              levelLabel: 'B1',
              rangeLabel: '大致范围 A2–B1',
              confidenceLabel: '置信度：高',
              message: '可以从常见旅行场景中的中级词汇开始。',
              warnings: [],
            },
            {
              domain: 'listening',
              label: '听力',
              status: 'low-confidence',
              levelLabel: 'A2',
              rangeLabel: '大致范围 A1–B1',
              confidenceLabel: '置信度：中',
              message: '有效证据有限，日常训练会继续校准。',
              warnings: ['部分音频作答未计入结果。'],
            },
            {
              domain: 'speaking',
              label: '口语',
              status: 'unavailable',
              levelLabel: '暂无结果',
              confidenceLabel: '证据不足',
              message: '设备未提供足够的可评分语音。',
              warnings: ['录音可以回放，但本次识别结果未计分。'],
            },
          ],
          disclaimer: '这是基于本次 15–20 分钟样本的起点估算，大致参考 CEFR 范围，不是官方认证。',
        }}
        onContinue={() => undefined}
        onExit={() => undefined}
      />
    )
  }

  if (id === 'vocabulary') {
    return (
      <VocabularyTrainingScreen
        viewModel={{
          header: {
            eyebrow: 'REVIEW',
            title: '词汇复习',
            progress: { label: '3 / 8', value: 38 },
            trainingBudget: {
              status: 'running',
              targetEffectiveSeconds: 900,
              remainingEffectiveSeconds: 742,
              completedItemCount: 3,
            },
          },
          instruction: '选择最合适的含义',
          term: 'check in',
          pronunciation: '/ˌtʃek ˈɪn/',
          partOfSpeech: '动词短语',
          choices: [
            { id: '1', label: '办理入住', state: 'correct' },
            { id: '2', label: '查看里面', state: 'default' },
            { id: '3', label: '支付账单', state: 'default' },
          ],
          feedback: {
            tone: 'success',
            title: '回答正确',
            description: '在酒店或机场语境中，check in 表示办理登记手续。',
          },
          exampleEn: 'We need to check in at the hotel before six.',
          explanationZh: '我们需要在六点前办理酒店入住。',
          action: { label: '下一题' },
        }}
        onExit={() => undefined}
        onSelect={() => undefined}
        onAction={() => undefined}
        onRetryTrainingContent={() => undefined}
      />
    )
  }

  if (id === 'listening') {
    return (
      <ListeningTrainingScreen
        viewModel={{
          header: {
            eyebrow: 'LISTENING',
            title: '听力训练',
            progress: { label: '2 / 6', value: 34 },
            trainingBudget: {
              status: 'finish-current-item',
              targetEffectiveSeconds: 900,
              remainingEffectiveSeconds: 0,
              completedItemCount: 8,
            },
          },
          instruction: '听一遍，然后回答',
          player: {
            status: 'paused',
            elapsedLabel: '00:12',
            durationLabel: '00:28',
            progressValue: 43,
            rateLabel: '速度 1.0×',
            playCountLabel: '已播放 1 / 2',
            statusLabel: '已暂停',
          },
          playbackControls: {
            rate: {
              label: '播放速度',
              currentValue: 1,
              options: [
                { value: 0.75, label: '0.75×' },
                { value: 1, label: '1×' },
                { value: 1.25, label: '1.25×' },
              ],
            },
            segment: {
              label: '播放片段',
              currentId: 'line-guest',
              options: [
                {
                  id: 'line-guest',
                  label: '第 1 句',
                  supportingText: '客人',
                },
                {
                  id: 'line-clerk',
                  label: '第 2 句',
                  supportingText: '前台',
                },
              ],
            },
            repeat: {
              label: '重复方式',
              currentMode: 'segment',
              options: [
                { value: 'none', label: '不重复' },
                { value: 'segment', label: '当前句' },
                { value: 'all', label: '全文' },
              ],
            },
          },
          question: {
            kind: 'single-choice',
            available: true,
            prompt: '对话中的客人想做什么？',
            choices: [
              { id: '1', label: '办理入住', state: 'correct' },
              { id: '2', label: '更换航班', state: 'default' },
              { id: '3', label: '预订餐桌', state: 'default' },
            ],
          },
          feedback: {
            tone: 'success',
            title: '抓住了关键信息',
            description: '对话提到了 reservation 和 room。',
          },
          transcript: [
            {
              id: 'line-guest',
              speaker: 'Guest',
              text: 'Hi, I have a reservation under Chen.',
              translationZh: '你好，我用 Chen 这个名字订了房。',
            },
            {
              id: 'line-clerk',
              speaker: 'Clerk',
              text: 'Welcome. May I see your ID?',
              translationZh: '欢迎。可以看一下你的证件吗？',
            },
          ],
          rationaleZh: '客人说明已有预订，前台随后核验证件，因此是在办理入住。',
          action: { label: '下一题' },
        }}
        onExit={() => undefined}
        onToggleAudio={() => undefined}
        onPlaybackRateChange={() => undefined}
        onSegmentChange={() => undefined}
        onRepeatModeChange={() => undefined}
        onQuestionInput={() => undefined}
        onAction={() => undefined}
        onRetryTrainingContent={() => undefined}
      />
    )
  }

  if (id === 'listening-dictation') {
    return (
      <ListeningTrainingScreen
        viewModel={{
          header: {
            eyebrow: 'LISTENING',
            title: '关键词听写',
            progress: { label: '3 / 6', value: 50 },
            trainingBudget: {
              status: 'running',
              targetEffectiveSeconds: 900,
              remainingEffectiveSeconds: 481,
              completedItemCount: 6,
            },
          },
          instruction: '听清关键词，再输入英文',
          player: {
            status: 'paused',
            elapsedLabel: '00:08',
            durationLabel: '00:19',
            progressValue: 42,
            rateLabel: '速度 0.75×',
            playCountLabel: '已播放 1 / 3',
            statusLabel: '已暂停',
          },
          playbackControls: {
            rate: {
              label: '播放速度',
              currentValue: 0.75,
              options: [
                { value: 0.75, label: '0.75×' },
                { value: 1, label: '1×' },
                { value: 1.25, label: '1.25×' },
              ],
            },
            segment: {
              label: '播放片段',
              currentId: 'airport-question',
              options: [
                { id: 'airport-question', label: '第 1 句' },
                { id: 'airport-answer', label: '第 2 句' },
              ],
            },
            repeat: {
              label: '重复方式',
              currentMode: 'segment',
              options: [
                { value: 'none', label: '不重复' },
                { value: 'segment', label: '当前句' },
                { value: 'all', label: '全文' },
              ],
            },
          },
          question: {
            kind: 'keyword-dictation',
            prompt: '输入你听到的地点关键词',
            requirements: {
              targetLabel: '写出听到的城市名。',
              countLabel: '需要填写 1 项关键信息。',
              orderLabel: '只有 1 项，不涉及先后顺序。',
              formatLabel: '输入一条英文短语。',
            },
            textInput: {
              label: '英文关键词',
              value: dictationValue,
              placeholder: '输入一个英文单词',
              disabled: false,
              state: dictationValue ? 'ready' : 'empty',
              description: '只填写题目要求的关键词。',
              statusLabel: dictationValue ? '可以提交' : '输入后即可提交',
            },
          },
          action: {
            label: '提交听写',
            disabled: !dictationValue,
          },
        }}
        onExit={() => undefined}
        onToggleAudio={() => undefined}
        onPlaybackRateChange={() => undefined}
        onSegmentChange={() => undefined}
        onRepeatModeChange={() => undefined}
        onQuestionInput={(intent) => {
          if (intent.type === 'change-keyword-dictation') {
            setDictationValue(intent.value)
          }
        }}
        onAction={() => undefined}
        onRetryTrainingContent={() => undefined}
      />
    )
  }

  if (id === 'speaking') {
    return (
      <SpeakingTrainingScreen
        viewModel={{
          header: {
            eyebrow: 'SPEAKING',
            title: '口语跟读',
            progress: { label: '1 / 4', value: 25 },
            trainingBudget: {
              status: 'content-exhausted',
              targetEffectiveSeconds: 900,
              remainingEffectiveSeconds: 318,
              completedItemCount: 11,
              contentExhausted: {
                reason: 'provider-failure',
                description:
                  '题库提供器暂时无法返回新的合格口语题。',
              },
              retryAction: {
                label: '重新获取题目',
              },
            },
          },
          instruction: '跟读这句话',
          prompt: 'I have a reservation under Chen.',
          cueZh: '说明你已经用 Chen 这个名字预订。',
          recorder: {
            status: 'review',
            statusLabel: '本次无法识别',
            description: '这次不会评分，你仍可以播放录音检查表达。',
            timeLabel: '00:08',
            playbackAvailable: true,
          },
          feedback: {
            tone: 'device',
            title: '已切换为录音回放',
            description: '识别失败不会降低你的口语能力记录。',
          },
          action: { label: '完成回放' },
          secondaryActionLabel: '重新录音',
        }}
        onExit={() => undefined}
        onRecorderAction={() => undefined}
        onPlayback={() => undefined}
        onAction={() => undefined}
        onSecondaryAction={() => undefined}
        onRetryTrainingContent={() => undefined}
      />
    )
  }

  if (id === 'progress') {
    return (
      <ProgressOverviewScreen
        viewModel={{
          title: '学习进度',
          description: '词汇、听力和口语分别查看，不合并成总分。',
          domains: [
            {
              domain: 'vocabulary',
              label: '词汇',
              currentLevelLabel: '5.5',
              levelChangeLabel: '+0.5',
              trend: 'improving',
              progressValue: 68,
              performanceLabel: '72%',
              retentionLabel: '64%',
              masteryLabel: '68%',
              confidenceLabel: '置信度 78%',
              commonErrors: ['词义回忆', '词形选择'],
            },
            {
              domain: 'listening',
              label: '听力',
              currentLevelLabel: '4.0',
              levelChangeLabel: '0.0',
              trend: 'stable',
              progressValue: 57,
              performanceLabel: '61%',
              retentionLabel: '55%',
              masteryLabel: '57%',
              confidenceLabel: '置信度 69%',
              commonErrors: ['细节遗漏'],
            },
            {
              domain: 'speaking',
              label: '口语',
              currentLevelLabel: '待校准',
              levelChangeLabel: '—',
              trend: 'insufficient-evidence',
              progressValue: 0,
              performanceLabel: '—',
              retentionLabel: '—',
              masteryLabel: '—',
              confidenceLabel: '可靠证据不足',
              commonErrors: [],
            },
          ],
          streak: {
            currentLabel: '5 天',
            longestLabel: '12 天',
          },
          reassessment: {
            title: '听力和口语需要复测',
            description: '已有足够的新学习证据，可以重新估算这两个专项。',
            actionLabel: '开始专项复测',
          },
        }}
        onReassessment={() => undefined}
      />
    )
  }

  return (
    <main className="visual-fixture-canvas">
      <MicrophonePermissionCard
        state="denied"
        description="请在 Safari 网站设置中允许麦克风，然后返回重试。"
        primaryAction={{ label: '重新检查' }}
        secondaryAction={{ label: '返回今日计划' }}
        onPrimaryAction={() => undefined}
        onSecondaryAction={() => undefined}
      />
    </main>
  )
}
