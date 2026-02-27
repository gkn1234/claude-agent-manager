import { execSync } from 'child_process';
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';

export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

export function getGitRemote(dir: string): string | null {
  try {
    return execSync('git remote get-url origin', { cwd: dir, encoding: 'utf-8' }).trim() || null;
  } catch {
    return null;
  }
}

export function gitClone(url: string, targetDir: string): void {
  execSync(`git clone "${url}" "${targetDir}"`, { encoding: 'utf-8' });
}

export function gitInit(dir: string): void {
  execSync('git init', { cwd: dir, encoding: 'utf-8' });
}

export function ensureGitignoreEntry(dir: string, entry: string): void {
  const gitignorePath = join(dir, '.gitignore');
  let content = '';
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf-8');
  }
  if (!content.includes(entry)) {
    appendFileSync(gitignorePath, `\n${entry}\n`);
  }
}
