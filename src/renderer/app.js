'use strict';

const S = window.Sprites;
const $ = (id) => document.getElementById(id);
const FOOD_SPRITE = { rice: 'rice', cookie: 'cookie', fruit: 'fruit' };

let info = null; // { species[], foods, testMode }
let view = null; // latest pet view from main
let selected = null;
let thinking = false;
let eating = null;
let talkUntil = 0;
let flashUntil = 0;
let hatchCracks = 0;
let revealSpecies = null;
let bubbleTimer = null;

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
}

function eggColor(species) {
  const pal = S.EGG_PAL(species.egg);
  return (k) => pal[k] || S.COMMON[k] || null;
}

function drawEggOn(ctx, species, cracks, scale, dx = 0, dy = 0) {
  S.drawGrid(ctx, S.egg(cracks), eggColor(species), scale, dx, dy);
}

// ---------- onboarding ----------
function buildEggs() {
  const wrap = $('eggs');
  wrap.innerHTML = '';
  for (const sp of info.species) {
    const card = document.createElement('div');
    card.className = 'egg-card';
    card.dataset.species = sp.id;
    card.innerHTML = `<canvas width="120" height="120"></canvas><div class="el">${elementLabel(sp.element)}</div>`;
    card.addEventListener('click', () => selectEgg(sp.id));
    wrap.appendChild(card);
  }
}

function elementLabel(el) {
  return { fire: '🔥 火之蛋', water: '💧 水之蛋', grass: '🌱 草之蛋' }[el] || el;
}

function selectEgg(id) {
  selected = id;
  const sp = info.species.find((s) => s.id === id);
  for (const c of document.querySelectorAll('.egg-card')) c.classList.toggle('selected', c.dataset.species === id);
  $('egg-info').textContent = `${elementLabel(sp.element)}：${sp.blurb}`;
  $('hatch-btn').disabled = false;
  $('pet-name').placeholder = `给它起个名字（默认 ${sp.nameZh}）`;
}

function showOnboarding() {
  selected = null;
  $('hatch-btn').disabled = true;
  $('egg-info').textContent = '点一颗蛋看看。';
  $('pet-name').value = '';
  buildEggs();
  show('onboarding');
}

// ---------- hatching ----------
const STEP_ORDER = ['checking-login', 'login', 'creating-agent', 'hatching'];

function setStep(step) {
  const idx = STEP_ORDER.indexOf(step);
  document.querySelectorAll('#steps li').forEach((li) => {
    const i = STEP_ORDER.indexOf(li.dataset.step);
    li.classList.toggle('done', i < idx);
    li.classList.toggle('active', i === idx);
  });
  hatchCracks = Math.min(3, Math.max(0, idx));
}

async function startHatch() {
  const species = info.species.find((s) => s.id === selected);
  revealSpecies = null;
  hatchCracks = 0;
  $('hatch-error').classList.add('hidden');
  $('hatch-retry').classList.add('hidden');
  $('login-box').classList.add('hidden');
  $('hatch-title').textContent = '孵化中……';
  document.querySelectorAll('#steps li').forEach((li) => li.classList.remove('done', 'active'));
  show('hatching');

  const offStep = window.pet.onHatchStep(setStep);
  const offLogin = window.pet.onLoginPrompt(({ url, code, browserFailed }) => {
    $('login-msg').textContent = browserFailed ? '没能自动打开浏览器，已为你打开登录页。请输入验证码：' : '浏览器已打开登录页，请确认验证码：';
    $('login-code').textContent = code || '（见浏览器页面）';
    $('login-url').textContent = url;
    $('login-box').classList.remove('hidden');
  });
  const res = await window.pet.hatch(species.id, $('pet-name').value);
  offStep();
  offLogin();

  if (!res.ok) {
    $('hatch-title').textContent = '孵化失败';
    $('hatch-error').textContent = res.error;
    $('hatch-error').classList.remove('hidden');
    $('hatch-retry').classList.remove('hidden');
    return;
  }
  document.querySelectorAll('#steps li').forEach((li) => { li.classList.remove('active'); li.classList.add('done'); });
  $('login-box').classList.add('hidden');
  flashUntil = performance.now() + 700;
  revealSpecies = res.view.pet.speciesId;
  $('hatch-title').textContent = `${res.view.pet.name} 破壳了！`;
  setTimeout(() => enterPet(res.view), 1500);
}

