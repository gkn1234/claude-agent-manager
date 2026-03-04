# 版本发布

发布新版本到 GitHub。参数 $ARGUMENTS 为版本号（如 `1.0.2`），不填则自动推断。

## 流程

### 1. 分析变更

并行执行：

```bash
# 获取最新 tag 作为基准
LAST_TAG=$(git describe --tags --abbrev=0)

# 查看自上个 tag 以来的提交
git log ${LAST_TAG}..HEAD --oneline

# 查看文件变更统计
git diff ${LAST_TAG}..HEAD --stat
```

若无新提交，告知用户无需发布并终止。

### 2. 确定版本号

若 $ARGUMENTS 已提供版本号，直接使用。否则根据变更内容推断：

| 变更类型 | 版本升级 | 示例 |
|----------|---------|------|
| 仅 fix / docs / refactor | patch (x.y.Z) | 1.0.0 → 1.0.1 |
| 含 feat（新功能） | minor (x.Y.0) | 1.0.1 → 1.1.0 |
| 含 BREAKING CHANGE | major (X.0.0) | 1.1.0 → 2.0.0 |

使用 AskUserQuestion 确认版本号。

### 3. 生成 CHANGELOG

读取 `CHANGELOG.md` 现有格式，按以下分类整理提交：

| Conventional Commits 前缀 | CHANGELOG 分类 |
|---------------------------|---------------|
| feat: | Features |
| fix: | Bug Fixes |
| refactor: | Refactoring |
| docs: | Documentation |
| perf: | Performance |
| chore: / ci: | 一般不列入，除非有重要变更 |

规则：
- 每条用中文简述变更内容和影响，不是直接复制 commit message
- 在 `## [上个版本]` 之前插入新版本段落
- 日期格式 YYYY-MM-DD

### 4. 更新版本号

修改 `package.json` 中的 `"version"` 字段。

### 5. 提交与打 Tag

```bash
git add package.json CHANGELOG.md
git commit -m "chore: release v<VERSION>"
git tag v<VERSION>
```

### 6. 推送与发布

```bash
git push origin main
git push origin v<VERSION>
```

使用 `gh release create` 创建 GitHub Release：
- title: `v<VERSION>`
- body: 从 CHANGELOG 中提取当前版本的内容，精简为 Release Notes
- 末尾附 Full Changelog 比较链接：`https://github.com/gkn1234/claude-agent-manager/compare/v<PREV>...v<VERSION>`

### 7. 确认

输出：
- 版本号
- commit hash
- GitHub Release URL
