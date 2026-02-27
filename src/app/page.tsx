'use client';

import { useCommands } from '@/hooks/use-commands';
import { StatusGroup } from '@/components/commands/status-group';

export default function HomePage() {
  const { grouped, loading, abortCommand } = useCommands();

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  const isEmpty = grouped.running.length === 0 && grouped.queued.length === 0 && grouped.completed.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <h1 className="mb-4 text-lg font-semibold">指令队列</h1>

      {isEmpty ? (
        <div className="flex h-[40vh] flex-col items-center justify-center text-center">
          <p className="text-muted-foreground">暂无指令</p>
          <p className="mt-1 text-sm text-muted-foreground">在项目中创建任务后，指令会出现在这里</p>
        </div>
      ) : (
        <>
          <StatusGroup
            title="进行中"
            icon="🔄"
            commands={grouped.running}
            defaultOpen={true}
            onAbort={abortCommand}
          />
          <StatusGroup
            title="排队中"
            icon="⏳"
            commands={grouped.queued}
            defaultOpen={true}
            draggable={true}
          />
          <StatusGroup
            title="已完成"
            icon="✅"
            commands={grouped.completed}
            defaultOpen={false}
          />
        </>
      )}
    </div>
  );
}
