'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { CreateTaskDialog } from '@/components/projects/create-task-dialog';

interface Task {
  id: string;
  description: string;
  branch: string | null;
  worktreeDir: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface Project {
  id: string;
  name: string;
  workDir: string;
  gitRemote: string | null;
  tasks: Task[];
}

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

  const handleDeleteTask = async (taskId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('确定删除此任务？所有指令将一并删除。')) return;
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    fetchProject();
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
          {project.tasks.map((task) => (
            <Link key={task.id} href={`/tasks/${task.id}`}>
              <Card className="hover:bg-accent/50 transition-colors">
                <CardHeader className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex-1">{task.description}</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={(e) => handleDeleteTask(task.id, e)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <CardDescription className="text-xs font-mono">{task.branch}</CardDescription>
                  {task.updatedAt && (
                    <CardDescription className="text-xs">
                      活跃：{new Date(task.updatedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </CardDescription>
                  )}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
