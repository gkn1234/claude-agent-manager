'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Trash2, Square, Undo2, Play, Brain } from 'lucide-react';
import { toast } from 'sonner';
import { CommandInput } from '@/components/commands/command-input';
import { AutonomousDialog } from '@/components/tasks/autonomous-dialog';

interface Command {
  id: string;
  prompt: string;
  mode: string;
  status: string;
  result: string | null;
  providerId: string | null;
  role: string;
  managerSummary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface Task {
  id: string;
  projectId: string;
  description: string;
  branch: string;
  worktreeDir: string | null;
  lastProviderId: string | null;
  lastMode: string | null;
  mode: string;
  goal: string | null;
  managerProviderId: string | null;
  workerProviderId: string | null;
  autonomousRound: number;
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

export default function TaskPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const [task, setTask] = useState<Task | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTask = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (res.ok) setTask(await res.json());
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const fetchProviders = useCallback(async () => {
    const res = await fetch('/api/providers');
    if (res.ok) setProviders(await res.json());
  }, []);

  useEffect(() => {
    fetchTask();
    fetchProviders();
    const interval = setInterval(fetchTask, 5000);
    return () => clearInterval(interval);
  }, [fetchTask, fetchProviders]);

  const hasRunning = task?.commands.some(c => c.status === 'running') ?? false;

  const handleDelete = async () => {
    if (!confirm('确定要删除这个任务吗？将同时删除所有相关指令和日志。')) return;
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    if (res.ok && task) {
      router.push(`/projects/${task.projectId}`);
    }
  };

  const handleAbort = async (commandId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/commands/${commandId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'aborted' }),
    });
    fetchTask();
  };

  const handleCancelQueue = async (commandId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/commands/${commandId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending' }),
    });
    fetchTask();
  };

  const handleDeleteCommand = async (commandId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/commands/${commandId}`, { method: 'DELETE' });
    fetchTask();
  };

  const handleQueueCommand = async (commandId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/commands/${commandId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'queued' }),
    });
    fetchTask();
  };

  const handleUpdatePendingCommand = async (commandId: string, updates: Record<string, unknown>, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/commands/${commandId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    fetchTask();
  };

  const handlePauseAutonomous = async () => {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause_autonomous' }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: '请求失败' }));
      toast.error(data.error || '暂停失败');
      return;
    }
    toast.success('自主模式已暂停');
    fetchTask();
  };

  const handleResumeAutonomous = async () => {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume_autonomous' }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: '请求失败' }));
      toast.error(data.error || '恢复失败');
      return;
    }
    toast.success('自主模式已恢复');
    fetchTask();
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
          <span className="text-sm font-medium flex-1 truncate">{task.description}</span>
          {task.mode === 'manual' && task.managerProviderId && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={handleResumeAutonomous}
            >
              <Brain className="h-3 w-3" />
              恢复自主
            </Button>
          )}
          {task.mode === 'manual' && !task.managerProviderId && (
            <AutonomousDialog
              taskId={taskId}
              providers={providers}
              onStarted={fetchTask}
            />
          )}
          {task.mode === 'autonomous' && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 text-orange-600 border-orange-300 hover:bg-orange-50"
              onClick={handlePauseAutonomous}
            >
              暂停自主
            </Button>
          )}
          <Button variant="ghost" size="sm" className="p-1 text-destructive hover:text-destructive" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground font-mono ml-8">{task.branch}</p>
        {task.mode === 'autonomous' && (
          <div className="flex items-center gap-2 ml-8 mt-1">
            <Badge variant="default" className="text-xs bg-purple-600 hover:bg-purple-600">
              自主模式
            </Badge>
            <span className="text-xs text-muted-foreground">
              轮次 {task.autonomousRound}
            </span>
            {task.goal && (
              <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={task.goal}>
                {task.goal.slice(0, 50)}{task.goal.length > 50 ? '...' : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Command Timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {task.commands.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">暂无指令</p>
        ) : (
          <div className="space-y-3">
            {[...task.commands].reverse().map((cmd, i) => {
              const cfg = statusConfig[cmd.status] || statusConfig.pending;
              if (cmd.status === 'pending') {
                return (
                  <div key={cmd.id} className="rounded-lg border border-dashed p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">#{task.commands.length - i} · 草稿</span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 px-1.5 text-xs"
                          onClick={(e) => handleQueueCommand(cmd.id, e)}
                        >
                          <Play className="h-3 w-3 mr-0.5" />
                          排队
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                          onClick={(e) => handleDeleteCommand(cmd.id, e)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      defaultValue={cmd.prompt}
                      rows={2}
                      className="resize-none text-sm mb-2"
                      onBlur={(e) => {
                        if (e.target.value !== cmd.prompt) {
                          handleUpdatePendingCommand(cmd.id, { prompt: e.target.value }, e as unknown as React.MouseEvent);
                        }
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <select
                        defaultValue={cmd.mode}
                        onChange={(e) => handleUpdatePendingCommand(cmd.id, { mode: e.target.value }, e as unknown as React.MouseEvent)}
                        className="h-6 rounded-md border bg-background px-1.5 text-xs cursor-pointer"
                      >
                        <option value="execute">Exec</option>
                        <option value="plan">Plan</option>
                      </select>
                      <select
                        defaultValue={cmd.providerId || ''}
                        onChange={(e) => handleUpdatePendingCommand(cmd.id, { providerId: e.target.value }, e as unknown as React.MouseEvent)}
                        className="h-6 rounded-md border bg-background px-1.5 text-xs cursor-pointer"
                      >
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              }
              const isManager = cmd.role === 'manager';
              return (
                <Link key={cmd.id} href={`/commands/${cmd.id}`}>
                  <div className={`rounded-lg border p-3 transition-colors ${
                    isManager
                      ? 'border-purple-300 bg-purple-50/50 hover:bg-purple-100/50 dark:border-purple-800 dark:bg-purple-950/30 dark:hover:bg-purple-950/50'
                      : 'hover:bg-accent/50'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        {isManager && <Brain className="h-3 w-3 text-purple-600 dark:text-purple-400" />}
                        <span className="text-xs text-muted-foreground">
                          #{task.commands.length - i}
                        </span>
                        {isManager && (
                          <Badge variant="outline" className="text-xs border-purple-300 text-purple-600 dark:border-purple-700 dark:text-purple-400">
                            Manager
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {cmd.status === 'running' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                            onClick={(e) => handleAbort(cmd.id, e)}
                          >
                            <Square className="h-3 w-3" />
                          </Button>
                        )}
                        {cmd.status === 'queued' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                            onClick={(e) => handleCancelQueue(cmd.id, e)}
                          >
                            <Undo2 className="h-3 w-3 mr-0.5" />
                            取消
                          </Button>
                        )}
                        <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>
                      </div>
                    </div>
                    <p className="text-sm line-clamp-2">{cmd.prompt.slice(0, 120)}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {cmd.mode === 'plan' && <Badge variant="outline" className="text-xs">Plan</Badge>}
                      {cmd.providerId && (() => {
                        const prov = providers.find(p => p.id === cmd.providerId);
                        return prov ? <span>{prov.name}</span> : null;
                      })()}
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
        <CommandInput
          taskId={taskId}
          initialProviderId={task.lastProviderId}
          initialMode={(task.lastMode as 'execute' | 'plan') || 'execute'}
          disabled={hasRunning}
          onSent={fetchTask}
        />
      </div>
    </div>
  );
}
