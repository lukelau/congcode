# congcode

> 面向企业内网的 AI 编程智能体，基于 [OpenCode](https://github.com/sst/opencode) 二次开发。

congcode 是一个运行在终端里的 AI 编程助手。它理解你的代码库、能读写文件、执行命令、运行测试，并支持接入企业私有模型服务，全程数据可控。

---

## 特性

### 终端优先

原生终端界面，基于 SolidJS 渲染，操作流畅不卡顿。键盘驱动，无需离开命令行。

### 多形态接入

| 形态 | 入口 |
| --- | --- |
| 终端（TUI） | `congcode` |
| Web | `congcode serve` 后浏览器访问 |
| 桌面 | Electron 客户端 |
| 无头 / 脚本 | `congcode run` |

三种形态共用同一套服务端与领域核心，配置、会话、历史完全互通。

### 私有模型接入

支持通过配置接入企业内网模型网关，兼容多种协议：

```json
{
  "providers": {
    "internal": {
      "settings": {
        "baseURL": "http://your-model-gateway/v1",
        "apiKey": "sk-..."
      },
      "models": {
        "my-model": {
          "name": "内部模型",
          "package": "aisdk:@ai-sdk/openai-compatible"
        }
      }
    }
  }
}
```

同时内置 70+ 公共 provider，开箱可用。

### 会话笔记

在任意 AI 回复上单击即可将其保存为笔记，随时归档有价值的技术结论：

- 追加到项目下的 `notes.md`，带时间戳分隔
- 右侧栏统一浏览、预览
- 支持新建独立笔记文件
- 保存目录可配置

### 会话管理

- **分叉（Fork）**：从任意节点分出新的会话分支，尝试不同方向而不污染原对话
- **回滚（Revert）**：撤销到指定的历史节点，同时回退期间的文件改动
- **时间线**：快速定位历史消息
- **后台任务**：长任务异步运行，不阻塞主对话

### 插件体系

- **TUI 插件**：扩展界面——侧栏区块、对话框、页面、代码块渲染器、键位
- **服务端插件**：扩展 agent 行为——工具、钩子、provider、命令

### 工程能力

- 文件读写与精确编辑（基于 diff）
- 代码检索（glob / grep / 全文索引）
- 命令执行（真实 PTY，非模拟）
- 上下文压缩，长会话不爆窗口
- 文件快照，配合回滚使用
- MCP 协议支持，接入外部工具

---

## 快速开始

### 安装

从发布页下载对应平台的 `congcode` 二进制，放入 `PATH` 即可。无需 Node.js 或 Bun 运行时。

### 首次运行

```bash
cd /path/to/your/project
congcode
```

首次启动会引导你配置模型 provider。

### 常用命令

```bash
congcode                    # 启动终端界面（当前目录）
congcode -c                 # 继续上次会话
congcode serve --port 4096  # 启动 Web 服务
congcode run "解释这个函数"   # 单次执行
congcode models             # 列出可用模型
congcode session list       # 查看会话列表
congcode upgrade            # 升级
```

---

## 配置

配置文件按就近原则查找：

1. 项目级：`<项目>/.opencode/opencode.json`、`opencode.json`、`opencode.jsonc`
2. 用户级：`~/.config/opencode/opencode.json`（Windows：`%USERPROFILE%\.config\opencode\opencode.json`）
3. 数据目录：`~/.opencode/`

常用配置项：

```json
{
  "model": "internal/my-model",
  "small_model": "internal/my-model",
  "notes": { "directory": "docs/notes" },
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["my-mcp-server", "--mcp"],
      "enabled": true
    }
  }
}
```

**提示**：配置文件含 API key，切勿提交到版本库。

---

## 数据与隐私

congcode 本身不上传任何数据。你的代码与会话只发往**你配置的模型服务**。

使用公共推理服务时请注意对方的数据条款；处理私有代码、客户信息或凭据时，建议接入企业内部模型网关或本地模型服务（如 Ollama、vLLM），确保数据不出内网。

---

## 架构

三层结构，前端只负责渲染，业务逻辑全部下沉到领域层：

```
前端  tui / app / desktop
   ↓
服务  server（HTTP · WebSocket · 事件流）
   ↓
领域  core（会话 · 工具 · provider · 插件 · 持久化）
   ↓
能力  ai · schema · util
   ↓
原生  cli-rs（终端渲染 · 插件 VM · 协议）
```

会话执行采用"从历史恢复"的设计：每次运行都从已落库的会话历史启动，因此进程重启、切换工作目录后都能无缝继续。

详细的架构说明与选型清单见：

- [技术架构](docs/architecture.md)
- [技术栈与版本](docs/tech-stack.md)

---

## 开发

环境要求：Bun ≥ 1.4.4

```bash
bun install
bun run dev              # 开发模式（终端界面）
bun run dev:web          # 开发模式（Web 界面）

bun turbo typecheck      # 类型检查
bun test                 # 测试
bun run lint             # 代码规范
```

构建单文件二进制：

```bash
OPENCODE_TARGET=windows-x64 bun run --cwd packages/cli build --single --outdir=dist
```

产物位于 `packages/cli/dist/cli-<target>/bin/congcode`。

---

## 许可

本项目基于 [OpenCode](https://github.com/sst/opencode) 二次开发，遵循 MIT 许可证，详见 [LICENSE](LICENSE)。

MIT 允许商业使用、修改与再分发，分发时需保留原始版权声明与许可证文本。