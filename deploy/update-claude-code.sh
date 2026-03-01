#!/bin/bash
# =============================================================================
# 更新 Claude Code CLI
# 用法: sudo bash update-claude-code.sh
# =============================================================================

set -euo pipefail

echo "当前版本:"
claude --version 2>/dev/null || echo "未安装"

echo ""
echo "正在更新 Claude Code CLI..."
npm update -g @anthropic-ai/claude-code

echo ""
echo "更新后版本:"
claude --version 2>/dev/null || echo "版本获取失败"

echo ""
echo "注意: Claude Code 更新不需要重启 claude-dispatch 服务。"
echo "新的 Claude CLI 版本将在下次命令执行时自动生效。"
