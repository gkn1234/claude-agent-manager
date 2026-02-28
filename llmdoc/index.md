# llmdoc Index

Entry point for LLM agents navigating the Claude Dispatch documentation. Read documents in order: overview first, then architecture, then guides/reference as needed.

## Overview

| Document | Description |
|---|---|
| [project-overview](overview/project-overview.md) | What Claude Dispatch is: a Next.js app for remotely dispatching tasks to Claude Code CLI processes with real-time monitoring, provider profiles, and MCP feedback loop. Covers identity, tech stack, entity hierarchy (Projects -> Tasks -> Commands, Providers), and key patterns. |

## Architecture

| Document | Description |
|---|---|
| [projects-architecture](architecture/projects-architecture.md) | How the Projects entity works: schema, API routes, git utilities, three creation modes (clone, new, local), and cascade deletion via `cleanupTask()`. |
| [tasks-architecture](architecture/tasks-architecture.md) | How Tasks provide git worktree isolation and a manual-trigger init pipeline (pending -> init -> research -> ready). Covers status gating, provider requirement, cleanup logic, configurable prompts, task detail page (delete button, description truncate+dialog), and create-task dialog long content support. |
| [commands-scheduler-architecture](architecture/commands-scheduler-architecture.md) | The command execution pipeline: priority-based scheduling, concurrency control, mode-based CLI flags (`--permission-mode plan`), provider env injection, execEnv audit, permission_denials extraction (AskUserQuestion -> markdown), runner post-processing, providerName in command list, three-section detail page layout with sticky input, and inline command input from the detail page. |
| [providers-architecture](architecture/providers-architecture.md) | Provider profiles: named configurations with free-form env key-value pairs, CRUD API, drag-and-drop reordering, runtime env injection, and sensitive value masking. |
| [mcp-feedback-loop](architecture/mcp-feedback-loop.md) | Bidirectional MCP bridge between Claude subprocesses and the app via Streamable HTTP (`/api/mcp`). Covers the 4 MCP tools (create_task, update_command, get_task_context, list_tasks) with direct DB access, stateless transport, and recursive task decomposition. |

## Guides

| Document | Description |
|---|---|
| [managing-projects](guides/managing-projects.md) | How to create, list, retrieve, and delete projects via the REST API. Deletion now uses `cleanupTask()` for full cleanup. |
| [working-with-tasks](guides/working-with-tasks.md) | Task lifecycle: creation (pending), manual init with provider, two-phase pipeline, follow-up commands, monitoring (description truncate+dialog), and deletion (UI delete button with confirm, redirect to project). Provider is required for all operations. |
| [dispatching-commands](guides/dispatching-commands.md) | Full command lifecycle: create (with provider), queue, execute, monitor, view execEnv, dispatch follow-up from detail page (navigates to task page), reorder priority, and abort. |
| [mcp-integration](guides/mcp-integration.md) | How to configure, extend, and debug the MCP integration (adding new tools, setting API_BASE, reading logs). |

## Reference

| Document | Description |
|---|---|
| [config-keys](reference/config-keys.md) | All runtime configuration keys: scheduler params (max_concurrent, poll_interval, command_timeout), prompt templates (init_prompt, research_prompt), and API validation rules. |
| [coding-conventions](reference/coding-conventions.md) | Project coding standards: Next.js 16, TypeScript strict, pnpm, Tailwind v4, shadcn/ui, Drizzle ORM + SQLite, Zod validation, @dnd-kit, zh-CN UI. |
| [git-conventions](reference/git-conventions.md) | Git workflow: single main branch, worktree-based task isolation, Conventional Commits format, cleanupTask() for worktree removal. |
| [command-state-machine](reference/command-state-machine.md) | Complete state transition rules for commands: 6 states (pending, queued, running, completed, failed, aborted) with enforced transition map. Commands require providerId. |
