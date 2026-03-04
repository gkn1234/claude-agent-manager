'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Brain } from 'lucide-react';
import { toast } from 'sonner';

interface Provider {
  id: string;
  name: string;
}

interface AutonomousDialogProps {
  taskId: string;
  providers: Provider[];
  onStarted?: () => void;
}

export function AutonomousDialog({ taskId, providers, onStarted }: AutonomousDialogProps) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState('');
  const [managerProviderId, setManagerProviderId] = useState(providers[0]?.id || '');
  const [workerProviderId, setWorkerProviderId] = useState(providers[0]?.id || '');
  const [sending, setSending] = useState(false);

  const handleStart = async () => {
    if (!goal.trim() || !managerProviderId || !workerProviderId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start_autonomous',
          goal: goal.trim(),
          managerProviderId,
          workerProviderId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '请求失败' }));
        toast.error(data.error || '启动自主模式失败');
        return;
      }
      toast.success('自主模式已启动');
      setOpen(false);
      setGoal('');
      onStarted?.();
    } finally {
      setSending(false);
    }
  };

  if (providers.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
          <Brain className="h-3 w-3" />
          启动自主模式
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>启动自主模式</DialogTitle>
          <DialogDescription>
            设定目标后，Manager 将自动拆解任务、派发工作命令并审查结果，直到目标完成。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="goal">目标</Label>
            <Textarea
              id="goal"
              placeholder="描述你想要实现的目标..."
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="manager-provider">Manager Provider</Label>
              <select
                id="manager-provider"
                value={managerProviderId}
                onChange={(e) => setManagerProviderId(e.target.value)}
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="worker-provider">Worker Provider</Label>
              <select
                id="worker-provider"
                value={workerProviderId}
                onChange={(e) => setWorkerProviderId(e.target.value)}
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button
            onClick={handleStart}
            disabled={!goal.trim() || !managerProviderId || !workerProviderId || sending}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {sending ? '启动中...' : '启动'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
