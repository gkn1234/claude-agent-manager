'use client';

import { useIsMobile } from '@/hooks/use-media-query';
import { BottomTabs } from './bottom-tabs';
import { Sidebar } from './sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  return (
    <>
      {isMobile ? <BottomTabs /> : <Sidebar />}
      <main className={isMobile ? 'pb-14' : 'pl-52'}>
        {children}
      </main>
    </>
  );
}
