# Git Conventions

This document provides a high-level summary and pointers to source-of-truth information for the project's git workflow and commit conventions.

## 1. Core Summary

The project uses a single `main` branch with linear history (no feature branches observed). All commits follow Conventional Commits format with a mandatory `Co-Authored-By` trailer for Claude Code contributions. Task-level isolation is achieved via **git worktrees** rather than branches, with each task getting a dedicated worktree under `<project-work-dir>/.worktrees/`.

## 2. Branch Strategy

- **Primary branch:** `main` (only branch; no remote feature branches).
- **Task isolation:** Git worktrees are used instead of feature branches. Each task creates a worktree at `<projectWorkDir>/.worktrees/<taskDir>`. See `docs/initial-design.md` for the design rationale.
- **Worktree lifecycle:** Created during task initialization, deleted when the task is removed.

## 3. Commit Message Format

All commits use **Conventional Commits** (`<type>: <description>`).

| Prefix   | Usage                                        | Example from history                                    |
|----------|----------------------------------------------|---------------------------------------------------------|
| `feat:`  | New feature or capability                    | `feat: add settings page and system config API`         |
| `fix:`   | Bug fix or correction                        | `fix: consume config from DB and deduplicate config keys`|
| `chore:` | Tooling, config, non-functional changes      | `chore: initialize Next.js project with shadcn/ui`      |
| `docs:`  | Documentation only                           | `docs: add detailed implementation plan`                |

**Rules inferred from history:**
- Subject line is imperative mood, lowercase after prefix.
- Parenthetical detail may follow for context (e.g., `fix: migrate MCP server to registerTool API (fix deprecation warnings)`).
- No scope convention (e.g., `feat(api):`) is used; subjects are kept flat.

## 4. Co-Author Pattern

Every commit includes the trailer:

```
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

This is appended automatically when Claude Code creates commits.

## 5. Source of Truth

- **Worktree design:** `docs/initial-design.md` - Task initialization and worktree creation flow.
- **Worktree runtime usage:** `src/lib/claude-runner.ts:26-30` - Resolves `worktreeDir` for command execution.
- **Init command detection:** `src/lib/claude-runner.ts:153` - Checks for worktree creation in init commands.
- **Gitignore for worktrees:** `.gitignore` - Excludes `.worktrees/` from version control.
