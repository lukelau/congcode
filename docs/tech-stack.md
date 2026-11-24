# congcode 技术栈与架构

本文档说明 congcode（基于 OpenCode 二次开发的 AI 编程智能体）的技术选型与架构分层，供新成员快速建立全局认知。

---

## 1. 总览

| 维度 | 选型 |
| --- | --- |
| 主语言 | TypeScript 6 |
| 运行时 / 包管理 | Bun ≥ 1.4.4（Bun workspaces + catalog 统一版本） |
| Monorepo 编排 | Turborepo 2.10 |
| 辅助语言 | Rust（`packages/cli-rs`） |
| 终端 UI | @opentui/core + @opentui/solid（SolidJS 驱动） |
| Web UI | SolidJS + Vite + Tailwind CSS v4 |
| 桌面端 | Electron + electron-builder |
| 业务范式 | Effect-TS（Runtime / Stream / Schema） |
| 数据存储 | Drizzle ORM + SQLite |
| 可执行产物 | `bun build --compile` 单文件二进制 |

一句话：**Bun 全栈 + SolidJS 双端 UI（终端 / Web）+ Effect-TS 业务基座 + Drizzle/SQLite 持久化 + Rust 性能关键路径**，最终产出跨平台单文件可执行程序 `congcode`。

---

## 2. 仓库结构

```
.
├── packages/            # 34 个 workspace 包
│   ├── core             # 领域核心（LLM 路由、插件、PTY、MCP、DB）
│   ├── cli              # CLI 入口与二进制构建
│   ├── tui              # 终端 UI
│   ├── server           # HTTP / WebSocket 服务端
│   ├── app              # Web UI（SPA / PWA）
│   ├── desktop          # Electron 桌面端
│   ├── ai               # LLM provider 实现
│   ├── schema           # Effect Schema 校验基座
│   ├── client           # Client SDK
│   ├── protocol         # 协议与 OpenAPI 生成
│   ├── ui               # 跨端组件库
│   ├── plugin           # 插件运行时
│   ├── cli-rs           # Rust crate workspace
│   └── ...              # util / theme / session-ui 等
├── script/              # 构建、lint、ast-grep 规则
├── turbo.json           # Turborepo 任务图
└── package.json         # workspace + catalog
```

---

## 3. 架构分层

```
┌──────────────────────────────────────────────────────┐
│  表现层                                               │
│  tui（终端）  app（Web）  desktop（Electron）          │
└──────────────────────┬───────────────────────────────┘
                       │ client / protocol
┌──────────────────────▼───────────────────────────────┐
│  服务层  server（Hono + Bun.serve + WebSocket）        │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│  领域层  core（Effect-TS 业务逻辑）                    │
│  ├─ session / prompt / tool 执行                      │
│  ├─ plugin 系统                                       │
│  ├─ PTY 终端 / MCP 集成                               │
│  ├─ provider 与模型路由（ai 包）                       │
│  └─ 持久化（Drizzle + SQLite）                         │
└──────────────────────┬───────────────────────────────┘
                       │ Rust FFI / 原生绑定
┌──────────────────────▼───────────────────────────────┐
│  底层  cli-rs（终端渲染、Luau 插件 VM、DHT、ACP）      │
└──────────────────────────────────────────────────────┘
```

### 3.1 表现层

- **tui**：终端 UI，基于 `@opentui/core` + `@opentui/solid`，用 SolidJS 的响应式模型渲染 ANSI 字符界面；JSX 在 bun build 阶段由 `createSolidTransformPlugin()` 编译。
- **app**：Web 端，Vite + SolidJS SPA，Tailwind CSS v4 样式，`vite-plugin-pwa` 提供 PWA 能力，`@tanstack/solid-query` 管数据。
- **desktop**：Electron 壳，electron-vite 构建，electron-builder 打包 MSI/NSIS，electron-updater 自动更新。

### 3.2 服务层

- **server**：Hono 4 + `Bun.serve`，WebSocket 基于 Effect Platform 的 NodeWS 实现。TUI 与 Web 共用同一套服务端逻辑。

### 3.3 领域层

- **core**：整个产品的业务核心，使用 **Effect-TS** 组织（Effect Runtime + Stream + Schema）。包含会话生命周期、Prompt 编排、工具执行、插件系统、PTY 终端、MCP 集成、模型路由与持久化。

### 3.4 底层

- **cli-rs**：Rust 实现的高性能部分 —— 终端渲染原生绑定、Luau 脚本插件 VM（mlua）、DHT 分布式存储（Iroh）、Agent Client Protocol（ACP）、tree-sitter 解析。

---

## 4. 关键技术选型说明

### 4.1 Effect-TS

版本 4.x，是 core / server / protocol / client 的核心范式。用于：

- 依赖注入（Layer）
- 错误建模（类型化错误通道）
- 并发与资源管理（Scope / Fiber）
- Schema 校验与编解码（Effect Schema）

**注意**：项目为 Effect 模式定制了 ast-grep 简化规则（`script/ast-grep/effect-simplifications/`），提交前会检查写法。