// ---------- pet ----------
function enterPet(v) {
  view = v;
  revealSpecies = null;
  show('pet-screen');
  refreshHud();
}

function barColor(v, invert) {
  const good = invert ? 100 - v : v;
  return good > 60 ? '#6cc16a' : good > 30 ? '#f2b53a' : '#e0455f';
}

function refreshHud() {
  if (!view) return;
  const p = view.pet;
  const set = (id, v, invert) => {
    const el = $(id);
    el.style.setProperty('--v', `${invert ? 100 - v : v}%`);
    el.style.setProperty('--c', barColor(v, invert));
  };
  set('bar-hunger', p.hunger, true);
  set('bar-mood', p.mood, false);
  set('bar-energy', p.energy, false);
  const stage = { baby: '幼崽', child: '少年', adult: '成年' }[p.stage];
  const prog = view.progress.next ? ` · 成长 ${view.progress.pct}%` : ' · 已完全成长';
  $('meta').textContent = `${p.name} · ${view.species.nameZh} · ${stage}${prog}`;
}

function say(text, kind, source, reason) {
  const b = $('bubble');
  clearTimeout(bubbleTimer);
  b.classList.remove('thinking');
  b.classList.remove('hidden');
  b.textContent = text;
  b.dataset.kind = kind || '';
  b.dataset.source = source || '';
  b.dataset.reason = reason || '';
  talkUntil = performance.now() + Math.min(4000, 400 + text.length * 90);
  bubbleTimer = setTimeout(() => b.classList.add('hidden'), 6000 + text.length * 120);
}

function setThinking(on) {
  thinking = on;
  const b = $('bubble');
  if (on) {
    clearTimeout(bubbleTimer);
    b.classList.remove('hidden');
    b.classList.add('thinking');
    b.textContent = '……';
  }
}

// Tell the owner what actually went wrong instead of blaming "the network" for everything.
function errorLine(r) {
  if (r.code === 'ETIMEDOUT') return '（我想了好久也没想出来……LobeHub 现在好像很慢，晚点再说一次？）';
  if (r.code === 'EAUTH') return '（LobeHub 登录好像过期了，需要重新 lh login）';
  if (r.code === 'ENOENT') return '（找不到 lh 命令，请先 npm install -g @lobehub/cli）';
  if (r.code === 'ENOREPLY') return '（我走神了，没想出要说什么……再说一次？）';
  return `（出错了：${String(r.message || '未知错误').slice(0, 70)}）`;
}

async function doAct(kind, food) {
  const r = await window.pet.act(kind, food);
  if (kind === 'feed' && r.ok) {
    eating = FOOD_SPRITE[food] || 'rice';
    setTimeout(() => { eating = null; }, 1600);
  }
}

function buildFoodMenu() {
  const m = $('food-menu');
  m.innerHTML = '';
  for (const [id, f] of Object.entries(info.foods)) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = f.label;
    b.addEventListener('click', () => { m.classList.add('hidden'); doAct('feed', id); });
    m.appendChild(b);
  }
}

function bindPetUi() {
  buildFoodMenu();
  $('toolbar').addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    $('food-menu').classList.add('hidden');
    $('main-menu').classList.add('hidden');
    if (act === 'feed') $('food-menu').classList.toggle('hidden');
    else if (act === 'play' || act === 'sleep') doAct(act);
    else if (act === 'chat') {
      $('chat-row').classList.toggle('hidden');
      if (!$('chat-row').classList.contains('hidden')) $('chat-input').focus();
    } else if (act === 'menu') $('main-menu').classList.toggle('hidden');
  });
  $('main-menu').addEventListener('click', async (e) => {
    const m = e.target.dataset && e.target.dataset.menu;
    if (!m) return;
    $('main-menu').classList.add('hidden');
    if (m === 'quit') window.pet.quit();
    if (m === 'log') window.pet.openLog();
    if (m === 'release' && confirm('放生它，并在 LobeHub 里删除对应的 agent（含聊天记录）？')) await release(true);
    if (m === 'forget' && confirm('只重置本地进度，LobeHub 里的 agent 会保留。继续？')) await release(false);
  });
  const send = async () => {
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    $('chat-send').disabled = true;
    const r = await window.pet.chat(text);
    $('chat-send').disabled = false;
    if (!r.ok && r.reason === 'error') say(errorLine(r), 'error', 'error', r.message);
    if (!r.ok && r.reason === 'busy') say('等等，我还在想上一句……', 'busy');
  };
  $('chat-send').addEventListener('click', send);
  $('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  // drag the window by the sprite; a click without movement pats the pet
  const cv = $('pet-canvas');
  let drag = null;
  cv.addEventListener('mousedown', (e) => { drag = { x: e.screenX, y: e.screenY, moved: false }; });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.screenX - drag.x;
    const dy = e.screenY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) { window.pet.moveBy(dx, dy); drag.x = e.screenX; drag.y = e.screenY; }
  });
  window.addEventListener('mouseup', () => {
    if (drag && !drag.moved) doAct('pat');
    drag = null;
  });
}

