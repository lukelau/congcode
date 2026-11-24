# congcode 技术架构

本文讲 congcode 的**架构设计**：分层、模块职责、核心数据流、执行链路与扩展点。

技术选型、框架版本见 [tech-stack.md](./tech-stack.md)；本文不重复版本信息。

---

## 1. 架构目标

congcode 是一个 AI 编程智能体，同时提供三种前端形态（终端 / Web / 桌面），共用一套服务端与领域核心。

设计上的四个约束决定了整体架构：

| 约束 | 架构对策 |
| --- | --- |
| 同一个 agent 能力要跑在 TUI / Web / 桌面 / 无头服务 | 领域逻辑全部下沉到 `core`，前端只做渲染 |
| 需要长时间运行的会话、工具执行、子 agent 并发 | Effect-TS 的结构化并发 + Fiber + Scope |
| 会话历史、文件改动必须可回滚、可追溯 | 会话投影（projector）+ 快照（snapshot）+ 事件总线 |
| 需要第三方扩展，但不能让插件崩掉主进程 | 插件宿主隔离 + 槽位渲染 + 崩溃边界 |
| 端上要单文件分发、秒级启动 | `bun build --compile` + bytecode，模型目录构建期嵌入 |

---

## 2. 分层视图

```
┌────────────────────────── 前端层 ──────────────────────────┐
│  packages/tui        packages/app        packages/desktop  │
│  终端（opentui）     Web SPA / PWA       Electron 壳        │
└────────────────────────────┬───────────────────────────────┘
                             │ context/data（响应式数据源）
                             │ client / protocol（SDK、协议）
┌────────────────────────────▼───────────────────────────────┐
│  服务层  packages/server                                    │
│  Hono 路由 · 鉴权 · 事件流（SSE/WS）· 文件与媒体服务         │
└────────────────────────────┬───────────────────────────────┘
                             │
┌────────────────────────────▼───────────────────────────────┐
│  领域层  packages/core（Effect-TS）                          │
│  Location / Project / Workspace                             │
│  Session（run-coordinator · runner · execution · projector） │
│  Tool（内置工具 + 权限 + 插件钩子）                          │
│  Provider / Model（路由、重试、成本、变体）                   │
│  Plugin（宿主、钩子、模块加载）                              │
│  DB（drizzle + SQLite）· Bus（事件）· Snapshot（快照）        │
└────────────────────────────┬───────────────────────────────┘
                             │
┌────────────────────────────▼───────────────────────────────┐
│  能力层  packages/ai · packages/schema · packages/util      │
│  LLM 客户端 · provider 协议适配 · Schema · FS/Effect 工具    │
└────────────────────────────┬───────────────────────────────┘
                             │ FFI / 原生绑定
┌────────────────────────────▼───────────────────────────────┐
│  原生层  packages/cli-rs                                     │
│  终端渲染绑定 · Luau 插件 VM · DHT · ACP · tree-sitter       │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 关键抽象

### 3.1 Location（位置）

`packages/core/src/location.ts`

**整个领域模型的根坐标系。** 一个 Location 代表一个工作目录上下文（含 directory、workspace、vcs 信息），几乎所有的 Service 都是"绑定到 Location 的"：

- 会话、文件系统、工具、Provider 都挂在某个 Location 下
- `LayerNode.unbound(Service, tags.values.location)` 表明它本身是节点化（node）的服务，可按需构建 Layer
- 同一个进程可以同时服务多个 Location（多项目、worktree）

**影响**：新增任何与"工作目录"相关的服务，都应通过 Location 获取上下文，而不是直接用 `process.cwd()`。

### 3.2 Project / Workspace

`Project` 负责把磁盘路径解析成一个持久化的项目记录；`Workspace` 在其上提供隔离的工作区（含 worktree 支持）。

Location → Project → Workspace 是"路径 → 持久化实体 → 隔离环境"的三级递进。

### 3.3 Bus（事件总线）

`packages/core/src/bus.ts`

领域事件的统一出口，用于：

- 前端实时刷新（会话消息增量、工具进度、状态变更）
- 会话投影（projector）落库
- 插件钩子分发

### 3.4 Plugin Hooks

`packages/core/src/plugin/hooks.ts`

插件系统分两层，不要混淆：

| 层 | 位置 | 用途 |
| --- | --- | --- |
| **服务端插件** | `core/src/plugin/` | 扩展 agent 行为：钩子（hooks）、工具、provider、命令、goal |
| **TUI 插件** | `tui/src/plugin/` | 扩展界面：槽位（slot）渲染、对话框、路由页、markdown 渲染器 |

---

## 4. 会话执行链路（核心）

这是整个产品最关键的路径。入口在 `packages/core/src/session/`，运行核心在 `session/runner/`。

```
用户输入
  │
  ▼
