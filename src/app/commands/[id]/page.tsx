'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, FileText, ChevronDown, ChevronRight } from 'lucide-react';
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
  execEnv: string | null;
  providerId: string | null;
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

const eventTypeColors: Record<string, string> = {
  assistant: 'text-blue-400',
  user: 'text-green-400',
  system: 'text-yellow-400',
  result: 'text-purple-400',
  error: 'text-red-400',
};

function formatNDJSON(raw: string) {
  const lines = raw.split('\n').filter(l => l.trim());
  return lines.map((line, i) => {
    try {
      const obj = JSON.parse(line);
      const typeColor = eventTypeColors[obj.type] || 'text-muted-foreground';
      return (
        <pre key={i} className="whitespace-pre-wrap border-b border-border/50 pb-1 last:border-0">
          {obj.type && <span className={`font-semibold ${typeColor}`}>[{obj.type}] </span>}
          {JSON.stringify(obj, null, 2)}
        </pre>
      );
    } catch {
      return <pre key={i} className="whitespace-pre-wrap text-muted-foreground">{line}</pre>;
    }
  });
}

export default function CommandDetailPage() {
  const params = useParams();
  const router = useRouter();
  const commandId = params.id as string;

  const [command, setCommand] = useState<CommandDetail | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [showExecEnv, setShowExecEnv] = useState(false);
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
        {command.mode === 'init' && <Badge variant="outline">Init</Badge>}
        {command.mode === 'research' && <Badge variant="outline">调研</Badge>}
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

      {/* Execution Environment */}
      {command.execEnv && (() => {
        try {
          const env = JSON.parse(command.execEnv) as { args?: string[]; env?: Record<string, string>; cwd?: string; providerName?: string | null };
          return (
            <div className="mb-4">
              <button
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                onClick={() => setShowExecEnv(!showExecEnv)}
              >
                {showExecEnv ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                执行参数
                {env.providerName && <Badge variant="outline" className="text-xs ml-1">{env.providerName}</Badge>}
              </button>
              {showExecEnv && (
                <div className="mt-2 rounded-lg border bg-muted/50 p-3 text-xs space-y-2">
                  {env.cwd && (
                    <div>
                      <span className="text-muted-foreground">工作目录：</span>
                      <span className="font-mono">{env.cwd}</span>
                    </div>
                  )}
                  {env.args && env.args.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">CLI 参数：</span>
                      <span className="font-mono">{env.args.join(' ')}</span>
                    </div>
                  )}
                  {env.env && Object.keys(env.env).length > 0 && (
                    <div>
                      <span className="text-muted-foreground">环境变量：</span>
                      <div className="mt-1 space-y-0.5 font-mono">
                        {Object.entries(env.env).map(([k, v]) => (
                          <div key={k}><span className="text-blue-500">{k}</span>=<span>{v}</span></div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        } catch {
          return null;
        }
      })()}

      <Separator className="mb-4" />

      {/* Result */}
      {command.result && (
        <div className="mb-4">
          <h3 className="text-xs font-medium text-muted-foreground mb-2">结果</h3>
          <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg border p-4 max-h-[60vh] overflow-y-auto">
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
              <div className="max-h-96 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs space-y-1">
                {logs ? formatNDJSON(logs) : '无日志内容'}
              </div>
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
