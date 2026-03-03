'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Plus, Trash2, X, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// --- System Config Section ---

interface ConfigItem {
  key: string;
  label: string;
  description: string;
  unit?: string;
  type: 'number' | 'text';
}

const CONFIG_ITEMS: ConfigItem[] = [
  { key: 'max_concurrent', label: '最大并发数', description: '同时运行的 Claude 实例最大数量', unit: '个', type: 'number' },
  { key: 'command_timeout', label: '指令超时时间', description: '单条指令的最大执行时间', unit: '秒', type: 'number' },
  { key: 'log_retention_days', label: '日志保留天数', description: '日志文件自动清理的保留天数', unit: '天', type: 'number' },
  { key: 'poll_interval', label: '轮询间隔', description: '调度器检查待执行指令的间隔', unit: '秒', type: 'number' },
];

// --- Provider Section ---

interface Provider {
  id: string;
  name: string;
  sortOrder: number;
  envJson: Record<string, string>;
}

interface EnvRow {
  key: string;
  value: string;
}

function SortableProviderCard({ provider, onDelete, onSave }: {
  provider: Provider;
  onDelete: () => void;
  onSave: (name: string, envRows: EnvRow[]) => Promise<void>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: provider.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const [name, setName] = useState(provider.name);
  const [rows, setRows] = useState<EnvRow[]>(() =>
    Object.entries(provider.envJson).map(([key, value]) => ({ key, value }))
  );
  const [saving, setSaving] = useState(false);

  const addRow = () => setRows([...rows, { key: '', value: '' }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: 'key' | 'value', val: string) => {
    const updated = [...rows];
    updated[i] = { ...updated[i], [field]: val };
    setRows(updated);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name, rows.filter(r => r.key.trim()));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 touch-none"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </div>
          <Input
            placeholder="配置名称（如：智谱 GLM）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-sm font-medium"
          />
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive shrink-0" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder="变量名"
                value={row.key}
                onChange={(e) => updateRow(i, 'key', e.target.value)}
                className="text-xs font-mono max-w-[220px]"
              />
              <Input
                placeholder="值"
                type={/KEY|TOKEN|SECRET|PASSWORD/i.test(row.key) ? 'password' : 'text'}
                value={row.value}
                onChange={(e) => updateRow(i, 'value', e.target.value)}
                className="text-xs font-mono flex-1"
              />
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => removeRow(i)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-3">
          <Button variant="outline" size="sm" className="text-xs" onClick={addRow}>
            <Plus className="h-3 w-3 mr-1" /> 添加变量
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function NewProviderCard({ onSave, onCancel }: {
  onSave: (name: string, envRows: EnvRow[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [rows, setRows] = useState<EnvRow[]>([
    { key: 'ANTHROPIC_BASE_URL', value: '' },
    { key: 'ANTHROPIC_AUTH_TOKEN', value: '' },
  ]);
  const [saving, setSaving] = useState(false);

  const addRow = () => setRows([...rows, { key: '', value: '' }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: 'key' | 'value', val: string) => {
    const updated = [...rows];
    updated[i] = { ...updated[i], [field]: val };
    setRows(updated);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name, rows.filter(r => r.key.trim()));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Input
          placeholder="配置名称（如：智谱 GLM）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-sm font-medium"
        />
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive shrink-0" onClick={onCancel}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              placeholder="变量名"
              value={row.key}
              onChange={(e) => updateRow(i, 'key', e.target.value)}
              className="text-xs font-mono max-w-[220px]"
            />
            <Input
              placeholder="值"
              type={/KEY|TOKEN|SECRET|PASSWORD/i.test(row.key) ? 'password' : 'text'}
              value={row.value}
              onChange={(e) => updateRow(i, 'value', e.target.value)}
              className="text-xs font-mono flex-1"
            />
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => removeRow(i)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-3">
        <Button variant="outline" size="sm" className="text-xs" onClick={addRow}>
          <Plus className="h-3 w-3 mr-1" /> 添加变量
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </div>
    </Card>
  );
}

// --- Main Page ---

export default function SettingsPage() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [providers, setProviders] = useState<Provider[]>([]);
  const [showNewProvider, setShowNewProvider] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/system/config');
      if (res.ok) setConfig(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProviders = useCallback(async () => {
    const res = await fetch('/api/providers');
    if (res.ok) setProviders(await res.json());
  }, []);

  useEffect(() => { fetchConfig(); fetchProviders(); }, [fetchConfig, fetchProviders]);

  const handleSaveConfig = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/system/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setConfig(await res.json());
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

  const handleSaveProvider = async (id: string | null, name: string, rows: EnvRow[]) => {
    const envJson = Object.fromEntries(rows.map(r => [r.key, r.value]));
    if (id) {
      await fetch(`/api/providers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, envJson }),
      });
    } else {
      await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, envJson }),
      });
      setShowNewProvider(false);
    }
    fetchProviders();
  };

  const handleDeleteProvider = async (id: string) => {
    if (!confirm('确定删除此 Provider 配置？')) return;
    await fetch(`/api/providers/${id}`, { method: 'DELETE' });
    fetchProviders();
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = providers.findIndex(p => p.id === active.id);
    const newIndex = providers.findIndex(p => p.id === over.id);
    const reordered = arrayMove(providers, oldIndex, newIndex);

    // Optimistic update
    setProviders(reordered);

    // Persist
    const items = reordered.map((p, i) => ({ id: p.id, sortOrder: i }));
    await fetch('/api/providers/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  };

  if (loading) {
    return <div className="flex h-[50vh] items-center justify-center text-muted-foreground">加载中...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <h1 className="text-lg font-semibold mb-1">系统设置</h1>
      <p className="text-sm text-muted-foreground mb-4">配置系统运行参数</p>

      {/* Provider Profiles */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-medium">Provider 配置</h2>
        <Button variant="outline" size="sm" onClick={() => setShowNewProvider(true)} disabled={showNewProvider}>
          <Plus className="h-3.5 w-3.5 mr-1" /> 新增
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        配置不同的 API 端点和密钥，派发指令时可选择使用。拖拽排序，排在首位的为默认 Provider。
      </p>

      <div className="space-y-3 mb-6">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={providers.map(p => p.id)} strategy={verticalListSortingStrategy}>
            {providers.map((p) => (
              <SortableProviderCard
                key={p.id}
                provider={p}
                onDelete={() => handleDeleteProvider(p.id)}
                onSave={(name, rows) => handleSaveProvider(p.id, name, rows)}
              />
            ))}
          </SortableContext>
        </DndContext>
        {showNewProvider && (
          <NewProviderCard
            onSave={(name, rows) => handleSaveProvider(null, name, rows)}
            onCancel={() => setShowNewProvider(false)}
          />
        )}
        {providers.length === 0 && !showNewProvider && (
          <p className="text-sm text-muted-foreground text-center py-4">暂无 Provider 配置</p>
        )}
      </div>

      <Separator className="mb-4" />

      {/* System Config */}
      <h2 className="font-medium mb-3">系统参数</h2>
      <Card className="p-4">
        <div className="space-y-5">
          {CONFIG_ITEMS.map((item) => (
            <div key={item.key} className="space-y-1.5">
              <Label htmlFor={item.key}>{item.label}</Label>
              {item.type === 'number' ? (
                <div className="flex items-center gap-2">
                  <Input
                    id={item.key}
                    type="number"
                    min={item.key === 'poll_interval' ? 1 : 0}
                    value={config[item.key] ?? ''}
                    onChange={(e) => setConfig((prev) => ({ ...prev, [item.key]: e.target.value }))}
                    className="max-w-[160px]"
                  />
                  {item.unit && <span className="text-sm text-muted-foreground">{item.unit}</span>}
                </div>
              ) : (
                <Textarea
                  id={item.key}
                  value={config[item.key] ?? ''}
                  onChange={(e) => setConfig((prev) => ({ ...prev, [item.key]: e.target.value }))}
                  rows={6}
                  className="text-sm font-mono"
                />
              )}
              <p className="text-xs text-muted-foreground">{item.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button onClick={handleSaveConfig} disabled={saving}>
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
