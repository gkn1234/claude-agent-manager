import { db } from '@/lib/db';
import { commands } from '@/lib/schema';
import { ensureInitialized } from '@/lib/init';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  ensureInitialized();

  const encoder = new TextEncoder();
  let lastSnapshot = '';

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      // Send initial data
      const all = db.select().from(commands).all();
      send({ type: 'init', commands: all });

      const interval = setInterval(() => {
        const active = db.select().from(commands).all()
          .filter(c => ['queued', 'running', 'pending'].includes(c.status || ''));

        const snapshot = JSON.stringify(active.map(c => ({ id: c.id, status: c.status })));
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          send({ type: 'commands_update', commands: active });
        }
      }, 2000);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
    },
  });
}