async function release(deleteAgent) {
  await window.pet.release({ deleteAgent });
  view = null;
  showOnboarding();
}

// ---------- render loop ----------
function drawPet(ctx, t) {
  const p = view.pet;
  const status = thinking ? 'idle' : view.status;
  const f = S.frame({ speciesId: p.speciesId, stage: p.stage, status, t, talking: performance.now() < talkUntil, eating });
  const colorOf = (k) => S.colorFor(p.speciesId, k);
  const scale = 8;
  S.drawGrid(ctx, f.grid, colorOf, scale, 0, f.dy * scale);
  for (const fx of f.effects) S.drawGrid(ctx, S.EFFECTS[fx.name], (k) => S.colorFor(p.speciesId, k), scale, fx.x * scale, fx.y * scale);
  if (performance.now() < flashUntil) {
    ctx.fillStyle = `rgba(255,255,255,${(flashUntil - performance.now()) / 700})`;
    ctx.fillRect(0, 0, 192, 192);
  }
}

function frameLoop(ts) {
  const t = ts / 1000;
  if (!$('onboarding').classList.contains('hidden')) {
    document.querySelectorAll('.egg-card').forEach((c, i) => {
      const ctx = c.querySelector('canvas').getContext('2d');
      ctx.clearRect(0, 0, 120, 120);
      const sp = info.species[i];
      const wob = c.classList.contains('selected') ? Math.round(Math.sin(t * 9 + i)) * 2 : 0;
      drawEggOn(ctx, sp, 0, 5, wob, 0);
    });
  } else if (!$('hatching').classList.contains('hidden')) {
    const ctx = $('hatch-canvas').getContext('2d');
    ctx.clearRect(0, 0, 192, 192);
    if (revealSpecies) {
      const p = { speciesId: revealSpecies };
      const f = S.frame({ speciesId: revealSpecies, stage: 'baby', status: 'happy', t });
      S.drawGrid(ctx, f.grid, (k) => S.colorFor(p.speciesId, k), 8, 0, f.dy * 8);
      for (const fx of f.effects) S.drawGrid(ctx, S.EFFECTS[fx.name], (k) => S.colorFor(p.speciesId, k), 8, fx.x * 8, fx.y * 8);
    } else {
      const sp = info.species.find((s) => s.id === selected);
      drawEggOn(ctx, sp, hatchCracks, 8, Math.round(Math.sin(t * 10)) * 4 * (hatchCracks > 0 ? 1 : 0.5), 0);
    }
    if (performance.now() < flashUntil) {
      ctx.fillStyle = `rgba(255,255,255,${(flashUntil - performance.now()) / 700})`;
      ctx.fillRect(0, 0, 192, 192);
    }
  } else if (view) {
    const ctx = $('pet-canvas').getContext('2d');
    ctx.clearRect(0, 0, 192, 192);
    drawPet(ctx, t);
  }
  setTimeout(() => requestAnimationFrame(frameLoop), 80); // ~12 fps keeps the pixel feel and idles cheaply
}

// ---------- boot ----------
async function main() {
  info = await window.pet.boot();
  bindPetUi();
  $('hatch-btn').addEventListener('click', startHatch);
  $('hatch-retry').addEventListener('click', showOnboarding);
  window.pet.onUpdate((v) => { view = v; if (v) refreshHud(); });
  window.pet.onSay((m) => say(m.text, m.kind, m.source, m.reason));
  window.pet.onThinking(setThinking);
  window.pet.onEvolved(() => { flashUntil = performance.now() + 700; });
  if (info.view) enterPet(info.view);
  else showOnboarding();
  requestAnimationFrame(frameLoop);
}

main();
