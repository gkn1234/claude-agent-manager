'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Plus } from 'lucide-react';

type Mode = 'local' | 'clone' | 'new';

interface CreateProjectDialogProps {
  onCreated: () => void;
}

export function CreateProjectDialog({ onCreated }: CreateProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('local');
  const [name, setName] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || workDir.split('/').pop(), workDir, gitUrl, mode }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create project');
      }
      setOpen(false);
      setName('');
      setWorkDir('');
      setGitUrl('');
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />新建项目</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          {(['local', 'clone', 'new'] as Mode[]).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={mode === m ? 'default' : 'outline'}
              onClick={() => setMode(m)}
            >
              {m === 'local' ? '本地项目' : m === 'clone' ? 'Git Clone' : '新建'}
            </Button>
          ))}
        </div>

        <div className="space-y-3">
          {mode === 'local' && (
            <Input placeholder="本地项目目录路径" value={workDir} onChange={(e) => setWorkDir(e.target.value)} />
          )}
          {mode === 'clone' && (
            <>
              <Input placeholder="Git URL" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} />
              <Input placeholder="目标目录 (可选)" value={workDir} onChange={(e) => setWorkDir(e.target.value)} />
            </>
          )}
          {mode === 'new' && (
            <>
              <Input placeholder="项目名称" value={name} onChange={(e) => setName(e.target.value)} />
              <Input placeholder="项目目录 (可选)" value={workDir} onChange={(e) => setWorkDir(e.target.value)} />
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button className="w-full" onClick={handleSubmit} disabled={loading}>
            {loading ? '创建中...' : '创建'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
