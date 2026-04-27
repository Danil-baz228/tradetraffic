/* ══════════════════════════════════════
   STATE
══════════════════════════════════════ */
const S = {
  tg: window.Telegram?.WebApp,
  initData: '',
  user: null,
  balance: 0,
  isAdmin: false,
  page: 'home',
  chart: { candles: [], interval: '1m', price: 0, change: 0, high: 0, low: 0 },
  activeBet: null,
  bets: [],
  admin: { users: [], bets: [] },
};

/* ══════════════════════════════════════
   API
══════════════════════════════════════ */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (S.initData) opts.headers['X-Telegram-Init-Data'] = S.initData;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(e.detail || r.statusText);
  }
  return r.json();
}

/* ══════════════════════════════════════
   INIT
══════════════════════════════════════ */
async function init() {
  if (S.tg) {
    S.tg.ready(); S.tg.expand();
    S.tg.setHeaderColor?.('#050507');
    S.tg.setBackgroundColor?.('#050507');
    S.initData = S.tg.initData || '';
  }

  try {
    const me = await api('GET', '/api/me');
    S.user     = me;
    S.balance  = me.balance ?? 0;
    S.activeBet = me.active_bet || null;
    renderUserUI();
    if (S.activeBet) showActiveBet();
    else enableBetBtns();
  } catch (_) {
    enableBetBtns();
  }

  try {
    await api('GET', '/api/admin/users');
    S.isAdmin = true;
    document.getElementById('admin-section').classList.remove('hidden');
  } catch (_) {}

  await loadChart();
  startPricePoll();
  loadBets();

  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');

  // live clock
  updateClock();
  setInterval(updateClock, 10000);
}

function updateClock() {
  const now = new Date();
  document.getElementById('sb-time').textContent =
    now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/* ══════════════════════════════════════
   NAVIGATION
══════════════════════════════════════ */
document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

function switchPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.getElementById('tab-' + page)?.classList.add('active');
  S.page = page;
  if (page === 'stats')    renderStatsPage();
  if (page === 'profile')  renderProfilePage();
  if (page === 'settings' && S.isAdmin) loadAdminData();
}

/* ══════════════════════════════════════
   CHART
══════════════════════════════════════ */
async function loadChart() {
  const loader = document.getElementById('chart-loader');
  loader.classList.remove('hidden');
  try {
    const [candles, ticker] = await Promise.all([
      fetch(`/api/klines/BTCUSDT?interval=${S.chart.interval}&limit=80`).then(r => r.json()),
      fetch('/api/ticker24h/BTCUSDT').then(r => r.json()),
    ]);
    S.chart.candles = candles;
    S.chart.price   = parseFloat(ticker.price);
    S.chart.change  = parseFloat(ticker.change);
    S.chart.high    = parseFloat(ticker.high);
    S.chart.low     = parseFloat(ticker.low);
    updatePriceUI();
    drawChart();
  } catch (e) { console.warn('chart', e); }
  finally { loader.classList.add('hidden'); }
}

function updatePriceUI() {
  const p  = S.chart.price;
  const ch = S.chart.change;
  document.getElementById('sc-price').textContent  = '$' + fmt(p);
  const sign = ch >= 0 ? '+' : '';
  const changeEl = document.getElementById('sc-change');
  changeEl.textContent = sign + ch.toFixed(2) + '%';
  changeEl.className = 'stat-card ' + (ch >= 0 ? 'green' : 'red');
  updateTrendStrip();
}

function updateTrendStrip() {
  if (S.activeBet) {
    const b = S.activeBet;
    const dir = b.direction === 'up' ? '↑ LONG' : '↓ SHORT';
    document.getElementById('trend-text').textContent =
      `${dir}   ENTRY $${fmt(b.entry_price)}   AMOUNT $${b.amount}`;
  } else {
    const p = S.chart.price;
    const target = p * 1.005;
    const stop   = p * 0.995;
    document.getElementById('trend-text').textContent =
      `ENTRY ${fmt(p)}   TARGET ${fmt(target)}   STOP ${fmt(stop)}`;
  }
  // stat card P/L
  const plEl = document.getElementById('sc-pl');
  if (S.activeBet) {
    const diff = S.chart.price - S.activeBet.entry_price;
    const win = S.activeBet.direction === 'up' ? diff > 0 : diff < 0;
    const pl = win ? '+$' + (S.activeBet.amount * 0.9).toFixed(0) : '-$' + S.activeBet.amount.toFixed(0);
    plEl.textContent = 'P/L ' + pl;
    plEl.className = 'stat-card ' + (win ? 'green' : 'red');
  } else {
    plEl.textContent = 'P/L —';
    plEl.className = 'stat-card';
  }
}

