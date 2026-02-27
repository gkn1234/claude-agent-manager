# Claude Dispatch

## 1. Identity

- **What it is:** A Next.js web application for remotely dispatching tasks to Claude Code CLI processes running on an ECS server, with real-time monitoring and an MCP-based feedback loop.
- **Purpose:** Enables users to manage AI-driven coding tasks through a mobile-first web UI, orchestrating Claude Code execution across isolated git worktrees with priority-based scheduling and concurrent execution control.

## 2. High-Level Description

Claude Dispatch is a task orchestration system built on a three-tier entity hierarchy: **Projects** (git repositories) contain **Tasks** (units of work with isolated git worktrees), which contain **Commands** (individual Claude Code invocations with prompt, status, and results). A polling scheduler consumes queued commands, spawns `claude` CLI subprocesses, and manages their lifecycle including timeout enforcement (SIGTERM/SIGKILL). Real-time UI updates flow through SSE (Server-Sent Events) with 2-second database polling for change detection.

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.1 (App Router, all client-rendered pages) |
| UI | React 19, shadcn/ui (Radix UI), Tailwind CSS 4, Lucide icons |
| Database | SQLite via better-sqlite3 + Drizzle ORM (WAL mode) |
| AI Integration | Claude Code CLI (spawned as subprocess, NDJSON stream parsing) |
| MCP | `@modelcontextprotocol/sdk` 1.27 - stdio transport MCP server |
| Validation | Zod 4 |
| Package Manager | pnpm |
| Language | TypeScript 5 |

## 4. Entity Hierarchy

```
Projects (git repo registration)
  └── Tasks (isolated git worktree per task)
        └── Commands (single claude CLI invocation)
              Status: pending → queued → running → completed/failed/aborted
```

- `src/lib/schema.ts` (`projects`, `tasks`, `commands`, `config`) - Drizzle ORM table definitions.
- Relations are one-to-many at each level. Cascade delete flows top-down.

## 5. Key Architectural Patterns

**Scheduler Polling Loop:** `src/lib/scheduler.ts` (`tick`) polls DB every N seconds for `queued` commands, respects `max_concurrent` limit and per-task serial execution constraint. Lazily initialized on first HTTP request via `src/lib/init.ts`.

**SSE Real-Time Updates:** `src/app/api/events/route.ts` maintains SSE connections, polls active commands every 2s, pushes change notifications. Client-side `src/hooks/use-commands.ts` receives SSE events then re-fetches full command list via REST for consistency.

**MCP Feedback Loop:** `src/mcp-server-stdio.ts` exposes 4 tools (`create_task`, `update_command`, `get_task_context`, `list_tasks`) to Claude subprocesses via stdio MCP. This enables Claude to self-decompose tasks, report progress, and query context -- forming a bidirectional orchestration cycle where the app dispatches Claude and Claude operates back on the app's database through REST API.

**Session Continuity:** `src/lib/claude-runner.ts` (`runCommand`) automatically passes `--resume <sessionId>` from the previous command in the same task, enabling multi-turn conversation across commands.

## 6. Mobile-First Responsive Design

- `src/components/nav/app-shell.tsx` (`AppShell`) - Uses `useIsMobile()` (768px breakpoint) to toggle between `BottomTabs` (mobile) and `Sidebar` (desktop).
- All pages are `'use client'` components. UI language is Simplified Chinese.
- 6 routes: `/` (command queue), `/projects`, `/projects/[id]`, `/tasks/[id]`, `/commands/[id]`, `/settings`.
