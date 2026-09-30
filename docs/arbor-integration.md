# Arbor 同步

## 已观察的协议

公开前端代码中，登录 POST /auth/login，JSON 为 items 数组中的 username/password。日历控件使用自身 dataUrl，POST action_params 包含 view、startDate、endDate、filters。返回 items[0].fields.response.value.pages，每页包含 HTML。

先访问学校首页初始化 mis 会话，再登录。日历页面配置使用 /guardians/student-ui/calendar/id/{id}?format=javascript，返回 JSON 内容。实际组件为 Arbor.calendar.Calendar，props 提供 referenceObjectTypeId/referenceObjectId；未覆盖 dataUrl 时使用已核对的前端默认 /calendar-entry/list-static/format/json/。所有请求固定限制为 Tiffin School 同源 HTTPS，Cookie 由 tough-cookie 管理。

已检查实际日视图 DOM：table.mis-cal-day、.mis-cal-event、data-eventid、.mis-cal-event-time、.title、data-datetime。日历提供英国当地时间，转换为 UTC 后保存。A/B 周从标题获取。HTML 只进行文本解析，不作为脚本执行。

## 完整性

读取未来 14 天，每天必须有对应日期的合法日视图。利用上游附带的相邻页减少请求，校验完整范围后才替换快照。任何单日格式错误均使同步失败，避免部分成功丢失原课表。

空课表必须有合法日期表格。登录页、错误页、日期不符、缺失标题或时间、当前不支持的全天事件会报告错误，保留旧快照。夏令时重叠/不存在的当地时间也拒绝自动猜测。

## 登录与部署边界

- 本地：用户在连接页输入账户，密码不保存，Cookie 只保留在服务进程内存。
- 云端：学校账户由 Vercel 环境变量提供，每次同步建立新的会话。
- 如果学校需要额外 SSO、验证码或同意条款，适配器不会绕过，需调整接入方式。
- 已通过模拟 HTTP/解析测试，以及真实账户的本地登录、14 天读取、缓存和页面显示验证。
- Vercel 云端环境尚未部署验收，需单独验证网络访问和 Redis。
- Cookie/JWT 在学校升级后可能改变；必须以实际验收结果为准。

## 参考

Waveshare/学校网页与公开 JS 的读取是调查依据，不是 Arbor 官方开放 API 承诺。
实现前端协议的适配器可能随学校升级而需要维护。
