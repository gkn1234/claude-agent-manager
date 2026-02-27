import { db } from './db';
import { config } from './schema';
import { eq } from 'drizzle-orm';

const CONFIG_DEFAULTS: Record<string, string> = {
  max_concurrent: '2',
  command_timeout: '1800',
  log_retention_days: '30',
  poll_interval: '5',
  research_prompt: `你正在一个任务派发系统中工作。初始化已完成，请在当前工作区中进行需求调研和分析：

1. 快速理解项目的技术栈、目录结构和核心模块
2. 仔细分析任务描述，明确需求目标和验收标准
3. 定位与任务相关的代码区域，评估影响范围
4. 识别潜在的技术风险、依赖关系和实现约束
5. 给出需求分析结论：需求是否清晰、是否需要拆分、建议的实现方向

任务描述：{description}`,
  init_prompt: `你正在一个任务派发系统中工作。请基于以下任务描述完成初始化：

1. 检查项目工作目录 {workDir} 下的 .gitignore 文件，确保 .worktrees/ 已被忽略。如果没有，请添加该条目
2. 在项目工作目录 {workDir} 下的 .worktrees/ 目录中创建 git worktree 作为本任务的工作空间
3. 分支命名：请根据项目命名规范和任务描述自主决定分支名称。建议使用 feat/、fix/、chore/ 等前缀加简短描述的格式（如 feat/add-user-auth），保持简洁、有意义、符合团队惯例
4. 理解项目结构
5. 如果任务过于庞大，请通过 MCP create_task 工具拆分为多个子任务

任务描述：{description}`,
};

export const CONFIG_KEYS = Object.keys(CONFIG_DEFAULTS) as Array<keyof typeof CONFIG_DEFAULTS>;

export function getConfig(key: string, defaultValue?: string): string {
  const row = db.select().from(config).where(eq(config.key, key)).get();
  if (row) return row.value;
  return defaultValue ?? CONFIG_DEFAULTS[key] ?? '';
}

export function setConfig(key: string, value: string): void {
  db.insert(config)
    .values({ key, value })
    .onConflictDoUpdate({ target: config.key, set: { value } })
    .run();
}

export function getAllConfig(): Record<string, string> {
  const rows = db.select().from(config).all();
  const result: Record<string, string> = { ...CONFIG_DEFAULTS };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
