'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Send, Loader2 } from 'lucide-react';

interface Command {
  id: string;
  prompt: string;
  mode: string;
  status: string;
  result: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface Task {
  id: string;
  projectId: string;
  description: string;
  branch: string | null;
  worktreeDir: string | null;
  status: string;
  commands: Command[];
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: '未开始', variant: 'outline' },
  queued: { label: '排队中', variant: 'secondary' },
  running: { label: '进行中', variant: 'default' },
  completed: { label: '已完成', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
  aborted: { label: '已中止', variant: 'outline' },
};

export default function TaskPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'execute' | 'plan'>('execute');
  const [sending, setSending] = useState(false);

  const fetchTask = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (res.ok) setTask(await res.json());
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchTask();
    const interval = setInterval(fetchTask, 5000); // Poll for updates
    return () => clearInterval(interval);
  }, [fetchTask]);

  const hasRunning = task?.commands.some(c => c.status === 'running') ?? false;
  const isTaskReady = task?.status === 'ready';
  const inputDisabled = hasRunning || !isTaskReady;

  const handleSend = async () => {
    if (!prompt.trim() || inputDisabled) return;
    setSending(true);
    try {
      await fetch(`/api/tasks/${taskId}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode }),
      });
      setPrompt('');
      fetchTask();
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="flex h-[50vh] items-center justify-center text-muted-foreground">加载中...</div>;
  if (!task) return <div className="flex h-[50vh] items-center justify-center text-muted-foreground">任务不存在</div>;

  const taskStatusLabel = task.status === 'initializing' ? '初始化中' : task.status === 'researching' ? '调研中' : task.status === 'ready' ? '就绪' : '已归档';

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] md:h-screen">
      {/* Header */}
      <div className="px-4 py-3 border-b">
        <div className="flex items-center gap-2 mb-1">
          <Button variant="ghost" size="sm" className="p-1" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Badge variant="outline">{taskStatusLabel}</Badge>
          {task.branch && <span className="text-xs text-muted-foreground">{task.branch}</span>}
        </div>
        <p className="text-sm">{task.description}</p>
      </div>

      {/* Command Timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {task.commands.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">暂无指令</p>
        ) : (
          <div className="space-y-3">
            {task.commands.map((cmd, i) => {
              const config = statusConfig[cmd.status] || statusConfig.pending;
              return (
                <Link key={cmd.id} href={`/commands/${cmd.id}`}>
                  <div className="rounded-lg border p-3 hover:bg-accent/50 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">#{i + 1}</span>
                      <Badge variant={config.variant} className="text-xs">{config.label}</Badge>
                    </div>
                    <p className="text-sm line-clamp-2">{cmd.prompt.slice(0, 120)}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {cmd.mode === 'plan' && <Badge variant="outline" className="text-xs">Plan</Badge>}
                      <span>{new Date(cmd.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t px-4 py-3">
        {!isTaskReady && !hasRunning && (
          <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> 任务{task.status === 'initializing' ? '初始化' : '调研'}中，请等待完成后再派发指令...
          </p>
        )}
        {hasRunning && (
          <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> 有指令正在执行中...
          </p>
        )}
        <div className="flex gap-2">
          <Textarea
            placeholder={inputDisabled ? (hasRunning ? '等待当前指令完成...' : '等待任务就绪...') : '输入指令...'}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={inputDisabled}
            rows={2}
            className="resize-none text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
            }}
          />
          <div className="flex flex-col gap-1">
            <Button
              size="sm"
              variant={mode === 'plan' ? 'outline' : 'default'}
              className="text-xs h-6 px-2"
              onClick={() => setMode(mode === 'execute' ? 'plan' : 'execute')}
            >
              {mode === 'plan' ? 'Plan' : 'Exec'}
            </Button>
            <Button size="sm" onClick={handleSend} disabled={!prompt.trim() || inputDisabled || sending}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
