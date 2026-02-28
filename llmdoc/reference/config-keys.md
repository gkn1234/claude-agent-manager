# 配置键参考

本文档提供所有运行时配置键的摘要及其来源指针。

## 1. 核心摘要

系统使用由数据库支撑的配置表（`config`），并在代码中设有默认值。通过 `getConfig(key)` 读取配置，通过 `setConfig(key, value)` 写入配置。所有值均以字符串形式存储。PATCH API 对数字键和字符串键分别进行验证。

## 2. 权威来源

- **主要代码：** `src/lib/config.ts`（`CONFIG_DEFAULTS`、`getConfig`、`setConfig`、`getAllConfig`）- 所有默认值及读写逻辑。
- **API 路由：** `src/app/api/system/config/route.ts`（`GET`、`PATCH`）- 读取和更新配置的 REST 接口。
- **数据模式：** `src/lib/schema.ts`（`config`）- SQLite 表定义（键值对）。
- **相关架构：** `/llmdoc/architecture/tasks-architecture.md` - `init_prompt` 和 `research_prompt` 在任务流水线中的使用方式。
- **相关架构：** `/llmdoc/architecture/commands-scheduler-architecture.md` - `max_concurrent`、`poll_interval`、`command_timeout` 如何控制调度。

## 3. 配置键

| 键名 | 类型 | 默认值 | 描述 |
|-----|------|---------|-------------|
| `max_concurrent` | 数字 | `2` | 所有任务中最大并发运行命令数 |
| `command_timeout` | 数字 | `1800` | 运行中命令被终止（SIGTERM）之前的秒数 |
| `poll_interval` | 数字 | `5` | 调度器 tick 间隔（秒），最小值：1 |
| `log_retention_days` | 数字 | `30` | 日志文件保留天数 |
| `init_prompt` | 字符串 | *（见下文）* | 任务 init 命令的模板。占位符：`{workDir}`、`{description}` |
| `research_prompt` | 字符串 | *（见下文）* | 任务 research 命令的模板。占位符：`{description}` |

`init_prompt` 由 `src/app/api/tasks/[id]/init/route.ts:35-38` 在手动触发 init 时使用。`research_prompt` 由 `src/lib/claude-runner.ts:272-273` 在 init 成功后自动创建 research 命令时使用。

## 4. API 验证规则

`src/app/api/system/config/route.ts:13-44` 中的 PATCH 端点强制执行以下规则：

- 仅接受 `CONFIG_KEYS` 中的键（否则返回 400）。
- 数字键（`max_concurrent`、`command_timeout`、`log_retention_days`、`poll_interval`）必须为非负数。
- `poll_interval` 有额外的最小值约束：必须 >= 1。
- 字符串键（`init_prompt`、`research_prompt`）接受任意字符串值。
