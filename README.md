# Claude Dispatch

一个用于远程向 Claude Code CLI 进程派发任务的 Web 应用，具备实时监控、服务商配置文件和 MCP 反馈循环。

## 功能特性

- **项目管理** — 注册 git 仓库，支持 clone、新建、本地目录三种模式
- **任务隔离** — 每个任务自动创建独立的 git 工作树（worktree），原子操作
- **命令派发** — 基于优先级的调度队列，支持并发控制和每任务串行执行
- **服务商配置** — 多套 API 凭证配置文件，命令执行时按需注入环境变量
- **MCP 反馈循环** — Claude 子进程可通过 MCP 工具自我分解任务、汇报进度
- **实时监控** — SSE 推送命令状态变更，Web UI 实时更新
- **语音输入** — 支持通过浏览器语音识别输入命令（Web Speech API）
- **移动端优先** — 响应式设计，手机和桌面端均可使用

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16（App Router） |
| UI | React 19、shadcn/ui、Tailwind CSS 4 |
| 数据库 | SQLite + Drizzle ORM |
| AI 集成 | Claude Code CLI（子进程） |
| MCP | Streamable HTTP 传输 |
| 包管理器 | pnpm |

## 本地开发

```bash
# 安装依赖
pnpm install

# 复制环境变量
cp .env.example .env

# 启动开发服务器
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_PATH` | `./data/dispatch.db` | SQLite 数据库路径 |
| `LOG_DIR` | `./logs` | 命令执行日志目录 |
| `PORT` | `3000` | 服务端口 |
| `MAX_CONCURRENT` | `2` | 最大并发命令数 |
| `COMMAND_TIMEOUT` | `1800` | 命令超时时间（秒） |
| `POLL_INTERVAL` | `5` | 调度器轮询间隔（秒） |

以上调度参数也可通过 Web UI 的系统设置页面动态修改。

## EC2 部署

详见 [deploy/README.md](deploy/README.md)。

```bash
# 1. 环境初始化（首次）
sudo bash deploy/setup-ec2.sh

# 2. 部署应用
sudo su - dispatch
cd ~/claude-dispatch
bash deploy/deploy.sh
```

## 日志查看

```bash
# 应用服务日志
journalctl -u claude-dispatch -f

# 命令执行日志（NDJSON 格式）
ls logs/

# 也可通过 API 读取
curl http://localhost:3000/api/commands/{id}/logs
```

## 项目结构

```
src/
├── app/                  # Next.js App Router 页面和 API 路由
│   ├── api/              # REST API 端点
│   └── (pages)/          # 页面组件
├── components/           # React 组件
│   ├── commands/         # 命令相关组件
│   ├── projects/         # 项目相关组件
│   ├── nav/              # 导航组件
│   └── ui/               # shadcn/ui 基础组件
├── hooks/                # 自定义 React hooks
└── lib/                  # 核心库
    ├── schema.ts         # Drizzle ORM 数据模式
    ├── scheduler.ts      # 命令调度器
    ├── claude-runner.ts  # Claude CLI 进程管理
    └── config.ts         # 运行时配置
```

## License

Private
