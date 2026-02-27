# How to Manage Projects via the API

A guide for creating, listing, retrieving, and deleting projects through the REST API.

## Creating a Project

1. **Choose a creation mode** (`clone`, `new`, or `local`):
   - `clone`: Provide `gitUrl` and optionally `name`/`workDir`. The system clones the repo.
   - `new`: Provide `name` and optionally `workDir`. The system creates a directory and runs `git init`.
   - `local`: Provide `workDir` pointing to an existing git repo. The `name` is derived from the directory if omitted.

2. **Send the request:** `POST /api/projects` with JSON body:
   ```json
   { "name": "my-project", "gitUrl": "https://...", "mode": "clone" }
   ```
   See `src/app/api/projects/route.ts:22-87` for full validation logic.

3. **Handle responses:**
   - `201`: Project created. Response contains `{ id, name, workDir, gitRemote }`.
   - `400`: Missing required fields (e.g., no `gitUrl` for clone mode, nonexistent directory for local mode).
   - `409`: Directory conflict (already exists for `new` mode, or different repo for `clone` mode).

4. **Default directory:** If `workDir` is omitted, projects are created under `~/claude-agent-manager/<name>`.

## Listing All Projects

1. **Send:** `GET /api/projects`
2. **Response:** JSON array of all project records (id, name, workDir, gitRemote, createdAt, updatedAt).

## Retrieving a Single Project

1. **Send:** `GET /api/projects/<id>`
2. **Response:** Project object with a nested `tasks` array, or `404` if not found.
   See `src/app/api/projects/[id]/route.ts:7-14`.

## Deleting a Project

1. **Send:** `DELETE /api/projects/<id>`
2. **Cascade behavior:** The system calls `cleanupTask()` for each task, which kills running processes, deletes log files, removes git worktrees, and deletes commands + task DB records. Then deletes the project row. See `src/app/api/projects/[id]/route.ts:16-28`.
3. **Response:** `{ "ok": true }` on success, `404` if project not found.
