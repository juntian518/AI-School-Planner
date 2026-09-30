# Vercel 部署

1. 导入 juntian518/AI-School-Planner，Root Directory=backend，Framework=Other，Node.js=22.x。静态页面位于 public，API 位于 api。
2. 为生产环境准备 Upstash Redis，设置 UPSTASH_REDIS_REST_URL、UPSTASH_REDIS_REST_TOKEN、STORAGE_DRIVER=redis。
3. 设置独立随机 DEVICE_TOKEN、ADMIN_TOKEN、CRON_SECRET（至少 32 字符）。
4. 设置 ARBOR_STUDENT_ID、ARBOR_USERNAME、ARBOR_PASSWORD。学校密码只放服务端环境变量，不进入 Git 或页面代码。
5. 部署后打开页面，输入设备密钥和管理密钥，点击「立即同步 Arbor」。
6. 验证 source=arbor、日期覆盖完整、科目/时间/教室与学校一致。
7. vercel.json 已配置以下定时任务：每 30 分钟调用 /api/sync。请在第一次生产部署时配置齐全环境变量；若暂时不准备同步，可先移除 crons。

```json
{ "crons": [{ "path": "/api/sync", "schedule": "*/30 * * * *" }] }
```

Cron 使用 CRON_SECRET 验证。同步函数最长配置为 300 秒，Redis 锁有效期 330 秒。同步失败保留上一次日程。连接过期、上游格式变化等错误在模拟页显示。

预览环境请禁用学校凭据或使用独立数据库，避免与生产共享日程及状态。不要关闭 Vercel 的其他安全功能来让设备访问；如部署保护拦截设备，需按账户实际设置配置受支持的机器访问方式。

参考：[Vercel Functions](https://vercel.com/docs/functions/runtimes/node-js)、[Cron 管理](https://vercel.com/docs/cron-jobs/manage-cron-jobs)、[Upstash REST](https://upstash.com/docs/redis/features/restapi)。