session/inbox.ts          入队（区分 steer 插队 / queue 排队）
  │
  ▼
session/run-coordinator  决定何时可以真正开始跑（忙碌/竞态仲裁）
  │
  ▼
session/runner/index.ts  SessionRunner.drain()
  │  ├─ 从已记录的会话历史恢复（不是从内存状态）
  │  ├─ 按需切换到目标 Location（跨工作目录继续）
  │  └─ 返回 DrainResult: Complete / Moved / Reloaded
  ▼
session/runner/step.ts    单个 step：组装上下文 → 调 LLM → 处理工具调用
  │  ├─ session/system-prompt.ts    系统提示词
  │  ├─ session/instructions.ts     指令文件发现（AGENTS.md 等）
  │  ├─ runner/to-llm-message.ts    消息格式转换
  │  └─ runner/llm.ts               实际请求与流式响应
  ▼
session/execution          执行生命周期（开始/结束/中断/错误）
  │
  ▼
tool 执行                  内置工具 + 权限检查 + 插件钩子
  │
  ▼
session/projector         把消息事件投影成可查询状态并落库
  │
  ▼
Bus 广播                  前端增量刷新
```

**设计要点：**

1. **从历史恢复，不依赖内存状态。** `drain()` 的语义是"从已经记录的会话历史中跑一个 continuation"，所以进程重启、换机器、切 Location 都能继续。
2. **`DrainResult` 三态**：`Complete`（本轮结束）/ `Moved`（需要换 Location 继续）/ `Reloaded`（强制重载），把"换环境继续跑"变成显式返回值而不是异常。
3. **step 是原子单位**：一个 step = 一次 LLM 调用 + 其工具调用处理，`runner/max-steps.ts` 控制上限。
4. **中断是外部的**：`interruption: () => "user" | "shutdown" | undefined`，中断原因由调用方注入，runner 不判断。

### 4.1 相关子模块

| 模块 | 职责 |
| --- | --- |
| `session/compaction.ts` | 上下文压缩 |
| `session/revert.ts` | 回滚（消息 + 文件改动） |
| `session/fork.ts`（dialog-fork 对接） | 会话分叉 |
| `session/subagent-job.ts` | 子 agent 任务 |
| `session/background.ts` | 后台任务 |
| `session/title.ts` | 会话标题自动生成 |
| `session/usage.ts` / `stats.ts` | token 用量与统计 |
| `session/search*.ts` | 会话全文检索 |
| `session/snapshot.ts` / `core/snapshot.ts` | 文件快照，支撑 revert |

---

## 5. 工具系统

`packages/core/src/tool.ts` + `core/src/tool/`

```
Tool.Definition（@opencode/schema/tool 定义契约）
   │
   ├─ 内置工具实现（tool/plugin/：read / edit / glob / grep / shell / mcp / image …）
   ├─ 权限层（core/src/permission.ts）：调用前裁决
   ├─ 插件钩子（PluginHooks）：调用前/后介入
   └─ CodeMode（core/src/codemode/）：以"写代码"方式组合多工具调用
```

三个交汇点值得注意：

- **权限**是横切关注点，不在每个工具里各写一遍；
- **插件钩子**可以改写工具输入/输出；
- **CodeMode** 把"多次工具调用"提升为"一段被执行的代码"，减少往返。

---

## 6. Provider / Model 路由

`packages/core/src/provider.ts`、`model.ts`、`model-resolver.ts`、`model-retry.ts`、`variant.ts`

```
请求模型
  │
  ├─ provider.ts       provider 注册与凭据（config / env / oauth / credential）
  ├─ model.ts          模型目录（models.dev 快照）+ 可用性 + free 判定
  ├─ model-resolver    在给定约束下选出实际模型（fallback）
  ├─ model-retry       失败重试策略
  └─ variant.ts        同一模型的不同档位（思考强度 / 速度）
```

`packages/ai/` 在其下做协议适配：

- `ai/src/providers/`（78 个 provider 目录）
- `ai/src/protocols/`（chat-completions / messages / responses 等协议实现）
- `ai/src/effect.ts` 暴露 Effect 化的 LLMClient，供 `session/runner/llm.ts` 消费

**关键约束**：`core` 只依赖 `@opencode/ai/effect` 暴露的接口，不直接依赖具体 provider，从而保证 provider 可插拔。

---

## 7. 服务层与前端

### 7.1 server

`packages/server/src/`

| 模块 | 职责 |
| --- | --- |
| `routes.ts` / `handlers/` | Hono 路由与处理器 |
| `auth.ts` / `pairing.ts` | 鉴权与设备配对 |
| `event-feed.ts` | 事件流推送（前端订阅领域事件） |
| `media-uri.ts` / `range.ts` | 媒体与文件分段读取 |
| `workerd.ts` | 边缘运行时适配 |

### 7.2 tui

`packages/tui/src/`

```
index.tsx / app.tsx        入口与主运行时
routes/                    页面路由
  └─ session/              会话页（index.tsx 是核心）
       ├─ rows.ts          transcript 行的数据建模
       ├─ message-parts    消息部件（TextPart / ReasoningPart / ToolPart）
       ├─ sidebar.tsx      侧栏（含 sidebar.content / sidebar.footer 槽位）
       └─ dialog-*         消息操作、时间线、分叉等对话框
