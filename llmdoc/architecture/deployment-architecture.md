# 部署架构

## 1. Identity

- **What it is:** Claude Dispatch 的生产部署架构，基于 systemd 管理的 Next.js standalone 模式运行。
- **Purpose:** 描述应用如何在 Linux 服务器上以 systemd 服务形式运行，包括进程管理、环境变量注入和目录结构。

## 2. Core Components

- `deploy/setup-ec2.sh` (`APP_DIR`, `SERVICE_NAME`, `RUN_USER`): 环境初始化脚本。检测 OS（Amazon Linux/Ubuntu/OpenCloudOS/CentOS）、安装 Node.js 24 + pnpm + Claude Code CLI、clone 仓库、写入 systemd unit 文件并 enable 服务。
- `deploy/deploy.sh` (`APP_DIR`, `SERVICE_NAME`): 部署/更新脚本。6 步流程：git pull -> pnpm install -> pnpm build -> 复制静态资源到 standalone -> 创建数据目录 -> systemctl restart。
- `deploy/update-claude-code.sh`: Claude Code CLI 热更新脚本。npm update 全局包，无需重启服务。
- `.env` (`AUTH_PASSWORD`, `AUTH_SECRET`): 应用环境变量文件，通过 systemd EnvironmentFile 指令注入到服务进程。
- `/etc/systemd/system/claude-agent-manager.service`: systemd unit 文件，由 setup-ec2.sh 自动生成。

## 3. Execution Flow (LLM Retrieval Map)

### 初始化流程 (setup-ec2.sh)

- **1. OS 检测:** `deploy/setup-ec2.sh:23-29` 读取 `/etc/os-release` 判断包管理器（dnf vs apt-get）。
- **2. 依赖安装:** `deploy/setup-ec2.sh:32-43` 安装 git、curl、build-essential/gcc、python3。
- **3. Node.js 安装:** `deploy/setup-ec2.sh:45-67` 获取最新 v24 版本号，按架构（x64/arm64）下载二进制到 `/usr/local/`。
- **4. 工具链安装:** `deploy/setup-ec2.sh:70-80` 全局安装 pnpm 和 `@anthropic-ai/claude-code`。
- **5. 仓库 clone:** `deploy/setup-ec2.sh:84-92` clone 到 `APP_DIR`（默认 `~/claude-agent-manager-source`），修正目录归属。
- **6. systemd 配置:** `deploy/setup-ec2.sh:95-126` 写入 unit 文件，配置 `EnvironmentFile=-${APP_DIR}/.env`（`-` 前缀表示文件不存在时不报错）。

### 部署/更新流程 (deploy.sh)

- **1. 代码同步:** `deploy/deploy.sh:24` `git pull origin main`。
- **2. 依赖安装:** `deploy/deploy.sh:27` `pnpm install --frozen-lockfile`。
- **3. 构建:** `deploy/deploy.sh:30` `pnpm build`（生成 `.next/standalone/`）。
- **4. 复制静态资源:** `deploy/deploy.sh:33-34` 将 `.next/static` 复制到 `.next/standalone/.next/static`，将 `public` 复制到 `.next/standalone/public`。Next.js standalone 模式不自动包含静态资源，这是官方文档明确要求的必要步骤。
- **5. 数据目录:** `deploy/deploy.sh:37` 确保 `data/` 和 `logs/` 目录存在。
- **6. 重启验证:** `deploy/deploy.sh:40-53` `systemctl restart` 后 3 秒检查服务状态。

### systemd 服务运行时

- **入口:** `ExecStart=/usr/local/bin/node ${APP_DIR}/.next/standalone/server.js`
- **硬编码环境变量:** `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=0.0.0.0`, `DB_PATH=${APP_DIR}/data/dispatch.db`, `LOG_DIR=${APP_DIR}/logs`
- **动态环境变量:** 通过 `EnvironmentFile=-${APP_DIR}/.env` 注入 `AUTH_PASSWORD`、`AUTH_SECRET` 及其他自定义变量。
- **进程策略:** `Restart=on-failure`, `RestartSec=10`, `LimitNOFILE=65536`。

## 4. Design Rationale

- **standalone 模式:** Next.js `output: 'standalone'` 生成自包含的 `server.js`，无需 `node_modules`，部署体积小。standalone 模式不自动包含 `.next/static` 和 `public` 目录，构建后必须手动复制这些静态资源，否则页面 CSS/JS/图片等将 404。
- **EnvironmentFile 注入:** 敏感变量（API 密钥、认证密码）不写入 unit 文件，通过 `.env` 文件隔离，便于运维修改。
- **无容器化:** 直接 systemd 管理 Node.js 进程，避免 Docker 额外开销，适合单机部署场景。
- **CLI 热更新:** Claude Code CLI 作为全局 npm 包，更新后无需重启服务，下次 spawn 子进程时自动使用新版本。
