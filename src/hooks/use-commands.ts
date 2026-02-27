'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSSE } from './use-sse';

export interface Command {
  id: string;
  taskId: string;
  prompt: string;
  mode: string;
  status: string;
  priority: number;
  result: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  taskDescription: string;
  projectId: string;
  projectName: string;
  providerName: string | null;
}

export function useCommands(filters?: { projectId?: string; taskId?: string }) {
  const [commands, setCommands] = useState<Command[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCommands = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters?.projectId) params.set('project_id', filters.projectId);
      if (filters?.taskId) params.set('task_id', filters.taskId);
      const qs = params.toString();
      const res = await fetch(`/api/commands${qs ? `?${qs}` : ''}`);
      const data = await res.json();
      setCommands(data);
    } catch (err) {
      console.error('Failed to fetch commands:', err);
    } finally {
      setLoading(false);
    }
  }, [filters?.projectId, filters?.taskId]);

  useEffect(() => {
    fetchCommands();
  }, [fetchCommands]);

  // SSE for real-time updates
  useSSE('/api/events', (data: unknown) => {
    const event = data as { type: string };
    if (event.type === 'commands_update' || event.type === 'init') {
      fetchCommands(); // Refetch on any change
    }
  });

  const abortCommand = useCallback(async (id: string) => {
    await fetch(`/api/commands/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'aborted' }),
    });
    fetchCommands();
  }, [fetchCommands]);

  const reorderCommands = useCallback(async (items: { id: string; priority: number }[]) => {
    await fetch('/api/commands/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    fetchCommands();
  }, [fetchCommands]);

  const grouped = {
    running: commands.filter(c => c.status === 'running')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    queued: commands.filter(c => c.status === 'queued' || c.status === 'pending'),
    completed: commands.filter(c => ['completed', 'failed', 'aborted'].includes(c.status))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  };

  return { commands, grouped, loading, abortCommand, reorderCommands, refetch: fetchCommands };
}
