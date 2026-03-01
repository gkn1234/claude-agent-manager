#!/bin/bash
# =============================================================================
# Claude Dispatch - 部署/更新脚本
# 在 EC2 上运行，用于首次部署或后续更新
#
# 流程: git pull → pnpm install → pnpm build → 重启服务
# 直接在 clone 的仓库目录内构建和运行（standalone 模式）
#
# 用法: bash deploy/deploy.sh
# =============================================================================

set -euo pipefail

# 定位到项目根目录（脚本在 deploy/ 子目录下）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_NAME="claude-dispatch"

echo "=== 部署 Claude Dispatch ==="
echo "应用目录: $APP_DIR"
cd "$APP_DIR"

echo "[1/5] 拉取最新代码..."
git pull origin main

echo "[2/5] 安装依赖..."
pnpm install --frozen-lockfile

echo "[3/5] 构建应用..."
pnpm build

echo "[4/5] 确保数据目录存在..."
mkdir -p data logs

echo "[5/5] 重启服务..."
sudo systemctl restart "$SERVICE_NAME"

sleep 3
if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo ""
  echo "============================================"
  echo "  部署成功！"
  echo "  访问: http://$(hostname -I | awk '{print $1}'):3000"
  echo "============================================"
else
  echo "服务启动失败，查看日志:"
  journalctl -u "$SERVICE_NAME" --no-pager -n 20
  exit 1
fi
