# 后端及模拟页面

运行 npm ci、npm test、npm run dev，打开 http://127.0.0.1:3000。
页面可查看同步状态、选择日期、模拟当前时间，并展示设备预览与完整课表。

## API

| 路径 | 方法 | 身份 |
|---|---|---|
| /api/schedule?date=YYYY-MM-DD | GET | DEVICE_TOKEN |
| /api/status | GET | DEVICE_TOKEN |
| /api/admin-sync | POST | ADMIN_TOKEN |
| /api/sync | GET | CRON_SECRET |
| /api/import | POST | ADMIN_TOKEN |

生产 API 使用 Authorization: Bearer 密钥，至少 32 字符。设备、管理、Cron 使用不同的随机密钥。响应均禁止共享缓存。

同步读取未来 14 天，失败返回非 2xx 并记录错误，保留已有快照。Redis 分布式锁避免并发重复登录和抓取。本地进程使用内存锁。同步状态的 succeededAt 表示最近一次成功，即使最新尝试失败也会保留。

source 可为 arbor、manual、demo；只有真实同步适配器可写入 arbor。手动导入只能使用 manual/demo，原子替换全部数据。fixtures/demo.json 为虚构格式样例。

coverage: unknown 表示所选日期未覆盖，不能解释为当天无课；stale 表示超过一小时没有更新。current 保留重叠活动。设备仍需按本地时钟更新课程，而非等待轮询。

## 本地登录

/api/connect 只存在于本地开发服务器，不是 Vercel Function。密码不落盘，只将登录会话保留在内存。接口要求本地 Cookie 且 POST Origin 必须精确匹配本地服务。只接受 Tiffin School 作为学校数据目的地，跨域重定向被拒绝。

本地服务自动读取根目录 .env.local 的 ARBOR_USERNAME/ARBOR_PASSWORD（兼容 user/pass）。配置时每 30 分钟自动同步。手工表单连接仅支持当前进程内主动同步。

本地服务自动为 API 注入临时密钥；不能作为对外部署服务器使用。在云端以环境变量提供学校用户名/密码，页面只处理设备及管理 token。

## 存储

本地文件 .data/schedule.json、.data/sync-status.json；生产使用 Upstash REST。预览/生产环境必须使用不同数据库，避免覆盖。学校凭据和原始登录响应不写入日程缓存。

真实学校登录与 14 天同步已在本地通过验证，页面结果已与学校日历对照。云端部署仍需配置 Vercel 环境变量及 Redis。参考 docs/arbor-integration.md。
