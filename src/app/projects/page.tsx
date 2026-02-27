'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FolderGit2 } from 'lucide-react';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';

interface Project {
  id: string;
  name: string;
  workDir: string;
  gitRemote: string | null;
  createdAt: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      setProjects(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">项目管理</h1>
        <CreateProjectDialog onCreated={fetchProjects} />
      </div>

      {loading ? (
        <div className="flex h-[40vh] items-center justify-center text-muted-foreground">加载中...</div>
      ) : projects.length === 0 ? (
        <div className="flex h-[40vh] flex-col items-center justify-center text-center">
          <FolderGit2 className="h-12 w-12 text-muted-foreground mb-2" />
          <p className="text-muted-foreground">暂无项目</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card className="hover:bg-accent/50 transition-colors">
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <CardDescription className="text-xs truncate">{p.workDir}</CardDescription>
                  {p.gitRemote && (
                    <Badge variant="outline" className="mt-1 w-fit text-xs">{p.gitRemote}</Badge>
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
