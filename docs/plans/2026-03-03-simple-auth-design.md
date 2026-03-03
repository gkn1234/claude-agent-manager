# 简单认证系统设计

## 背景

应用部署到公网后，3000 端口裸露，任何人可访问并派发命令。需要最简单的认证机制保护所有路由。

## 约束

- 单用户，不需要用户系统
- 单密码认证，环境变量配置
- 零外部依赖，仅用 Node.js 内置 crypto

## 环境变量

| 变量 | 说明 |
|------|------|
| `AUTH_PASSWORD` | 登录密码（明文） |
| `AUTH_SECRET` | Cookie 签名密钥（随机字符串） |

## 架构

### 核心模块 `src/lib/auth.ts`

- `verifyPassword(input)` — 使用 `timingSafeEqual` 比对密码
- `createToken()` — `crypto.createHmac('sha256', AUTH_SECRET)` 生成 `timestamp.signature` 格式 token
- `verifyToken(token)` — 验证签名合法性，检查 7 天有效期

### 登录页 `src/app/login/page.tsx`

- 单密码输入框 + 登录按钮
- shadcn/ui Card + Input + Button 组件
- 登录失败 toast 提示
- 移动端友好布局

### 登录 API `src/app/api/auth/login/route.ts`

- POST `{ password }` → 验证通过设置 httpOnly Cookie `auth_token`
- 验证失败返回 401

### 登出 API `src/app/api/auth/logout/route.ts`

- POST → 清除 Cookie

### 中间件 `src/middleware.ts`

- 白名单：`/login`、`/api/auth/*`、`/api/mcp`、`/_next/*`、静态资源
- 未认证页面请求 → redirect `/login`
- 未认证 API 请求 → 401 JSON
- Token 合法 → 放行

## Cookie 配置

- `httpOnly: true`
- `sameSite: 'lax'`
- `path: '/'`
- `maxAge: 7 * 24 * 60 * 60`（7 天）

## 关键排除

- `/api/mcp` — Claude CLI 子进程调用，无法携带用户 Cookie
- `/api/events` — SSE，浏览器 EventSource 自动携带同源 Cookie，无需特殊处理
