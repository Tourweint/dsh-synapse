# 项目工作须知

`dsh-synapse` 是 DeepSeek Harness（DSH）的会话地图插件，零运行时依赖、无构建产物。三块代码：
`index.js`（Host 半部，路由 + 投影 + 存储）、`client.js`（浏览器桥，注入 DSH 页面）、`app.js`（画布 UI，跑在 iframe 里）。

架构与边界见 `docs/architecture.md`，发布流程见 `docs/development.md`。

## 开发循环

```powershell
corepack pnpm install --frozen-lockfile   # 无依赖，只跑 prepare
corepack pnpm run build                   # node --check index.js client.js app.js
corepack pnpm test                        # node --test test/*.test.js
cd dev/harness; npm install; npm test     # 真实渲染 + 真实点击（需 jsdom）
```

`build` 只做语法检查，没有打包步骤；改完直接生效。

## 在本机 App 里调试（踩过坑，照做）

DSH 桌面 App 的 profile 是 **pnpm 供应链校验**过的，插件必须走官方入口装入，否则插件宿主起不来，
表现是**整个 App 点不动**，而 `~/.dsh/synapse/workspaces.json` 仍在被写（投影先于路由注册执行），
极容易误判成前端 bug。

```powershell
cd 'D:\Program File\DeepSeekHarness\resources\runtime\cli\bin'
.\dsh.cmd plugin --profile desktop add "link:D:/Projects/fork/dsh-synapse"
```

- **不要**手工建 junction / 软链顶替 `node_modules/dsh-synapse`：lockfile 里没有记录，App 启动时校验不过。
- `dsh plugin` 只是在 profile 目录转发 pnpm，`link:` 会写进 `package.json` 与 `pnpm-lock.yaml`。
- 改 `app.js` / `client.js` 后刷新页面即可；改 `index.js` 必须重启 App。
- 退回 npm 版：`.\dsh.cmd plugin --profile desktop add dsh-synapse@<version>`（`0.5.3` 及更早没有 morph，可作对照）。
- `dsh --profile desktop` 不能直接 boot（提示 “managed exclusively by the Electron application”），
  `--dump-config` 同理不可用。

## 测试的三层，以及各自的盲区

| 层 | 位置 | 管什么 | 盲区 |
|---|---|---|---|
| Host 单测 | `test/workspace-store.test.js`、`test/plugin-apply.test.js` | 存储、投影、迁移、路由挂载 | 不碰浏览器 |
| vm 切片 | `test/conversation-cards.test.js`、`test/message-projection.test.js` 等 | 从 `app.js` 切函数片段跑 | 不渲染、不点击 |
| 源码契约 | `test/morph-render.test.js`、`test/canvas-runtime.test.js` | 用正则锁住关键写法 | **函数在 ≠ 点了有反应** |
| 点击级 | `dev/harness/click.mjs` | 真实 Host + jsdom 真实点击 | 无布局，尺寸相关只验证不报错 |

**改 UI 渲染/事件的一定要跑 `dev/harness`**：0.5.4 的 morph 回归让 101 个测试全绿而页面完全不可用。

## `app.js` 的 morph 补丁层：三条硬约束

`morphInto()` 原地打补丁取代 `innerHTML` 整体重建，因此：

1. **兄弟节点的 key 必须唯一。** key 依次取 `data-morph-key` → `data-card-id` → `data-thread` → `id`。
   `data-thread` 在卡片里被所有控件共用（详情 / DSH / 归档、追问 / 分支），所以配 key 时还要拼上
   `data-action` / `data-card` / `data-seq`；新增"同一父节点下多个同 thread 控件"时必须确认 key 不同。
2. **一个活节点只能被匹配一次**（`keyed.delete(key)`）。否则第二个同 key 的节点会覆盖第一个，原节点被当作未匹配删除。
3. **`morphHoldsCaret()` 只冻结光标所有者本身**（以及 contenteditable 宿主），绝不能 `contains()` 整条祖先链：
   页面里只要存在选区或输入框聚焦，`<main>` 就会被判定为光标宿主，此后所有 `render()` 变成空操作，
   表现为"点啥都没用"。

另外：地图/详情两个视图根节点是 `<section>`，必须带 `data-morph-key`，否则会被按位置配成一对互相打补丁，
切换后卡片丢失。

## 数据位置

- `$DSH_HOME/synapse/workspaces.json`：画布布局 + 每轮 280 字预览（schema v5），**正文不在这里**。
- `$DSH_HOME/sessions/--<cwd slug>--/session-*/`：DSH 会话日志，正文按需从这里读。
- 删掉 `workspaces.json` 只丢布局，不丢会话。
- 调试用的临时产物（`dev/harness/node_modules`、`%TEMP%` 下的 jsdom 环境）都不进 git，
  `dev/` 也不在 `package.json` 的 `files` 白名单里，不会进 npm 包。
