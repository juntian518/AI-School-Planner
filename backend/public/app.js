const $ = id => document.getElementById(id);
let local = false, data = null, deviceToken = '', adminToken = '', busy = false, configured = false, connected = false;
let refreshId = 0;
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
  const preview = $('liveTime').checked ? timeString(new Date()) : $('previewTime').value;
  $('screenClock').textContent = preview || '--:--';
  $('screenDate').textContent = date || 'SCHOOL PLANNER';
  $('events').replaceChildren();
  if (!data) {
    $('dayCount').textContent = '0 项'; $('lessonTitle').textContent = '尚无可用课表'; $('lessonDetail').textContent = '连接并同步后查看当天安排。';
    $('lessonLabel').textContent = '等待数据'; $('nextTitle').textContent = '—'; $('nextTime').textContent = '';
    $('source').textContent = '未加载'; $('screenStatus').textContent = '尚无数据'; $('week').textContent = '—'; return;
  }
  const events = data.events;
  const current = events.filter(e => timeString(e.start) <= preview && preview < timeString(e.end));
  const next = events.find(e => timeString(e.start) > preview);
  const lesson = current[0];
  const title = e => e.title.split(/\s*\(/)[0];
  $('source').textContent = ({ arbor: 'ARBOR', demo: '演示数据', manual: '手动导入' }[data.source] || data.source);
  const week = events.find(e => e.week)?.week;
  $('week').textContent = week ? 'WEEK ' + week : '—';
  $('lessonLabel').textContent = lesson ? (current.length > 1 ? '当前 · ' + current.length + ' 项活动' : '当前课程') : '当前安排';
  $('lessonTitle').textContent = lesson ? title(lesson) : data.coverage === 'unknown' ? '该日期尚未同步' : next ? '课间 / 等待上课' : events.length ? '今天的课程已结束' : '今天没有课程';
  $('lessonDetail').textContent = lesson ? timeString(lesson.start) + ' – ' + timeString(lesson.end) + ' · ' + (lesson.location || '教室未提供') : '查看下方完整日程';
  $('nextTitle').textContent = next ? title(next) : '没有后续课程'; $('nextTime').textContent = next ? timeString(next.start) : '';
  const old = data.stale || Date.now() - Date.parse(data.receivedAt) > 3600000;
  $('screenStatus').textContent = (old ? '⚠ 数据已过期' : '已读取') + ' · ' + timeString(data.receivedAt);
  $('dayCount').textContent = events.length + ' 项';
  if (!events.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = data.coverage === 'unknown' ? '没有该日期的同步数据，不能确定当天是否有课。' : '已同步该日期，没有安排。'; $('events').append(p); }
  events.forEach(e => {
    const row = document.createElement('div'); row.className = 'event' + (current.includes(e) ? ' current' : '');
    const time = document.createElement('span'); time.textContent = timeString(e.start) + ' – ' + timeString(e.end);
    const info = document.createElement('div'); const name = document.createElement('strong'); name.textContent = title(e);
    const full = document.createElement('small'); full.textContent = e.title; info.append(name, full);
    const room = document.createElement('span'); room.className = 'room'; room.textContent = e.location || '未提供教室'; row.append(time, info, room); $('events').append(row);
  });
}
async function refresh() {
  const id = ++refreshId;
  const requestedDate = $('date').value;
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
    if ($('date').value < result.coverageStart || $('date').value > result.coverageEnd) $('date').value = result.coverageStart;
    await refresh(); }
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
  $('date').value = '2030-06-03'; $('previewTime').value = '09:00'; $('liveTime').checked = false; $('previewTime').disabled = false;
  data = { source: 'demo', receivedAt: new Date().toISOString(), coverage: 'covered', stale: false, events: [
    { id: 'demo-1', title: 'English (Demo)', location: 'Room A', start: '2030-06-03T07:40:00Z', end: '2030-06-03T08:30:00Z', week: 'A' },
    { id: 'demo-2', title: 'Mathematics (Demo)', location: 'Room B', start: '2030-06-03T08:30:00Z', end: '2030-06-03T09:20:00Z', week: 'A' },
    { id: 'demo-3', title: 'Science (Demo)', location: 'Lab 1', start: '2030-06-03T09:40:00Z', end: '2030-06-03T11:20:00Z', week: 'A' }
  ] };
  message('仅界面演示：虚构课表，不会写入或覆盖同步结果。点击刷新结果返回服务器数据。'); render();
});
$('syncButton').addEventListener('click', sync); $('refreshButton').addEventListener('click', refresh);
$('date').addEventListener('change', refresh); $('previewTime').addEventListener('input', render);
$('liveTime').addEventListener('change', () => { $('previewTime').disabled = $('liveTime').checked; render(); });
$('date').value = dateString(new Date()); $('previewTime').value = timeString(new Date()); $('previewTime').disabled = true;
function tick() { $('clock').textContent = timeString(new Date()); $('today').textContent = dateString(new Date()); render(); }
try { const response = await fetch('/api/local'); if (response.ok) { const mode = await response.json(); local = mode.local === true; configured = mode.configured === true; connected = mode.connected === true; if (connected || configured) $('connectionBadge').textContent = configured ? '本地凭据已配置' : '学校已连接'; } } catch {}
$('connectForm').hidden = !local || configured || connected; $('tokenForm').hidden = local;
$('connectionHelp').textContent = local ? (configured ? '已读取项目 .env.local · 每 30 分钟自动同步。' : '本地连接 · 请登录一次以验证服务器同步。') : '云端连接 · 输入设备密钥查看同步结果。';
tick(); setInterval(tick, 15000); if (local) await refresh();
