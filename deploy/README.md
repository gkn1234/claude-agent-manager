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
- 安装 Node.js 24、pnpm、Git、Claude Code CLI
- Clone 仓库到指定目录
- 配置 systemd 服务（开机自启）

#### 2.1 前置准备：Clash 安装
不能科学上网，相当于 Claude 被切断了双臂，因此一定要先解决科学上网问题

**安装 Clash：**
在用户目录下创建 clash 文件夹
```bash
cd ~
mkdir clash
```

下载适合的 Clash 二进制文件并解压重命名为 clash

下载地址：https://github.com/Kuingsmile/clash-core/releases

```bash
tar -zxvf clash-linux-amd64-v3-v1.18.0.gz
mv clash-linux-amd64-v3-v1.18.0 clash
```

**准备配置文件：**

在终端 cd 到 Clash 二进制文件所在的目录
```bash
cd ~/clash
```

去你的梯子网站下载 Clash 配置文件，上传到 `~/clash` 目录下，重命名为 `config.yaml`

**启动：**

启动 Clash，同时启动 HTTP 代理和 Socks5 代理。
```bash
./clash -d .
```

如提示权限不足，请执行：、
```bash
chmod +x clash
```

建议后台启动 clash：
```bash
nohup ./clash -d . > clash.log 2>&1 &
```

停止 clash
```bash
kill $(pidof clash)
```

**配置代理环境变量：**
在 `~/.bashrc` 文件中添加以下内容：
```bash
export http_proxy=http://127.0.0.1:7890
export https_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890
```

之后访问外网验证：
```bash
curl -I https://www.google.com
```

返回 200 后，我们就可以翻墙了

#### 2.2 前置准备：Docker 安装
```bash
# 安装 Docker                                                                                                                                                                                                                   
dnf install -y docker                                                                                                                                                                                                           
                                                                                                                                                                                                                                
# 启动并设置开机自启                                                                                                                                                                                                            
systemctl start docker
systemctl enable docker                                                                                                                                                                                                         
                                                                                                                                                                                                                                
# 验证                                                                                                                                                                                                                          
docker --version   
```

#### 2.3 管理 Clash

```bash
docker run -p 1234:80 -d --name yacd --rm ghcr.io/haishanh/yacd:master
```

1234 端口和 9990 端口建议不要放通到公网。

请通过 ssh 本地端口映射的方式访问
- 1234：clash 管理后台地址
- 9990：clash 服务 API 地址

都要放通，否则浏览器管理会出现跨域问题
```bash
ssh -L 1234:127.0.0.1:1234 root@118.25.103.212
ssh -L 9990:127.0.0.1:9990 root@118.25.103.212
```

#### 2.4 预装 Claude Code

**环境变量注入：**

修改 `~/.bashrc` 文件，添加：

```bash
# Claude Code API Router configuration
export ANTHROPIC_BASE_URL="https://xxx"
export ANTHROPIC_AUTH_TOKEN="xxx"
```

这样，我们自己远程上去也可以用 claude，可能帮助我们做系统运维

**跳过 Claude 登录验证：**

创建或打开 `~/.claude.json`

确保文件中包含：

```json
{
  "hasCompletedOnboarding": true
}
```

> 如果文件已有其他内容，在第一层加上 `"hasCompletedOnboarding": true` 即可，不要覆盖已有字段。

**Claude 基础配置：**

编辑 `~/.claude/settings.json`：

写入以下内容（替换 `<...>` 为你的实际值）：

```json
{
  "env": {
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "20000",
    "DISABLE_TELEMETRY": "1",
    "DISABLE_ERROR_REPORTING": "1",
    "CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR": "1",
    "MAX_THINKING_TOKENS": "12000"
  },
  "skipWebFetchPreflight": true,
  "permissions": {},
  "hooks": {},
  "enabledPlugins": {}
}
```

`permissions`、`hooks`、`enabledPlugins` 按照自己的实际需求设置

#### 必要 Claude Code 插件(自用)

**anthropics skills**

https://github.com/anthropics/skills/blob/main/README.md

```bash
/plugin marketplace add anthropics/skills

/plugin install document-skills@anthropic-agent-skills
/plugin install example-skills@anthropic-agent-skills
```

**superpowers**

https://github.com/obra/superpowers

```bash
/plugin marketplace add obra/superpowers-marketplace

/plugin install superpowers@superpowers-marketplace
```

**claude-mem**

通用记忆系统

https://github.com/thedotmack/claude-mem

```bash
/plugin marketplace add thedotmack/claude-mem

/plugin install claude-mem
```

**cc-plugin**

以项目为单位，文档驱动的记忆系统

https://github.com/TokenRollAI/cc-plugin

```bash
# Add TokenRoll plugin marketplace
/plugin marketplace add https://github.com/TokenRollAI/cc-plugin

# Install tr plugin
/plugin install tr@cc-plugin
```

复制仓库中的 CLAUDE.md 内容到 `~/.claude` 下的同名文件

**gh cli & 登录 github**

安装 gh，并验证登录

设置好 git 的登录身份：
```bash
git config --global user.name "xxx"
git config --global user.email “yyy”
```

**playwright cli & 技能**

```bash
npm install -g @playwright/cli@latest
```

在 `~/.claude` 目录下安装技能

```bash
playwright-cli install --skills
```

**TypeScript LSP**

```bash
npm install -g typescript-language-server typescript
```

**官方技能**

输入 `/plugin`，选择安装：
- context7
- frontend-design
- typescript-lsp


### 3. 首次部署

```bash
cd ~/claude-agent-manager-source

# 配置认证密码（必须设置，否则应用无法登录）
cat >> .env << 'EOF'
AUTH_PASSWORD=你的登录密码
AUTH_SECRET=$(openssl rand -hex 32)
EOF

bash deploy/deploy.sh
```

> **重要**：`AUTH_PASSWORD` 和 `AUTH_SECRET` 未设置时，所有页面和 API 将返回 503 错误。MCP 端点 (`/api/mcp`) 不受认证限制，Claude CLI 子进程可正常调用。

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
