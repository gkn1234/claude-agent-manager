# 编码规范

本文档提供项目编码规范的高层摘要，源自配置文件和观察到的源码模式。

## 1. 核心摘要

本项目是一个 Next.js 16 App Router 项目，使用 TypeScript strict 模式，pnpm 作为包管理器，Tailwind CSS v4 用于样式，shadcn/ui（new-york 风格）配合 Radix UI 原语用于组件，Drizzle ORM 配合 SQLite 用于持久化，Zod 用于验证，`@dnd-kit/core` + `@dnd-kit/sortable` 用于拖放交互。界面语言为中文（zh-CN）。

## 2. 权威来源

- **包管理器：** `package.json`（pnpm 部分）- pnpm 是唯一支持的包管理器，禁止使用 npm 或 yarn。
- **TypeScript 配置：** `tsconfig.json` - 启用 strict 模式，目标为 ES2017，路径别名 `@/*` 映射到 `./src/*`。
- **ESLint 配置：** `eslint.config.mjs` - 使用 `eslint-config-next`，含 core-web-vitals 和 TypeScript 预设。
- **PostCSS 配置：** `postcss.config.mjs` - 使用 `@tailwindcss/postcss`（Tailwind CSS v4）。
- **shadcn/ui 配置：** `components.json` - 风格：`new-york`，启用 RSC，图标库：`lucide`，启用 CSS 变量，基础色：`neutral`。
- **Next.js 配置：** `next.config.ts` - 默认配置，无自定义设置。

## 3. 关键规范

### 框架模式

- **App Router：** 所有页面位于 `src/app/` 下。默认使用服务端组件（Server Components），仅在需要客户端交互时添加 `'use client'` 指令。
- **API 路由：** 使用 Next.js 路由处理器（`route.ts`），导出具名 HTTP 方法函数（`GET`、`POST`、`PUT`、`DELETE`），返回 `NextResponse.json()`。
- **布局：** 根布局位于 `src/app/layout.tsx`，用 `AppShell` 包裹所有页面。

### 组件模式

- **UI 原语：** 位于 `src/components/ui/`，由 shadcn/ui CLI 生成。使用 `cva`（class-variance-authority）实现变体样式。
- **组合：** 组件使用 `src/lib/utils.ts` 中的 `cn()`（`clsx` + `tailwind-merge`）进行条件类名合并。
- **Radix UI：** 以统一包形式导入（如 `import { Slot } from "radix-ui"`）。
- **功能组件：** 按领域组织在 `src/components/{domain}/` 下（如 `projects/`、`commands/`、`nav/`）。
- **Props：** 组件 props 使用 TypeScript interface，而非 `type` 别名。HTML 元素 props 继承自 `React.ComponentProps<>`。

### 代码风格

- **导出：** 具名函数组件（非箭头函数）按名称导出，组件不使用默认导出；页面使用 `export default function`。
- **Hooks：** 自定义 hooks 位于 `src/hooks/`，文件名以 `use-` 为前缀（kebab-case）。使用 `'use client'` 指令。
- **导入：** 项目导入专用 `@/` 路径别名。分组：外部库，然后 `@/` 导入。
- **数据层：** Drizzle ORM schema 在 `src/lib/schema.ts`，数据库单例在 `src/lib/db.ts`。UUID 主键以文本形式存储。
- **验证：** API 路由中使用 Zod 进行请求体验证。
- **UI 组件文件中不使用分号**（shadcn 规范）；**API 路由和 lib 文件中使用分号**。

## 4. 前端错误处理

- API 响应必须检查 `res.ok`；失败时通过 `sonner` 的 `toast.error()` 显示服务器错误消息，禁止静默忽略失败。
- 使用 `sonner`（`toast.error()`、`toast.success()`）进行面向用户的通知，禁止使用 `alert()` 或 `window.confirm()` 进行错误反馈。
- `Toaster` 在 `src/app/layout.tsx` 中全局配置，使用 `position="top-center" richColors`。顶部居中避免在移动端遮挡底部输入区域。
- `src/components/ui/sonner.tsx`（`Toaster`）：shadcn sonner 包装组件。

## 5. shadcn 组件使用规范

- **优先使用 shadcn 组件**，而非手写 HTML 元素。使用 `npx shadcn@latest add <component> --yes` 安装新组件。
- **使用前先查阅文档：** 查阅 shadcn 文档确认正确的 props 和可用功能（如 sonner 的 `richColors`、ToggleGroup 的 `variant="outline"`），不要猜测 API 接口。
- **分段切换：** 对于互斥选项（如 Exec/Plan、Draft/Queue），使用 `src/components/ui/toggle-group.tsx` 中的 `ToggleGroup` + `ToggleGroupItem`，禁止手写按钮组。
- **折叠面板：** 对于可展开/折叠的内容区域，使用 `src/components/ui/collapsible.tsx` 中的 `Collapsible` + `CollapsibleTrigger` + `CollapsibleContent`（基于 Radix UI Collapsible 原语）。
- **切换激活样式：** `src/components/ui/toggle.tsx` 使用 `data-[state=on]:bg-primary data-[state=on]:text-primary-foreground` 实现高对比度激活状态（而非默认的 `bg-accent`）。

## 6. 移动端优先交互

- 所有交互元素必须具备最小 44x44 的触摸目标。使用 shadcn 组件的 `size="sm"` 作为最小值，禁止使用极小尺寸如 `text-[10px]`。
- Toast 通知使用 `position="top-center"`，避免在移动端遮挡底部输入区域。
- 按钮、切换和控件必须在手机屏幕上可以舒适点按。

## 7. 数据库 Schema 变更规范

- **Schema 定义：** `src/lib/schema.ts` 是唯一权威来源。所有表结构、DEFAULT 表达式、列定义均以此文件为准。
- **同步命令：** 修改 `schema.ts` 后，必须立即执行 `pnpm db:push`（即 `drizzle-kit push --force`）同步本地数据库。
- **部署同步：** `deploy.sh` 第 6 步自动执行 `pnpm db:push`，确保生产环境数据库与 schema 一致。
- **SQLite 限制：** SQLite 不支持 `ALTER COLUMN`，修改列的 DEFAULT 表达式会导致 drizzle-kit 重建整张表（创建临时表 -> 迁移数据 -> 删除旧表 -> 重命名）。
- **危险组合：** 在同一次变更中同时修改 DEFAULT 表达式和新增列，drizzle-kit push 会触发 bug：重建表时 `INSERT...SELECT` 引用新列，但旧表中该列不存在，导致失败。**应将 DEFAULT 变更和新增列分为两次独立的 push 操作。**
- **一次性修复脚本：** `deploy/db-sync.js` 是修复历史数据库结构不一致的一次性工具。它手动重建所有表并处理缺失列（如 `providers.sort_order`），执行后 `pnpm db:push` 即为幂等操作。仅在已有数据库出现同步问题时使用。
- **时间戳格式：** 所有 `created_at` / `updated_at` 列使用 `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` 生成 ISO 8601 毫秒精度时间。
