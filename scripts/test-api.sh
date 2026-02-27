#!/bin/bash
# Test script for the dispatch system API
# Usage: Start the server with `pnpm run dev` first, then run this script

BASE_URL="${API_BASE:-http://localhost:3000}"

echo "=== Testing Dispatch System API ==="

# 1. Create project (new mode)
echo -e "\n--- Create Project ---"
PROJECT=$(curl -s -X POST "$BASE_URL/api/projects" \
  -H 'Content-Type: application/json' \
  -d '{"name":"test-project","mode":"new","workDir":"/tmp/test-dispatch-project"}')
echo "$PROJECT"
PROJECT_ID=$(echo "$PROJECT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Project ID: $PROJECT_ID"

# 2. List projects
echo -e "\n--- List Projects ---"
curl -s "$BASE_URL/api/projects" | head -200

# 3. Get project detail
echo -e "\n--- Project Detail ---"
curl -s "$BASE_URL/api/projects/$PROJECT_ID" | head -200

# 4. Create task
echo -e "\n--- Create Task ---"
TASK=$(curl -s -X POST "$BASE_URL/api/projects/$PROJECT_ID/tasks" \
  -H 'Content-Type: application/json' \
  -d '{"description":"Test task for API validation"}')
echo "$TASK"
TASK_ID=$(echo "$TASK" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Task ID: $TASK_ID"

# 5. List tasks
echo -e "\n--- List Tasks ---"
curl -s "$BASE_URL/api/tasks?project_id=$PROJECT_ID" | head -200

# 6. Get task detail
echo -e "\n--- Task Detail ---"
curl -s "$BASE_URL/api/tasks/$TASK_ID" | head -200

# 7. Global commands list (should have the init command)
echo -e "\n--- Global Commands ---"
curl -s "$BASE_URL/api/commands" | head -200

# 8. System status
echo -e "\n--- System Status ---"
curl -s "$BASE_URL/api/system/status"

# 9. System config
echo -e "\n--- System Config ---"
curl -s "$BASE_URL/api/system/config"

# 10. Update config
echo -e "\n--- Update Config ---"
curl -s -X PATCH "$BASE_URL/api/system/config" \
  -H 'Content-Type: application/json' \
  -d '{"max_concurrent":"3"}'

# 11. Verify config updated
echo -e "\n--- Verify Config ---"
curl -s "$BASE_URL/api/system/config"

# 12. Clean up - delete project
echo -e "\n--- Delete Project ---"
curl -s -X DELETE "$BASE_URL/api/projects/$PROJECT_ID"

echo -e "\n\n=== Tests Complete ==="
