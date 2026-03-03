#!/bin/bash
# =============================================================================
# Claude Dispatch - 环境初始化脚本
# 适用系统: Amazon Linux 2023 / Ubuntu 22.04+ / OpenCloudOS / CentOS / RHEL
# 用法: sudo bash setup-ec2.sh [应用目录]
#
# 执行完成后，按提示运行 deploy.sh 完成应用部署
# =============================================================================

set -euo pipefail

APP_DIR="${1:-$HOME/claude-agent-manager-source}"
REPO_URL="https://github.com/gkn1234/claude-agent-manager.git"
SERVICE_NAME="claude-agent-manager"
RUN_USER="$(logname 2>/dev/null || echo "$SUDO_USER" || echo "$USER")"

echo "=== Claude Dispatch 环境初始化 ==="
echo "应用目录: $APP_DIR"
echo "运行用户: $RUN_USER"
echo ""

echo "=== [1/6] 检测操作系统 ==="
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
else
  echo "无法检测操作系统"
  exit 1
fi
echo "检测到系统: $OS"

echo "=== [2/6] 安装系统依赖 ==="
if [ "$OS" = "amzn" ] || [ "$OS" = "opencloudos" ] || [ "$OS" = "centos" ] || [ "$OS" = "rhel" ] || [ "$OS" = "fedora" ] || [ "$OS" = "tencentos" ]; then
  dnf update -y
  dnf install -y git curl gcc gcc-c++ make python3
elif [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
  apt-get update
  apt-get install -y git curl build-essential python3
else
  echo "不支持的操作系统: $OS"
  echo "如果你的系统使用 dnf，请手动运行: dnf install -y git curl gcc gcc-c++ make python3"
  exit 1
fi

echo "=== [3/6] 安装 Node.js 24 ==="
if ! command -v node &> /dev/null; then
  # 获取最新 v24 版本号
  NODE_VERSION=$(curl -fsSL https://nodejs.org/dist/index.json | python3 -c "
import sys, json
versions = json.load(sys.stdin)
v24 = next(v for v in versions if v['version'].startswith('v24.'))
print(v24['version'])
")
  echo "安装 Node.js $NODE_VERSION ..."

  # 检测架构
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)  NODE_ARCH="x64" ;;
    aarch64) NODE_ARCH="arm64" ;;
    *) echo "不支持的架构: $ARCH"; exit 1 ;;
  esac

  # 下载并解压到 /usr/local
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
    | tar -xJ --strip-components=1 -C /usr/local/
fi
echo "Node.js: $(node -v)"

echo "=== [4/6] 安装 pnpm ==="
if ! command -v pnpm &> /dev/null; then
  npm install -g pnpm
fi
echo "pnpm: $(pnpm -v)"

echo "=== [5/6] 安装 Claude Code CLI ==="
if ! command -v claude &> /dev/null; then
  npm install -g @anthropic-ai/claude-code
fi
echo "Claude Code: $(claude --version 2>/dev/null || echo 'installed')"

echo "=== [6/6] Clone 仓库并安装 systemd 服务 ==="

if [ ! -d "$APP_DIR" ]; then
  git clone "$REPO_URL" "$APP_DIR"
  # 如果是 sudo 执行，确保目录归属运行用户
  if [ -n "$RUN_USER" ] && [ "$RUN_USER" != "root" ]; then
    chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"
  fi
else
  echo "应用目录已存在，跳过 clone"
fi

# 写入 systemd 服务配置
cat > /etc/systemd/system/${SERVICE_NAME}.service << UNIT
[Unit]
Description=Claude Dispatch - AI Task Orchestration
After=network.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/local/bin/node ${APP_DIR}/.next/standalone/server.js
Restart=on-failure
RestartSec=10

# 环境变量
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DB_PATH=${APP_DIR}/data/dispatch.db
Environment=LOG_DIR=${APP_DIR}/logs
Environment=HOSTNAME=0.0.0.0

# 资源限制
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "============================================"
echo "  环境初始化完成！"
echo "============================================"
echo ""
echo "应用目录: $APP_DIR"
echo "运行用户: $RUN_USER"
echo "服务名称: $SERVICE_NAME"
echo ""
echo "下一步:"
echo "  cd $APP_DIR"
echo "  bash deploy/deploy.sh"
echo ""