function drawChart() {
  const canvas = document.getElementById('chart-canvas');
  const wrap   = canvas.parentElement;
  const dpr    = window.devicePixelRatio || 1;
  canvas.width  = wrap.clientWidth  * dpr;
  canvas.height = wrap.clientHeight * dpr;
  canvas.style.width  = wrap.clientWidth  + 'px';
  canvas.style.height = wrap.clientHeight + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const PL = 48, PR = 8, PT = 8, PB = 22;
  const cW = W - PL - PR, cH = H - PT - PB;
  const volH = Math.floor(cH * 0.16);
  const candH = cH - volH - 4;

  const cc = S.chart.candles;
  if (!cc.length) return;

  const maxP = Math.max(...cc.map(c => c.h));
  const minP = Math.min(...cc.map(c => c.l));
  const pRange = maxP - minP || 1;
  const maxV = Math.max(...cc.map(c => c.v)) || 1;
  const gap  = cW / cc.length;
  const cndW = Math.max(1.5, gap * 0.6);

  const pY = p => PT + candH * (1 - (p - minP) / pRange);
  const vY = v => PT + candH + 4 + volH * (1 - v / maxV);

  // bg
  ctx.fillStyle = '#111214';
  ctx.fillRect(0, 0, W, H);

  // grid
  ctx.strokeStyle = '#1c2030'; ctx.lineWidth = .5;
  for (let i = 0; i <= 4; i++) {
    const y = PT + (candH / 4) * i;
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke();
    const price = maxP - (pRange / 4) * i;
    ctx.fillStyle = '#4a5568'; ctx.font = '9px Inter,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(fmtK(price), PL - 3, y + 3);
  }

  // candles
  cc.forEach((c, i) => {
    const x  = PL + gap * i + gap / 2;
    const bull = c.c >= c.o;
    const col  = bull ? '#00C7C7' : '#FF405C';
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, pY(c.h)); ctx.lineTo(x, pY(c.l)); ctx.stroke();
    const bY  = Math.min(pY(c.o), pY(c.c));
    const bH  = Math.max(1.5, Math.abs(pY(c.o) - pY(c.c)));
    ctx.fillStyle = col;
    ctx.fillRect(x - cndW / 2, bY, cndW, bH);

    const vbH = Math.max(1, (PT + candH + 4 + volH) - vY(c.v));
    ctx.fillStyle = bull ? 'rgba(0,199,199,.35)' : 'rgba(255,64,92,.35)';
    ctx.fillRect(x - cndW / 2, PT + candH + 4 + volH - vbH, cndW, vbH);
  });

  // current price line
  if (S.chart.price) {
    const py = pY(S.chart.price);
    ctx.setLineDash([3, 4]); ctx.strokeStyle = '#00C7C7'; ctx.lineWidth = .8;
    ctx.beginPath(); ctx.moveTo(PL, py); ctx.lineTo(W - PR, py); ctx.stroke();
    ctx.setLineDash([]);

    // price tag
    ctx.fillStyle = '#3B3D42';
    const tag = '$' + fmt(S.chart.price);
    ctx.font = 'bold 9px Inter,sans-serif'; ctx.textAlign = 'right';
    const tw = ctx.measureText(tag).width + 10;
    ctx.beginPath();
    ctx.roundRect?.(PL - tw - 2, py - 10, tw, 18, 4) || ctx.rect(PL - tw - 2, py - 10, tw, 18);
    ctx.fill();
    ctx.fillStyle = '#F2F4F7'; ctx.fillText(tag, PL - 4, py + 3);
  }

  // time labels
  ctx.fillStyle = '#4a5568'; ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'center';
  const step = Math.ceil(cc.length / 5);
  for (let i = 0; i < cc.length; i += step) {
    const d = new Date(cc[i].t);
    const lbl = S.chart.interval.endsWith('d')
      ? d.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' })
      : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    ctx.fillText(lbl, PL + gap * i + gap / 2, H - PB + 10);
  }
}

