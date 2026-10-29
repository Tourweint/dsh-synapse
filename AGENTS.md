# dsh-synapse — 项目工作须知

DeepSeek Harness（DSH）的会话地图插件：零运行时依赖，无构建产物，改完即生效。

- 架构与边界：`docs/architecture.md`
- 发布流程：`docs/development.md`
- 用户文档：`docs/zh-CN/README.md`、`docs/en/README.md`

## 目录

- [三块代码](#三块代码)
- [Host 半部的模块划分](#host-半部的模块划分)
- [画布 UI 的模块划分](#画布-ui-的模块划分)
- [开发循环](#开发循环)
- [在本机 App 里调试](#在本机-app-里调试)
- [测试的四层与各自的盲区](#测试的四层与各自的盲区)
- [DOM 补丁层（`app/morph.js`）](#dom-补丁层appmorphjs三条硬约束)
- [卡片：一个 turn = 两张卡](#卡片一个-turn--两张卡七条契约)
- [详情页：一列对话](#详情页一列对话不是一叠卡片)
- [Markdown 与代码块](#markdown-与代码块)
- [侧边栏与外壳](#侧边栏与外壳)
- [顶栏：标签行与右上角](#顶栏标签行与右上角)
- [页面级开关：对话 / 会话地图](#页面级开关对话--会话地图clientjs)
- [配色只住在一个文件里](#配色只住在一个文件里)
- [数据位置](#数据位置)

## 三块代码

| 文件 | 是什么 | 改完要做什么 |
|---|---|---|
| `index.js` | Host 半部的公开出口（barrel），实现都在 `host/*.js` | **重启 App** |
| `client.js` | 浏览器桥：把画布注入 DSH 页面 | 刷新页面（还不行就重启 App） |
| `app/*.js` | 画布 UI：15 个 classic script，跑在 `/synapse/` iframe 里 | 刷新页面 |

**最容易浪费半小时的一条**：地图 iframe 只在 DSH 页面 mount 时创建一次，切「对话 / 会话地图」只是把它 `hidden` 掉再显示，**不会重新拉 `app/*.js` 和 CSS**。所以改完必须整页 `Ctrl+R`，光点标签看不到任何变化。

## Host 半部的模块划分

`host/` 是真正的 ES 模块（`import`/`export`），`index.js` 只是把测试与 DSH 需要的名字再导出一次——别把逻辑写回 barrel 里。

| 模块 | 内容 |
|---|---|
| `constants.js` | 各种上限、截断尾巴、颜色表、注入来源白名单 |
| `values.js` | 校验、标题推断、`proseText()` / `contentText()`、注入判定 |
| `projection.js` | 会话事件 → 存储图（`normalizeState` / `bodiesFromEvents`） |
| `store.js` | `WorkspaceStore`：加载、迁移、锁、防抖写盘（最大的一个，~565 行） |
| `sessions.js` | 读 DSH 会话日志，含 zstd 解压 |
| `http.js` | `readJson` / `sendJson` / `sendFile` |
| `apply.js` | 插件入口：`APP_SCRIPTS`、`page()`、路由表 |

**坑**：静态资源读取用的是 `new URL('../tokens.css', import.meta.url)`——模块搬到 `host/` 之后，所有 `./xxx` 都要多一层 `..`，否则只有 harness/页面会 404，单测全绿也看不出来。

## 画布 UI 的模块划分

`app/` 是**同一份全局作用域**按章节切开的，不是 ES 模块——没有 import/export，也没有打包步骤。顺序就是依赖顺序，唯一权威是 `index.js` 里 re-export 的 `APP_SCRIPTS`（页面 `<script>` 标签和路由都由它生成，测试也从那里取）。

| 模块 | 内容 |
|---|---|
| `text.js` | `escapeHtml` / `clipText`，唯一的纯函数文件，无 DOM 无状态 |
| `dom.js` | 挂载点 `#app` |
| `core.js` | 常量、`state`、localStorage、`api/post/rpc` |
| `data.js` | 工作区 / 线程 / 消息装载，以及开启一轮的动作 |
| `markdown.js` | Markdown 解析 + 代码分词 |
| `layout.js` | 卡片几何、自动布局、连线路径 |
| `cards.js` | 卡片与草稿的 HTML、画布视口 |
| `process.js` | 工具调用记录（折叠行与抽屉里的块） |
| `detail.js` | 详情页转录 |
| `inspector.js` | 右侧抽屉：开合、宽度、内容 |
| `render.js` | `render()` 入口、按需拉正文、画布变换 |
| `morph.js` | 原地 DOM 打补丁 |
| `canvas.js` | 拖动、缩放、定位 |
| `events.js` | 各类监听、选区追问、切换工作区 |
| `live.js` | 桥消息、实时轮询、启动 |

两条规则：①**新增模块只在 `APP_SCRIPTS` 里插一行**（位置即加载顺序，`test/source.js` 直接复用这份列表，不用改别处）；②顶层只允许声明，**唯一会立刻执行的代码在 `events.js` / `live.js` 末尾**——把立即执行的语句塞进靠前的文件，会在它依赖的常量还没初始化时炸掉。

## 开发循环

```powershell
corepack pnpm install --frozen-lockfile   # 无依赖，只跑 prepare
corepack pnpm run build                   # node scripts/check.mjs：index.js + client.js + app/*.js + host/*.js
corepack pnpm test                        # node --test test/*.test.js
cd dev/harness; npm install; npm test     # 真实渲染 + 真实点击（需 jsdom）
```

`build` 只做语法检查，没有打包步骤。

提交信息照仓库既有风格：`type: 小写祈使句`（`feat` / `fix` / `docs` / `test` / `chore`），正文写**为什么**，不逐条罗列改动。

## 在本机 App 里调试

（踩过坑，照做。）

DSH 桌面 App 的 profile 是 **pnpm 供应链校验**过的，插件必须走官方入口装入，否则插件宿主起不来，表现是**整个 App 点不动**，而 `~/.dsh/synapse/workspaces.json` 仍在被写（投影先于路由注册执行），极容易误判成前端 bug。

```powershell
cd 'D:\Program File\DeepSeekHarness\resources\runtime\cli\bin'
.\dsh.cmd plugin --profile desktop add "link:D:/Projects/fork/dsh-synapse"
```

- **不要**手工建 junction / 软链顶替 `node_modules/dsh-synapse`：lockfile 里没有记录，App 启动时校验不过。
- `dsh plugin` 只是在 profile 目录转发 pnpm，`link:` 会写进 `package.json` 与 `pnpm-lock.yaml`。
- 退回 npm 版：`.\dsh.cmd plugin --profile desktop add dsh-synapse@<version>`（`0.5.3` 及更早没有 morph，可作对照）。
- `dsh --profile desktop` 不能直接 boot（提示 "managed exclusively by the Electron application"），`--dump-config` 同理不可用。
- 想确认运行中的 App 到底提供的是哪份文件，直接问它：先 `Get-NetTCPConnection` 找到 `DeepSeek Harness` 的监听端口，再 `GET /synapse/app/<模块>.js` 搜关键字。端口每次启动都会变。

## 测试的四层与各自的盲区

| 层 | 位置 | 管什么 | 盲区 |
|---|---|---|---|
| Host 单测 | `test/workspace-store.test.js`、`test/plugin-apply.test.js` | 存储、投影、迁移、路由挂载 | 不碰浏览器 |
| vm 切片 | `test/conversation-cards.test.js`、`test/message-projection.test.js` 等 | 把 `app/` 的某个模块整个 eval 进 vm 跑 | 不渲染、不点击 |
| 源码契约 | `test/morph-render.test.js`、`test/canvas-runtime.test.js` | 用正则锁住关键写法 | **函数在 ≠ 点了有反应** |
| 点击级 | `dev/harness/click.mjs` | 真实 Host + jsdom 真实点击 | 无布局，尺寸相关只验证不报错 |

**改 UI 渲染 / 事件的一定要跑 `dev/harness`**：0.5.4 的 morph 回归让 101 个测试全绿而页面完全不可用。

vm 切片要显式列出模块（`pickApp('text', 'markdown')`），所以改模块边界时顺手看一眼谁在引用它：`test/source.js` 的 `APP_FILES` 直接取 `index.js` 的 `APP_SCRIPTS`，加模块不用改测试工具。

## DOM 补丁层（`app/morph.js`）：三条硬约束

`morphInto()` 原地打补丁取代 `innerHTML` 整体重建，因此：

1. **兄弟节点的 key 必须唯一。** key 依次取 `data-morph-key` → `data-card-id` → `data-thread` → `id`。
   `data-thread` 在卡片里被所有控件共用（详情 / DSH / 归档、追问 / 分支），所以配 key 时还要拼上 `data-action` / `data-card` / `data-seq`；新增"同一父节点下多个同 thread 控件"时必须确认 key 不同。
2. **一个活节点只能被匹配一次**（`keyed.delete(key)`）。否则第二个同 key 的节点会覆盖第一个，原节点被当作未匹配删除。
3. **`morphHoldsCaret()` 只冻结光标所有者本身**（以及 contenteditable 宿主），绝不能 `contains()` 整条祖先链：页面里只要存在选区或输入框聚焦，`<main>` 就会被判定为光标宿主，此后所有 `render()` 变成空操作，表现为"点啥都没用"。
   而且**只有输入控件才算光标所有者**（`isContentEditable` / `input` / `textarea` / `select`）：聚焦的 `<button>` 不持有光标，冻结它会让它停在上一帧的 class/aria 上——点击「对话」后那个按钮被跳过，两个标签一起掉高亮就是这个坑（`test/morph-dom.test.js` 有对应用例）。

另外：地图 / 详情两个视图根节点是 `<section>`，必须带 `data-morph-key`，否则会被按位置配成一对互相打补丁，切换后卡片丢失。

## 卡片：一个 turn = 两张卡（七条契约）

一个 turn 是**两张卡**，纵向成对：**问卡**（用户原话，`role: 'question'`）在上，**答卡**（模型收尾正文，`role: 'answer'`）紧贴其下 20px。节点 id 形如 `<thread>:turn:<seq>:q` / `:a`；两者都带 `turnIndex`，所以详情面板、折叠、拖动都按 turn 走。默认 3 行，点右上箭头展开到 8 行。

1. **两种卡各自只装一种东西**：问卡只放 `question.text`；答卡只放 `card.answer.text` 的 `answerSummary()`。投影层是这道闸门：`proseText()` 只取 `text` 块（`tool-call` / `tool-result` 一律不进助手正文），`isInjectedUserSource()` 把 harness 注入的行挡在 turn 之外。任何工具名、参数 JSON、`Time sampled…` 出现在卡片上都是回归。

**只有 `source.kind === 'user'` 是人打的**：harness 会以 `user/message` 的形状塞自己的行，种类已经见过一整套——`runtime-context`、`time-context`、`skill-catalog`、`agent-instructions`（`<system-reminder>`，含 `Updated instructions from:`）、`user-approval`、`model-selection`（`[model changed: …]`）、`goal`（`<goal_round>`）、`compact-checkpoint`（compaction 摘要）。**旧版白名单只挡了三种**，剩下的每一种都占了一张问卡，还把本该落在真问题上的答复偷走：真问题变「本轮没有正文」，checkpoint 卡上却是答案。所以规则改成反过来的——**除 `user` 以外的 kind 一律不算 turn**；早于这个标记的事件没有 `source`，退回 `isInjectedUserText()` 的前缀表（`<system-reminder>` 开头一律算注入）。存量数据在 `normalizeState()` 载入时按同一张表清掉，清完再 `collapseTurnMessages()` 把「注入行两边的两轮」并回一轮（一组里有多条答复时取**正文最长**的那条——最后一条常常是调用工具前的半句话）。

**合并是有代价的**：`<goal_round>` 这一种本来就把一次长目标切成 N 轮，挡掉之后 N 轮并成一轮、只留一条答复（更早几轮的汇报只留在 DSH 日志里）。修这个之前，先想清楚是不是要放开某一种 kind。

**一轮只存一条答复**：turn 的每一步都是一条 `assistant/message`（真实会话里一轮能有上百步），但**中间步骤不各占一条消息**——`foldAssistantStep()` 把后一步的正文原地覆盖到这一轮唯一的答复上（收尾正文就是最后一条有 prose 的步骤），只有工具调用的步骤只往这轮的 `process` 里加记录。`foldToolProcess()` 按 **turn** 归属（不是 turn+step），所以第 5 步的调用能落在第 3 步写的答复上。

**「最后一次工具调用」这件事没有信号，`turn/end` 才是终点**：某一步不再调工具，和它下一步还要调工具，在日志里长得一样。所以闭环交给 `turn/end`（`closeTurn()`）：它给答复打 `ended`；如果整轮一句正文都没有但留下了工具调用（纯工具轮、被取消），仍然写一条**空正文 + `ended`** 的答复，让卡片说「本轮没有正文」而不是永远停在「等待助手回复」，也顺手修好了 `settlePendingReply()` 一直不成立、输入框一直 disabled 的老问题。**什么都没留下就不写行**——否则会给被过滤掉的注入轮留下一条空答复。还有一个更早的坑：`applyLiveReplyToCard()` 曾按 `.thread-card-body .thread-summary` 找节点，那次卡片重构后该选择器已不存在，流式补丁静默失效——现在打 `.thread-card.is-answer` 里的 `.thread-card-text`。
2. **尺寸常量必须两边对齐**：`CARD_WIDTH` / `CARD_HEIGHT(92)` / `CARD_HEIGHT_EXPANDED(188)` / `CARD_PAIR_GAP(20)` / `CARD_STEP_X(308)` 与 `styles/cards.css` 的 `.thread-card`（252×92 / `.expanded` 188）是同一组数字，92 = 16 内边距 + 18 标签行 + 2px 间隔 + 3×18 行高。改字号 / 行高 / 内边距 / 间隔必须重算常量，否则文字被裁成半行。布局是**高度感知**的（`cardHeight(card)`），问卡展开会把它的答卡和后续卡顶下去。
3. **卡内没有滚动区**：`.thread-card-text` 用 `-webkit-line-clamp` 截断，滚轮始终缩放画布（只有草稿卡片里的 `textarea` 保留原生滚动）。全尺寸正文只在右侧 `.card-inspector` 里。
4. **卡片不可选中、整卡拖动**：`.thread-card { user-select: none }` + `bindCardDrag()` 的长按（150ms / 5px 阈值）。没有按下就是普通点击（打开 inspector），按住没动就松手也**不写位置**——一旦写进 `card-positions`，这张卡就被 `positionLocked` 钉住，不再参与自动布局。
5. **inspector 的宽度是 CSS 变量**：`style="--inspector-width:460px"`，CSS 用 `width: var(--inspector-width, 460px)`。窄屏（≤760px）变成底部抽屉时要用 `!important` 覆盖这个内联变量。范围 380–760px，且上限再钳到面板宽的 78%（`clampInspectorWidth`）。点画布空白处会关闭它（`click` 监听里排除 `.card-inspector` / `.thread-card` / `[data-action]`）。
6. **问答之间的连线按「角色」判定**（`isPairLink()`：question→answer 且同 thread 同 turn），**不能按坐标判定**——按 x 相等判定时，随便拖几像素就会退回横向贝塞尔，看起来像连线断了。配对连线的形状按**主导轴**决定（同一条路径既要画竖的也要画横的），控制点落在两张卡相对的边中点。
7. **问答相对位置是一个可选项，不是常量**：`state.questionPosition`（`above` / `below` / `left` / `right`，从问卡视角命名）由工具栏「排列」里的四个示意图设置，存 `dsh-synapse:question-position:v1`。所有几何都必须走 `answerOffset()` / `turnStepX()` / `laneStepY()`，不要在别处假设「答在问下面」：
   - `answerOffset` 决定一对卡的相对位移（上下=换行，左右=换列）；
   - `turnStepX` 是「下一轮的问卡」到本轮问卡的距离：`问在右` 时答卡在问卡左边，所以下一轮要从问卡右缘起算，步进变成 `CARD_WIDTH*2 + CARD_PAIR_GAP + 56`；
   - `laneStepY` 是分支车道间距（堆叠时一对卡占两行，并排时只占一行）。

   切换排列会 `resetCardPositions()`（旧坐标对新形状没意义）再 `focusActiveCard()`。配对连线本身也要跟着换轴：`connectorPath(..., pair=true)` 里按 dx/dy 的绝对值选竖直或水平分支。

## 详情页：一列对话，不是一叠卡片

`renderThread()` 照宿主 `ui-chat` 的转录样式，而不是照卡片样式——**整页只有对话本身**：

- **问是气泡，答是正文**：`.message-user .message-body` 右对齐、`--syn-bubble` 底色、20px 圆角（官方 `--dsw-radius-xl`）、`10px 16px` 内边距、`14px/22px` 字、宽度 `70%`；答卡直接是 `.md` 正文铺在页面上（颜色走 `--syn-ink`）。消息本身**没有边框、没有背景、没有头像 / 角色行 / 时间**——`header` 一回到 `.message` 里就说明旧卡片样式漏回来了（`dev/harness` 有对应检查）。
- **没有页头**：会话名、徽章、副标题、21px 大标题、`返回画布` 全部删掉，转录紧贴顶部的 tab 行开始。会话的两个动作（在 DSH 中打开 / 创建分支）挂在 `.header-actions`，占 `.canvas-header` 第一行右侧，别塞回对话区。
- **每条回答下面没有操作**：`创建分支` 在顶栏只有一个入口，逐条挂 `.message-branch` 只是把同一个动作用 N 次摆出来（`dev/harness` 与 `test/canvas-runtime.test.js` 都锁了"对话里不出现 `open-branch`"）。
- **一列 920px**：`.detail-flow` 与 `.message-composer` 同宽同轴，宽 `min(920px, calc(100% - 32px))`（宿主嵌入对话的上限）；改列宽要两处一起改。
- **底部是一条横条**：`.message-composer` 是一个 20px 圆角的输入卡（细线 + 柔投影），里面只有单行 `textarea`（占位「继续当前对话」）和右侧 30px 圆形 `.composer-send`（底色 `--syn-link`，与宿主发送键同为 business blue）。不要再退回"textarea + 并排按钮"的两块布局。

### 过程记录 / 工具调用

- **对话里**：一条折叠行 `.message-fold`（chevron + 摘要），展开才渲染 `.message-body`，行本身不画底色。
- **右侧详情面板里**：`.card-inspector-process` 默认可见**而且默认展开**——每个工具一块（等宽工具名 + 状态 + 「参数」/「结果」两段全文），不截断、不内嵌滚动，抽屉是唯一滚动条；点行头只是收起，`state.collapsedProcessIds` 记的是被关掉的那些。没有 payload 的旧记录写「暂无参数与结果」，不要留一行空白让人以为渲染坏了。

## Markdown 与代码块

Markdown 只走 `.md` 一套排版（`styles/markdown.css`）。`markdownBlock()` 必须产出 `hr` / `blockquote` / `ul`+`ol`（可嵌套）/ `.task-item` / `pre.md-code[data-lang]` / `table` / `a[href^=http]`；`---` 与 `>` 掉成纯文本是回归。设计稿在 `dev/design/`（`cards/` 是选型记录，`inspector/` 是三版排版），`node dev/design/inspector/_build.mjs` 用真实渲染器刷新样例。

**代码块要着色，但只着一种色**。`highlightCode(text, language)` 是单遍扫描，产出 `span.tok-*`（`key` / `str` / `num` / `com` / `fn` / `type` / `tag` / `attr`），不引入依赖、不建语法树。两条硬约束：

1. 每个 token 都是 `escapeHtml` 之后的原文切片，任何语言标签都不能让原文漏成标签（用 `html` 围栏时，正文里的 `<script>` 依然是文本）。
2. **只有明确是"输出"的标签保持素色**（`text` / `diff` / `log` / `csv` / `mermaid` …，见 `CODE_PLAIN`），认不出的标签走 C 系默认着色——漏一个别名（曾经漏了 `java`）不能让整块代码变回一片黑。加语言只往 `CODE_FAMILY` 里加一行，分词器本身不分语言。

配色只住 `tokens.css` 的 `--syn-code-*` / `--syn-tok-*`，逐条抄 JetBrains 默认方案（IntelliJ Light 与 Darcula），因为代码块是一个"编辑器"——用 DSH 自己的灰阶时 `const` 和 `"value"` 长得一样。`--syn-code-bg` 是编辑器底色（`#f7f8fa` / `#2b2b2b`），比页面高一档，块仍然读作内嵌面。

## 侧边栏与外壳

`.sidebar` 只是**视口**：宽度 280↔56 由 `grid-template-columns` 过渡，里面 `.sidebar-inner` **恒定 256px**（≤760px 时 176px），靠 `.sidebar` 的 `overflow: hidden` 裁切成轨道。所以新增侧边栏元素要放进 `.sidebar-inner` / `.sidebar-panel`，**别给它们设百分比宽度的祖先链**——一旦内层跟着外层变窄，文字每帧重排、省略号重算，动画立刻掉帧（官方侧边栏就是这个观感）。

动效口径来自 lifediary（`D:\Projects\projects\lifediary\docs\基线文档\设计令牌与动效.md`）：临界阻尼弹簧、受钳制的进度（宽度）不许超调、按压用缩放不用色变、过渡中的控件不门禁（CSS 可反向打断）。

层级照抄官方 `packages/client/ui-layout/src/client/AppFrame.module.css`（Windows 标题栏分支）：外壳（`.synapse-shell` + `.sidebar`）统一是 `--dsw-specific-sidebar-fill`，只有对话面 `.content-pane` 是 `--dsw-alias-bg-base`，并且**只圆左上角**：`border-radius: 16px 0 0 0` + `corner-shape: round`，贴着上/右/下边（任何 `margin` 或顶部行都会变成一条"露底"的横条）。官方在那里显式写了 `corner-shape: round`——即从全局的 `superellipse(1.5)` 退出来，所以这个角是圆弧而不是超椭圆；要改曲线只动 `.content-pane` 的两个值。

**不要加回独立的顶栏**：折叠按钮和视图切换同处 `.canvas-header`（76px = 官方对话 header 的高度，内部两行 38+38），对话面才能从 y=0 开始，让宿主标题栏的颜色直接压在上面形成同一个容器。交界处**没有线、没有阴影、没有 elevation**：官方 Windows 分支就是 `sidebarCol { border-right: none }`，centre 列自己也不画任何东西，全靠一档色阶差 + 左上角圆角。不要往这里补边框/投影（试过 0.5px 发丝线和面板投影，都被打回）。

侧边栏内部间距照官方 `ui-sidebar/SidebarRoot.module.css` 的 Windows 分支：logo 行 **40px、无外边距、无内边距**（60px/8px 那组是 macOS 变体），brand 再加 `padding-left: 4px`，「新建卡片」用 `margin-top: 8px`。

折叠按钮就待在 `.canvas-header` 栅格的第一格（`.rail-toggle { grid-column: 1; grid-row: 1; align-self: center }`，28px 圆盘 + 16px 字形）。试过把它做成"与左上 16px 圆角同心"的绝对定位圆盘（2px / 4px 留白），被否掉了——**不要再动它的位置**，回到栅格就是最终形态。

工作区选择器是**自绘的 listbox**，不是 `<select>`：原生 select 的弹层无法做动画/圆角/主题。`.workspace-trigger` 是按钮，`.workspace-menu` 是绝对定位的面板（12px 圆角、发丝线、柔投影），用 `workspace-menu-in` 做 180ms 的 `translateY(-6px) scale(.97)` 入场（只动 `transform`/`opacity`，不重排侧边栏）；选项点击走 `switchWorkspace()`，点外面或 Esc 收起。`prefers-reduced-motion` 下动画关掉。

## 顶栏：标签行与右上角

### 视图标签：地图 / 详情

`.canvas-header` 第二行是视图标签，**用插件自己的词：地图（画布）/ 详情（会话）**——曾经照抄宿主的「轨迹 / 对话」，被要求改回来了，别再改。

规格抄 `ui-conversation/src/client/skeleton/ConversationRoot.module.css` 的 `.viewTabs` / `.tab`：13px/16px 字重 500、净行高 25px（`min-height: 35px` + `margin: -10px -10px 0` 把命中区上下各撑 10px）、**间距 32px**、`padding-left: 12px`（配合 header 的 16px，文字起点落在 28px 上）。激活条是**蓝色圆角短线**，`bottom: -1px` 压住 header 的 0.5px 发丝线，藏掉"线断一截"的缝：**地图 2px、详情 3px**——详情下面紧接正文，2px 会被读成 header 那条线的一段，加粗 1px 才成为标签自己的标记。**悬停和选中都用蓝的** `--syn-link`（= 宿主的 business primary）；`--syn-accent` 是近黑，用在这里会变成"没选中"的观感。第一行只放左端的折叠按钮和右端的一组动作，两行 38+38 = 76px。

**选中态挂在 `<nav>` 的 `data-active` 上，不是按钮的 class**：点击后浏览器把焦点给那个按钮，而 morph 会冻结"光标所有者"——按钮本身不持有光标，现在会被正常打补丁，但把状态放在不会被聚焦的父节点上更稳：`[data-active="thread"] button[data-action="show-thread"]` 决定颜色和短线（那条加粗到 3px 的规则也挂在这个选择器上），按钮只用 `aria-current="page"` 表达语义。0.5.5 之前用 class，点「详情」后两个标签一起失去高亮，就是因为被点击的那个按钮是冻结节点。

### 右上角：一组控件，两种视图

`.header-actions` 是第一行右端唯一的一组按钮，地图和详情共用同一套高度/字重/悬停（26px 高、6px 圆角、12px 字、14px 图标），所以切视图时右上角不会"变一个样子"。**按频次决定形状，不按视图**：

- `整理` / `定位`（`.header-action`，图标 + 文字）：最常用的两个，保留文字。**`整理` 不只是重排**：它先向 Host 重取一次投影（`refreshProjection()`）再清坐标——投影层丢掉的那些注入行，点一下就生效，不必等 1 秒轮询；
- `排列`（`.header-action.is-icon`，26×26 只有图标，`title` 带说法）：偶尔用，收成字形；
- 缩放（`.zoom-meter`）：**只有读数**——3px 轨道（`--syn-min..--syn-max` 的**对数轴**，100% 在中点偏右）+ 百分比数字，前面一条发丝分隔线。± 按钮已删：滚轮/触控板缩放才是唯一输入，`syncZoomLabel()` 在 `applyZoomFrame()` 里逐帧更新轨道和数字；
- 详情视图：`在 DSH 中打开` / `创建分支` 用同一组控件（图标 + 文字），不再单独占一行。

三版对照在 `dev/design/toolbar/index.html`：**A（频次分组）是已选方案**，B 全图标 / C 分段胶囊只是留档。

## 页面级开关：对话 / 会话地图（`client.js`）

那颗悬浮胶囊不归任何视图管：它是一个 `position: fixed` 的页面级控件，`z-index` 高于地图 overlay，否则进了地图就出不来。

**暗色填充是一块会走的 thumb**（`.dsh-synapse-switch-thumb`），不是两个按钮各自画背景——切视图时读作"填充移过去了"，而不是"两个标签换色"。它由 `moveThumb()` 量出来：标签宽度不等，不能假设各占一半；原点取 `dialogButton` 的左缘（恰好等于 thumb 的静止位），这样不用写 border/padding 常量。挂载首帧不做动画，窗口 resize 与字体换入后重测；没有布局的环境（`test/client-bridge.test.js` 的假 DOM）直接跳过，thumb 宽 0 不显示。

进出地图的淡入是 `.dsh-synapse-overlay.is-opening iframe { opacity: 0 }`，`is-opening` 本身仍负责在首帧之前藏住 iframe，别删。

## 配色只住在一个文件里

`tokens.css`（先于所有样式表加载，路由 `/synapse/tokens.css`）只放值：22 个 `--syn-*`、两组代码着色变量，明暗各一套，逐条抄自宿主的 `ui-theme/src/styles/design-platform.css`（`--syn-bubble` 对应 `--dsw-specific-bubble`，正是详情页问句气泡的底色）。

`styles/` 里**不允许出现字面 hex**，否则两套主题会重新走散。改色只动 `tokens.css`。

样式表按 cascade 顺序切成七份，权威列表是 `host/apply.js` 的 `STYLE_SHEETS`（页面 `<link>` 与路由都由它生成，测试从 `index.js` 取同一份）：`base` → `chrome` → `cards` → `inspector` → `detail` → `markdown` → `dark`。**`dark` 必须最后**，它靠顺序压过前面的一切；插新表只能插在 `dark` 之前。

## 数据位置

| 路径 | 内容 | 删了会怎样 |
|---|---|---|
| `$DSH_HOME/synapse/workspaces.json` | 画布布局 + 每轮 280 字预览（schema v6），**正文不在这里** | 只丢布局，不丢会话 |
| `$DSH_HOME/sessions/--<cwd slug>--/session-*/` | DSH 会话日志，正文按需从这里读 | 才是真的丢正文 |

调试用的临时产物（`dev/harness/node_modules`、`%TEMP%` 下的 jsdom 环境）都不进 git；`dev/` 也不在 `package.json` 的 `files` 白名单里，不会进 npm 包。
