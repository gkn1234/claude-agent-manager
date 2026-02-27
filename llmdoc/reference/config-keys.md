# Configuration Keys Reference

This document provides a summary of all runtime configuration keys and pointers to their source of truth.

## 1. Core Summary

The system uses a DB-backed configuration table (`config`) with in-code defaults. Configuration is read via `getConfig(key)` and written via `setConfig(key, value)`. All values are stored as strings. The PATCH API validates numeric keys separately from string keys.

## 2. Source of Truth

- **Primary Code:** `src/lib/config.ts` (`CONFIG_DEFAULTS`, `getConfig`, `setConfig`, `getAllConfig`) - All default values and the read/write logic.
- **API Route:** `src/app/api/system/config/route.ts` (`GET`, `PATCH`) - REST interface for reading and updating config.
- **Schema:** `src/lib/schema.ts` (`config`) - The SQLite table definition (key-value pairs).
- **Related Architecture:** `/llmdoc/architecture/tasks-architecture.md` - How `init_prompt` and `research_prompt` are used in the task pipeline.
- **Related Architecture:** `/llmdoc/architecture/commands-scheduler-architecture.md` - How `max_concurrent`, `poll_interval`, `command_timeout` govern scheduling.

## 3. Configuration Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `max_concurrent` | numeric | `2` | Maximum concurrent running commands across all tasks |
| `command_timeout` | numeric | `1800` | Seconds before a running command is killed (SIGTERM) |
| `poll_interval` | numeric | `5` | Scheduler tick interval in seconds (minimum: 1) |
| `log_retention_days` | numeric | `30` | Log file retention period in days |
| `init_prompt` | string | *(see below)* | Template for task init commands. Placeholders: `{workDir}`, `{description}` |
| `research_prompt` | string | *(see below)* | Template for task research commands. Placeholders: `{description}` |

The `init_prompt` is used by `src/app/api/tasks/[id]/init/route.ts:35-38` when manually triggering init. The `research_prompt` is used by `src/lib/claude-runner.ts:272-273` when auto-creating the research command after init success.

## 4. API Validation Rules

The PATCH endpoint at `src/app/api/system/config/route.ts:13-44` enforces:

- Only keys in `CONFIG_KEYS` are accepted (400 otherwise).
- Numeric keys (`max_concurrent`, `command_timeout`, `log_retention_days`, `poll_interval`) must be non-negative numbers.
- `poll_interval` has additional minimum constraint: must be >= 1.
- String keys (`init_prompt`, `research_prompt`) accept any string value.
