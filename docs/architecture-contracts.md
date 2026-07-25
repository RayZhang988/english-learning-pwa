# 01｜架构、所有权与模块契约

## 技术方案记录

第一版采用 React、TypeScript、Vite、React Router Hash 路由、Dexie /
IndexedDB、vite-plugin-pwa / Workbox 和 Cache Storage。

比较过的方向：

1. React + Vite：生态成熟，静态部署简单，现有模块可通过类型契约接入。
2. Preact + Vite：体积更小，但对本项目 2–4 周内容规模收益有限，会增加兼容差异。
3. 原生 Web Components：依赖最少，但状态、路由、测试和多人模块交付成本更高。

采用方案 1。这里的关键约束不是框架性能，而是无后端、iPhone Safari、静态 HTTPS
部署和清晰的跨任务边界。Hash 路由避免静态托管服务为每个路径配置回退规则。

## 文件所有权

最终所有权以根目录 `AGENTS.md` 为准。集成时遵守以下依赖方向：

```text
src/main.tsx
  -> src/app/**
      -> src/core/**, src/platform/**, src/storage/**, src/pwa/**
      -> src/ui/** public exports
      -> delivered src/features/** public exports

src/features/<feature>/**
  -> src/core/index.ts
  -> src/platform/index.ts
  -> src/storage/index.ts
  -> src/pwa/index.ts
  -> src/ui/** public exports
```

业务模块不得导入其他业务模块的内部文件，也不得修改 `src/app/**`。01 只从模块公开
入口导入交付物并注册。

## 预留模块槽位

预留槽位描述计划中的交付位置，不会创建假模块或假训练逻辑：

| 模块 | 任务 | 路由基址 | 存储命名空间 |
| --- | --- | --- | --- |
| assessment | 03 | `assessment` | `feature.assessment` |
| vocabulary | 06 | `vocabulary` | `feature.vocabulary` |
| listening | 07 | `listening` | `feature.listening` |
| speaking | 08 | `speaking` | `feature.speaking` |

04 的学习引擎不拥有页面路由，通过其公开接口和平台事件契约向其他模块交付数据。
05 只交付结构化内容包，不注册运行时路由。

## FeatureModule 输入输出

每个可路由业务模块从自己的公开入口导出一个用 `defineFeatureModule()` 定义的
`FeatureModule`：

- `id`：必须匹配预留槽位。
- `routeBase`：不带 `/` 的单段路径，必须匹配预留槽位。
- `storage.namespace`：模块独占命名空间，必须匹配预留槽位。
- `storage.schemaVersion`：正整数，表示该模块当前写入的数据版本。
- `routes`：相对于 `routeBase` 的 React Router 子路由；不得使用绝对路径。

01 的注册表验证标识、路径、命名空间、版本和重复项，然后将路由挂载到应用。
未交付模块保持未注册，不显示为可用功能；纯 UI 原型可以展示空状态，但不能冒充业务模块。

## 路由、状态和组件边界

- 01 拥有 Hash Router、顶层错误边界、404、模块挂载和 PWA 生命周期 Provider。
- 02 拥有 `src/ui/**` 中的纯展示组件、视觉状态和样式。
- 业务模块拥有数据加载、状态机、判定、事件上报和业务错误映射。
- 业务模块通过 props 或 `ReadonlyDataSource<T>` 把 ViewModel 交给 UI。
- 异步状态统一为 `AsyncDataState<T>` 的 `idle/loading/empty/ready/error`，UI
  决定呈现方式，业务模块决定何时进入哪个状态。
- UI 不直接读取 IndexedDB、Cache Storage、麦克风或网络 API。
- 01 不定义水平测试、学习计划、训练判定或课程字段。

## 通用事件契约

`PlatformEvent` 只定义跨模块传输信封：

- `id`：事件唯一标识。
- `type`：由业务任务定义并版本化的事件名称。
- `sourceModuleId`：生产事件的模块。
- `occurredAt`：ISO 8601 UTC 字符串。
- `schemaVersion`：该事件 payload 的正整数版本。
- `payload`：仅允许 `PortableData`。

04 负责学习事件的具体名称和语义。01 不替 04 定义掌握度、复习或进度规则。

## 数据版本规则

1. IndexedDB 的物理数据库版本由 01 管理；业务模块不得直接修改 `AppDatabase`。
2. 每条业务记录保存独立的 `schemaVersion`，新写入始终使用模块当前版本。
3. 版本必须为正整数；只允许按连续版本逐步迁移，例如 1 → 2 → 3。
4. 读取旧记录时先迁移再使用；成功迁移后写回当前版本。
5. 遇到高于当前代码的未来版本必须停止读取并报告可恢复错误，不得降级覆盖。
6. 迁移必须确定、可重复测试，并且输出仍为 `PortableData`。
7. 日期保存为 ISO 8601 字符串。Blob、录音和课程媒体不进入 JSON 记录。
8. 内容包、事件和备份分别维护自己的格式版本，不能借用数据库版本。
9. `replace` 恢复必须在单一事务中完成；离线媒体清单不进入 JSON 备份。

## 模拟接口

01 提供不含业务数据的测试适配器：

- 静态 `ReadonlyDataSource<T>`：由调用方注入任意 ViewModel。
- 失败 `ReadonlyDataSource<T>`：验证错误状态。
- 内存 `PlatformEventSink`：记录已发布事件，供模块单元测试断言。
- Feature fixture factory：生成只用于注册表测试的合成模块。

这些适配器不会注册到生产应用，也不会伪造 assessment、vocabulary、listening 或
speaking 的业务交付。