// interval buttons
document.querySelectorAll('.tf').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tf').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.chart.interval = btn.dataset.iv;
    loadChart();
    document.getElementById('set-interval').textContent = btn.dataset.iv;
  });
});

// price poll
function startPricePoll() {
  setInterval(async () => {
    try {
      const t = await fetch('/api/ticker24h/BTCUSDT').then(r => r.json());
      S.chart.price  = parseFloat(t.price);
      S.chart.change = parseFloat(t.change);
      S.chart.high   = parseFloat(t.high);
      S.chart.low    = parseFloat(t.low);
      if (S.chart.candles.length) {
        const last = S.chart.candles[S.chart.candles.length - 1];
        last.c = S.chart.price;
        last.h = Math.max(last.h, S.chart.price);
        last.l = Math.min(last.l, S.chart.price);
      }
      updatePriceUI();
      if (S.page === 'home') drawChart();
      updateActiveBetPL();
    } catch (_) {}
  }, 5000);
  setInterval(() => { if (S.page === 'home') loadChart(); }, 60000);
}

window.addEventListener('resize', () => { if (S.page === 'home') drawChart(); });

/* ══════════════════════════════════════
   USER UI
══════════════════════════════════════ */
function renderUserUI() {
  if (!S.user) return;
  const name = S.user.first_name || ('@' + S.user.username) || 'User';
  const uname = S.user.username ? '@' + S.user.username : String(S.user.telegram_id || '');

  // home header
  el('hc-name').textContent = uname || name;
  el('hc-bal-val').textContent = '$' + S.balance.toFixed(2);
  el('hc-avatar').textContent = '';
  el('hc-avatar').appendChild(mkDot('#07110D'));

  // stats header
  el('stats-hc-name').textContent = uname || name;

  // profile header
  el('pr-name').textContent = name;
  el('pr-bal').textContent  = '$' + S.balance.toFixed(2);
  el('pr-hero-name').textContent = name;
  el('pr-hero-meta').textContent = 'UID ' + (S.user.telegram_id || '—');
  el('pr-hero-bal').textContent  = S.balance.toFixed(2);
}

function mkDot(color) {
  const d = document.createElement('div');
  d.className = 'hc-avatar-dot'; d.style.background = color; return d;
}

function renderBalance() {
  el('hc-bal-val').textContent    = '$' + S.balance.toFixed(2);
  el('pr-bal').textContent        = '$' + S.balance.toFixed(2);
  el('pr-hero-bal').textContent   = S.balance.toFixed(2);
}

/* ══════════════════════════════════════
   BETTING
══════════════════════════════════════ */
document.querySelectorAll('.bc-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bc-preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    el('bet-amount').value = btn.dataset.val;
  });
});

document.querySelectorAll('.bc-dur').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bc-dur').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

function enableBetBtns() {
  el('bet-up-btn').disabled = false;
  el('bet-down-btn').disabled = false;
}
function disableBetBtns() {
  el('bet-up-btn').disabled = true;
  el('bet-down-btn').disabled = true;
}

el('bet-up-btn').addEventListener('click', () => placeBet('up'));
el('bet-down-btn').addEventListener('click', () => placeBet('down'));

async function placeBet(direction) {
  if (S.activeBet) return;
  const amount = parseFloat(el('bet-amount').value);
  const dur    = parseInt(document.querySelector('.bc-dur.active')?.dataset.dur || '60');
  if (!amount || amount <= 0) return;
  if (amount > S.balance) {
    S.tg?.showAlert?.('Недостаточно средств!'); return;
  }
  disableBetBtns();
  try {
    const res = await api('POST', '/api/bet', { direction, amount, symbol: 'BTCUSDT', duration: dur });
    S.activeBet = res.bet;
    S.balance   = res.balance;
    renderBalance();
    showActiveBet();
    S.tg?.HapticFeedback?.impactOccurred('medium');
  } catch (e) {
    S.tg?.showAlert?.(e.message || 'Ошибка'); enableBetBtns();
  }
}

function showActiveBet() {
  const b = S.activeBet; if (!b) return;
  disableBetBtns();
  el('bet-controls').classList.add('hidden');
  el('active-bet-bar').classList.remove('hidden');

  const dirIcon = el('abb-dir-icon');
  dirIcon.textContent  = b.direction === 'up' ? '↑' : '↓';
  dirIcon.className    = 'abb-dir ' + b.direction;
  el('abb-label').textContent = (b.direction === 'up' ? 'UP' : 'DOWN') + ' • $' + b.amount;
  el('abb-entry').textContent = 'Entry: $' + fmt(b.entry_price);
  startBetTimer(b.resolve_at);
  updateTrendStrip();
}

