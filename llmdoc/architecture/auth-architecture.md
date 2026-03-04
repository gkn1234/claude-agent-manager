# 认证系统架构

## 1. 系统定位

- **是什么：** 基于单密码 + HMAC-SHA256 签名 Cookie 的简单认证系统。
- **用途：** 保护所有 Web 路由和 API 端点，同时白名单放行 MCP 端点（Claude CLI 子进程回调）。

## 2. 核心组件

- `src/lib/auth.ts`（`verifyPassword`, `createToken`, `verifyToken`, `isAuthConfigured`, `AUTH_COOKIE_NAME`, `AUTH_COOKIE_OPTIONS`）：认证核心库。Web Crypto API 实现 HMAC-SHA256 签名，constant-time 密码比对，Edge Runtime 兼容。
- `src/middleware.ts`（`middleware`, `PUBLIC_PREFIXES`）：Next.js middleware，拦截所有非静态资源请求，执行认证检查。
- `src/app/api/auth/login/route.ts`（`POST`）：验证密码，成功时设置 httpOnly Cookie。
- `src/app/api/auth/logout/route.ts`（`POST`）：清除认证 Cookie（maxAge=0）。
- `src/app/login/page.tsx`（`LoginPage`, `LoginForm`）：登录页面，单密码输入框，shadcn/ui Card 组件。
- `src/app/(app)/layout.tsx`（`AppLayout`）：路由分组布局，包裹 AppShell，仅认证后页面显示导航。
- `src/app/(app)/settings/page.tsx`：设置页面底部包含退出登录按钮（调用 `POST /api/auth/logout` 后跳转 `/login`）。

## 3. 执行流（LLM 检索路径）

### 3.1 登录流程

- **1. 用户提交密码：** `src/app/login/page.tsx:18-43` 表单 POST 到 `/api/auth/login`。
- **2. 密码验证：** `src/app/api/auth/login/route.ts:10-31` 调用 `verifyPassword()` 进行 constant-time 比对。
- **3. Token 签名：** `src/lib/auth.ts:69-74`（`createToken`）生成 `timestamp.hmac_hex` 格式 token。
- **4. Cookie 设置：** 响应设置 `auth_token` Cookie（httpOnly, sameSite=lax, maxAge=7天）。
- **5. 重定向：** 客户端读取 `?from=` 参数，跳转到原始页面。

### 3.2 请求认证流程

- **1. Middleware 拦截：** `src/middleware.ts:18-56` 对所有匹配路径执行认证。
- **2. 白名单检查：** `PUBLIC_PREFIXES`（`/login`, `/api/auth/`, `/api/mcp`）直接放行。
- **3. 配置检查：** `isAuthConfigured()` 为 false 时，API 返回 503，页面重定向到 `/login`。
- **4. Token 验证：** `src/lib/auth.ts:77-97`（`verifyToken`）验证签名和有效期（7天）。
- **5. 未认证处理：** API 请求返回 401 JSON，页面请求重定向到 `/login?from=原路径`。

### 3.3 路由分组结构

- **登录页** `/login` 不在 `(app)` 分组内，不显示导航（AppShell）。
- **认证后页面** 在 `src/app/(app)/layout.tsx` 内，包裹 AppShell 以显示侧边栏/底部导航。
- **AppShell 从根布局下放到路由分组**，确保登录页无导航干扰。

## 4. 设计决策

- **MCP 白名单**：`/api/mcp` 必须免认证，因为 Claude CLI 子进程以无浏览器方式回调，没有 Cookie。
- **Edge Runtime 兼容**：使用 Web Crypto API 而非 Node.js crypto，确保 middleware 可在 Edge Runtime 运行。
- **无用户概念**：单密码模式，无用户注册/管理，适合单人或小团队部署场景。
