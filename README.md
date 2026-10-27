<h1 align="center">dsh-synapse</h1>

<p align="center">DeepSeek Harness 的会话地图</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-synapse"><img src="https://img.shields.io/npm/v/dsh-synapse?style=flat-square&logo=npm&label=npm" alt="npm version"></a>
  <a href="https://github.com/Tourweint/dsh-synapse/actions/workflows/main-tests.yml"><img src="https://github.com/Tourweint/dsh-synapse/actions/workflows/main-tests.yml/badge.svg?branch=main&style=flat-square" alt="Main branch tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-10b981?style=flat-square" alt="MIT license"></a>
  <a href="package.json"><img src="https://img.shields.io/node/v/dsh-synapse?style=flat-square&logo=node.js&label=node" alt="Node.js version"></a>
</p>

<p align="center">
  <a href="docs/zh-CN/README.md">中文指南</a> ·
  <a href="docs/en/README.md">English guide</a> ·
  <a href="https://www.npmjs.com/package/dsh-synapse">npm</a> ·
  <a href="docs/development.md">开发与发布</a>
</p>

把同一工作区中的会话、追问和分支放到一张可浏览、可拖拽、可缩放的画布上。对话本身仍只存在于 DSH 的原生会话里——画布读它，不另存一份。

![Synapse 会话地图：成对的问答卡片、分支和右侧详情](docs/images/synapse-map.jpg)

> **这一版把力气全花在"像不像 DSH 自己的一部分"上。** 地图能做的事没有增加：看结构、开分支、追问、回到原生对话。改的是它怎么排、怎么读、怎么跟着窗口动。

## 这一版改了什么

| 位置 | 之前 | 现在 |
|---|---|---|
| 画布卡片 | 一轮对话压成一张卡，正文和工具调用挤在一起 | 一个 turn 是**两张卡**：问卡（原话）在上、答卡（收尾正文）紧贴其下，默认 3 行、可展开。工具调用不进卡片 |
| 会话正文 | 又是一叠卡片，还要点开面板看全 | **详情页是一列对话**：问句右对齐气泡、回答是铺在页面上的正文，底部一条单行输入条；没有页头、没有角色行、没有时间 |
| 顶栏 | 几行小按钮各管一段 | 76px 两行，与宿主对话 header 同高：折叠按钮、`地图 / 详情` 标签、右侧一组动作。标签用插件自己的词 |
| 侧边栏与外框 | 边框、投影、分区色 | 只靠**一档色阶**和**左上 16px 圆角**与宿主对齐；280↔56 的收放裁切轨道，内部文字不重排 |
| 排列 | 位置是写死的常量 | 「排列」里四个示意图切换问与答的相对方位，坐标与连线跟着换轴 |
| 配色与代码块 | 各样式表各处写色值 | 所有颜色收进 `tokens.css`，明暗两套逐条抄宿主设计令牌；代码块按 JetBrains 方案着色，只着一种色 |
| 刷新时机 | 每次变化整块重建 DOM | 原地打补丁（`morph`），滚动位置、选区、正在输入的草稿不再被刷掉 |
| 动效 | 线性过渡、会超调 | 临界阻尼弹簧：受钳制的宽度不超调，按压用缩放表达，过渡中的控件不门禁 |

## 快速安装

需要 DeepSeek Harness `>= 0.1.7-rc.2`（本插件依赖该版本的 Host 会话与 Client 服务接口）和 Node.js `>= 22.19.0`。

> **兼容性提示：** 自 0.4 起只支持 DeepSeek Harness `>= 0.1.7-rc.2`，不再兼容更早版本。

**先确认插件要装进哪一套 profile**。DSH 按 profile 分套安装插件，桌面 App 和命令行各用一套，互不影响：

| 你平时怎么用 DSH | 要装的 profile | 安装命令 |
|---|---|---|
| 桌面 App（DeepSeek Harness 客户端） | `desktop` | `corepack pnpm dsh plugin --profile desktop add dsh-synapse` |
| 命令行 `dsh web` / 浏览器访问 | `web` | `corepack pnpm dsh plugin --profile web add dsh-synapse` |
| 两种都用 | 两套各装一次 | 两条命令都执行 |

- 从 App 内的插件页面安装时，App 会自动装进它自己用的那套，不用管 profile。
- **自检口诀：装完顶部看不到「会话地图」开关，就是装到另一套去了**，换成另一条命令再装一次即可。
- 桌面 App 装完需要**重启 App**（Host 侧插件在启动时加载）；命令行装的，重启 `dsh web` 并刷新页面。

```powershell
# 命令行方式：装好后启动
corepack pnpm dsh plugin --profile web add dsh-synapse
corepack pnpm dsh web
```

启动后，在 DSH 顶部切换到 **会话地图**。Synapse 复用现有的 DSH Web Server，不会启动第二个应用或代理系统。

## 它解决什么问题

| 能力 | 说明 |
|---|---|
| 对话地图 | 把连续追问、分支和不同会话放到同一张可操作的画布上。 |
| 保留真实分支 | 按 DSH 原生 fork 关系连接卡片，不制造另一套会话历史。 |
| 追问更顺手 | 选中回答中的文字可直接带入新的追问；常用补充词可编辑。 |
| 双向同步 | 在地图或 DSH 原生对话中切换会话，当前上下文保持一致。 |

## 从原生对话进入

在 DSH 原生对话中，通过顶部的 **会话地图** 进入 Synapse；返回 **对话** 后，仍是同一个 DSH 会话。

![DSH 原生对话与会话地图入口](docs/images/native-webui.jpg)

## 文档

| 文档 | 内容 |
|---|---|
| [中文指南](docs/zh-CN/README.md) | 安装、启动、配置、使用、卸载和限制。 |
| [English guide](docs/en/README.md) | Installation, configuration, usage, cleanup, and limitations. |
| [开发与发布](docs/development.md) | 本地验证、GitHub Actions、版本标签和 npm 发布。 |
| [架构与边界](docs/architecture.md) | 会话归属、投影、数据存储和模型影响。 |
| [AGENTS.md](AGENTS.md) | 给改动代码的人 / 代理的工作须知：调试入口、测试分层、以及那些"改了就坏"的约定。 |

## 与 DSH 的边界

- DSH session log 保存真实会话内容；Synapse 只投影已提交的事件。
- Synapse 只保存画布布局和每轮对话的短预览，消息正文始终从 DSH 会话记录按需读取；`$DSH_HOME/synapse/` 删除后不会丢会话，只会丢布局。
- 插件不修改 prompt、模型请求、工具 schema、provider 路由或可复用 KV-cache 前缀。
- 内置 patch 由 profile 的 bundle 列表引入，桌面 App（`desktop`）与命令行（`web`）都适用。

## 开发

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm test
```

改动了画布渲染或事件，还要跑一遍真实点击的 jsdom harness：

```powershell
cd dev/harness
npm install
npm test
```

完整的贡献、CI/CD 和发布流程见[开发与发布指南](docs/development.md)。

## 许可证

[MIT](LICENSE)
