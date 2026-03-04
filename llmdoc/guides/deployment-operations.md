# How to Deploy and Operate Claude Dispatch

部署和日常运维 Claude Dispatch 的操作指南。涵盖首次部署、应用更新、CLI 更新和服务管理。

1. **首次环境初始化:** 在目标服务器上执行 `sudo bash deploy/setup-ec2.sh [可选目录]`。默认应用目录为 `~/claude-agent-manager-source`。脚本完成后 systemd 服务已注册但未启动。参考 `deploy/setup-ec2.sh`。

2. **配置环境变量:** 在应用目录下创建 `.env` 文件，至少包含 `AUTH_PASSWORD` 和 `AUTH_SECRET`。参考 `/llmdoc/reference/config-keys.md` 获取完整变量列表。
   ```bash
   # 在 APP_DIR 下执行
   cat >> .env << 'EOF'
   AUTH_PASSWORD=your_password
   AUTH_SECRET=$(openssl rand -hex 32)
   EOF
   ```

3. **首次部署:** 执行 `bash deploy/deploy.sh`，脚本自动完成 git pull -> pnpm install -> build -> restart。部署成功后访问 `http://<server-ip>:3000`。

4. **更新应用代码:** 同样执行 `bash deploy/deploy.sh`，流程与首次部署一致。参考 `deploy/deploy.sh`。

5. **更新 Claude Code CLI:** 执行 `sudo bash deploy/update-claude-code.sh`。不需要重启服务，新版本在下次命令执行时自动生效。参考 `deploy/update-claude-code.sh`。

6. **日常服务管理:** 使用标准 systemctl 命令。服务名为 `claude-agent-manager`。
   - 启停重启: `sudo systemctl start|stop|restart claude-agent-manager`
   - 查看状态: `systemctl status claude-agent-manager`
   - 实时日志: `journalctl -u claude-agent-manager -f`
   - 数据库备份: `sqlite3 <APP_DIR>/data/dispatch.db ".backup /tmp/dispatch-backup.db"`

7. **验证部署成功:** 执行 `systemctl is-active claude-agent-manager` 返回 `active`，且 `curl http://localhost:3000` 返回 HTTP 响应（未认证时重定向到 `/login`）。
