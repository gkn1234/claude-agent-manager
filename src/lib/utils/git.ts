import { execFileSync, execFile as execFileCb } from 'child_process';
import { existsSync, readFileSync, appendFileSync, rmSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFileCb);

const CLONE_TIMEOUT_MS = 120_000; // 120 seconds

export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

export function getGitRemote(dir: string): string | null {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf-8' }).trim() || null;
  } catch {
    return null;
  }
}

export async function gitClone(url: string, targetDir: string): Promise<void> {
  try {
    await execFileAsync('git', ['clone', url, targetDir], {
      encoding: 'utf-8',
      timeout: CLONE_TIMEOUT_MS,
    });
  } catch (e) {
    // Clean up partially-cloned directory
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    const err = e as Error & { killed?: boolean };
    if (err.killed) {
      throw new Error(`git clone 超时（${CLONE_TIMEOUT_MS / 1000}s），已清理残留目录`);
    }
    throw e;
  }
}

export function gitInit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, encoding: 'utf-8' });
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
