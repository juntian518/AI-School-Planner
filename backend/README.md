# Backend API

Node.js 22，无运行时第三方依赖。Vercel Root Directory 设为 `backend`，Framework Preset 为 Other。

## API

| 路径 | 方法 | 身份 | 用途 |
|---|---|---|---|
| `/api/schedule?date=YYYY-MM-DD` | GET | DEVICE_TOKEN | 读取选定的英国当地日期；省略日期为今天 |
| `/api/import` | POST | ADMIN_TOKEN | 原子替换完整日程快照，非增量合并 |
| `/api/sync` | GET | CRON_SECRET | 预留自动同步入口，目前返回 501 |

每个请求通过 `Authorization: Bearer <token>` 传递密钥。密钥至少 32 字符，三者必须自行设为不同的随机值。设备只持有 DEVICE_TOKEN。所有响应禁止共享缓存。

`fixtures/demo.json` 定义完整导入格式（虚构数据）。日期范围是“已知已读取完整”的范围，空日程不代表读取失败。`coverage: unknown` 表示查询日期未覆盖，不能显示为“当天无课”。`stale: true` 表示超过一小时未导入。`receivedAt` 是服务器收到数据的时间，不是假称的 Arbor 同步时间。

`current` 是数组，保留可能重叠的活动；`next` 是所查询的今天内下一项活动，非今天的查询返回空值。完整 `events` 始终保留，设备应根据网络校时后的本地时钟自行更新当前课程，而不是等下一次轮询。

## 本地导入示例（PowerShell）

先按根目录说明创建 `.env` 并启动服务。在另一终端的 backend 目录输入：

```powershell
$adminToken = Read-Host 'ADMIN_TOKEN'
Invoke-RestMethod -Uri http://127.0.0.1:3000/api/import -Method Post -Headers @{ Authorization = "Bearer $adminToken" } -ContentType application/json -InFile fixtures/demo.json
$deviceToken = Read-Host 'DEVICE_TOKEN'
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/schedule?date=2030-06-03' -Headers @{ Authorization = "Bearer $deviceToken" }
```

## 存储

- 本地：`STORAGE_DRIVER=file`；`.data/schedule.json` 原子替换，重启保留。
- Vercel：`STORAGE_DRIVER=redis`，设置 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`。
- Redis 保存单个完整快照，不设 TTL：失败时保留旧课表，并通过 stale 标识其时效。
- 单家庭、单设备密钥版本。生产/预览环境必须使用独立数据库或禁用预览写入，避免互相覆盖。

当前无自动同步，也没有启用 Cron。部署后需导入数据才能使用查询接口。不会自动创建云资源或产生后台抓取。

参考：[Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)、[Upstash REST](https://upstash.com/docs/redis/features/restapi)。