function startBetTimer(resolveAt) {
  clearInterval(window._betTimer);
  window._betTimer = setInterval(async () => {
    const rem = resolveAt - Date.now() / 1000;
    if (rem <= 0) {
      clearInterval(window._betTimer);
      el('abb-timer').textContent = '00:00';
      await pollResolution();
      return;
    }
    const m = Math.floor(rem / 60), s = Math.floor(rem % 60);
    el('abb-timer').textContent = pad(m) + ':' + pad(s);
  }, 500);
}

async function pollResolution() {
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    try {
      const res = await api('GET', '/api/bets');
      const bet = res.bets.find(b => b.id === S.activeBet?.id);
      if (bet?.status === 'resolved') {
        S.balance   = res.balance;
        S.activeBet = null;
        S.bets      = res.bets;
        renderBalance();
        hideActiveBet();
        enableBetBtns();
        const won = bet.outcome === 'win';
        const msg = won ? `Победа! +$${bet.payout.toFixed(2)}` : `Поражение. -$${bet.amount.toFixed(2)}`;
        S.tg?.showAlert?.(msg);
        S.tg?.HapticFeedback?.notificationOccurred(won ? 'success' : 'error');
        updateTrendStrip();
        return;
      }
    } catch (_) {}
  }
}

function hideActiveBet() {
  el('active-bet-bar').classList.add('hidden');
  el('bet-controls').classList.remove('hidden');
}

function updateActiveBetPL() {
  if (!S.activeBet || !S.chart.price) return;
  const { direction, entry_price, amount } = S.activeBet;
  const diff = S.chart.price - entry_price;
  const win  = direction === 'up' ? diff > 0 : diff < 0;
  const plEl = el('abb-pl');
  if (Math.abs(diff) < 0.5) { plEl.textContent = '~$0'; plEl.className = 'abb-pl neutral'; }
  else if (win) { plEl.textContent = '+$' + (amount * 0.9).toFixed(2); plEl.className = 'abb-pl profit'; }
  else          { plEl.textContent = '-$' + amount.toFixed(2);          plEl.className = 'abb-pl loss'; }
  updateTrendStrip();
}

/* ══════════════════════════════════════
   BETS / STATS
══════════════════════════════════════ */
async function loadBets() {
  try {
    const res = await api('GET', '/api/bets');
    S.bets    = res.bets;
    S.balance = res.balance;
    renderBalance();
  } catch (_) {}
}

function renderStatsPage() {
  loadBets().then(() => {
    const bets     = S.bets;
    const resolved = bets.filter(b => b.status === 'resolved');
    const wins     = resolved.filter(b => b.outcome === 'win');
    const losses   = resolved.filter(b => b.outcome === 'lose');
    const totalPL  = wins.reduce((s, b) => s + b.payout - b.amount, 0)
                   - losses.reduce((s, b) => s + b.amount, 0);
    const wr = resolved.length ? Math.round(wins.length / resolved.length * 100) : 0;
    const totalInvested = resolved.reduce((s, b) => s + b.amount, 0);
    const roi = totalInvested ? ((totalPL / totalInvested) * 100).toFixed(1) : '0';

    el('stats-big-pl').textContent = (totalPL >= 0 ? '+$' : '-$') + Math.abs(totalPL).toFixed(2);
    el('stats-big-pl').style.color = totalPL >= 0 ? 'var(--green)' : 'var(--red2)';
    el('stats-pl').textContent     = (totalPL >= 0 ? '+$' : '-$') + Math.abs(totalPL).toFixed(2);
    el('m-roi').querySelector('.metric-val').textContent = roi + '%';
    el('m-winrate').querySelector('.metric-val').textContent = wr + '%';
    el('m-draws').querySelector('.metric-val').textContent  = '$' + losses.reduce((s, b) => s + b.amount, 0).toFixed(2);
    el('stats-total').textContent = bets.length;
    el('stats-wins').textContent  = wins.length;

    const best = wins.sort((a, b) => b.payout - a.payout)[0];
    el('stats-summary').textContent = best
      ? `Best win: $${best.payout.toFixed(2)} on ${best.symbol}   +${((best.payout / best.amount - 1) * 100).toFixed(0)}%`
      : 'Best performer: — +0%';

    const listEl = el('bets-list');
    if (!bets.length) { listEl.innerHTML = '<div class="empty-state">Нет ставок</div>'; return; }
    listEl.innerHTML = bets.slice(0, 10).map(bet => {
      const cls  = bet.status === 'pending' ? 'pending' : bet.outcome;
      const amt  = bet.status === 'pending'
        ? `<span class="blc-amount pending">$${bet.amount.toFixed(2)}</span>`
        : bet.outcome === 'win'
          ? `<span class="blc-amount win">+$${bet.payout.toFixed(2)}</span>`
          : `<span class="blc-amount lose">-$${bet.amount.toFixed(2)}</span>`;
      const date = new Date(bet.created_at * 1000).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      return `<div class="blc-item">
        <div class="blc-left">
          <div class="blc-dir ${bet.direction}">${bet.direction === 'up' ? '↑' : '↓'}</div>
          <div>
            <div class="blc-label">${bet.symbol} • ${bet.direction === 'up' ? 'UP' : 'DOWN'}</div>
            <div class="blc-date">${date}</div>
          </div>
        </div>
        ${amt}
      </div>`;
    }).join('');
  });
}

