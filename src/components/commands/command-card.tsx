'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Square, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Command } from '@/hooks/use-commands';

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: '未开始', variant: 'outline' },
  queued: { label: '排队中', variant: 'secondary' },
  running: { label: '进行中', variant: 'default' },
  completed: { label: '已完成', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
  aborted: { label: '已中止', variant: 'outline' },
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

interface CommandCardProps {
  command: Command;
  onAbort?: (id: string) => void;
  draggable?: boolean;
}

function CommandCardInner({ command, onAbort, dragHandle }: {
  command: Command;
  onAbort?: (id: string) => void;
  dragHandle?: React.ReactNode;
}) {
  const config = statusConfig[command.status] || statusConfig.pending;

  return (
    <>
      {dragHandle}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm text-muted-foreground min-w-0">
          <Link
            href={`/projects/${command.projectId}`}
            className="truncate max-w-[40%] py-1.5 px-1 -mx-1 rounded hover:underline hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            {command.projectName}
          </Link>
          <span className="shrink-0">/</span>
          <Link
            href={`/tasks/${command.taskId}`}
            className="truncate max-w-[55%] py-1.5 px-1 -mx-1 rounded hover:underline hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            {command.taskDescription?.slice(0, 30)}
          </Link>
        </div>
        <Link href={`/commands/${command.id}`} className="mt-1 block">
          <p className="line-clamp-2 text-sm">{command.prompt.slice(0, 100)}</p>
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant={config.variant}>{config.label}</Badge>
            {command.mode === 'plan' && (
              <Badge variant="outline">Plan</Badge>
            )}
            {command.mode === 'init' && (
              <Badge variant="outline">Init</Badge>
            )}
            {command.mode === 'research' && (
              <Badge variant="outline">调研</Badge>
            )}
            {command.providerName && (
              <span className="text-xs text-muted-foreground">{command.providerName}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {timeAgo(command.startedAt || command.createdAt)}
            </span>
            {command.status === 'running' && onAbort && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-destructive"
                onClick={(e) => { e.preventDefault(); onAbort(command.id); }}
              >
                <Square className="mr-1 h-3 w-3" />
                中止
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function SortableCommandCard({ command, onAbort }: { command: Command; onAbort?: (id: string) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: command.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-2 rounded-lg border p-3 bg-card">
      <CommandCardInner
        command={command}
        onAbort={onAbort}
        dragHandle={
          <GripVertical
            className="mt-1 h-4 w-4 shrink-0 cursor-grab text-muted-foreground"
            {...attributes}
            {...listeners}
          />
        }
      />
    </div>
  );
}

export function CommandCard({ command, onAbort, draggable }: CommandCardProps) {
  if (draggable) {
    return <SortableCommandCard command={command} onAbort={onAbort} />;
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border p-3 bg-card">
      <CommandCardInner command={command} onAbort={onAbort} />
    </div>
  );
}
