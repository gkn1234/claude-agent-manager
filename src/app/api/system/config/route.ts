import { NextResponse } from 'next/server';
import { getAllConfig, setConfig, CONFIG_KEYS } from '@/lib/config';

export async function GET() {
  try {
    const config = getAllConfig();
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const updates: Record<string, string> = {};

    for (const [key, value] of Object.entries(body)) {
      if (!CONFIG_KEYS.includes(key)) {
        return NextResponse.json({ error: `无效配置项: ${key}` }, { status: 400 });
      }
      const numVal = Number(value);
      if (isNaN(numVal) || numVal < 0) {
        return NextResponse.json({ error: `配置项 ${key} 必须为非负数` }, { status: 400 });
      }
      if (key === 'poll_interval' && numVal < 1) {
        return NextResponse.json({ error: 'poll_interval 必须 >= 1' }, { status: 400 });
      }
      updates[key] = String(value);
    }

    for (const [key, value] of Object.entries(updates)) {
      setConfig(key, value);
    }

    const config = getAllConfig();
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
