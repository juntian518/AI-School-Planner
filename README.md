# AI School Planner

ESP32-S3 学校日程显示器：Arbor → Vercel 后端与缓存 → 设备/浏览器预览。

## 已实现

- Arbor HTTP 登录适配器，从返回的页面配置发现日历端点与学生过滤条件。
- 按英国当地日期读取未来 14 天日程，解析科目、时间、教室、A/B 周。
- 完整快照校验后替换缓存；失败保留旧数据；同步锁与状态记录。
- 设备鉴权、管理同步接口、Supabase/Redis/本地文件存储。
- 浏览器模拟页：480×320 屏幕预览、完整课表、日期与时间切换、同步状态。
- 独立演示模式：虚构数据只存在页面内存，不覆盖课表。

**已通过真实学校账号的本地登录、14 天课表读取、缓存和模拟页显示验证。Vercel 云端部署及 ESP32 可烧录固件尚未完成。**

## 本地运行

Node.js 22，在 backend 目录：

```powershell
npm ci
npm test
npm run dev
```

打开 http://127.0.0.1:3000 。启动时自动读取项目根目录 .env.local（支持 ARBOR_USERNAME/ARBOR_PASSWORD，也兼容 user/pass）。该文件已被 Git 忽略。配置凭据后每 30 分钟自动同步，也可点击立即同步。本地模式无需手工配置设备密钥；仅监听回环地址，以 HttpOnly 会话 Cookie 和 Origin 检查保护接口。页面输入的学校密码仅在登录请求期间使用，学校会话保存在进程内存，重启后需重新连接。默认课表保存在 Git 忽略的 backend/.data；显式配置 STORAGE_DRIVER=supabase 后使用云端数据库。

如果暂时不登录，点击「预览演示课表」即可体验设备显示。服务器重启后请刷新页面以更新本地会话。

## 云端

Vercel 根目录设为 backend；在服务端环境变量中配置学校账户、Supabase 与独立访问密钥。云端页面使用设备/管理密钥访问 API，不提供公开学校密码表单。参见 [部署说明](docs/deployment.md)。

## 目录

- backend/：API、Arbor 适配器、浏览器模拟页、测试。
- firmware/：硬件信息与后续固件要求。
- docs/：部署与数据接入说明。
- private/、.data/、.env：本地私有文件，已忽略。

仓库：https://github.com/juntian518/AI-School-Planner
