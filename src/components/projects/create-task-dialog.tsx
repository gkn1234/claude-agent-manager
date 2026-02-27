'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Plus } from 'lucide-react';

interface CreateTaskDialogProps {
  projectId: string;
  onCreated: () => void;
}

export function CreateTaskDialog({ projectId, onCreated }: CreateTaskDialogProps) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!description.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      if (res.ok) {
        setOpen(false);
        setDescription('');
        onCreated();
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
      <DialogContent className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
        </DialogHeader>
        <Textarea
          placeholder="描述任务内容..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="min-h-[100px] max-h-[50vh] overflow-y-auto"
        />
        <Button className="w-full shrink-0" onClick={handleSubmit} disabled={loading || !description.trim()}>
          {loading ? '创建中...' : '创建任务'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
