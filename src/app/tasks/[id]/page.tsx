'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Play, Trash2 } from 'lucide-react';

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
  lastProviderId: string | null;
  lastMode: string | null;
  commands: Command[];
}

interface Provider {
  id: string;
  name: string;
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: '未开始', variant: 'outline' },
  queued: { label: '排队中', variant: 'secondary' },
  running: { label: '进行中', variant: 'default' },
  completed: { label: '已完成', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
  aborted: { label: '已中止', variant: 'outline' },
};

const taskStatusMap: Record<string, string> = {
  pending: '待初始化',
  initializing: '初始化中',
  researching: '调研中',
  ready: '就绪',
  archived: '已归档',
};

export default function TaskPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const [task, setTask] = useState<Task | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'execute' | 'plan'>('execute');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const fetchTask = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (res.ok) {
        const data = await res.json();
        setTask(data);
        if (!prefsLoaded) {
          if (data.lastMode === 'plan' || data.lastMode === 'execute') setMode(data.lastMode);
          if (data.lastProviderId) setProviderId(data.lastProviderId);
          setPrefsLoaded(true);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [taskId, prefsLoaded]);

  const fetchProviders = useCallback(async () => {
    const res = await fetch('/api/providers');
    if (res.ok) {
      const data = await res.json();
      setProviders(data);
      if (!providerId && !prefsLoaded && data.length > 0) {
        setProviderId(data[0].id);
      }
    }
  }, [providerId, prefsLoaded]);

  useEffect(() => {
    fetchTask();
    fetchProviders();
    const interval = setInterval(fetchTask, 5000);
    return () => clearInterval(interval);
  }, [fetchTask, fetchProviders]);

  const savePrefs = useCallback(async (newProviderId: string | null, newMode: string) => {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastProviderId: newProviderId, lastMode: newMode }),
    });
  }, [taskId]);

  const handleModeChange = (newMode: 'execute' | 'plan') => {
    setMode(newMode);
    savePrefs(providerId, newMode);
  };

  const handleProviderChange = (newProviderId: string) => {
    setProviderId(newProviderId);
    savePrefs(newProviderId, mode);
  };

  const handleInit = async () => {
    if (!providerId) return;
    setInitializing(true);
    try {
      await fetch(`/api/tasks/${taskId}/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      });
      fetchTask();
    } finally {
      setInitializing(false);
    }
  };

  const hasRunning = task?.commands.some(c => c.status === 'running') ?? false;
  const isTaskReady = task?.status === 'ready';
  const isTaskPending = task?.status === 'pending';
  const noProvider = providers.length === 0;
  const inputDisabled = hasRunning || !isTaskReady || noProvider;

  const handleSend = async () => {
    if (!prompt.trim() || inputDisabled || !providerId) return;
    setSending(true);
    try {
      await fetch(`/api/tasks/${taskId}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode, providerId }),
      });
      setPrompt('');
      fetchTask();
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('确定要删除这个任务吗？将同时删除所有相关指令和日志。')) return;
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    if (res.ok && task) {
      router.push(`/projects/${task.projectId}`);
    }
  };

  if (loading) return <div className="flex h-[50vh] items-center justify-center text-muted-foreground">加载中...</div>;
  if (!task) return <div className="flex h-[50vh] items-center justify-center text-muted-foreground">任务不存在</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] md:h-screen">
      {/* Header */}
      <div className="px-4 py-3 border-b">
        <div className="flex items-center gap-2 mb-1">
          <Button variant="ghost" size="sm" className="p-1" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Badge variant="outline">{taskStatusMap[task.status] || task.status}</Badge>
          {task.branch && <span className="text-xs text-muted-foreground">{task.branch}</span>}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="p-1 text-destructive hover:text-destructive" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <p className="text-sm truncate cursor-pointer hover:text-foreground/80 transition-colors">{task.description}</p>
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>任务描述</DialogTitle>
            </DialogHeader>
            <div className="overflow-y-auto whitespace-pre-wrap text-sm">
              {task.description}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Command Timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {task.commands.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">暂无指令</p>
        ) : (
          <div className="space-y-3">
            {[...task.commands].reverse().map((cmd, i) => {
              const cfg = statusConfig[cmd.status] || statusConfig.pending;
              return (
                <Link key={cmd.id} href={`/commands/${cmd.id}`}>
                  <div className="rounded-lg border p-3 hover:bg-accent/50 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">#{task.commands.length - i}</span>
                      <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>
                    </div>
                    <p className="text-sm line-clamp-2">{cmd.prompt.slice(0, 120)}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {cmd.mode === 'plan' && <Badge variant="outline" className="text-xs">Plan</Badge>}
                      {cmd.mode === 'init' && <Badge variant="outline" className="text-xs">Init</Badge>}
                      {cmd.mode === 'research' && <Badge variant="outline" className="text-xs">调研</Badge>}
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
        {noProvider && (
          <p className="text-xs text-destructive mb-2">
            尚未配置 Provider，请先前往<Link href="/settings" className="underline ml-0.5">系统设置</Link>添加
          </p>
        )}

        {/* Pending: show init controls */}
        {isTaskPending && !noProvider && (
          <div className="flex items-center gap-2">
            <select
              value={providerId || ''}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs cursor-pointer"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <Button size="sm" onClick={handleInit} disabled={!providerId || initializing}>
              <Play className="h-3.5 w-3.5 mr-1" />
              {initializing ? '初始化中...' : '开始初始化'}
            </Button>
          </div>
        )}

        {/* Initializing / Researching: show progress */}
        {!isTaskPending && !isTaskReady && (
          <>
            {hasRunning ? (
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> 有指令正在执行中...
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> 任务{task.status === 'initializing' ? '初始化' : '调研'}中，请等待完成后再派发指令...
              </p>
            )}
          </>
        )}

        {/* Ready: show command input */}
        {isTaskReady && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <select
                value={providerId || ''}
                onChange={(e) => handleProviderChange(e.target.value)}
                disabled={inputDisabled}
                className="h-7 rounded-md border bg-background px-2 text-xs cursor-pointer disabled:opacity-50"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="flex-1" />
              <div className="flex items-center rounded-md border text-xs overflow-hidden">
                <button
                  className={`px-3 py-1 transition-colors cursor-pointer ${mode === 'execute' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                  onClick={() => handleModeChange('execute')}
                  disabled={inputDisabled}
                >
                  Exec
                </button>
                <button
                  className={`px-3 py-1 transition-colors cursor-pointer ${mode === 'plan' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                  onClick={() => handleModeChange('plan')}
                  disabled={inputDisabled}
                >
                  Plan
                </button>
              </div>
            </div>

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
              <Button size="sm" onClick={handleSend} disabled={!prompt.trim() || inputDisabled || !providerId || sending} className="self-end">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