context/                   响应式上下文（data / local / theme / route / keymap…）
component/                 复合组件（对话框、tabs、输入框…）
ui/                        原子组件（dialog / toast / border…）
feature-plugins/           内置 TUI 插件（sidebar 各区块、系统面板、storybook）
plugin/                    插件宿主（api / context / builtins / slot 渲染）
util/                      工具函数
mini/                      轻量会话运行时（无完整 TUI）
```

**Slot 机制**：TUI 插件通过 `context.ui.slot({ append: "sidebar.content", render })` 把组件挂到宿主预留的位置。现有的槽位：

| 槽位 | 宿主 |
| --- | --- |
| `sidebar.content` | `routes/session/sidebar.tsx` |
| `sidebar.footer` | `routes/session/sidebar.tsx` |

内置插件必须在 `plugin/builtins.ts` 的 `builtins` 数组注册才生效——这是最常见的"插件写了不生效"原因。

---

## 8. 数据与持久化

```
drizzle ORM (1.0 rc)
   └─ SQLite（@effect/sql-sqlite-bun）
        ├─ session / message / part  会话与消息
        ├─ project / workspace       项目与工作区
        ├─ credential / oauth        凭据
        ├─ kv / state                键值与运行态
        └─ 其他：usage、stats、todo 等
```

- **投影模式**：写入以"事件 → projector → 表"的方式落库，保证消息可增量重放。
- **blob 存储**：大对象（附件、快照）走 `session/blob.ts` / `blob-store.ts`，不塞进主表。
- **快照**：`snapshot.ts` 支撑 revert，与 git 状态协同（`core/src/git.ts`、`vcs.ts`）。

---

## 9. 扩展点全景

按"想扩展什么"分类：

| 想扩展 | 位置 | 方式 |
| --- | --- | --- |
| agent 行为（工具/钩子/provider） | `core/src/plugin/` | 服务端插件 |
| 界面区块 | `tui/src/feature-plugins/` | TUI 插件 + slot |
| 对话框/页面 | `tui/src/component/`、`tui/src/routes/` | 组件或路由页 |
| markdown 渲染 | `context.markdown.registerCodeBlockRenderer` | 代码块渲染器 |
| 键位 | `context.keymap.layer()` | 键位层 |
| 模型/provider | `packages/ai/src/providers/` | 新 provider 实现 |
| 工具 | `core/src/tool/` | 新 Tool.Definition |
| 命令 | `core/src/command.ts` | 命令注册 |

---

## 10. 阅读路径建议

| 目标 | 起点 |
| --- | --- |
| 理解 agent 怎么跑 | `core/src/session/runner/index.ts` → `step.ts` |
| 理解消息怎么到界面 | `core/src/session/projector.ts` → `bus.ts` → `tui/src/context/data.tsx` |
| 理解工具怎么执行 | `core/src/tool.ts` → `core/src/tool/plugin/` |
| 理解模型怎么选 | `core/src/model-resolver.ts` → `packages/ai/src/effect.ts` |
| 理解界面怎么组织 | `tui/src/routes/session/index.tsx` → `rows.ts` |
| 想加插件 | `tui/src/plugin/builtins.ts` + `feature-plugins/sidebar/*` |

---

## 11. 架构演进注意

以下是容易踩坑的边界，修改时需特别注意：

1. **不要在 `tui` 里写业务逻辑**。前端只做渲染与交互，业务判断放 `core`。
2. **不要绕过 Location 取路径**。多项目/多 worktree 场景下 `process.cwd()` 是错的。
3. **不要在前端直接建 LLM 客户端**。走 `core` 的 provider/model 层，否则重试、成本统计、权限都会缺失。
4. **会话状态以数据库为准**。内存态只是缓存，`drain()` 的设计前提就是"可从历史恢复"。
5. **新增内置 TUI 插件必须注册进 `builtins.ts`**。
6. **Effect 写法遵循 `script/ast-grep/effect-simplifications/` 规则**，提交前会检查。