const $ = s => document.querySelector(s);
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const stacked = matchMedia('not ((min-width: 880px) and (min-height: 560px))');
const PPM = 20;
const NAMES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const ASSORTED = { id: 'assorted', title: 'Assorted work', db: null };

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem('pomodo.' + k)) ?? d } catch { return d } },
  set: (k, v) => { try { localStorage.setItem('pomodo.' + k, JSON.stringify(v)) } catch {} },
};
const cfg = { db: null, doneProp: null, countProp: null, hide: {}, focus: 25, short: 5, long: 15, every: 4, auto: false, sound: true, ...store.get('cfg', {}) };
const saveCfg = () => store.set('cfg', cfg);
const full = m => cfg[m] * 6e4;

let mode = 'focus', running = false, endAt = 0, left = 0, timer = 0, lastS = -1, ac;
let round = store.get('round', 0), current = store.get('current', null), schema = null, tasks = [];

/* ---------- Timer ---------- */

const saveTimer = () => store.set('timer', { mode, left, endAt, running });

function draw() {
  $('#scale').style.transform = `translateX(${-(full(mode) - left) / 6e4 * PPM}px)`;
  const s = Math.ceil(left / 1000);
  if (s === lastS) return;
  lastS = s;
  const m = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0');
  $('#lead').textContent = m < 10 ? '0' : '';
  $('#mm').textContent = m;
  $('#ss').textContent = ss;
  document.title = running ? `${m}:${ss} · ${NAMES[mode]}` : 'PomoDo.';
}

function renderMeta() {
  root.dataset.mode = mode;
  $('meta[name=theme-color]').content = getComputedStyle(root).getPropertyValue('--bg').trim();
  $('#mode').textContent = NAMES[mode];
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-selected', b.dataset.m === mode);
  $('#dots').replaceChildren(...Array.from({ length: cfg.every }, (_, i) => Object.assign(document.createElement('i'), { className: i < round ? 'on' : '' })));
  $('#sub').textContent = mode === 'focus' ? `Round ${Math.min(round + 1, cfg.every)} of ${cfg.every}` : mode === 'short' ? 'Stand up. Look away.' : 'Step away properly.';
  $('#nowLabel').textContent = mode === 'focus' ? 'Now focusing' : 'Up next';
  $('#task').textContent = current?.title || 'Pick a task';
  $('#go').textContent = running ? 'Pause' : left < full(mode) ? 'Resume' : 'Start';

  const mins = cfg[mode], step = mins <= 10 ? 1 : 5, sc = $('#scale');
  sc.style.width = mins * PPM + 1 + 'px';
  sc.style.setProperty('--major', step * PPM + 'px');
  sc.replaceChildren(...Array.from({ length: Math.floor(mins / step) + 1 }, (_, i) =>
    Object.assign(document.createElement('i'), { textContent: i * step, style: `left:${i * step * PPM}px` })));
  lastS = -1;
  draw();
}

function setMode(m, from = $('#go')) {
  clearTimeout(timer);
  running = false; mode = m; left = full(m);
  saveTimer();
  const apply = () => {
    renderMeta();
    document.body.classList.remove('swap');
    void document.body.offsetWidth;
    document.body.classList.add('swap');
  };
  if (!document.startViewTransition || reduced.matches || document.hidden) return apply(), Promise.resolve();
  const r = from.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  root.style.setProperty('--x', x + 'px');
  root.style.setProperty('--y', y + 'px');
  root.style.setProperty('--r', Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 'px');
  const vt = document.startViewTransition(apply);
  vt.ready.catch(() => {});
  vt.finished.catch(() => {});
  return vt.updateCallbackDone;
}

function loop() {
  if (!running) return;
  left = Math.max(0, endAt - Date.now());
  draw();
  requestAnimationFrame(loop);
}

function start() {
  if (running) return;
  running = true;
  endAt = Date.now() + left;
  timer = setTimeout(complete, left);
  saveTimer(); renderMeta();
  requestAnimationFrame(loop);
}

function pause() {
  if (!running) return;
  clearTimeout(timer);
  left = Math.max(0, endAt - Date.now());
  running = false;
  saveTimer(); renderMeta();
}

function complete() {
  const was = mode;
  running = false; left = 0;
  chime();
  if (document.hidden && window.Notification?.permission === 'granted')
    new Notification(`${NAMES[was]} complete`, { body: was === 'focus' ? 'Time for a break.' : 'Back to focus.', silent: true });
  advance(true);
}

function advance(counted) {
  let next = 'focus';
  if (mode === 'focus') {
    if (counted) { round++; if (current) logPomo(current); }
    next = round >= cfg.every ? 'long' : 'short';
  } else if (mode === 'long') round = 0;
  store.set('round', round);
  // A view transition waits for the next painted frame, which never comes while the window is covered.
  const shown = Promise.race([setMode(next), new Promise(r => setTimeout(r, 1000))]);
  shown.then(() => counted && cfg.auto && start());
}

