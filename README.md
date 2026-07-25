# 英语学习 PWA

个人使用、本地优先的英语学习 PWA。应用已接入真实课程、每日计划以及词汇、听力和
口语训练模块；学习状态只保存在当前设备。

## 技术栈

- React + TypeScript + Vite
- React Router（Hash 路由，保证任意静态托管都可直接工作）
- Dexie / IndexedDB（学习记录）
- vite-plugin-pwa / Workbox（应用壳缓存和版本更新）
- Cache Storage（显式下载的离线课程资源）
- Vitest（基础设施单元测试）

## 命令

```bash
pnpm install
pnpm dev
pnpm check
pnpm preview
```

`pnpm build` 生成纯静态 `dist/`，不要求服务器、账号或云服务。部署平台必须使用 HTTPS；本机 `localhost` 开发不受此限制。

推送到 `main` 后，`.github/workflows/deploy-pages.yml` 会执行完整检查、构建并部署 GitHub Pages。工作流中的第三方 Action 固定到具体提交，避免浮动标签在未审查的情况下改变构建行为。

当前部署地址：
<https://rayzhang988.github.io/english-learning-pwa/>

## 模块边界

```text
src/
  app/                 路由组合、模块注册、应用入口
  core/contracts/      跨模块契约
  core/errors/         通用错误边界与错误类型
  platform/            浏览器能力：网络、权限、录音能力探测
  pwa/                 Service Worker 生命周期和离线资源设施
  storage/             IndexedDB、存储健康、备份恢复
  ui/                  02 所有的主题、样式和纯展示组件
```

业务模块不得直接导入其他业务模块的内部文件。交付时实现 `FeatureModule`，只在 `src/app/module-registry.ts` 注册。

跨模块调用只能从公开入口导入：

- `src/core/index.ts`
- `src/platform/index.ts`
- `src/pwa/index.ts`
- `src/storage/index.ts`

`indexed-db/`、`backup/` 等子目录是底座内部实现，不是业务模块契约。

详细的路由所有权、预留模块槽位、事件信封、异步状态和数据版本规则见
[`docs/architecture-contracts.md`](docs/architecture-contracts.md)。01 步骤 3–7
的交付状态和接入检查清单见
[`docs/01-step-3-7-handoff.md`](docs/01-step-3-7-handoff.md)。

业务模块通过 `LocalStorageService.namespace()` 获得独立数据空间，自行维护其中数据的业务结构和 `schemaVersion`。平台层不替模块决定学习记录字段或算法。该接口只接受可移植 JSON 数据；`Date` 应保存为字符串，Blob、录音和课程媒体必须使用专门的二进制存储接口。

当前发布的课程 JSON 会随生产 PWA 版本预缓存；各训练模块仍可通过
`OfflineAssetStore.install()` 管理自己的显式内容包。

PWA 更新采用自动激活策略：新 Service Worker 接管页面后最多自动刷新一次，Workbox
只清理过期预缓存，不会清除评估、计划、训练进度或显式下载的离线课程包。

`StorageHealthService` 提供容量估算、持久化状态查询及持久化申请。不得把 `persist()` 调用成功等同于必然获批，应以返回的最新快照为准。

`LocalBackupService` 导出带格式版本的 JSON。恢复前先调用 `inspectJson()`；调用 `restoreJson()` 时必须明确选择：

- `merge`：按命名空间和键覆盖同名记录，保留备份外记录。
- `replace`：在一个 IndexedDB 事务中清空并恢复全部记录。

解析和格式校验在事务前完成，无效或未来版本备份不会改动现有数据。

备份不包含 `pwa.offline-packages`。该命名空间只描述当前设备的 Cache Storage，恢复它会制造“显示已下载、实际无文件”的假状态；课程资源应在恢复后重新下载。

## 当前状态与限制

- 01 步骤 3–7 已交付；真实每日计划、生产事件协调器和 06/07/08 路由已集成。
- GitHub Pages 和对应 CI 已启用。
- 生产模块注册表包含 assessment、vocabulary、listening、speaking。
- 180、192、512 像素 PWA 图标满足安装技术要求；最终图标视觉由 02 交付。
- 干净设备会进入 assessment-required，并可完成正式水平测试；评估快照、能力档案、
  首日计划和训练进度均使用版本化本地存储。
- `pnpm check` 已覆盖正式评估、四周课程、首日计划、训练路由、刷新恢复和 PWA 构建。
- 真实 iPhone 安装、离线、麦克风和恢复由 09 执行。

真实运行时、路由、存储和 09 前置条件见
[`docs/01-step-8-runtime-integration.md`](docs/01-step-8-runtime-integration.md)。
