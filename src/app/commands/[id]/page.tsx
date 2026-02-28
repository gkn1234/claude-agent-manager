'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, FileText, ChevronDown, ChevronRight, Send, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

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
  taskStatus: string | null;
  taskLastProviderId: string | null;
  taskLastMode: string | null;
  isLatestFinished: boolean;
  hasRunning: boolean;
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

  // Command input states
  const [providers, setProviders] = useState<Provider[]>([]);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'execute' | 'plan'>('execute');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const fetchCommand = useCallback(async () => {
    try {
      const res = await fetch(`/api/commands/${commandId}`);
      if (res.ok) {
        const data = await res.json();
        setCommand(data);
        if (!prefsLoaded && data.isLatestFinished) {
          if (data.taskLastMode === 'plan' || data.taskLastMode === 'execute') setMode(data.taskLastMode);
          if (data.taskLastProviderId) setProviderId(data.taskLastProviderId);
          setPrefsLoaded(true);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [commandId, prefsLoaded]);

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
    fetchCommand();
    fetchProviders();
    const interval = setInterval(fetchCommand, 5000);
    return () => clearInterval(interval);
  }, [fetchCommand, fetchProviders]);

  const loadLogs = async () => {
    const res = await fetch(`/api/commands/${commandId}/logs`);
    const data = await res.json();
    setLogs(data.logs);
    setShowLogs(true);
  };

  const savePrefs = useCallback(async (newProviderId: string | null, newMode: string) => {
    if (!command) return;
    await fetch(`/api/tasks/${command.taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastProviderId: newProviderId, lastMode: newMode }),
    });
  }, [command]);

  const handleModeChange = (newMode: 'execute' | 'plan') => {
    setMode(newMode);
    savePrefs(providerId, newMode);
  };

  const handleProviderChange = (newProviderId: string) => {
    setProviderId(newProviderId);
    savePrefs(newProviderId, mode);
  };

  const canShowInput = command
    && command.isLatestFinished
    && command.taskStatus === 'ready'
    && !command.hasRunning;

  const handleSend = async () => {
    if (!command || !prompt.trim() || !providerId || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tasks/${command.taskId}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode, providerId }),
      });
      if (res.ok) {
        router.push(`/tasks/${command.taskId}`);
      }
    } finally {
      setSending(false);
    }
  };

  const handleAbort = async () => {
    await fetch(`/api/commands/${commandId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'aborted' }),
    });
    fetchCommand();
  };

  if (loading) return <div className="flex h-[50vh] items-center justify-center text-muted-foreground">加载中...</div>;
  if (!command) return <div className="flex h-[50vh] items-center justify-center text-muted-foreground">指令不存在</div>;

  const config = statusConfig[command.status] || statusConfig.pending;
  const isFailed = command.status === 'failed';

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] md:h-screen">
      {/* Header - sticky top */}
      <div className="px-4 py-3 border-b">
        <div className="flex items-center gap-2 max-w-2xl mx-auto">
          <Button variant="ghost" size="sm" className="p-1" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Badge variant={config.variant}>{config.label}</Badge>
          {command.mode === 'plan' && <Badge variant="outline">Plan</Badge>}
          {command.mode === 'init' && <Badge variant="outline">Init</Badge>}
          {command.mode === 'research' && <Badge variant="outline">调研</Badge>}
          <div className="flex-1" />
          {(command.status === 'running' || command.status === 'queued') && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleAbort}>
              <Square className="h-3.5 w-3.5 mr-1" />
              中止
            </Button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-2xl mx-auto">
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
              <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg border p-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{command.result}</ReactMarkdown>
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
      </div>

      {/* Command Input Area - sticky bottom */}
      {canShowInput && (
        <div className="border-t px-4 py-3">
          <div className="max-w-2xl mx-auto">
            {providers.length === 0 ? (
              <p className="text-xs text-destructive">
                尚未配置 Provider，请先前往<Link href="/settings" className="underline ml-0.5">系统设置</Link>添加
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <select
                    value={providerId || ''}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    className="h-7 rounded-md border bg-background px-2 text-xs cursor-pointer"
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
                    >
                      Exec
                    </button>
                    <button
                      className={`px-3 py-1 transition-colors cursor-pointer ${mode === 'plan' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                      onClick={() => handleModeChange('plan')}
                    >
                      Plan
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Textarea
                    placeholder="输入指令..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={2}
                    className="resize-none text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
                    }}
                  />
                  <Button size="sm" onClick={handleSend} disabled={!prompt.trim() || !providerId || sending} className="self-end">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
