# CLAUDE.md

本文件为 Claude Code 在本仓库工作时提供指引。请用中文回复。

## 项目简介

一个桌面端管理软件，用于**多标签管理 Claude Code 与 Google Antigravity 的会话**。每个标签托管一个真实的 CLI 进程，用户在标签内像使用终端一样与 AI 编码助手交互；应用负责标签管理、会话索引、历史会话浏览与恢复。

第一版优先支持 **Claude Code**，已扩展接入 Antigravity（`agy` CLI）。

### Provider 会话能力差异（接入时注意）

| Provider | 程序 | 新建会话 | 恢复会话 |
|----------|------|----------|----------|
| Claude   | `claude` | `--session-id <uuid>`（自带 id 创建） | `--resume <uuid>`（精确续接） |
| Antigravity | `agy` | 直接启动 | `--conversation <id>` 精确续接，回退 `--continue` |

> Antigravity(agy) 不支持预指定会话 id，但它把「工作目录 → 会话 id」映射存于
> `~/.gemini/antigravity-cli/cache/projects.json`。后端 `agy::agy_conversation_id`
> 按 cwd 解析出真实会话 id，store 在标签渲染前覆盖到 `sessionId`，再由
> `src/lib/providers.ts` 的 `buildArgs` 生成 `--conversation <id>`；解析不到则回退 `--continue`。

## 核心架构：PTY 终端托管

**根本路线**：不自研聊天协议，而是用伪终端（PTY）托管官方 CLI 进程，前端用 xterm.js 渲染真实终端画面。

```
React + xterm.js (前端)
   ⇅  Tauri Channel（双向字节流）
Rust 后端：portable-pty 每个标签一个 PTY 进程 → spawn `claude` (指定 cwd)
   +  SQLite：标签元数据 / 设置
```

**关键认知**：对话内容由 Claude Code 自身存储在 `~/.claude/projects/<cwd>/<session-id>.jsonl`。
- 本应用的 SQLite **只存**：打开的标签、各自工作目录、绑定的 session_id、应用设置。
- "会话浏览/恢复" = **读取官方 JSONL** 来展示历史，并通过 `claude --resume <session-id>` 续接，**不重复存储对话内容**。

## 技术栈

| 层 | 选型 |
|----|------|
| 桌面壳 | Tauri 2.x |
| 前端 | React + TypeScript + Vite + Zustand |
| 终端渲染 | xterm.js（addon-fit / web-links / search，性能用 webgl） |
| PTY | Rust `portable-pty`（Windows 走 ConPTY） |
| 前后端流式通道 | Tauri `Channel`（高吞吐双向字节流，**不要用 event**） |
| 本地存储 | SQLite（`rusqlite` 或 `tauri-plugin-sql`） |
| 异步运行时 | tokio |

## 目录结构（规划）

```
coder/
├── src/                 # React 前端
│   ├── components/       # 终端、标签栏、会话浏览器等组件
│   ├── stores/          # Zustand 状态（标签、设置）
│   └── lib/             # Tauri 调用封装、xterm 封装
├── src-tauri/           # Rust 后端
│   ├── src/
│   │   ├── pty/         # PTY 进程管理
│   │   ├── db/          # SQLite 访问
│   │   ├── session/     # JSONL 会话解析
│   │   └── lib.rs       # Tauri commands 注册
│   └── tauri.conf.json
└── docs/                # 设计文档
```

## 常用命令

> 项目尚未初始化，以下为规划中的命令，脚手架搭好后据实更新。

```bash
pnpm install          # 安装前端依赖
pnpm tauri dev        # 开发模式（前端 + Rust 热重载）
pnpm tauri build      # 打包发布
cargo test            # Rust 单测（在 src-tauri 下）
```

## 关键技术风险（开发时注意）

1. **Windows ConPTY**：`portable-pty` 在 Windows 走 ConPTY，颜色/光标偶有异常，xterm.js 基本可扛。
2. **高吞吐流式**：CLI 刷屏快，Channel 传字节需批量 flush / 背压，避免 UI 卡顿。
3. **claude 可执行路径与认证**：需自动探测或让用户配置 `claude` 路径；登录认证完全交给 CLI 自身处理，应用不介入。
4. **PTY resize**：xterm 的 cols/rows 变化必须实时同步到后端 PTY，否则换行错乱。

## 开发约定

- 回复与文档一律使用中文。
- 新增 Tauri command 时同步更新前端调用封装（`src/lib/`）。
- 标签/会话状态变更要持久化到 SQLite，保证重启可恢复。
- Provider（Claude / Gemini）通过统一抽象接入，新增 provider 不应改动 PTY 核心逻辑。
