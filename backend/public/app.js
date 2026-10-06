const $ = id => document.getElementById(id);
let local = false, data = null, deviceToken = '', adminToken = '', busy = false, configured = false, connected = false;
let refreshId = 0, page = 0;
function shiftDate(value, days) {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const tomorrow = () => shiftDate(dateString(new Date()), 1);
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateString = d => dateFormat.format(d);
const timeString = d => timeFormat.format(new Date(d));
const formatStamp = value => value ? dateString(new Date(value)) + ' ' + timeString(value) : '—';
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
async function api(path, options = {}, admin = false) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json',
    ...(!local ? { Authorization: 'Bearer ' + (admin ? adminToken : deviceToken) } : {}), ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw Error(body.message || ({ unauthorized: '访问密钥不正确。', schedule_not_available: '还没有课表，请先同步 Arbor。', server_not_configured: '服务器环境变量尚未配置。' }[body.error] || body.error));
  return body;
}
function render() {
  const date = $('date').value;
  $('screenDate').textContent = date || 'SCHOOL PLANNER';
  $('screenHeading').textContent = date === tomorrow() ? '明天的安排' : '所选日期安排';
  $('events').replaceChildren(); $('screenEvents').replaceChildren();
  const events = data?.events || [];
  const title = e => e.title.split(/\s*\(/)[0];
  const pages = Math.max(1, Math.ceil(events.length / 4));
  page = Math.min(page, pages - 1);
  $('pageLabel').textContent = (page + 1) + ' / ' + pages;

  $('source').textContent = data ? ({ arbor: 'ARBOR', demo: '演示数据', manual: '手动导入' }[data.source] || data.source) : '未加载';
  const week = events.find(e => e.week)?.week;
  $('week').textContent = week ? 'WEEK ' + week : '—';
  $('dayCount').textContent = events.length + ' 项';
  $('screenSummary').textContent = events.length ? events.length + ' 项 · ' + timeString(events[0].start) + ' 开始' : '';
  const emptyText = !data ? '尚无可用课表，请同步后查看。' : data.coverage === 'unknown' ? '该日期尚未同步，不能确定是否有安排。' : '已同步该日期，没有安排。';
  if (!events.length) {
    for (const id of ['events', 'screenEvents']) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = emptyText; $(id).append(p); }
  }
  events.forEach((e, index) => {
    const row = document.createElement('div'); row.className = 'event';
    const time = document.createElement('span'); time.textContent = timeString(e.start) + ' – ' + timeString(e.end);
    const info = document.createElement('div'); const name = document.createElement('strong'); name.textContent = title(e);
    const full = document.createElement('small'); full.textContent = e.title; const teacher = document.createElement('small'); teacher.textContent = '老师：' + (e.staff || '暂无信息'); info.append(name, full, teacher);
    const room = document.createElement('span'); room.className = 'room'; room.textContent = e.location || '未提供教室'; row.append(time, info, room); $('events').append(row);
    if (index >= page * 4 && index < (page + 1) * 4) {
      const line = document.createElement('div'); line.className = 'screen-event';
      const t = document.createElement('span'); t.textContent = time.textContent;
      const n = document.createElement('strong'); n.textContent = title(e);
      const r = document.createElement('span'); r.textContent = e.location || '—';
      const course = document.createElement('div'); const teacher = document.createElement('small'); teacher.textContent = e.staff || '老师暂无信息'; course.append(n, teacher); line.append(t, course, r); $('screenEvents').append(line);
    }
  });
  $('screenStatus').textContent = !data ? '尚无数据' : (data.stale || Date.now() - Date.parse(data.receivedAt) > 26 * 3600000 ? '⚠ 数据已过期' : '已同步') + ' · ' + timeString(data.receivedAt);
}
async function refresh() {
  const id = ++refreshId;
  const requestedDate = $('date').value;
  data = null; page = 0; render();
  try {
    const status = await api('/api/status');
    if (id !== refreshId) return;
    $('attempt').textContent = formatStamp(status.attemptedAt); $('success').textContent = formatStamp(status.succeededAt);
    $('coverage').textContent = status.coverageStart ? status.coverageStart + ' → ' + status.coverageEnd : '—'; $('eventCount').textContent = status.eventCount ?? '—';
    if (status.error) message(status.error.message, true);
    const nextData = await api('/api/schedule?date=' + encodeURIComponent(requestedDate));
    if (id !== refreshId) return;
    data = nextData;
    if (!status.error) message(status.state === 'running' ? '正在同步，当前显示上次成功的课表。' : '已读取 ' + data.source + ' 课表。');
  } catch (error) { if (id !== refreshId) return; data = null; message(error.message, true); }
  render();
}
async function sync() {
  if (busy) return;
  busy = true; $('syncButton').disabled = true; message('正在从 Arbor 获取未来 14 天日程…');
  try { const result = await api('/api/admin-sync', { method: 'POST', body: '{}' }, true);
    if (data?.source === 'demo') $('date').value = tomorrow();
    await refresh();
    if (result.state === 'paused') message('学校同步已暂停，继续显示已保存的课表。');
    if (result.state === 'skipped') message('英国时间每日 21:00 更新；失败后 10 分钟重试。目前无需再次访问学校。'); }
  catch (error) { message(error.message, true); }
  finally { busy = false; $('syncButton').disabled = false; }
}
$('connectForm').addEventListener('submit', async event => {
  event.preventDefault(); $('connectButton').disabled = true; message('正在验证学校登录…');
  const password = $('password').value; $('password').value = '';
  try {
    await api('/api/connect', { method: 'POST', body: JSON.stringify({ username: $('username').value, password }) });
    $('connectionBadge').textContent = '学校已连接'; $('connectForm').hidden = true; $('connectionHelp').textContent = '会话仅保存在本机内存中。'; await sync();
  } catch (error) { message(error.message, true); }
  finally { $('connectButton').disabled = false; }
});
$('tokenForm').addEventListener('submit', event => { event.preventDefault(); deviceToken = $('deviceToken').value; adminToken = $('adminToken').value; $('deviceToken').value = ''; $('adminToken').value = ''; refresh(); });
$('demoButton').addEventListener('click', () => {
  ++refreshId;
  $('date').value = '2030-06-03'; page = 0;
  data = { source: 'demo', receivedAt: new Date().toISOString(), coverage: 'covered', stale: false, events: [
    { id: 'demo-1', title: 'English (Demo)', location: 'Room A', start: '2030-06-03T07:40:00Z', end: '2030-06-03T08:30:00Z', week: 'A' },
    { id: 'demo-2', title: 'Mathematics (Demo)', location: 'Room B', start: '2030-06-03T08:30:00Z', end: '2030-06-03T09:20:00Z', week: 'A' },
    { id: 'demo-3', title: 'Science (Demo)', location: 'Lab 1', start: '2030-06-03T09:40:00Z', end: '2030-06-03T11:20:00Z', week: 'A' }
  ] };
  message('仅界面演示：虚构课表，不会写入或覆盖同步结果。点击刷新结果返回服务器数据。'); render();
});
$('syncButton').addEventListener('click', sync); $('refreshButton').addEventListener('click', refresh);
$('date').addEventListener('change', refresh);
for (const [id, days] of [['previousDay', -1], ['nextDay', 1]]) $(id).addEventListener('click', () => { $('date').value = shiftDate($('date').value || tomorrow(), days); refresh(); });
$('tomorrowButton').addEventListener('click', () => { $('date').value = tomorrow(); refresh(); });
function navigateScreen(direction) {
  if (direction === 'left' || direction === 'right') {
    $('date').value = shiftDate($('date').value || tomorrow(), direction === 'left' ? 1 : -1);
    refresh();
  } else {
    const last = Math.max(0, Math.ceil((data?.events.length || 0) / 4) - 1);
    page = Math.max(0, Math.min(last, page + (direction === 'up' ? 1 : -1)));
    render();
  }
}
const screen = $('deviceScreen');
let gesture = null;
screen.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
  screen.setPointerCapture(event.pointerId);
});
screen.addEventListener('pointerup', event => {
  if (!gesture || gesture.id !== event.pointerId) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  gesture = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
  if (Math.abs(dx) > Math.abs(dy) * 1.2) navigateScreen(dx < 0 ? 'left' : 'right');
  else if (Math.abs(dy) > Math.abs(dx) * 1.2) navigateScreen(dy < 0 ? 'up' : 'down');
});
screen.addEventListener('pointercancel', () => { gesture = null; });
screen.addEventListener('lostpointercapture', () => { gesture = null; });
screen.addEventListener('keydown', event => {
  const direction = {ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[event.key];
  if (direction) { event.preventDefault(); navigateScreen(direction); }
});
$('date').value = tomorrow();
function tick() { $('clock').textContent = timeString(new Date()); $('today').textContent = dateString(new Date()); render(); }
try { const response = await fetch('/api/local'); if (response.ok) { const mode = await response.json(); local = mode.local === true; configured = mode.configured === true; connected = mode.connected === true; if (connected || configured) $('connectionBadge').textContent = configured ? '本地凭据已配置' : '学校已连接'; } } catch {}
$('connectForm').hidden = !local || configured || connected; $('tokenForm').hidden = local;
$('connectionHelp').textContent = local ? (configured ? '已读取项目 .env.local · 英国时间每日 21:00 同步，失败 10 分钟后重试。' : '本地连接 · 请登录一次以验证服务器同步。') : '云端连接 · 输入设备密钥查看同步结果。';
tick(); setInterval(tick, 15000); if (local) await refresh();
