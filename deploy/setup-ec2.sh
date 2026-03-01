#!/bin/bash
# =============================================================================
# Claude Dispatch - EC2 环境初始化脚本
# 适用系统: Amazon Linux 2023 / Ubuntu 22.04+
# 用法: sudo bash setup-ec2.sh
#
# 执行完成后，按提示运行 deploy.sh 完成应用部署
# =============================================================================

set -euo pipefail

APP_USER="dispatch"
APP_DIR="/home/${APP_USER}/claude-dispatch"  # 应用源码目录（git clone 到此）
REPO_BASE="/home/${APP_USER}/repos"          # 被管理的 git 仓库存放目录
REPO_URL="https://github.com/gkn1234/claude-agent-manager.git"

echo "=== [1/7] 检测操作系统 ==="
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
else
  echo "无法检测操作系统"
  exit 1
fi
echo "检测到系统: $OS"

echo "=== [2/7] 安装系统依赖 ==="
if [ "$OS" = "amzn" ]; then
  dnf update -y
  dnf install -y git curl gcc g++ make python3
elif [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
  apt-get update
  apt-get install -y git curl build-essential python3
else
  echo "不支持的操作系统: $OS"
  exit 1
fi

echo "=== [3/7] 安装 Node.js 22 LTS ==="
if ! command -v node &> /dev/null; then
  curl -fsSL https://fnm.vercel.app/install | bash
  export PATH="$HOME/.local/share/fnm:$PATH"
  eval "$(fnm env)"
  fnm install 22
  fnm default 22
  fnm use 22
  ln -sf "$(which node)" /usr/local/bin/node
  ln -sf "$(which npm)" /usr/local/bin/npm
  ln -sf "$(which npx)" /usr/local/bin/npx
fi
echo "Node.js: $(node -v)"

echo "=== [4/7] 安装 pnpm ==="
if ! command -v pnpm &> /dev/null; then
  npm install -g pnpm
  ln -sf "$(which pnpm)" /usr/local/bin/pnpm
fi
echo "pnpm: $(pnpm -v)"

echo "=== [5/7] 安装 Claude Code CLI ==="
if ! command -v claude &> /dev/null; then
  npm install -g @anthropic-ai/claude-code
  ln -sf "$(which claude)" /usr/local/bin/claude
fi
echo "Claude Code: $(claude --version 2>/dev/null || echo 'installed')"

echo "=== [6/7] 创建应用用户和目录 ==="
if ! id "$APP_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$APP_USER"
fi
mkdir -p "$REPO_BASE"
chown -R "$APP_USER:$APP_USER" "/home/$APP_USER"

echo "=== [7/7] Clone 仓库并安装 systemd 服务 ==="

# Clone 应用仓库（以 dispatch 用户执行）
if [ ! -d "$APP_DIR" ]; then
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
else
  echo "应用目录已存在，跳过 clone"
fi

# 写入 systemd 服务配置
cat > /etc/systemd/system/claude-dispatch.service << UNIT
[Unit]
Description=Claude Dispatch - AI Task Orchestration
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
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
systemctl enable claude-dispatch

echo ""
echo "============================================"
echo "  EC2 环境初始化完成！"
echo "============================================"
echo ""
echo "应用目录:     $APP_DIR"
echo "仓库存放目录: $REPO_BASE"
echo ""
echo "下一步:"
echo "  sudo su - $APP_USER"
echo "  cd $APP_DIR"
echo "  bash deploy/deploy.sh"
echo ""
