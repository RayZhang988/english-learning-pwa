# 自适应词汇测试 v2 集成交接

> **已废止，不得注册到正式入口。** 本文仅供旧 schema 2 快照恢复。当前生产候选入口
> 见 `travel-vocabulary-r1-handoff.md`。

## 给 01：注册与持久化

以下是历史 v2 入口，仅供兼容解析：

```ts
import {
  createVocabularyAssessmentFeatureModule,
  createVocabularyPlacementRuntime,
  restoreVocabularyPlacementRuntime,
  VersionedAssessmentProfileRepository,
  VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
  LEGACY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
} from '@/features/assessment'
```

- 路由模块：`createVocabularyAssessmentFeatureModule(routeElement)`
- 新会话：`createVocabularyPlacementRuntime({ now, createId, onCompleted })`
- 恢复：`restoreVocabularyPlacementRuntime({ snapshot, now, onCompleted })`
- v2 快照 key：`active-vocabulary-assessment-runtime-v2`
- v1 旧 key：`active-assessment-runtime-v1`
- 最新档案仍使用既有 `latest-ability-profile` key，但读写器改为
  `VersionedAssessmentProfileRepository`，可读 v1/v2，写入时使用档案自身版本。

注册时不能同时挂载 v1 与 v2 两个 assessment route。v1 运行时只保留给旧快照解析和
迁移，不再用于全新设备。

建议恢复顺序：

```ts
const v2Snapshot = await read(VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY)
if (v2Snapshot) {
  return restoreVocabularyPlacementRuntime({ snapshot: v2Snapshot })
}

const v1Snapshot = await read(LEGACY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY)
if (v1Snapshot) {
  const runtime = restoreVocabularyPlacementRuntime({
    snapshot: v1Snapshot,
  })
  await write(
    VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
    runtime.toSnapshot(),
  )
  // 只有上面的 v2 写入确认成功后，01 才能归档或清理旧 key。
  return runtime
}

return createVocabularyPlacementRuntime()
```

`restoreVocabularyPlacementRuntime` 根据 `schemaVersion` 显式分支：

- v2：严格校验并恢复为 paused；
- v1 仍在词汇阶段：只导入词汇证据，保存完整 `legacySource.snapshot` 后恢复；
- v1 已进入听力/口语或已完成：使用已存在的词汇证据完成 v2 迁移，绝不继续旧听力或
  口语阶段；
- 损坏、未知或未来版本：抛出验证错误，01 应保留原始记录并显示可重试/重新开始，
  不得以空档案覆盖。

存储事务、旧 key 的归档/删除和应用路由仍归 01；03 不直接实现这些动作。

完成回调收到真实 `AbilityProfileV2`：

```ts
const runtime = createVocabularyPlacementRuntime({
  onCompleted: async (profile) => {
    await versionedProfileRepository.saveLatest(profile)
  },
})
```

同一运行时只投递一次完成回调。完成状态后所有答题、继续和停止动作都会拒绝。

## 公开会话状态与动作

`VocabularyAssessmentRuntimeStateV2` 只可能有以下阶段：

- `lifecycle: "intro"`：可 `start()`；
- `"active"`：可 `selectChoice()`、`submitChoice()`、
  `submitUncertain()` / `skip()`、`pause()`、`stop()`；
- `"feedback"`：可 `continue()`、`pause()`、`stop()`；
- `"paused"`：可 `resume()` 或 `stop()`；
- `"completed"`：只读 `profile`。

公开 `item` 只有 `domain: "vocabulary"`、`kind: "choice"`，且没有 `scoring`。
状态机没有 listening/speaking 阶段，也没有录音、音频播放或提交语音动作。

`progress` 提供：

```ts
{
  phase,
  elapsedSeconds,
  targetMinimumSeconds, // 480
  targetMaximumSeconds, // 720
  hardLimitSeconds,     // 900
  attempted,
  minimumEvidence,
  maximumAttempts,
  estimatedLevel,
  estimatedRange,
  confidence,
  confidenceBand
}
```

运行时只累计前台活跃时间；恢复时离线时长不计入。达到 15 分钟时，迟到的当前答案不会
进入证据，测试以 `time-limit` 和 partial 档案结束。

`skip()` 与 `submitUncertain()` 同义，记录 `answer: "uncertain"` 和较低可靠性，不按
普通答错处理。低于 2.5 秒的答案标记为快速猜测并降权；连续 4 次快速猜测或不确定会
停止。

## 给 02：页面状态与字段

02 只需呈现以下状态，不得自行计算选题、答案、等级或词数：

1. 介绍页：标题明确“自适应词汇起点测试”；显示目标 8–12 分钟、最长 15 分钟、只测
   词汇和非官方说明；不显示耳机、麦克风或口语设备检查。
2. 作答页：使用 `item.prompt`、`item.stimulus.text`、`item.options`；
   `actions.canMarkUncertain` / `canSkip` 对应“不确定/跳过”。
3. 进度页：使用 `progress.elapsedSeconds`、`attempted`、`confidenceBand`；题量不是
   固定线性进度，不得渲染成“第 N / 固定总题数”。
4. 反馈页：只确认“已记录”或“不确定”，不得在测试过程中展示正确答案，以免污染后续
   自适应证据。
5. 暂停/恢复页：使用 `lifecycle` 与 `actions`，不自行拼装会话。
6. 低质量或提前停止结果：`profile.outcome: "partial"`，展示词汇证据不足和重测建议。
7. 正常结果：只展示 `vocabularySize.label`、词汇内部等级/区间、置信度、边界警告和
   disclaimer。听力、口语显示“待校准”，不能显示从词汇推导的数值，也不能出现综合
   英语总分。

02 若需要展示“估算词汇量区间”，当前唯一可辩护的字段是
`vocabularySize.internalRange`（内部词汇难度区间）。`wordCountRange` 明确为 `null`；
不得在 UI 端换算出词数。

## 给 04：接入点

04 读取 `AbilityProfileV2` 的规则见
`content/assessment/ability-profile-v2-contract.md`。听力和口语只能在正常训练中
校准；03 不提供额外的强制校准测试。
