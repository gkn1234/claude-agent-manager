# llmdoc Index

Entry point for LLM agents navigating the Claude Dispatch documentation. Read documents in order: overview first, then architecture, then guides/reference as needed.

## Overview

| Document | Description |
|---|---|
| [project-overview](overview/project-overview.md) | What Claude Dispatch is: a Next.js app for remotely dispatching tasks to Claude Code CLI processes with real-time monitoring and MCP feedback loop. Covers identity, tech stack, and entity hierarchy (Projects -> Tasks -> Commands). |

## Architecture

| Document | Description |
|---|---|
| [projects-architecture](architecture/projects-architecture.md) | How the Projects entity works: schema, API routes, git utilities, and the three creation modes (clone, new, local). |
| [tasks-architecture](architecture/tasks-architecture.md) | How Tasks provide git worktree isolation and serial command execution within a project. Covers creation, init commands, and worktree lifecycle. |
| [commands-scheduler-architecture](architecture/commands-scheduler-architecture.md) | The command execution pipeline: priority-based scheduling, concurrency control, Claude CLI subprocess lifecycle, timeout enforcement, and orphan recovery. |
| [mcp-feedback-loop](architecture/mcp-feedback-loop.md) | Bidirectional MCP bridge between Claude subprocesses and the app. Covers the 4 MCP tools (create_task, update_command, get_task_context, list_tasks) and how recursive task decomposition works. |

## Guides

| Document | Description |
|---|---|
| [managing-projects](guides/managing-projects.md) | How to create, list, retrieve, and delete projects via the REST API. |
| [working-with-tasks](guides/working-with-tasks.md) | Task lifecycle: creation, automatic init, follow-up commands, monitoring, and deletion. |
| [dispatching-commands](guides/dispatching-commands.md) | Full command lifecycle: create, queue, execute, monitor, reorder priority, and abort. |
| [mcp-integration](guides/mcp-integration.md) | How to configure, extend, and debug the MCP integration (adding new tools, setting API_BASE, reading logs). |

## Reference

| Document | Description |
|---|---|
| [coding-conventions](reference/coding-conventions.md) | Project coding standards: Next.js 16, TypeScript strict, pnpm, Tailwind v4, shadcn/ui, Drizzle ORM + SQLite, Zod validation, zh-CN UI. |
| [git-conventions](reference/git-conventions.md) | Git workflow: single main branch, worktree-based task isolation, Conventional Commits format. |
| [command-state-machine](reference/command-state-machine.md) | Complete state transition rules for commands: 6 states (pending, queued, running, completed, failed, aborted) with enforced transition map. |