function renderProfilePage() {
  loadBets().then(() => {
    const resolved = S.bets.filter(b => b.status === 'resolved');
    const wins     = resolved.filter(b => b.outcome === 'win');
    const losses   = resolved.filter(b => b.outcome === 'lose');
    const wr = resolved.length ? Math.round(wins.length / resolved.length * 100) : 0;
    el('pr-total-bets').textContent = S.bets.length;
    el('pr-wins').textContent       = wins.length;
    el('pr-losses').textContent     = losses.length;
    el('pr-winrate').textContent    = wr + '%';

    const actEl = el('pr-activity');
    if (!S.bets.length) { actEl.innerHTML = '<div class="empty-state sm">Нет ставок</div>'; return; }
    actEl.innerHTML = S.bets.slice(0, 3).map(bet => {
      const label = bet.direction === 'up' ? '↑ UP' : '↓ DOWN';
      const status = bet.status === 'pending' ? 'В игре' : (bet.outcome === 'win' ? 'Победа' : 'Поражение');
      return `<div class="act-item">${bet.symbol} ${label} — $${bet.amount.toFixed(2)} — ${status}</div>`;
    }).join('');
  });
}

/* ══════════════════════════════════════
   ADMIN
══════════════════════════════════════ */
document.getElementById('refresh-admin-btn')?.addEventListener('click', loadAdminData);

document.querySelectorAll('.adm-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.adm-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.atab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('atab-' + btn.dataset.atab)?.classList.add('active');
  });
});

async function loadAdminData() {
  const [usersRes, betsRes] = await Promise.allSettled([
    api('GET', '/api/admin/users'),
    api('GET', '/api/admin/bets'),
  ]);
  if (usersRes.status === 'fulfilled') { S.admin.users = usersRes.value.users; renderAdminUsers(); }
  if (betsRes.status  === 'fulfilled') { S.admin.bets  = betsRes.value.bets;   renderAdminBets(); }
}

