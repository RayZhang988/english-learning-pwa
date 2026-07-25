# 01｜步骤 3–7 交付说明

## 交付状态

`01｜技术架构与 PWA 底座` 的步骤 3、4、5、6、7 已完成。

本通知只记录技术底座步骤 3–7 当时的状态。后续真实运行时集成见
`docs/01-step-8-runtime-integration.md`。

## 步骤 3：目录、所有权、契约和版本

- 文件所有权遵循根目录 `AGENTS.md`。
- 路由、模块注册和顶层 Provider 由 `src/app/**` 统一集成。
- 跨模块公共入口为 `src/core/index.ts`、`src/platform/index.ts`、
  `src/storage/index.ts`、`src/pwa/index.ts` 和 `src/ui/index.ts`。
- `FeatureModule` 定义了模块标识、路由基址、存储命名空间、数据版本和相对子路由。
- `PlatformEvent` 只定义通用版本化事件信封，具体学习事件由 04 定义。
- `AsyncDataState<T>` 和 `ReadonlyDataSource<T>` 定义业务数据到 UI 的状态边界。
- 数据版本与迁移规则记录在 `docs/architecture-contracts.md`。

因此，03、04、05 已满足开始详细设计所需的 01 依赖。

## 步骤 4：可运行 PWA 基础项目

- React、TypeScript、Vite 和 Hash Router 可构建运行。
- 顶层应用壳、404、路由错误页和 React 错误边界已经接入。
- 02 的视觉组件通过 `src/ui/index.ts` 接入；视觉 CSS 位于
  `src/ui/styles/app.css`，根样式只负责基础重置和导入。

## 步骤 5：存储、迁移、错误和权限

- Dexie / IndexedDB 以独立命名空间保存可移植 JSON 数据。
- `migratePortableValue()` 验证并执行连续单步迁移。
- `readMigratedRecord()` 在读取旧数据后升级并写回当前版本。
- 未来数据版本、缺失迁移和非法迁移会显式失败，不会静默覆盖。
- 已提供容量、持久化、备份、合并/替换恢复、通用错误和麦克风权限能力。

## 步骤 6：离线、更新和安装

- Manifest、安装图标和 iPhone Web App 元数据已经配置。
- Workbox 预缓存应用壳；新版本自动激活、接管客户端，并由应用级 guard 只刷新一次。
- Workbox 激活时清理过期预缓存，不清除 IndexedDB、localStorage 或显式离线课程包。
- 课程资源通过显式 `OfflineAssetStore` 安装，不把偶然访问等同于已下载。
- GitHub Pages 使用 HTTPS 部署。

## 步骤 7：模块空壳、契约和模拟接口

步骤 7 当时预留但未注册的模块槽位：

| 模块 | 任务 | 路由 | 存储 |
| --- | --- | --- | --- |
| assessment | 03 | `#/assessment` | `feature.assessment` |
| vocabulary | 06 | `#/vocabulary` | `feature.vocabulary` |
| listening | 07 | `#/listening` | `feature.listening` |
| speaking | 08 | `#/speaking` | `feature.speaking` |

`createFeatureRegistry()` 会拒绝未预留模块、重复标识、重复路径、重复命名空间、
错误版本和绝对业务路由。当前生产注册表已经接入 06、07、08；以步骤 8 交接文档和
实际注册表为准。

测试适配器位于 `src/core/testing/index.ts`：

- 静态数据源
- 失败数据源
- 内存事件接收器
- 合成 FeatureModule 工厂

这些适配器只用于开发和单元测试，不进入生产注册表。

## 验证证据

执行：

```bash
pnpm check
```

结果：

- oxlint 通过
- TypeScript 类型检查通过
- 8 个测试文件、24 项测试通过
- Vite 生产构建通过
- Workbox 生成 Service Worker
- 12 个应用壳资源进入预缓存

## 后续模块接入要求

1. 模块任务只修改自己的目录，并从公开入口导出 `FeatureModule`。
2. 模块的 `id`、`routeBase` 和存储命名空间必须匹配预留槽位。
3. 模块路由必须相对于自己的路由基址。
4. 模块负责业务状态、判定和事件语义；02 负责展示；01 负责最终注册。
5. 模块交付后由 01 审查公开入口并加入生产注册表。

## 未完成与遗留风险

- 03–08 尚未交付真实业务模块，01 步骤 8 不能开始完整集成。
- 当前 UI 使用 02 的演示 ViewModel，只用于验证展示和集成边界，不代表真实学习计划。
- 真实 iPhone 上的数据写入、备份恢复、麦克风降级和课程媒体离线必须在业务模块
  接入后复验，并由 09 给出最终验收结论。
