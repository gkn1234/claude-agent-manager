'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CommandCard } from './command-card';
import type { Command } from '@/hooks/use-commands';

interface StatusGroupProps {
  title: string;
  icon: string;
  commands: Command[];
  defaultOpen?: boolean;
  onAbort?: (id: string) => void;
  draggable?: boolean;
  onReorder?: (items: { id: string; priority: number }[]) => void;
}

export function StatusGroup({ title, icon, commands, defaultOpen = true, onAbort, draggable, onReorder }: StatusGroupProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (commands.length === 0) return null;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorder) return;

    const oldIndex = commands.findIndex(c => c.id === active.id);
    const newIndex = commands.findIndex(c => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(commands, oldIndex, newIndex);
    const items = reordered.map((cmd, i) => ({
      id: cmd.id,
      priority: reordered.length - 1 - i,
    }));
    onReorder(items);
  };

  const list = (
    <div className="space-y-2">
      {commands.map((cmd) => (
        <CommandCard key={cmd.id} command={cmd} onAbort={onAbort} draggable={draggable} />
      ))}
    </div>
  );

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 py-2 text-sm font-medium text-muted-foreground"
      >
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span>{icon} {title}</span>
        <span className="ml-1 text-xs">({commands.length})</span>
      </button>
      {isOpen && (
        draggable ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={commands.map(c => c.id)} strategy={verticalListSortingStrategy}>
              {list}
            </SortableContext>
          </DndContext>
        ) : list
      )}
    </div>
  );
}
