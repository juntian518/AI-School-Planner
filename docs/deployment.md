# Vercel + Supabase 部署

1. 导入 juntian518/AI-School-Planner，Root Directory=backend，Framework=Other，Node.js=22.x。
2. 在 Supabase 的 multi-projects 项目中执行 `backend/migrations/001_supabase.sql`。专用 schema 为 `ai_school_planner`，含课表快照、同步状态、同步锁三张表。此步骤需实际执行，提交迁移文件不会自动建表。
3. 从 Supabase Connect 面板获取 transaction pooler 连接串（通常端口 6543），配置服务端 `SUPABASE_DATABASE_URL` 和 `STORAGE_DRIVER=supabase`。连接串密码中的特殊字符需要 URL 编码。客户端关闭 prepared statements，强制验证 TLS 证书。
4. 配置独立随机 `DEVICE_TOKEN`、`ADMIN_TOKEN`、`CRON_SECRET`（各至少 32 字符）。
5. 配置 `ARBOR_STUDENT_ID=8408`、`ARBOR_USERNAME`、`ARBOR_PASSWORD`。全部敏感值仅保存在 Vercel Production 环境变量；不要提交 Git。
6. 部署后打开模拟页，输入设备密钥和管理密钥，点击“立即同步 Arbor”，验证日期覆盖、科目、时间与教室。

数据库 schema 不加入 Data API 的 Exposed schemas，不向 anon/authenticated 授权；浏览器和 ESP32 通过 Vercel API 访问。后端数据库连接必须具有该 schema 的读写权限（SQL Editor 创建的表默认由 postgres 拥有）。学校密码不存数据库。

vercel.json 已配置每 30 分钟调用 /api/sync，使用 CRON_SECRET 验证。同步锁 330 秒，函数最长 300 秒。数据库完整快照不自动过期，同步失败保留上次课表。

本地默认仍使用文件存储；根目录 .env.local 可设置 STORAGE_DRIVER=supabase 和 SUPABASE_DATABASE_URL 后重启服务进行云端存储联调。未配置时不会自动切换或上传本地课表。

预览部署不要使用生产学校凭据及数据库。已有 Redis 适配保留兼容，但采用 Supabase 后无需配置 Upstash。

参考：[Supabase 连接指南](https://supabase.com/docs/guides/database/connecting-to-postgres)、[Vercel Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs)。
