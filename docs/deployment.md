# 部署到 Vercel

1. 将代码同步到用户指定仓库 `juntian518/AI-School-Planner`。
2. 在已有的 Vercel Pro 团队导入该仓库。Root Directory: `backend`，Framework: Other，Node: 22.x；无需自定义构建命令。
3. 准备 Upstash Redis，将 REST URL/token 填入 Vercel 的生产环境变量。
4. 设置 `STORAGE_DRIVER=redis`，独立随机 `DEVICE_TOKEN`、`ADMIN_TOKEN`、`CRON_SECRET`（至少 32 字符）。不要提交到 Git。
5. 部署并验证：未鉴权 GET /api/schedule 应为 401；已鉴权但无数据应为 503。用 demo 快照完成导入/查询验证后再换成真实数据。
6. 当前 `/api/sync` 会返回 501。确认真实 Arbor 数据读取、重新登录、失败保留缓存后，再添加每 30 分钟 Cron。当前不启用空跑定时任务。
7. 将部署域名和 DEVICE_TOKEN 配置给后续固件，保持 HTTPS 证书验证。

本地测试通过不等于云端部署已通过。Vercel、Redis 和真实硬件必须分别验证。
