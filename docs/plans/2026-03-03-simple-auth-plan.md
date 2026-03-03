# Simple Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add single-password authentication to protect all routes, using signed cookies and zero external dependencies.

**Architecture:** Middleware-based auth — `src/middleware.ts` intercepts all requests, checking for a signed `auth_token` cookie. Unauthenticated requests are redirected to `/login` (pages) or get 401 (APIs). `/api/mcp` is whitelisted for Claude CLI subprocess access. Auth logic lives in `src/lib/auth.ts` using Node.js built-in `crypto`.

**Tech Stack:** Next.js 16 middleware, Node.js `crypto` (HMAC-SHA256, timingSafeEqual), httpOnly cookies, shadcn/ui (Card, Input, Button, Label)

**Design Doc:** `docs/plans/2026-03-03-simple-auth-design.md`

---

### Task 1: Environment Variables

**Files:**
- Modify: `.env` (append 2 lines)
- Modify: `.env.example` (append 2 lines)
- Modify: `deploy/setup-ec2.sh:109-114` (add env vars to systemd unit)

**Step 1: Add auth env vars to `.env.example`**

Append to `.env.example`:
```
# Auth
AUTH_PASSWORD=changeme
AUTH_SECRET=replace-with-random-string
```

**Step 2: Add auth env vars to `.env`**

Append to `.env`:
```
# Auth
AUTH_PASSWORD=admin123
AUTH_SECRET=dev-secret-do-not-use-in-prod
```

**Step 3: Add env vars to systemd service template**

In `deploy/setup-ec2.sh`, in the `[Service]` section after `Environment=HOSTNAME=0.0.0.0`, add:
```bash
Environment=AUTH_PASSWORD=\${AUTH_PASSWORD}
Environment=AUTH_SECRET=\${AUTH_SECRET}
```

Note: The systemd unit uses shell-escaped `\${}` so that the actual values must be set manually after deployment. Add a comment in the deploy README about this.

**Step 4: Commit**

```bash
git add .env.example deploy/setup-ec2.sh
git commit -m "chore: add auth environment variables"
```

> Do NOT commit `.env` — it's in `.gitignore`.

---

### Task 2: Auth Core Library

**Files:**
- Create: `src/lib/auth.ts`

**Step 1: Create `src/lib/auth.ts`**

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

const AUTH_PASSWORD = process.env.AUTH_PASSWORD ?? '';
const AUTH_SECRET = process.env.AUTH_SECRET ?? '';
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

export function verifyPassword(input: string): boolean {
  if (!AUTH_PASSWORD || !input) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(AUTH_PASSWORD);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createToken(): string {
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', AUTH_SECRET)
    .update(timestamp)
    .digest('hex');
  return `${timestamp}.${signature}`;
}

export function verifyToken(token: string): boolean {
  if (!AUTH_SECRET || !token) return false;
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  // Check expiry
  const age = Date.now() - Number(timestamp);
  if (isNaN(age) || age < 0 || age > TOKEN_MAX_AGE) return false;

  // Verify signature
  const expected = createHmac('sha256', AUTH_SECRET)
    .update(timestamp)
    .digest('hex');

  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export const AUTH_COOKIE_NAME = 'auth_token';

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
};
```

**Step 2: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat(auth): add token signing and password verification"
```

---

### Task 3: Login & Logout API Routes

**Files:**
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`

**Step 1: Create login API**

`src/app/api/auth/login/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword, createToken, AUTH_COOKIE_NAME, AUTH_COOKIE_OPTIONS } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.password) {
    return NextResponse.json({ error: '请输入密码' }, { status: 400 });
  }

  if (!verifyPassword(body.password)) {
    return NextResponse.json({ error: '密码错误' }, { status: 401 });
  }

  const token = createToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);
  return response;
}
```

**Step 2: Create logout API**

`src/app/api/auth/logout/route.ts`:
```typescript
import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/auth';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return response;
}
```

**Step 3: Commit**

```bash
git add src/app/api/auth/login/route.ts src/app/api/auth/logout/route.ts
git commit -m "feat(auth): add login and logout API routes"
```

---

### Task 4: Middleware

**Files:**
- Create: `src/middleware.ts`

**Step 1: Create middleware**

`src/middleware.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, AUTH_COOKIE_NAME } from '@/lib/auth';

// Routes that don't require authentication
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/',
  '/api/mcp',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check auth cookie
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const isAuthenticated = token ? verifyToken(token) : false;

  if (isAuthenticated) {
    return NextResponse.next();
  }

  // API routes: return 401 JSON
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  // Page routes: redirect to login
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, icons, manifest
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
```

**Step 2: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(auth): add route protection middleware"
```

---

### Task 5: Login Page

**Files:**
- Create: `src/app/login/page.tsx`

**Step 1: Create login page**

