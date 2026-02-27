'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { CreateTaskDialog } from '@/components/projects/create-task-dialog';

interface Task {
  id: string;
  description: string;
  branch: string | null;
  status: string;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  workDir: string;
  gitRemote: string | null;
  tasks: Task[];
}

const taskStatusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  initializing: { label: '初始化中', variant: 'secondary' },
  ready: { label: '就绪', variant: 'default' },
  archived: { label: '已归档', variant: 'outline' },
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const projectId = params.id as string;

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) setProject(await res.json());
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchProject(); }, [fetchProject]);

  const handleDelete = async () => {
    if (!confirm('确定删除此项目？所有任务和指令将一并删除。')) return;
    await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    router.push('/projects');
  };

  if (loading) return <div className="flex h-[50vh] items-center justify-center text-muted-foreground">加载中...</div>;
  if (!project) return <div className="flex h-[50vh] items-center justify-center text-muted-foreground">项目不存在</div>;

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold flex-1">{project.name}</h1>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={handleDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="mb-4 space-y-1 text-sm text-muted-foreground">
        <p>目录：{project.workDir}</p>
        {project.gitRemote && <p>远程：{project.gitRemote}</p>}
      </div>

      <Separator className="mb-4" />

      <div className="flex items-center justify-between mb-3">
        <h2 className="font-medium">任务 ({project.tasks.length})</h2>
        <CreateTaskDialog projectId={projectId} onCreated={fetchProject} />
      </div>

      {project.tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">暂无任务</p>
      ) : (
        <div className="space-y-2">
          {project.tasks.map((task) => {
            const config = taskStatusConfig[task.status] || taskStatusConfig.initializing;
            return (
              <Link key={task.id} href={`/tasks/${task.id}`}>
                <Card className="hover:bg-accent/50 transition-colors">
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{task.description.slice(0, 60)}</CardTitle>
                      <Badge variant={config.variant}>{config.label}</Badge>
                    </div>
                    {task.branch && (
                      <CardDescription className="text-xs">{task.branch}</CardDescription>
                    )}
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
