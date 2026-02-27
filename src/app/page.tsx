'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCommands } from '@/hooks/use-commands';
import { StatusGroup } from '@/components/commands/status-group';

interface Project {
  id: string;
  name: string;
}

interface Task {
  id: string;
  description: string;
  status: string;
}

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);

  const filters: { projectId?: string; taskId?: string } | undefined =
    selectedTaskId ? { taskId: selectedTaskId } :
    selectedProjectId ? { projectId: selectedProjectId } :
    undefined;

  const { grouped, loading, abortCommand, reorderCommands } = useCommands(filters);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) setProjects(await res.json());
    } catch {}
  }, []);

  const fetchTasks = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch {}
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  useEffect(() => {
    if (selectedProjectId) {
      fetchTasks(selectedProjectId);
    } else {
      setTasks([]);
    }
  }, [selectedProjectId, fetchTasks]);

  const handleProjectSelect = (projectId: string | undefined) => {
    setSelectedProjectId(projectId);
    setSelectedTaskId(undefined);
  };

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  const isEmpty = grouped.running.length === 0 && grouped.queued.length === 0 && grouped.completed.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <h1 className="mb-4 text-lg font-semibold">指令队列</h1>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        <select
          value={selectedProjectId || ''}
          onChange={(e) => handleProjectSelect(e.target.value || undefined)}
          className="h-7 rounded-md border bg-background px-2 text-xs cursor-pointer"
        >
          <option value="">全部项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {selectedProjectId && tasks.length > 0 && (
          <select
            value={selectedTaskId || ''}
            onChange={(e) => setSelectedTaskId(e.target.value || undefined)}
            className="h-7 rounded-md border bg-background px-2 text-xs cursor-pointer flex-1 min-w-0"
          >
            <option value="">全部任务</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.description.length > 30 ? t.description.slice(0, 30) + '...' : t.description}
              </option>
            ))}
          </select>
        )}
      </div>

      {isEmpty ? (
        <div className="flex h-[40vh] flex-col items-center justify-center text-center">
          <p className="text-muted-foreground">暂无指令</p>
          <p className="mt-1 text-sm text-muted-foreground">在项目中创建任务后，指令会出现在这里</p>
        </div>
      ) : (
        <>
          <StatusGroup
            title="进行中"
            icon="🔄"
            commands={grouped.running}
            defaultOpen={true}
            onAbort={abortCommand}
          />
          <StatusGroup
            title="排队中"
            icon="⏳"
            commands={grouped.queued}
            defaultOpen={true}
            draggable={!filters}
            onReorder={reorderCommands}
          />
          <StatusGroup
            title="已完成"
            icon="✅"
            commands={grouped.completed}
            defaultOpen={false}
          />
        </>
      )}
    </div>
  );
}