### 4.2 Schema 与校验

- 主：`Effect Schema`（`packages/schema`）
- 并存：`Zod 4`（部分已有代码）

新增代码优先使用 Effect Schema，保持单一数据模型来源。

### 4.3 AI Provider 层

- `packages/ai` 提供约 30+ provider 实现，每个 provider 按能力拆分子模块导出（chat / embeddings / images / videos / responses / messages / transcription）。
- 模型目录来自 **models.dev 快照**（`packages/core/src/models-dev/snapshot.txt`），由同步脚本更新，构建时通过 `modelsSnapshotPlugin` 嵌入二进制。
- 推理网关按协议区分：`chat-completions`（OpenAI 兼容）、`messages`（Anthropic）、`responses`（OpenAI Responses API）。

### 4.4 数据持久化

- Drizzle ORM（1.0 rc）+ SQLite（`@effect/sql-sqlite-bun`）。
- 迁移与 schema 定义在 core 内维护。

### 4.5 插件系统

- `packages/plugin` 提供宿主抽象与运行时；TUI 插件通过 `Plugin.define({ id, setup(context) })` 注册，用 `context.ui.slot({ append: "sidebar.content", render })` 挂载到界面槽位。
- 内置插件需在 `packages/tui/src/plugin/builtins.ts` 的 `builtins` 数组注册才生效。
- Rust 侧 `opencode-plugin` 提供 Luau 脚本 VM，用于更底层的扩展。

---

## 5. 构建与发布

### 5.1 CLI 二进制

```bash
# 单平台（开发常用）
OPENCODE_TARGET=windows-x64 bun run --cwd packages/cli build --single --outdir=dist

# 产物
packages/cli/dist/cli-windows-x64/bin/congcode.exe
```

- 使用 `bun build --compile`，开启 `bytecode: true` 提升启动性能。
- 目标平台：Linux（x64/arm64，glibc + musl）、macOS（x64/arm64）、Windows（x64/arm64），含 baseline 变体。

### 5.2 替换运行中的二进制（Windows）

```bash
./bin/congcode.exe service stop
cp packages/cli/dist/cli-windows-x64/bin/congcode.exe bin/congcode.exe
./bin/congcode.exe service start
```

服务进程 `congcode.exe serve --service` 占用 exe 时，必须先 `service stop` 再覆盖；若停不掉需强制结束该进程（不要误杀正在使用的 TUI 窗口）。

### 5.3 桌面端与容器

- Desktop：`electron-builder` → MSI / NSIS。
- Docker：多平台 OCI 镜像（`linux/amd64`、`linux/arm64`）。
- 另有 Nix flake（`flake.nix`）用于可复现构建。

---

## 6. 测试与质量

| 类型 | 工具 |
| --- | --- |
| 单元 / 集成 | `bun test` |
| Web E2E / 组件 | Playwright |
| 属性测试 | fast-check |
| DOM 模拟 | happy-dom |
| Golden master | `packages/ai/test/recorded-runner.ts` |

命令：

```bash
bun turbo typecheck      # 全仓类型检查（tsgo）
bun turbotest            # 按 turbo 图跑测试
bun run lint             # oxlint + ast-grep + 文档/灰度检查
```

### 代码规范工具

- **oxlint**：快速 lint。
- **ast-grep**：结构化规则检查，配置位于 `script/ast-grep/`：
  - `sgconfig.yml`（通用）
  - `effect-simplifications/sgconfig.yml`（Effect 写法简化）
  - `gui-plugins/sgconfig.yml`
  - `dialog-size.yml`
- **Husky**：Git hooks。

---

## 7. 版本管理约定

- 所有第三方版本通过根 `package.json` 的 `workspaces.catalog` 统一管理，子包用 `"catalog:"` 引用，避免版本漂移。
- 新增依赖必须先在 catalog 中声明，再在包内引用。

---

## 8. 新成员上手路径

1. 读 `packages/core/src/` 了解领域模型（session / prompt / tool / provider）。
2. 读 `packages/tui/src/routes/session/index.tsx` 理解终端会话渲染主链路。
3. 读 `packages/server/` 理解 TUI 与服务端的通信边界。
4. 读 `packages/plugin/src/tui/context.ts` 了解插件 API 面。
5. 用 `bun run --cwd packages/cli src/index.ts` 跑开发模式，避免每次都完整编译。

---

## 附：关键路径索引

| 关注点 | 路径 |
| --- | --- |
| 根配置 / catalog | `package.json` |
| Turbo 任务图 | `turbo.json` |
| 领域核心 | `packages/core/src/` |
| 终端 UI | `packages/tui/src/` |
| 服务端 | `packages/server/src/` |
| Web UI | `packages/app/` |
| Provider 实现 | `packages/ai/src/` |
| Schema 基座 | `packages/schema/src/` |
| 插件 API | `packages/plugin/src/tui/context.ts` |
| 二进制构建 | `packages/cli/script/build.ts` |
| Rust 底层 | `packages/cli-rs/` |
| Lint 规则 | `script/ast-grep/` |

