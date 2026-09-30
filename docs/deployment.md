# Vercel + Supabase Data API 部署

1. 导入 juntian518/AI-School-Planner，Root Directory=backend，Framework=Other，Node.js=22.x。
2. Supabase multi-projects 项目执行 backend/migrations/001_supabase.sql，再执行 002_supabase_data_api.sql。
3. Data API Settings 的 Exposed schemas 中追加 ai_school_planner，保留其他项目已有 schema。表启用 RLS，anon/authenticated 无访问权限；仅 service_role 可访问，并调用两项原子同步锁 RPC。
4. Vercel Production 设置 STORAGE_DRIVER=supabase、SUPABASE_URL、SUPABASE_SECRET_KEY（sb_secret_ 开头的服务端 Secret Key）。无需数据库密码，也无需 Upstash。Secret Key 具有项目级权限，不能发送给浏览器或 ESP32。
5. 设置独立随机 DEVICE_TOKEN、ADMIN_TOKEN、CRON_SECRET（各至少32字符），以及 ARBOR_STUDENT_ID=8408、ARBOR_USERNAME、ARBOR_PASSWORD。
6. 部署后打开模拟页，输入设备密钥和管理密钥，点击“立即同步 Arbor”，核对课表。

所有真实环境变量只保存在本地 .env.local 和 Vercel 服务端配置，不上传 GitHub。修改云端变量后重新部署。预览部署不要使用生产凭据和数据库。

vercel.json 每分钟调用 /api/sync 检查调度，以 CRON_SECRET 鉴权；只有 Europe/London 每日16:00到点且当天未成功，或上次失败已满10分钟，才访问学校。检查本身不访问 Arbor。重试会在满10分钟后的首个调度触发执行，通常额外等待不足1分钟。成功后停止当天重试。管理员同步入口也遵守相同限制。同步锁有效330秒；函数最长300秒。同步失败保留完整旧快照。

本地默认使用文件存储。根目录 .env.local 设置 STORAGE_DRIVER=supabase 后重启即可使用 Data API。浏览器和 ESP32 始终访问本项目后端，不接触 Supabase Secret Key。

保留兼容驱动：STORAGE_DRIVER=postgres 搭配 SUPABASE_DATABASE_URL 为直接数据库连接；STORAGE_DRIVER=redis 为原 Upstash 适配。推荐使用上述 Data API 配置。

参考：[Supabase API Keys](https://supabase.com/docs/guides/getting-started/api-keys)、[自定义 schema](https://supabase.com/docs/guides/api/using-custom-schemas)。
