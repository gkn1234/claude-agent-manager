'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

interface CreateTaskDialogProps {
  projectId: string;
  onCreated: () => void;
}

const BRANCH_REGEX = /^[a-z0-9-]*$/;

export function CreateTaskDialog({ projectId, onCreated }: CreateTaskDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [loading, setLoading] = useState(false);

  const branchValid = BRANCH_REGEX.test(branch);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    if (branch && !branchValid) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: name.trim(), branch: branch.trim() || undefined }),
      });
      if (res.ok) {
        setOpen(false);
        setName('');
        setBranch('');
        onCreated();
      } else {
        const data = await res.json().catch(() => ({ error: '创建失败' }));
        toast.error(data.error || '创建失败');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />新建任务</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-name">任务名称</Label>
            <Input
              id="task-name"
              placeholder="输入任务名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-branch">分支名（选填）</Label>
            <Input
              id="task-branch"
              placeholder="不填则自动生成 task-xxx"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className={`font-mono ${branch && !branchValid ? 'border-destructive' : ''}`}
            />
            {branch && !branchValid && (
              <p className="text-xs text-destructive">仅允许小写字母、数字和连字符</p>
            )}
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={loading || !name.trim() || (!!branch && !branchValid)}>
            {loading ? '创建中...' : '创建任务'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
