# 配置键参考

本文档定义项目中两套配置来源的完整清单、读取位置和生效方式。

## 1. 核心原则

**运行时可调参数必须走数据库配置系统（`getConfig()`），禁止直接读 `process.env`。环境变量仅用于启动时固定的基础设施配置（路径、端口、密钥）。**

判断依据：如果参数需要通过 Settings UI 实时修改并动态生效，则必须使用 `getConfig()`。如果参数在进程生命周期内不变（如数据库路径、监听端口），则使用环境变量。

## 2. 权威来源

- **数据库配置：** `src/lib/config.ts`（`CONFIG_DEFAULTS`、`getConfig`、`setConfig`、`getAllConfig`）- 所有动态配置的默认值及读写逻辑。
- **API 路由：** `src/app/api/system/config/route.ts`（`GET`、`PATCH`）- Settings UI 读写配置的 REST 接口。
- **数据模式：** `src/lib/schema.ts`（`config`）- SQLite config 表定义（键值对）。
- **相关架构：** `/llmdoc/architecture/commands-scheduler-architecture.md` - 动态配置如何控制调度行为。

## 3. 数据库配置（运行时动态生效，Settings UI 可修改）

通过 `getConfig(key)` 读取，`setConfig(key, value)` 写入，存储在 SQLite `config` 表中。

| 键名 | 默认值 | 读取位置 | 生效方式 |
|-----|---------|----------|----------|
| `max_concurrent` | `2` | `src/lib/scheduler.ts:39` 每次 tick | 下次 tick 立即生效 |
| `command_timeout` | `1800` | `src/lib/claude-runner.ts:320` 每次执行命令 | 新命令立即生效 |
| `poll_interval` | `5` | `src/lib/scheduler.ts:31` 每次 tick | 检测变更后热重载 interval |
| `log_retention_days` | `30` | 日志清理逻辑 | 下次清理时生效 |

## 4. 环境变量（启动时固定，不可通过 UI 修改）

通过 `process.env` 读取，仅在进程启动时加载一次（通过 systemd EnvironmentFile 或 `.env`）。

| 变量名 | 默认值 | 读取位置 | 用途 |
|--------|--------|----------|------|
| `DB_PATH` | `./data/dispatch.db` | `src/lib/db.ts:7` | SQLite 数据库文件路径 |
| `LOG_DIR` | `./logs` | `src/lib/claude-runner.ts:9` | 命令 NDJSON 日志目录 |
| `PORT` | `3000` | standalone `server.js` | Next.js 监听端口 |
| `AUTH_PASSWORD` | （必填） | `src/lib/auth.ts:8` | 登录密码 |
| `AUTH_SECRET` | （必填） | `src/lib/auth.ts:9` | HMAC-SHA256 Cookie 签名密钥 |

`AUTH_PASSWORD` 和 `AUTH_SECRET` 均未设置时，应用返回 503 拒绝所有请求。参考 `.env.example`。

## 5. API 验证规则

`src/app/api/system/config/route.ts` PATCH 端点：

- 仅接受 `CONFIG_KEYS` 中的键（否则 400）。
- 数字键必须为非负数。
- `poll_interval` 额外约束：>= 1。

## 6. 历史教训

`command_timeout` 和 `poll_interval` 曾直接读 `process.env`，导致 Settings UI 修改不生效。已修复为统一使用 `getConfig()`。新增运行时参数时，务必遵循第 1 节原则。