function unlockAudio() {
  if (cfg.sound && !ac) ac = new AudioContext();
  ac?.resume();
}

function chime() {
  if (!cfg.sound || !ac) return;
  const t0 = ac.currentTime;
  [988, 784, 988].forEach((f, i) => {
    const o = ac.createOscillator(), g = ac.createGain(), t = t0 + i * .2;
    o.frequency.value = f;
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(.2, t + .02);
    g.gain.exponentialRampToValueAtTime(1e-4, t + .5);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + .55);
  });
}

/* ---------- Notion ---------- */

async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'x-pomodo': '1', ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Request failed (${r.status})`);
  return j;
}

const plain = (rt = []) => rt.map(t => t.plain_text).join('');
const prop = n => n && schema?.props.find(p => p.name === n);

function groups(p) {
  const name = Object.fromEntries(p.status.options.map(o => [o.id, o.name]));
  const g = k => p.status.groups.find(x => x.name === k)?.option_ids.map(i => name[i]) || [];
  const done = g('Complete'), doing = g('In progress'), hidden = cfg.hide[schema?.id] || [];
  return {
    todo: g('To-do'),
    active: doing.find(n => /in progress/i.test(n)) || doing.find(n => !hidden.includes(n)),
    done: done.length ? done : p.status.options.filter(o => /done|complete/i.test(o.name)).map(o => o.name),
  };
}

async function listDbs() {
  const { results } = await api('POST', '/v1/search', { filter: { property: 'object', value: 'database' }, page_size: 100 });
  return results.map(d => ({ id: d.id, name: plain(d.title) || 'Untitled' }));
}

async function loadSchema(id) {
  const d = await api('GET', '/v1/databases/' + id);
  const props = Object.values(d.properties);
  return { id, props, title: props.find(p => p.type === 'title')?.name };
}

const guessCount = s => s.props.find(p => p.type === 'number' && /pomo|session|focus/i.test(p.name))?.name ?? null;

function autoProps(s) {
  const is = (n, types) => types.includes(s.props.find(p => p.name === n)?.type);
  if (!is(cfg.doneProp, ['status', 'checkbox']))
    cfg.doneProp = (s.props.find(p => p.type === 'status') || s.props.find(p => p.type === 'checkbox'))?.name || '';
  if (cfg.countProp !== '' && !is(cfg.countProp, ['number'])) cfg.countProp = guessCount(s);
}

async function loadTasks() {
  const done = prop(cfg.doneProp), count = prop(cfg.countProp);
  let filter;
  if (done?.type === 'checkbox') filter = { property: done.name, checkbox: { equals: false } };
  else if (done?.type === 'status') {
    const skip = [...groups(done).done, ...(cfg.hide[schema.id] || [])];
    if (skip.length) filter = { and: skip.map(n => ({ property: done.name, status: { does_not_equal: n } })) };
  }
  const out = [];
  let cursor;
  do {
    const r = await api('POST', `/v1/databases/${schema.id}/query`, {
      page_size: 100,
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      ...(filter && { filter }),
      ...(cursor && { start_cursor: cursor }),
    });
    out.push(...r.results);
    cursor = r.has_more && r.next_cursor;
  } while (cursor && out.length < 300);

  tasks = out.map(p => ({
    id: p.id,
    title: plain(p.properties[schema.title]?.title) || 'Untitled',
    count: count ? p.properties[count.name]?.number ?? 0 : null,
    status: done && p.properties[done.name]?.status?.name,
  }));
  if (current?.db === schema.id) {
    const t = tasks.find(x => x.id === current.id);
    current = t ? { ...current, title: t.title } : null;
    store.set('current', current);
    $('#task').textContent = current?.title || 'Pick a task';
  }
  renderTasks();
}

async function write(id, properties) {
  try { await api('PATCH', '/v1/pages/' + id, { properties }); return true }
  catch (e) { toast(e.message); return false }
}

function renderTasks() {
  const list = $('#list'), canFinish = !!prop(cfg.doneProp);
  $('#count').textContent = $('#sideCount').textContent = tasks.length;
  const general = document.createElement('li'), gp = document.createElement('button');
  general.className = 'assorted' + (current?.id === ASSORTED.id ? ' on' : '');
  gp.className = 'pick';
  gp.textContent = ASSORTED.title;
  gp.append(Object.assign(document.createElement('sup'), { textContent: 'not logged' }));
  gp.onclick = () => choose(ASSORTED);
  general.append(gp);
  if (!tasks.length) return list.replaceChildren(general, empty('Nothing open. Add a task below.'));
  list.replaceChildren(general, ...tasks.map(t => {
    const li = document.createElement('li'), pick = document.createElement('button');
    li.classList.toggle('on', t.id === current?.id);
    pick.className = 'pick';
    pick.textContent = t.title;
    if (t.count != null) pick.append(Object.assign(document.createElement('sup'), { textContent: t.count }));
    pick.onclick = () => choose(t);
    li.append(pick);
    if (canFinish) {
      const done = Object.assign(document.createElement('button'), { className: 'done', title: 'Mark done' });
      done.setAttribute('aria-label', `Mark “${t.title}” done`);
      done.onclick = () => finish(t, li);
      li.append(done);
    }
    return li;
  }));
}

const empty = text => Object.assign(document.createElement('li'), { className: 'empty', textContent: text });

function choose(t) {
  current = t === ASSORTED ? ASSORTED : { id: t.id, title: t.title, db: schema.id, countProp: prop(cfg.countProp)?.type === 'number' ? cfg.countProp : null };
  store.set('current', current);
  $('#task').textContent = t.title;
  renderTasks();
  if (stacked.matches) $('.timer').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth' });
  if (t === ASSORTED) return;
  const p = prop(cfg.doneProp);
  if (p?.type === 'status') {
    const g = groups(p);
    if (g.todo.includes(t.status) && g.active)
      write(t.id, { [p.name]: { status: { name: g.active } } }).then(ok => ok && (t.status = g.active));
  }
}

async function finish(t, li) {
  const p = prop(cfg.doneProp), doneName = p.type === 'status' && groups(p).done[0];
  if (p.type === 'status' && !doneName) return toast(`“${p.name}” has no Complete option`);
  li.classList.add('leaving');
  const [ok] = await Promise.all([
    write(t.id, { [p.name]: p.type === 'checkbox' ? { checkbox: true } : { status: { name: doneName } } }),
    new Promise(r => setTimeout(r, 400)),
  ]);
  if (!ok) return li.classList.remove('leaving');
  tasks = tasks.filter(x => x !== t);
  if (current?.id === t.id) {
    current = null;
    store.set('current', null);
    $('#task').textContent = 'Pick a task';
  }
  renderTasks();
  toast(`Done: ${t.title}`);
}

// Reads the current count from Notion first, so edits made elsewhere aren't overwritten.
async function logPomo(task) {
  if (task.id === ASSORTED.id) return;
  const name = task.db === schema?.id ? prop(cfg.countProp)?.type === 'number' && cfg.countProp : task.countProp;
  if (!name) return;
  try {
    const page = await api('GET', '/v1/pages/' + task.id);
    const n = (page.properties[name]?.number || 0) + 1;
    await api('PATCH', '/v1/pages/' + task.id, { properties: { [name]: { number: n } } });
    const t = tasks.find(x => x.id === task.id);
    if (t) { t.count = n; renderTasks(); }
    toast(`Pomodoro ${n} logged to Notion`);
  } catch (e) { toast(e.message) }
}

let syncing = null, dbsLoaded = false;

async function fillDbs() {
  const dbs = await listDbs();
  if (!dbs.length) throw new Error('No databases are shared with your Notion integration yet.');
  if (!dbs.some(d => d.id === cfg.db)) cfg.db = (dbs.find(d => /task|to-?do/i.test(d.name)) || dbs[0]).id;
  fill($('#db'), dbs.map(d => [d.id, d.name]), cfg.db);
  dbsLoaded = true;
}

function sync(all) {
  if (syncing) return syncing;
  $('#refresh').classList.add('spin');
  syncing = (async () => {
    if (all || !dbsLoaded) await fillDbs();
    if (schema?.id !== cfg.db) { schema = await loadSchema(cfg.db); autoProps(schema); }
    saveCfg();
    await loadTasks();
  })()
    .catch(e => { if (!tasks.length) $('#list').replaceChildren(empty(e.message)); toast(e.message); })
    .finally(() => { syncing = null; $('#refresh').classList.remove('spin'); });
  return syncing;
}

/* ---------- UI ---------- */

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2800);
}

$('#go').onclick = () => {
  unlockAudio();
  if (window.Notification?.permission === 'default') Notification.requestPermission();
  running ? pause() : start();
};
$('#reset').onclick = () => {
  clearTimeout(timer);
  running = false; left = full(mode);
  saveTimer(); renderMeta();
};
$('#skip').onclick = () => advance(false);
for (const b of document.querySelectorAll('.seg button')) b.onclick = () => b.dataset.m !== mode && setMode(b.dataset.m, b);
function setSolo(on) {
  const b = $('#side');
  document.body.classList.toggle('solo', on);
  b.setAttribute('aria-expanded', !on);
  b.setAttribute('aria-label', on ? 'Show tasks' : 'Hide tasks');
  b.title = on ? 'Show tasks (T)' : 'Hide tasks (T)';
  store.set('solo', on);
}
setSolo(store.get('solo', false));
requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));
$('#side').onclick = () => setSolo(!document.body.classList.contains('solo'));

$('#refresh').onclick = () => sync(true);
$('#now').onclick = () => $('#tasks').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'nearest' });
$('#db').onchange = e => {
  Object.assign(cfg, { db: e.target.value, doneProp: null, countProp: null });
  schema = null;
  tasks = [];
  $('#count').textContent = 0;
  $('#list').replaceChildren(empty('Loading…'));
  (syncing || Promise.resolve()).then(() => sync());
};

$('#add').onsubmit = async e => {
  e.preventDefault();
  const input = e.target.t, title = input.value.trim();
  if (!title || !schema) return;
  input.value = '';
  try {
    const p = await api('POST', '/v1/pages', { parent: { database_id: schema.id }, properties: { [schema.title]: { title: [{ text: { content: title } }] } } });
    tasks.push({ id: p.id, title, count: prop(cfg.countProp) ? 0 : null, status: p.properties?.[cfg.doneProp]?.status?.name });
    renderTasks();
    $('#list').lastChild.classList.add('entering');
    $('#list').lastChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (err) {
    input.value = title;
    toast(err.message);
  }
};

addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input,select,textarea,dialog')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    if (e.target.closest('button')) return;
    e.preventDefault();
    $('#go').click();
  } else if (k === 'r') $('#reset').click();
  else if (k === 's') $('#skip').click();
  else if (k === 't' && !stacked.matches) $('#side').click();
  else if (k === '1' || k === '2' || k === '3') document.querySelectorAll('.seg button')[k - 1].click();
});

/* ---------- Settings ---------- */

const dlg = $('#settings'), form = $('#cfg');
const fill = (sel, opts, value) => sel.replaceChildren(...opts.map(([v, t]) => new Option(t, v, false, v === value)));

function fillHide() {
  const p = prop(form.doneProp.value), box = $('#hide');
  const opts = p?.type === 'status' ? p.status.options.map(o => o.name).filter(n => !groups(p).done.includes(n)) : [];
  const hidden = schema && form.doneProp.value === cfg.doneProp ? cfg.hide[schema.id] || [] : [];
  box.hidden = !opts.length;
  box.querySelector('div').replaceChildren(...opts.map(n => {
    const l = document.createElement('label'), c = Object.assign(document.createElement('input'), { type: 'checkbox', value: n, checked: hidden.includes(n) });
    l.className = 'check';
    l.append(n, c);
    return l;
  }));
}

$('#menu').onclick = () => {
  for (const k of ['focus', 'short', 'long', 'every']) form[k].value = cfg[k];
  form.auto.checked = cfg.auto;
  form.sound.checked = cfg.sound;
  const ps = schema?.props || [];
  fill(form.doneProp, ps.filter(p => p.type === 'status' || p.type === 'checkbox').map(p => [p.name, `${p.name} (${p.type})`]), cfg.doneProp);
  fill(form.countProp, [['', 'Don’t log'], ...ps.filter(p => p.type === 'number').map(p => [p.name, p.name])], cfg.countProp ?? '');
  fillHide();
  dlg.showModal();
};
form.doneProp.onchange = fillHide;
dlg.onclick = e => { if (e.target === dlg) dlg.close() };

dlg.onclose = () => {
  if (dlg.returnValue !== 'save') return;
  dlg.returnValue = '';
  const n = (k, lo, hi) => Math.min(hi, Math.max(lo, Math.round(+form[k].value) || cfg[k]));
  const before = full(mode);
  Object.assign(cfg, { focus: n('focus', 1, 90), short: n('short', 1, 30), long: n('long', 1, 60), every: n('every', 2, 8), auto: form.auto.checked, sound: form.sound.checked });
  if (schema) {
    Object.assign(cfg, { doneProp: form.doneProp.value, countProp: form.countProp.value });
    cfg.hide = { ...cfg.hide, [schema.id]: [...$('#hide').querySelectorAll('input:checked')].map(c => c.value) };
  }
  saveCfg();
  if (!running && (left === before || left > full(mode))) left = full(mode);
  saveTimer();
  renderMeta();
  (syncing || Promise.resolve()).then(() => sync());
};

/* ---------- Boot ---------- */

const saved = store.get('timer', {});
if (NAMES[saved.mode]) mode = saved.mode;
left = saved.running ? saved.endAt - Date.now() : saved.left;
if (!(left > 0 && left <= full(mode))) left = full(mode);
renderMeta();
if (saved.running && saved.endAt > Date.now()) start();

sync();
setInterval(() => !document.hidden && sync(), 60e3);
document.addEventListener('visibilitychange', () => !document.hidden && sync());
