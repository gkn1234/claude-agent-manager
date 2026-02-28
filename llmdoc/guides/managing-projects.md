# 如何通过 API 管理项目

通过 REST API 创建、列出、获取和删除项目的指南。

## 创建项目

1. **选择创建模式**（`clone`、`new` 或 `local`）：
   - `clone`：提供 `gitUrl`，可选填 `name`/`workDir`。系统将克隆仓库。
   - `new`：提供 `name`，可选填 `workDir`。系统将创建目录并运行 `git init`。
   - `local`：提供指向已有 git 仓库的 `workDir`。若省略 `name`，则从目录名派生。

2. **发送请求：** `POST /api/projects`，携带 JSON 请求体：
   ```json
   { "name": "my-project", "gitUrl": "https://...", "mode": "clone" }
   ```
   完整验证逻辑请参见 `src/app/api/projects/route.ts:22-87`。

3. **处理响应：**
   - `201`：项目已创建，响应包含 `{ id, name, workDir, gitRemote }`。
   - `400`：缺少必填字段（如 clone 模式未提供 `gitUrl`，local 模式目录不存在）。
   - `409`：目录冲突（`new` 模式目录已存在，或 `clone` 模式为不同仓库）。

4. **默认目录：** 若省略 `workDir`，项目将创建在 `~/claude-agent-manager/<name>` 下。

## 列出所有项目

1. **发送：** `GET /api/projects`
2. **响应：** 所有项目记录的 JSON 数组（id、name、workDir、gitRemote、createdAt、updatedAt）。

## 获取单个项目

1. **发送：** `GET /api/projects/<id>`
2. **响应：** 项目对象（含嵌套的 `tasks` 数组），不存在则返回 `404`。
   参见 `src/app/api/projects/[id]/route.ts:7-14`。

## 删除项目

1. **发送：** `DELETE /api/projects/<id>`
2. **级联行为：** 系统对每个任务调用 `cleanupTask()`，该函数会终止运行中的进程、删除日志文件、移除 git 工作树，并删除命令和任务数据库记录，最后删除项目行本身。参见 `src/app/api/projects/[id]/route.ts:16-28`。
3. **响应：** 成功返回 `{ "ok": true }`，项目不存在返回 `404`。
