# AI School Planner

ESP32-S3 学校日程显示器。后端部署到 Vercel，设备通过 HTTPS 获取日程。

## 当前进度

- 已实现：设备鉴权、日程 JSON 校验、Europe/London 日期处理、当前/下一节课程、缓存过期标记、手动导入、Upstash Redis 存储适配、本地运行及测试。
- 已确认：Arbor 浏览器日历可显示课程时间、教室、Week A/B，并有 Printable Timetable 入口。
- **尚未实现：Arbor 自动登录/续期与自动抓取、屏幕固件、实际 Vercel 部署。** `/api/sync` 返回明确的 501，不会假报同步成功。
- 仓库只包含虚构的测试数据，不包含真实学生课表、账户或 Cookie。

## 本地运行（Node.js 22）

在 `backend` 目录执行：

```powershell
Copy-Item .env.example .env
# 编辑 .env，给 DEVICE_TOKEN、ADMIN_TOKEN、CRON_SECRET 设置不同的随机值（至少 32 字符）
npm test
npm run dev
```

打开终端提示的本地地址查看接口说明。默认仅监听 `127.0.0.1`，本地文件缓存放在被 Git 忽略的 `.data` 中。API 使用说明见 [backend/README.md](backend/README.md)。

## 项目结构

- `backend/`：Vercel Node.js Functions，无第三方运行时依赖。
- `firmware/`：硬件信息与固件开发边界；尚无可烧录固件。
- `docs/`：部署步骤与 Arbor 接入调查记录。

GitHub: https://github.com/juntian518/AI-School-Planner