`src/app/login/page.tsx`:
```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || '登录失败');
        return;
      }

      const from = searchParams.get('from') || '/';
      router.replace(from);
    } catch {
      toast.error('网络错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold">Claude Dispatch</h1>
          <p className="text-sm text-muted-foreground">请输入密码以继续</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入访问密码"
              autoFocus
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" disabled={loading || !password.trim()}>
            {loading ? '验证中...' : '登录'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat(auth): add login page"
```

---

### Task 6: Login Page Layout (bypass AppShell)

**Files:**
- Create: `src/app/login/layout.tsx`
- Modify: `src/app/layout.tsx` (conditionally render AppShell or just children)

The login page should NOT show the AppShell navigation. Since the root layout wraps everything in `<AppShell>`, we need to handle this.

**Approach:** Create a login-specific layout that renders without AppShell. Restructure root layout to separate AppShell from login.

**Step 1: Move AppShell to a route group layout**

Rename/reorganize so that `(app)` group uses AppShell and `login` does not:

- Root layout (`src/app/layout.tsx`): keep only html/body/Toaster, remove AppShell
- Create `src/app/(app)/layout.tsx`: wrap children with AppShell
- Move all existing page routes into `(app)` route group (or add `(app)/layout.tsx` that wraps)

Actually, simpler approach: keep root layout as-is but make login page opt out. Since Next.js App Router doesn't support per-page layouts easily, the cleanest approach is:

- Modify `src/app/layout.tsx`: remove `<AppShell>` wrapper
- Create `src/app/(app)/layout.tsx`: add `<AppShell>` wrapper
- Ensure all existing pages are under `(app)` route group

Wait — moving all existing page files into `(app)/` is a bigger refactor. Simpler: just create a `login/layout.tsx` that overrides. But in Next.js, layouts are additive, not overridable.

**Best approach:** Move AppShell to a conditional wrapper. Check pathname in layout — but layout is server component and doesn't have access to pathname easily.

**Simplest approach:** Create `src/app/login/layout.tsx` that just renders children without navigation:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "登录 - Claude Dispatch",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
```

And modify the root `layout.tsx` to make AppShell conditional — since login page will be wrapped in both root layout AND login layout, the AppShell nav will show. We need route groups.

**Step 1: Create route group `(app)` for authenticated pages**

Move existing page directories into `(app)`:
- `src/app/page.tsx` → `src/app/(app)/page.tsx`
- `src/app/projects/` → `src/app/(app)/projects/`
- `src/app/tasks/` → `src/app/(app)/tasks/`
- `src/app/commands/` → `src/app/(app)/commands/`
- `src/app/settings/` → `src/app/(app)/settings/`

Create `src/app/(app)/layout.tsx`:
```tsx
import { AppShell } from "@/components/nav/app-shell";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
```

**Step 2: Remove AppShell from root layout**

Modify `src/app/layout.tsx`:
```tsx
// Remove AppShell import and wrapper
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: use route groups to separate login from app shell"
```

---

### Task 7: Logout Button in Navigation

**Files:**
- Modify: `src/components/nav/app-shell.tsx` (add logout button)

**Step 1: Read `app-shell.tsx` to understand current nav structure**

**Step 2: Add logout button**

Add a logout button/icon to the nav. On click:
```typescript
const handleLogout = async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
};
```

Use `LogOut` icon from lucide-react. Place it in the nav header area.

**Step 3: Commit**

```bash
git add src/components/nav/app-shell.tsx
git commit -m "feat(auth): add logout button to navigation"
```

---

### Task 8: Build Verification & Deploy Config

**Step 1: Run build**

```bash
pnpm build
```

Expected: successful build with no errors.

**Step 2: Test locally**

1. Start dev server: `pnpm dev`
2. Visit `http://localhost:3000` → should redirect to `/login`
3. Enter wrong password → should show error toast
4. Enter correct password (`admin123` from `.env`) → should redirect to home
5. Visit any page → should work normally
6. Visit `http://localhost:3000/api/mcp` → should NOT require auth (200 or method-specific response)

**Step 3: Update deploy README with auth setup instructions**

Add a note in `deploy/README.md` about setting `AUTH_PASSWORD` and `AUTH_SECRET` in the systemd service or `.env` file.

**Step 4: Final commit**

```bash
git add -A
git commit -m "docs: add auth setup instructions to deploy guide"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Environment variables | `.env.example`, `deploy/setup-ec2.sh` |
| 2 | Auth core library | `src/lib/auth.ts` |
| 3 | Login/logout API | `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts` |
| 4 | Middleware | `src/middleware.ts` |
| 5 | Login page | `src/app/login/page.tsx` |
| 6 | Route group restructure | `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, move pages |
| 7 | Logout button | `src/components/nav/app-shell.tsx` |
| 8 | Build verification & deploy docs | `deploy/README.md` |
