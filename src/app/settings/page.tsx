'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

interface ConfigItem {
  key: string;
  label: string;
  description: string;
  unit: string;
}

const CONFIG_ITEMS: ConfigItem[] = [
  { key: 'max_concurrent', label: '最大并发数', description: '同时运行的 Claude 实例最大数量', unit: '个' },
  { key: 'command_timeout', label: '指令超时时间', description: '单条指令的最大执行时间', unit: '秒' },
  { key: 'log_retention_days', label: '日志保留天数', description: '日志文件自动清理的保留天数', unit: '天' },
  { key: 'poll_interval', label: '轮询间隔', description: '调度器检查待执行指令的间隔', unit: '秒' },
];

export default function SettingsPage() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/system/config');
      if (res.ok) {
        setConfig(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/system/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setMessage({ type: 'success', text: '保存成功' });
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error || '保存失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络错误' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  if (loading) {
    return <div className="flex h-[50vh] items-center justify-center text-muted-foreground">加载中...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <h1 className="text-lg font-semibold mb-1">系统设置</h1>
      <p className="text-sm text-muted-foreground mb-4">配置系统运行参数</p>

      <Separator className="mb-4" />

      <Card className="p-4">
        <div className="space-y-5">
          {CONFIG_ITEMS.map((item) => (
            <div key={item.key} className="space-y-1.5">
              <Label htmlFor={item.key}>{item.label}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={item.key}
                  type="number"
                  min={0}
                  value={config[item.key] ?? ''}
                  onChange={(e) => setConfig((prev) => ({ ...prev, [item.key]: e.target.value }))}
                  className="max-w-[160px]"
                />
                <span className="text-sm text-muted-foreground">{item.unit}</span>
              </div>
              <p className="text-xs text-muted-foreground">{item.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
          {message && (
            <span className={`text-sm ${message.type === 'success' ? 'text-green-600' : 'text-destructive'}`}>
              {message.text}
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
