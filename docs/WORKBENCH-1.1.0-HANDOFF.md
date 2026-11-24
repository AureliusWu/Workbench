# Workbench 1.1.0 开发交付

## 修改前的源码审查

| 项目 | 1.0.1 源码确认结果 |
| --- | --- |
| 技术栈 | React 19、TypeScript、Vite 7、Electron 45。`npm run dev` 启动网页预览，`npm run build` 做类型检查与生产构建，`npm start` 打开桌面应用。 |
| 既有检查 | `npm test`、`npm run test:native`、`npm run test:e2e`。仓库没有独立 lint 命令。 |
| 页面入口 | `src/main.tsx` 创建根节点，`src/App.tsx` 维护工作台、月历、清单、便笺、复盘、文件和设置。首页包含纵向问安、统计、清单与小工具，常见窗口上需要整页滚动。 |
| 待办 | 日期是本地 `YYYY-MM-DD`，时间是 `HH:mm` 或空值。标题、优先级、步骤、复选框和完成时间共用一份状态。重复待办通过 `模板 ID::日期` 保存当日覆盖记录。 |
| 日历 | 月历按日期调用 `tasksForDate`，显示数量或圆点。日程列表显示选中日标题。原有节假日与月末周六规则独立于待办。 |
| 周复盘 | `reviews` 以周一的本地日期保存文本。编辑某一周只写该周的键。此前只能逐周切换。 |
| 便笺 | 包含 ID、正文、颜色和创建时间，支持单独打开置顶窗口。没有标签和归档状态。 |
| 持久化与备份 | 桌面端经受限 IPC 使用 `%APPDATA%\Workbench\workbench.json`，原子替换并保留 `.bak`。网页预览使用 `localStorage`。JSON 备份为 schema 1，密钥文件单独由 Windows 加密保存。 |
| 快速录入 | 只有手动待办表单，未装自然语言解析库。 |

## 文件与数据兼容

| 文件 | 改动 |
| --- | --- |
| `src/App.tsx`、`src/workspace.css` | 首页周切换、快速输入、周日历和两侧辅助区。保留原有任务表单、月历和专注计时。加入无日期待办、复盘历史跳转和便笺管理入口。 |
| `src/components/WeekCalendar.tsx`、`src/components/ReviewTools.tsx`、`src/components/calendar-review.css` | 七天日历、日期跳转与 Markdown 导出入口。周日历和列表按同一待办状态渲染。 |
| `src/components/NotesPanel.tsx` | 标签新建、重命名、删除、过滤及便笺归档、恢复。 |
| `src/lib/quickTask.ts`、`src/lib/tasks.ts`、`src/lib/review.ts` | 本地中文解析、无日期兼容、所选周的 Markdown 与历史索引。 |
| `src/types.ts`、`src/state.ts`、`electron/state.cjs` | 沿用 schema 1，旧便笺默认空标签、未归档。原有字段、周键、完成记录和设置继续保留。 |
| `electron/main.cjs`、`electron/preload.cjs` | 原生 Markdown 保存、导入前恢复快照、避免导出覆盖正在使用的数据。 |
| `package.json`、`package-lock.json`、`.github/workflows/ci.yml` | 1.1.0 版本、一键安装配置、Windows 构建与安装生命周期测试。 |
| `scripts/smoke.cjs`、`scripts/native-test.cjs`、`src/lib/*.test.ts` | 旧数据和旧备份、快速建单、周与清单同步、复盘导出、标签归档、重启等回归。 |
| `scripts/installer-lifecycle.ps1`、`scripts/installed-profile.cjs` | 在临时 Windows 用户环境检查安装覆盖、安装前后文件哈希和数据保留。 |

启动不写主文件或轮换恢复副本。第一次实际保存新版数据时，旧主文件原样保留在 `%APPDATA%\Workbench\backups\before-1.1.0.json`。确认导入备份时，先保留一份独立的导入前副本。新增标签、归档状态和无日期待办会随 JSON 导出。旧版读取器早于这些功能，写入新版记录后应继续用新版。回退时先另存新版备份，再使用升级前的记录副本。

## 手动验收

1. 首页输入「明天下午三点开会」并回车。确认对应日期显示 15:00「开会」，点击可编辑。在右侧勾选完成，检查两处划线。输入「下周找时间打电话」应提示补充具体日期。只写「核对采购订单」时，在「待办清单 → 未排期」中能找到它。
2. 在首页切换前后周并回到本周。找到过去已完成的待办。进入「周度复盘」，通过日期或历史列表打开一周，导出 Markdown。核对文件名、日期范围、未完成和已完成事项及复盘正文。
3. 进入「灵感便笺 → 管理标签」，新建两个标签。给便笺同时勾选两个标签并保存。按其中一个筛选。归档后进入归档区，重启应用，再次检查正文和标签。恢复便笺并删除一个标签，确认正文和剩余标签仍在。
4. 在独立测试数据目录用旧 JSON 启动新版。检查历史任务、便笺与周复盘。确认导入旧备份后再次导出，备份包含 `noteTags`、`tagIds`，归档的便笺含 `archivedAt`。
5. 在 1366×768 或 1440×940 桌面窗口打开首页。周日历、待办和便笺同时可见，多条记录在卡片内滚动。小窗口可通过侧栏滚动打开设置。

调休数据继续使用内置的 2026、2027 年规则。自然语言解析处理常用中文日期与时间，遇上模糊时段会留下空时间。历史复盘按所选周的计划日期读取任务，未排期事项保留在清单里。
