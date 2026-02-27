'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface CommandDetail {
  id: string;
  taskId: string;
  prompt: string;
  mode: string;
  status: string;
  priority: number;
  result: string | null;
  logFile: string | null;
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: '未开始', variant: 'outline' },
  queued: { label: '排队中', variant: 'secondary' },
  running: { label: '进行中', variant: 'default' },
  completed: { label: '已完成', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
  aborted: { label: '已中止', variant: 'outline' },
};

export default function CommandDetailPage() {
  const params = useParams();
  const router = useRouter();
  const commandId = params.id as string;

  const [command, setCommand] = useState<CommandDetail | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchCommand = useCallback(async () => {
    try {
      const res = await fetch(`/api/commands/${commandId}`);
      if (res.ok) setCommand(await res.json());
    } finally {
      setLoading(false);
    }
  }, [commandId]);

  useEffect(() => {
    fetchCommand();
    const interval = setInterval(fetchCommand, 5000);
    return () => clearInterval(interval);
  }, [fetchCommand]);

  const loadLogs = async () => {
    const res = await fetch(`/api/commands/${commandId}/logs`);
    const data = await res.json();
    setLogs(data.logs);
    setShowLogs(true);
  };

  if (loading) return <div className="flex h-[50vh] items-center justify-center text-muted-foreground">加载中...</div>;
  if (!command) return <div className="flex h-[50vh] items-center justify-center text-muted-foreground">指令不存在</div>;

  const config = statusConfig[command.status] || statusConfig.pending;
  const isFailed = command.status === 'failed';

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="sm" className="p-1" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Badge variant={config.variant}>{config.label}</Badge>
        {command.mode === 'plan' && <Badge variant="outline">Plan</Badge>}
      </div>

      {/* Prompt */}
      <div className="mb-4">
        <h3 className="text-xs font-medium text-muted-foreground mb-1">Prompt</h3>
        <div className="rounded-lg border p-3 bg-muted/50 text-sm whitespace-pre-wrap">{command.prompt}</div>
      </div>

      {/* Meta */}
      <div className="mb-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        {command.startedAt && <div>开始：{new Date(command.startedAt).toLocaleString('zh-CN')}</div>}
        {command.finishedAt && <div>结束：{new Date(command.finishedAt).toLocaleString('zh-CN')}</div>}
        {command.sessionId && <div className="col-span-2 truncate">Session: {command.sessionId}</div>}
      </div>

      <Separator className="mb-4" />

      {/* Result */}
      {command.result && (
        <div className="mb-4">
          <h3 className="text-xs font-medium text-muted-foreground mb-2">结果</h3>
          <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg border p-4">
            <ReactMarkdown>{command.result}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Logs */}
      {command.logFile && (
        <div>
          {!showLogs ? (
            <Button variant="outline" size="sm" onClick={loadLogs}>
              <FileText className="mr-1 h-4 w-4" />
              查看完整日志
            </Button>
          ) : (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2">完整日志</h3>
              <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs">
                {logs || '无日志内容'}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Auto-show last lines on failure */}
      {isFailed && !showLogs && command.logFile && (
        <p className="mt-2 text-xs text-muted-foreground">
          指令执行失败，点击上方按钮查看完整日志排查问题
        </p>
      )}
    </div>
  );
}
