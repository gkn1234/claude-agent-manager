'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Send, FileEdit } from 'lucide-react';
import { toast } from 'sonner';

interface Provider {
  id: string;
  name: string;
}

interface CommandInputProps {
  taskId: string;
  /** Initial provider ID from task preferences */
  initialProviderId?: string | null;
  /** Initial mode from task preferences */
  initialMode?: 'execute' | 'plan';
  /** Whether to show draft/queue toggle. Default: true */
  showDraftToggle?: boolean;
  /** Whether the input is disabled (e.g. running command) */
  disabled?: boolean;
  /** Called after successful send */
  onSent?: () => void;
}

export function CommandInput({
  taskId,
  initialProviderId,
  initialMode = 'execute',
  showDraftToggle = true,
  disabled = false,
  onSent,
}: CommandInputProps) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'execute' | 'plan'>(initialMode);
  const [providerId, setProviderId] = useState<string | null>(initialProviderId ?? null);
  const [sending, setSending] = useState(false);
  const [isDraft, setIsDraft] = useState(false);
  const [prefsInited, setPrefsInited] = useState(false);

  const fetchProviders = useCallback(async () => {
    const res = await fetch('/api/providers');
    if (res.ok) {
      const data = await res.json();
      setProviders(data);
      if (!providerId && !prefsInited && data.length > 0) {
        setProviderId(data[0].id);
      }
    }
  }, [providerId, prefsInited]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Sync initial props when they become available
  useEffect(() => {
    if (prefsInited) return;
    if (initialProviderId) setProviderId(initialProviderId);
    if (initialMode) setMode(initialMode);
    setPrefsInited(true);
  }, [initialProviderId, initialMode, prefsInited]);

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

  const noProvider = providers.length === 0;
  const inputDisabled = disabled || noProvider;

  const handleSend = async () => {
    if (!prompt.trim() || !providerId) return;
    if (!isDraft && inputDisabled) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode, providerId, autoQueue: !isDraft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '请求失败' }));
        toast.error(data.error || `请求失败 (${res.status})`);
        return;
      }
      setPrompt('');
      onSent?.();
    } finally {
      setSending(false);
    }
  };

  if (noProvider) {
    return (
      <p className="text-xs text-destructive">
        尚未配置 Provider，请先前往<Link href="/settings" className="underline ml-0.5">系统设置</Link>添加
      </p>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <select
          value={providerId || ''}
          onChange={(e) => handleProviderChange(e.target.value)}
          disabled={inputDisabled && !isDraft}
          className="h-7 rounded-md border bg-background px-2 text-xs cursor-pointer disabled:opacity-50"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <div className="flex-1" />
        <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && handleModeChange(v as 'execute' | 'plan')}>
          <ToggleGroupItem value="execute">Exec</ToggleGroupItem>
          <ToggleGroupItem value="plan">Plan</ToggleGroupItem>
        </ToggleGroup>
        {showDraftToggle && (
          <ToggleGroup type="single" variant="outline" size="sm" value={isDraft ? 'draft' : 'queue'} onValueChange={(v) => v && setIsDraft(v === 'draft')}>
            <ToggleGroupItem value="queue">排队</ToggleGroupItem>
            <ToggleGroupItem value="draft">草稿</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      <div className="flex gap-2">
        <Textarea
          placeholder={!isDraft && inputDisabled ? '等待当前指令完成...' : '输入指令...'}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={!isDraft && inputDisabled}
          rows={2}
          className="resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
          }}
        />
        <Button
          size="sm"
          variant={isDraft ? 'outline' : 'default'}
          onClick={handleSend}
          disabled={!prompt.trim() || (!isDraft && inputDisabled) || !providerId || sending}
          title={isDraft ? '保存草稿' : '发送排队'}
          className="self-end"
        >
          {isDraft ? <FileEdit className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </>
  );
}
