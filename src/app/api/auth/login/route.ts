import { NextRequest, NextResponse } from 'next/server';
import {
  verifyPassword,
  createToken,
  isAuthConfigured,
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_OPTIONS,
} from '@/lib/auth';

export async function POST(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: '认证未配置，请设置 AUTH_PASSWORD 和 AUTH_SECRET 环境变量' },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body?.password) {
    return NextResponse.json({ error: '请输入密码' }, { status: 400 });
  }

  if (!verifyPassword(body.password)) {
    return NextResponse.json({ error: '密码错误' }, { status: 401 });
  }

  const token = await createToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);
  return response;
}
