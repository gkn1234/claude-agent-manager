# 服务商配置文件（Provider Profiles）架构

## 1. 系统定位

- **是什么：** 向 Claude CLI 子进程提供 API 凭证和环境变量的命名服务商配置。
- **用途：** 支持在不修改服务器环境的情况下，按命令切换不同的 API 服务商（Anthropic 直连、Bedrock、Vertex 等）。所有命令都必须有服务商——不存在默认环境变量兜底。

## 2. 核心组件

- `src/lib/schema.ts`（`providers`）：定义 `providers` 表 -- id、name、envJson（自由格式 JSON 键值对）、isDefault、sortOrder、createdAt、updatedAt。
- `src/app/api/providers/route.ts`（`GET`、`POST`）：按 `sortOrder` 升序列出服务商（敏感键的环境变量值已脱敏）。创建新服务商时自动递增 `sortOrder`。
- `src/app/api/providers/[id]/route.ts`（`PATCH`、`DELETE`）：更新服务商名称/envJson；删除服务商。
- `src/app/api/providers/reorder/route.ts`（`PATCH`）：批量更新所有服务商的 `sortOrder`，持久化拖放排序结果。
- `src/lib/claude-runner.ts:107-131`（`runCommand`）：通过 `command.providerId` 加载服务商，清除冲突的环境变量，将服务商的 `envJson` 注入生成环境。
- `src/app/(app)/settings/page.tsx`（`SettingsPage`、`SortableProviderCard`、`NewProviderCard`）：设置页面使用 Tabs 分为"Provider 配置"和"系统参数"两个 Tab。Provider 卡片使用 Collapsible 组件实现折叠/展开，默认折叠仅显示名称和拖拽手柄；新建 Provider 卡片默认展开。
- `src/components/ui/collapsible.tsx`（`Collapsible`、`CollapsibleTrigger`、`CollapsibleContent`）：shadcn/ui Collapsible 组件，基于 Radix UI Collapsible 原语封装。
- `src/app/tasks/[id]/page.tsx`：任务页面在 init 触发器和命令输入两处显示服务商 `<select>` 下拉框。选择结果持久化到 `task.lastProviderId`。
- `src/app/commands/[id]/page.tsx`：命令详情页显示可折叠的 `execEnv` 区块，包含服务商名称、cwd、CLI 参数和脱敏环境变量。

## 3. 执行流程（LLM 检索图）

### 3a. 服务商 CRUD

- **1. 创建：** `POST /api/providers`，携带 `{ name, envJson }` -- `src/app/api/providers/route.ts:38-68`。`envJson` 可为字符串或对象，`sortOrder` 自动赋值为 max+1。
- **2. 列表：** `GET /api/providers` -- `src/app/api/providers/route.ts:25-36`。按 `sortOrder` 返回所有服务商，敏感环境变量值已脱敏（前 8 字符 + `....`）。
- **3. 更新：** `PATCH /api/providers/{id}` -- `src/app/api/providers/[id]/route.ts:6-25`。更新名称和/或 envJson。
- **4. 删除：** `DELETE /api/providers/{id}` -- `src/app/api/providers/[id]/route.ts:27-35`。
- **5. 重排序：** `PATCH /api/providers/reorder`，携带 `{ items: [{ id, sortOrder }] }` -- `src/app/api/providers/reorder/route.ts:6-21`。持久化 UI 中拖放的排序结果。

### 3b. 运行时服务商注入

- **1.** `runCommand()` 读取 `command.providerId` 并加载服务商行。
- **2.** 清除已知冲突的环境变量：`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`、`CLAUDE_CODE_USE_BEDROCK`、`CLAUDE_CODE_USE_VERTEX` 等 -- `src/lib/claude-runner.ts:107-124`。
- **3.** 解析 `provider.envJson` 并将所有键值对合并到生成环境变量中 -- `src/lib/claude-runner.ts:126-129`。
- **4.** 在命令记录上记录脱敏的 `execEnv` 审计对象 -- `src/lib/claude-runner.ts:134-149`。

### 3c. 敏感值脱敏

GET API 和 `execEnv` 审计均使用模式匹配（`/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i`）对长度超过 8 个字符的值进行脱敏：`前8字符....`。

## 4. 设计原理

- **自由格式 envJson** 允许任意环境变量，而非固定 schema，支持任何当前或未来的 Claude CLI 配置。
- **注入前清除冲突环境变量**，防止服务器自身的环境变量泄漏到使用不同服务商的命令中。
- **sortOrder 字段** 通过 `@dnd-kit/sortable` 实现稳定的拖放排序，无需依赖插入顺序。
- **服务商必填（无兜底）**，使每条命令的凭证使用明确且可审计。
