# 命令取消与 Pending UI 设计

**日期：** 2026-02-28
**状态：** 设计完成，待实现

## 问题

排队中（queued）的命令取消时被标记为 `aborted`（终态），语义不正确。queued 命令还没开始执行，应该是"取消"（可恢复），而不是"中止"（终态不可恢复）。同时 pending 状态在 UI 层完全缺失操作入口。

## 当前现状

### 状态机
```
pending: ['queued', 'aborted']
queued: ['running', 'pending', 'aborted']
running: ['completed', 'failed', 'aborted']
```

### UI 入口
- `command-card.tsx:88` — 只对 `running` 显示中止按钮
- `tasks/[id]/page.tsx:229` — 对 `running` 和 `queued` 都显示中止按钮
- 两处都发送 `{ status: 'aborted' }`
- **pending 状态没有任何 UI 入口**（无排队按钮、无编辑、无删除）

### 命令创建
- API 支持 `autoQueue=false` 创建 pending 命令（`commands/route.ts:35`）
- 前端始终使用默认 `autoQueue=true`，直接创建 queued 命令

## 设计方案

### 第一步：Pending 命令的编辑与操作 UI

pending 命令卡片提供三个能力：

1. **可编辑**：用户可修改 prompt、mode、providerId（内联编辑或弹窗）
2. **排队按钮**：确认内容后点击排队，发送 `PATCH { status: 'queued' }`
3. **删除按钮**：真删除记录，发送 `DELETE /api/commands/[id]`

#### 新增 API 端点

`DELETE /api/commands/[id]` — 只允许删除 `pending` 状态的命令，其他状态返回 400。

```typescript
// src/app/api/commands/[id]/route.ts
export async function DELETE(req, { params }) {
  const command = db.select()...
  if (command.status !== 'pending') {
    return NextResponse.json({ error: '只能删除 pending 状态的命令' }, { status: 400 });
  }
  db.delete(commands).where(eq(commands.id, id)).run();
  return NextResponse.json({ ok: true });
}
```

#### 编辑 API

`PATCH /api/commands/[id]` 扩展：当命令为 `pending` 状态时，额外允许修改 `prompt`、`mode`、`providerId` 字段。

### 第二步：调整状态机和取消语义

1. **API 状态机变更**：
   ```
   // 之前
   pending: ['queued', 'aborted']
   queued: ['running', 'pending', 'aborted']

   // 之后
   pending: ['queued']
   queued: ['running', 'pending']
   ```
   - 去掉 `queued -> aborted`：取消排队用 `queued -> pending`
   - 去掉 `pending -> aborted`：不想要的 pending 命令直接 DELETE
   - `aborted` 只能从 `running` 状态触发（真正的执行中止）

2. **UI 变更**：
   - queued 命令：按钮从"中止"改为"取消排队"，发送 `{ status: 'pending' }`
   - running 命令：保持"中止"按钮，发送 `{ status: 'aborted' }`
   - pending 命令：显示"排队"、"编辑"、"删除"操作

3. **文案与图标区分**：
   - 取消排队（queued → pending）：回退图标，可恢复操作
   - 中止执行（running → aborted）：停止图标，终态操作
   - 删除命令（pending → 删除）：垃圾桶图标，物理删除

### 最终状态机

```
pending: ['queued']           — 排队
queued:  ['running', 'pending'] — 调度执行 / 取消排队
running: ['completed', 'failed', 'aborted'] — 完成 / 失败 / 中止
```

pending 另有 DELETE 操作（非状态转换）。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/app/api/commands/[id]/route.ts` | 状态机调整；新增 DELETE 端点；PATCH 扩展 pending 编辑 |
| `src/app/tasks/[id]/page.tsx` | pending 编辑/排队/删除 UI；queued "取消排队"按钮 |
| `src/app/commands/[id]/page.tsx` | 如有 abort 逻辑需同步调整 |
| `src/components/commands/command-card.tsx` | 列表视图中 queued 取消排队支持 |
| `llmdoc/reference/command-state-machine.md` | 更新状态转换表 |
| `llmdoc/architecture/commands-scheduler-architecture.md` | 更新相关描述 |
