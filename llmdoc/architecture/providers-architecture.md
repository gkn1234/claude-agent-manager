# Architecture of Provider Profiles

## 1. Identity

- **What it is:** Named provider configurations that supply API credentials and environment variables to Claude CLI subprocesses.
- **Purpose:** Enables switching between different API providers (Anthropic direct, Bedrock, Vertex, etc.) per-command without modifying server environment. Provider is required for all commands -- there is no default environment fallback.

## 2. Core Components

- `src/lib/schema.ts` (`providers`): Defines the `providers` table -- id, name, envJson (free-form JSON key-value pairs), isDefault, sortOrder, createdAt, updatedAt.
- `src/app/api/providers/route.ts` (`GET`, `POST`): Lists providers ordered by `sortOrder` ASC (env values masked for sensitive keys). Creates new providers with auto-incrementing `sortOrder`.
- `src/app/api/providers/[id]/route.ts` (`PATCH`, `DELETE`): Updates provider name/envJson; deletes a provider.
- `src/app/api/providers/reorder/route.ts` (`PATCH`): Batch-updates `sortOrder` for all providers to persist drag-and-drop ordering.
- `src/lib/claude-runner.ts:107-131` (`runCommand`): Loads provider by `command.providerId`, clears conflicting env vars, injects provider's `envJson` into spawn environment.
- `src/app/tasks/[id]/page.tsx`: Task page shows provider `<select>` dropdown for both init trigger and command input. Selection persisted to `task.lastProviderId`.
- `src/app/commands/[id]/page.tsx`: Command detail page shows collapsible `execEnv` section with provider name, cwd, CLI args, and sanitized env vars.

## 3. Execution Flow (LLM Retrieval Map)

### 3a. Provider CRUD

- **1. Create:** `POST /api/providers` with `{ name, envJson }` -- `src/app/api/providers/route.ts:38-68`. `envJson` can be string or object. `sortOrder` auto-assigned as max+1.
- **2. List:** `GET /api/providers` -- `src/app/api/providers/route.ts:25-36`. Returns all providers ordered by `sortOrder`. Sensitive env values are masked (first 8 chars + `....`).
- **3. Update:** `PATCH /api/providers/{id}` -- `src/app/api/providers/[id]/route.ts:6-25`. Updates name and/or envJson.
- **4. Delete:** `DELETE /api/providers/{id}` -- `src/app/api/providers/[id]/route.ts:27-35`.
- **5. Reorder:** `PATCH /api/providers/reorder` with `{ items: [{ id, sortOrder }] }` -- `src/app/api/providers/reorder/route.ts:6-21`. Persists drag-and-drop order from UI.

### 3b. Provider Injection at Runtime

- **1.** `runCommand()` reads `command.providerId` and loads the provider row.
- **2.** Clears known conflicting env vars: `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, etc. -- `src/lib/claude-runner.ts:107-124`.
- **3.** Parses `provider.envJson` and merges all key-value pairs into the spawn environment -- `src/lib/claude-runner.ts:126-129`.
- **4.** Records sanitized `execEnv` audit blob on the command record -- `src/lib/claude-runner.ts:134-149`.

### 3c. Sensitive Value Masking

Both the GET API and `execEnv` audit use pattern matching (`/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i`) to mask values longer than 8 characters: `first8chars....`.

## 4. Design Rationale

- **Free-form envJson** allows arbitrary env vars rather than a fixed schema, supporting any current or future Claude CLI configuration.
- **Clearing conflicting env vars** before injection prevents the server's own environment from leaking into commands using a different provider.
- **sortOrder field** enables stable drag-and-drop ordering via `@dnd-kit/sortable` without relying on insertion order.
- **Provider required (no fallback)** makes credential usage explicit and auditable per-command.
