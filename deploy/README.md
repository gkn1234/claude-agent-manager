# Claude Dispatch - EC2 部署指南

## 架构概览

```
EC2 实例
├── Node.js 22 LTS + pnpm
├── Claude Code CLI (npm 全局安装)
├── Git
│
├── /home/dispatch/
│   ├── claude-dispatch/               # 应用源码（git clone）
│   │   ├── .next/standalone/server.js # Next.js standalone 入口
│   │   ├── data/dispatch.db           # SQLite 数据库
│   │   ├── logs/                      # 命令日志
│   │   └── mcp-config.json            # MCP 回调配置
│   │
│   └── repos/                         # 被管理的 git 仓库
│       ├── project-a/
│       └── project-b/
│
└── systemd: claude-dispatch.service   # 进程管理
```

## 部署流程

### 1. 创建 EC2 实例

- **AMI:** Amazon Linux 2023 或 Ubuntu 22.04
- **实例类型:** t3.medium (2C/4G) 起步
- **安全组:** 开放 3000 端口（或后续配 nginx 反代 80/443）
- **存储:** 30GB+ gp3

### 2. 环境初始化（只需执行一次）

```bash
# 下载安装脚本（或 scp 上传）
curl -O https://raw.githubusercontent.com/gkn1234/claude-agent-manager/main/deploy/setup-ec2.sh

# 执行安装
sudo bash setup-ec2.sh
```

这一步会：
- 安装 Node.js 22、pnpm、Git、Claude Code CLI
- 创建 `dispatch` 用户
- Clone 仓库到 `/home/dispatch/claude-dispatch/`
- 配置 systemd 服务（开机自启）

### 3. 首次部署

```bash
sudo su - dispatch
cd ~/claude-dispatch
bash deploy/deploy.sh
```

### 4. 准备被管理的 git 仓库

```bash
# 以 dispatch 用户
cd ~/repos
git clone <your-target-repo-url> my-project
```

然后在 Web UI 创建项目时，`work_dir` 填写 `/home/dispatch/repos/my-project`。

## 日常运维

### 更新应用代码

```bash
sudo su - dispatch
cd ~/claude-dispatch
bash deploy/deploy.sh    # 自动 git pull → build → restart
```

### 更新 Claude Code CLI

```bash
sudo bash ~/claude-dispatch/deploy/update-claude-code.sh
# 不需要重启服务，新版本在下次命令执行时自动生效
```

### 常用命令

```bash
# 服务管理
sudo systemctl start|stop|restart claude-dispatch
systemctl status claude-dispatch

# 实时日志
journalctl -u claude-dispatch -f

# 数据库备份
sqlite3 ~/claude-dispatch/data/dispatch.db ".backup /tmp/dispatch-backup.db"
```

## 推荐实例规格

| 场景 | 实例类型 | 说明 |
|---|---|---|
| 开发/测试 | t3.medium (2C/4G) | MAX_CONCURRENT=2 |
| 生产 | t3.large (2C/8G) | MAX_CONCURRENT=2~3 |
| 高并发 | c6i.xlarge (4C/8G) | MAX_CONCURRENT=4~6 |

> Claude CLI 主要消耗网络 I/O，CPU/内存消耗不大。瓶颈是 API 限速。

## 安全建议

- 不要直接暴露 3000 端口到公网，使用 nginx + HTTPS 或 AWS ALB
- Provider 的 API Key 存储在 SQLite 中，确保 `data/` 目录权限 700
- 被管理的仓库目录权限限制为 `dispatch` 用户