---

## 附录 B：依赖版本清单

> 版本以 `package.json` / `workspaces.catalog` 为准；`catalog:` 表示由根 catalog 统一管理。

### B.1 工具链

| 项 | 版本 | 来源 |
| --- | --- | --- |
| 包管理器 / 运行时 | `bun@1.4.4` | `packageManager` |
| 编排 | turbo 2.10.2 | 根 devDependencies |
| Lint | oxlint 1.93.0 | 根 devDependencies |
| 结构化 lint | @ast-grep/cli 0.44.0 | 根 devDependencies |
| Git hooks | husky 9.1.7 | 根 devDependencies |
| TypeScript（发布） | 6.0.2（`npm:@typescript/typescript6@6.0.2`） | catalog |
| TypeScript（dev 编译器） | `npm:typescript@7.1.0-beta` | catalog（`@typescript/native`） |
| Node 类型 | @types/node 24.12.2 | catalog |
| Bun 类型 | @types/bun 1.4.3 | catalog |

### B.2 核心运行时

| 库 | 版本 | 用途 |
| --- | --- | --- |
| effect | 4.1.0 | 业务范式：Runtime / Stream / Schema |
| @effect/platform-node | 4.1.0 | Node 平台能力 |
| @effect/platform-node-shared | 4.1.0 | WebSocket（NodeWS）等共享实现 |
| @effect/sql-sqlite-bun | 4.1.0 | SQLite 驱动（Bun） |
| @effect/sql-sqlite-node | 4.1.0 | SQLite 驱动（Node） |
| @effect/opentelemetry | 4.1.0 | 观测 |
| hono | 4.13.13 | HTTP 服务端 |
| zod | 4.6.7 | 辅助校验（与 Effect Schema 并存） |
| @standard-schema/spec | 1.1.0 | 标准 schema 接口 |
| drizzle-orm | 1.0.0-rc.5-169397b | ORM |
| drizzle-kit | 1.0.0-rc.5-ab785fc | 迁移工具 |

### B.3 终端 UI

| 库 | 版本 |
| --- | --- |
| @opentui/core | 0.9.4 |
| @opentui/solid | 0.9.4 |
| @opentui/keymap | 0.9.4 |
| solid-js | 1.9.17 |
| solid-list | 0.3.0 |
| solid-sonner | 0.3.1 |
| @lydell/node-pty | 1.2.0-beta.12 |
| shiki | 4.4.3 |
| marked | 18.0.11 |
| marked-shiki | 1.2.1 |
| get-east-asian-width | 1.6.0 |
| string-width | 7.2.0 |

### B.4 Web UI

| 库 | 版本 |
| --- | --- |
| vite | 8.2.4（desktop / app 内），catalog 声明 7.3.7 |
| vite-plugin-solid | 2.11.10 |
| vite-plugin-pwa | 1.3.0 |
| tailwindcss | 4.3.3（app 内），catalog 4.1.11 |
| @tailwindcss/vite | 4.1.11 |
| @tanstack/solid-query | 5.91.4 |
| @tanstack/solid-virtual | 3.13.37 |
| @solidjs/router | 1.0.0 |
| @solidjs/meta | 0.29.4 |
| @solidjs/start | 2.1.0 |
| @kobalte/core | 0.13.13 |
| @corvu/drawer | 0.2.4 |
| @sentry/solid | 10.71.0 |
| dompurify | 3.4.17 |
| remeda | 2.26.0 |
| fuzzysort | 3.1.0 |
| diff | 8.0.4 |
| @pierre/diffs | 1.6.1 |
| @pierre/highlights | 0.2.0 |

### B.5 桌面端

| 库 | 版本 |
| --- | --- |
| electron | 44.9.1 |
| electron-builder | 26.15.7 |
| electron-updater | 6.8.9 |
| electron-vite | 6.0.0-beta.1 |

### B.6 AI

| 库 | 版本 |
| --- | --- |
| @ai-sdk/provider | 3.0.19 |

> `packages/ai` 下各 provider 的具体 `@ai-sdk/*` 实现按需在 catalog 或包内声明；模型目录以 models.dev 快照为准，不在依赖中体现。

### B.7 测试

| 库 | 版本 |
| --- | --- |
| @playwright/test | 1.60.0 |
| fast-check | 4.9.0 |
| happy-dom | 20.11.1 |
| @sentry/vite-plugin | 5.4.0 |

### B.8 Rust（`packages/cli-rs`）

关键 crate 职责（版本见 `packages/cli-rs/Cargo.toml`）：

| crate | 职责 |
| --- | --- |
| opencode-tui | OpenTUI 原生绑定 |
| opencode-ui | 终端 UI 通用能力、标题等 |
| opencode-plugin | Luau 脚本插件 VM（mlua） |
| opencode-drive | DHT 分布式存储（Iroh） |
| opencode-acp | Agent Client Protocol |
| opencode-mini | 轻量会话运行时 |
| 其余 | tree-sitter 解析器、api 等 |