function renderAdminUsers() {
  const listEl = el('admin-users-list');
  if (!S.admin.users.length) { listEl.innerHTML = '<div class="empty-state">Нет пользователей</div>'; return; }
  listEl.innerHTML = S.admin.users.map(u => {
    const name    = esc(u.first_name || u.username || String(u.telegram_id));
    const meta    = [u.username ? '@' + u.username : null, u.phone_number].filter(Boolean).join(' • ');
    const setting = u.outcome_setting || 'random';
    return `<div class="auc" id="auc-${u.telegram_id}">
      <div class="auc-header" onclick="toggleAuc(${u.telegram_id})">
        <div>
          <div class="auc-name">${name}</div>
          <div class="auc-meta">${esc(meta || 'ID ' + u.telegram_id)}</div>
        </div>
        <div class="auc-right">
          <div class="auc-balance">$${(u.balance || 0).toFixed(2)}</div>
          <div class="auc-outcome">${setting}</div>
        </div>
      </div>
      <div class="auc-controls hidden" id="aucc-${u.telegram_id}">
        <div class="auc-ctrl-lbl">Исход ставок</div>
        <div class="outcome-btns">
          <button class="outcome-btn win ${setting==='win'?'active':''}" onclick="setOutcome(${u.telegram_id},'win')">Победа</button>
          <button class="outcome-btn lose ${setting==='lose'?'active':''}" onclick="setOutcome(${u.telegram_id},'lose')">Поражение</button>
          <button class="outcome-btn rand ${setting==='random'?'active':''}" onclick="setOutcome(${u.telegram_id},'random')">Рандом</button>
        </div>
        <div class="auc-ctrl-lbl">Баланс</div>
        <div class="balance-set-row">
          <input type="number" class="balance-input" id="balinput-${u.telegram_id}" value="${(u.balance||0).toFixed(2)}" min="0">
          <button class="balance-set-btn" onclick="setBalance(${u.telegram_id})">Сохранить</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleAuc(tid) { el('aucc-' + tid)?.classList.toggle('hidden'); }

async function setOutcome(tid, setting) {
  try {
    await api('POST', '/api/admin/outcome', { telegram_id: tid, setting });
    const u = S.admin.users.find(x => x.telegram_id === tid);
    if (u) u.outcome_setting = setting;
    const ctrl = el('aucc-' + tid);
    ctrl?.querySelectorAll('.outcome-btn').forEach(b => {
      const match = b.classList.contains(setting) || (setting === 'random' && b.classList.contains('rand'));
      b.classList.toggle('active', match);
    });
    el('auc-' + tid)?.querySelector('.auc-outcome')?.setAttribute('textContent', setting);
    if (el('auc-' + tid)?.querySelector('.auc-outcome')) el('auc-' + tid).querySelector('.auc-outcome').textContent = setting;
    S.tg?.HapticFeedback?.selectionChanged();
  } catch (e) { S.tg?.showAlert?.(e.message); }
}

async function setBalance(tid) {
  const input = el('balinput-' + tid);
  const amt   = parseFloat(input?.value);
  if (isNaN(amt) || amt < 0) return;
  try {
    await api('POST', '/api/admin/balance', { telegram_id: tid, amount: amt });
    const u = S.admin.users.find(x => x.telegram_id === tid);
    if (u) u.balance = amt;
    const card = el('auc-' + tid);
    if (card) card.querySelector('.auc-balance').textContent = '$' + amt.toFixed(2);
    S.tg?.HapticFeedback?.notificationOccurred('success');
  } catch (e) { S.tg?.showAlert?.(e.message); }
}

function renderAdminBets() {
  const listEl = el('admin-bets-list');
  if (!S.admin.bets.length) { listEl.innerHTML = '<div class="empty-state">Нет ставок</div>'; return; }
  listEl.innerHTML = S.admin.bets.map(bet => {
    const date = new Date(bet.created_at * 1000).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    const statusCls = bet.status === 'pending' ? 'pending' : bet.outcome;
    const statusLbl = bet.status === 'pending' ? 'В игре' : (bet.outcome === 'win' ? 'Победа' : 'Поражение');
    return `<div class="abc">
      <div class="abc-row"><span class="abc-lbl">ID</span><span class="abc-val">${bet.telegram_id}</span></div>
      <div class="abc-row"><span class="abc-lbl">Направление</span><span class="abc-val ${bet.direction}">${bet.direction === 'up' ? '↑ UP' : '↓ DOWN'}</span></div>
      <div class="abc-row"><span class="abc-lbl">Ставка</span><span class="abc-val">$${bet.amount.toFixed(2)}</span></div>
      <div class="abc-row"><span class="abc-lbl">Вход</span><span class="abc-val">$${bet.entry_price.toFixed(2)}</span></div>
      <div class="abc-row"><span class="abc-lbl">Статус</span><span class="abc-val ${statusCls}">${statusLbl}</span></div>
      <div class="abc-row"><span class="abc-lbl">Дата</span><span class="abc-val">${date}</span></div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════
   UTILS
══════════════════════════════════════ */
function el(id) { return document.getElementById(id); }
function pad(n) { return String(n).padStart(2, '0'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt(n) {
  if (!n && n !== 0) return '—';
  return parseFloat(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtK(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toFixed(0);
}

/* boot */
window.addEventListener('DOMContentLoaded', init);
