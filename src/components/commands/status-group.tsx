'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { CommandCard } from './command-card';
import type { Command } from '@/hooks/use-commands';

interface StatusGroupProps {
  title: string;
  icon: string;
  commands: Command[];
  defaultOpen?: boolean;
  onAbort?: (id: string) => void;
  draggable?: boolean;
}

export function StatusGroup({ title, icon, commands, defaultOpen = true, onAbort, draggable }: StatusGroupProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (commands.length === 0) return null;

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
        <div className="space-y-2">
          {commands.map((cmd) => (
            <CommandCard key={cmd.id} command={cmd} onAbort={onAbort} draggable={draggable} />
          ))}
        </div>
      )}
    </div>
  );
}
