# Claude Agent Manager - 部署指南

## 架构概览

```
服务器实例
├── Node.js 22 LTS + pnpm
├── Claude Code CLI (npm 全局安装)
├── Git
│
├── ~/claude-agent-manager-source/    # 应用源码（git clone，可自定义路径）
│   ├── .next/standalone/server.js    # Next.js standalone 入口
│   ├── data/dispatch.db              # SQLite 数据库
│   ├── logs/                         # 命令日志
│   └── mcp-config.json               # MCP 回调配置
│
└── systemd: claude-agent-manager.service   # 进程管理
```

## 部署流程

### 1. 创建服务器实例

- **推荐系统:** Amazon Linux 2023 / Ubuntu 22.04+ / OpenCloudOS / CentOS
- **最低配置:** 2C/4G
- **安全组:** 开放 3000 端口（或后续配 nginx 反代 80/443）
- **存储:** 30GB+ gp3

### 2. 环境初始化（只需执行一次）

```bash
# 下载安装脚本（或 scp 上传）
curl -O https://raw.githubusercontent.com/gkn1234/claude-agent-manager/main/deploy/setup-ec2.sh

# 执行安装（默认目录 ~/claude-agent-manager-source）
sudo bash setup-ec2.sh

# 或指定自定义目录
sudo bash setup-ec2.sh /opt/my-app
```

这一步会：
- 安装 Node.js 22、pnpm、Git、Claude Code CLI
- Clone 仓库到指定目录
- 配置 systemd 服务（开机自启）

### 3. 首次部署

```bash
cd ~/claude-agent-manager-source
bash deploy/deploy.sh
```

### 4. 准备被管理的 git 仓库

在 Web UI 创建项目时指定本地 git 仓库路径即可，应用会自动管理工作树。

## 日常运维

### 更新应用代码

```bash
cd ~/claude-agent-manager-source
bash deploy/deploy.sh    # 自动 git pull → build → restart
```

### 更新 Claude Code CLI

```bash
sudo bash ~/claude-agent-manager-source/deploy/update-claude-code.sh
# 不需要重启服务，新版本在下次命令执行时自动生效
```

### 常用命令

```bash
# 服务管理
sudo systemctl start|stop|restart claude-agent-manager
systemctl status claude-agent-manager

# 实时日志
journalctl -u claude-agent-manager -f

# 数据库备份
sqlite3 ~/claude-agent-manager-source/data/dispatch.db ".backup /tmp/dispatch-backup.db"
```

## 推荐实例规格

| 场景 | 实例类型 | 说明 |
|---|---|---|
| 开发/测试 | 2C/4G | MAX_CONCURRENT=2 |
| 生产 | 2C/8G | MAX_CONCURRENT=2~3 |
| 高并发 | 4C/8G | MAX_CONCURRENT=4~6 |

> Claude CLI 主要消耗网络 I/O，CPU/内存消耗不大。瓶颈是 API 限速。

## 安全建议

- 不要直接暴露 3000 端口到公网，使用 nginx + HTTPS 或负载均衡
- Provider 的 API Key 存储在 SQLite 中，确保 `data/` 目录权限 700
