# Provider Profiles 设计文档

## 概述

在系统设置中配置多个 Provider Profile（命名的环境变量键值对集合），用户在派发指令前可选择 Profile 切换 API 端点/Key/模型。每个任务按任务级别记忆上次选择的 Profile 和 mode(plan/exec)。

## 数据模型

### 新增 `providers` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | UUID |
| name | text NOT NULL | 显示名称，如 "智谱 GLM" |
| envJson | text NOT NULL | JSON 对象，存环境变量键值对 |
| isDefault | integer DEFAULT 0 | 预留：是否全局默认 |
| createdAt | text | 创建时间 |
| updatedAt | text | 更新时间 |

`envJson` 示例：
```json
{
  "ANTHROPIC_BASE_URL": "https://open.bigmodel.cn/api/anthropic",
  "ANTHROPIC_API_KEY": "sk-xxx",
  "ANTHROPIC_MODEL": "glm-5"
}
```

### `commands` 表新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| providerId | text nullable | 关联 providers.id，null = 默认环境 |
| execEnv | text nullable | JSON，记录实际执行时的脱敏参数（审计用） |

### `tasks` 表新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| lastProviderId | text nullable | 上次选的 profile |
| lastMode | text nullable | 上次选的 mode (execute/plan) |

## API 设计

```
GET    /api/providers           — 列出所有 profile（敏感值脱敏）
POST   /api/providers           — 创建 { name, envJson }
PATCH  /api/providers/:id       — 更新 { name?, envJson? }
DELETE /api/providers/:id       — 删除
PATCH  /api/tasks/:id           — 更新 { lastProviderId?, lastMode? }
```

## Runner 注入逻辑

`claude-runner.ts` 中 spawn 前：

1. 查 `command.providerId` → 查 `providers` 表获取 `envJson`
2. 清除 `process.env` 中所有 provider 相关变量（ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL, CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_USE_VERTEX, CLAUDE_CODE_USE_FOUNDRY）
3. 注入 profile 的环境变量
4. 记录脱敏后的执行参数到 `execEnv` 字段
5. spawn claude CLI

## UI 设计

### 设置页 — Provider 管理

卡片式 CRUD，每个 profile 显示名称 + 环境变量列表（可增删行），API Key 类字段 mask 显示。

### 任务页 — 指令输入区

输入区上方增加：左侧 Profile 下拉，右侧 Plan/Exec Switch 组件。切换自动保存到 task。

### 指令详情页 — 执行参数

折叠区展示 cwd、provider 名称、脱敏环境变量、CLI 参数。

## 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `src/lib/schema.ts` | 新增 providers 表；commands 加 providerId/execEnv；tasks 加 lastProviderId/lastMode |
| `src/app/api/providers/route.ts` | 新建：GET + POST |
| `src/app/api/providers/[id]/route.ts` | 新建：PATCH + DELETE |
| `src/app/api/tasks/[id]/route.ts` | PATCH 支持 lastProviderId/lastMode |
| `src/app/api/tasks/[id]/commands/route.ts` | 接收 providerId |
| `src/lib/claude-runner.ts` | provider 环境变量注入 + execEnv 记录 |
| `src/app/settings/page.tsx` | 新增 Provider 管理区域 |
| `src/app/tasks/[id]/page.tsx` | Profile 下拉 + Plan/Exec Switch + 任务记忆 |
| `src/app/commands/[id]/page.tsx` | 执行参数展示 |
