import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, isAuthConfigured, AUTH_COOKIE_NAME } from '@/lib/auth';

/**
 * Paths that bypass authentication entirely.
 * - /login: login page and its assets
 * - /api/auth/: login and logout endpoints
 * - /api/mcp: Claude CLI subprocess MCP callback (no user cookie)
 */
const PUBLIC_PREFIXES = ['/login', '/api/auth/', '/api/mcp'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow public paths (MCP is critical — Claude subprocesses call it)
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // If auth is not configured, block everything except public paths
  if (!isAuthConfigured()) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: '认证未配置，请设置 AUTH_PASSWORD 和 AUTH_SECRET 环境变量' },
        { status: 503 },
      );
    }
    // Redirect to login page which will show the 503 error on submit
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Check auth cookie
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const isAuthenticated = token ? await verifyToken(token) : false;

  if (isAuthenticated) {
    return NextResponse.next();
  }

  // Unauthenticated API requests: 401 JSON
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  // Unauthenticated page requests: redirect to login with return URL
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, images, fonts
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
