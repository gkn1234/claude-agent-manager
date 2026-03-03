'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutList, FolderGit2, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/', label: '指令', icon: LayoutList },
  { href: '/projects', label: '项目', icon: FolderGit2 },
  { href: '/settings', label: '设置', icon: Settings },
];

async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

export function BottomTabs() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background">
      <div className="flex h-14 items-center justify-around">
        {tabs.map((tab) => {
          const isActive = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex flex-col items-center gap-0.5 px-3 py-1 text-xs transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <tab.icon className="h-5 w-5" />
              <span>{tab.label}</span>
            </Link>
          );
        })}
        <button
          onClick={handleLogout}
          className="flex flex-col items-center gap-0.5 px-3 py-1 text-xs text-muted-foreground transition-colors"
        >
          <LogOut className="h-5 w-5" />
          <span>退出</span>
        </button>
      </div>
    </nav>
  );
}
