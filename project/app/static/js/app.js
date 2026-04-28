/* ═══════════════════════════════════
   STATE
═══════════════════════════════════ */
const POPULAR_MARKETS = [
  { symbol: 'BTCUSDT', label: 'BTC/USDT', name: 'Bitcoin' },
  { symbol: 'ETHUSDT', label: 'ETH/USDT', name: 'Ethereum' },
  { symbol: 'SOLUSDT', label: 'SOL/USDT', name: 'Solana' },
];
const DEFAULT_MARKET_SYMBOL = POPULAR_MARKETS[0].symbol;
const MARKET_STORAGE_KEY = 'cryptotrade:selectedSymbol';

const S = {
  tg: window.Telegram?.WebApp,
  initData: '',
  user: null,
  balance: 0,
  isAdmin: false,
  page: 'home',
  clock: { offsetMs: 0, syncedAt: 0 },
  chart: {
    candles: [],
    interval: '1m',
    price: 0,
    displayPrice: 0,
    targetPrice: 0,
    change: 0,
    high: 0,
    low: 0,
  },
  activeBet: null,
  bets: [],
  admin: { users: [], bets: [] },
  market: { options: POPULAR_MARKETS, selectedSymbol: DEFAULT_MARKET_SYMBOL, menuOpen: false },
  modal: { direction: 'up' },
};

/* ═══════════════════════════════════
   API
═══════════════════════════════════ */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (S.initData) opts.headers['X-Telegram-Init-Data'] = S.initData;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) {
    const data = await r.json().catch(() => ({ detail: r.statusText }));
    let msg;
    if (typeof data.detail === 'string') msg = data.detail;
    else if (Array.isArray(data.detail)) msg = data.detail.map(d => d.msg || d.message || JSON.stringify(d)).join('; ');
    else msg = `${r.status} ${r.statusText}`;
    throw new Error(msg);
  }
  const data = await r.json();
  if (typeof data?.server_time === 'number') syncServerClock(data.server_time);
  return data;
}

function syncServerClock(serverTime) {
  if (!Number.isFinite(serverTime)) return;
  const nextOffset = serverTime * 1000 - Date.now();
  S.clock.offsetMs = S.clock.syncedAt ? ((S.clock.offsetMs + nextOffset) / 2) : nextOffset;
  S.clock.syncedAt = Date.now();
}

function nowServerMs() {
  return Date.now() + S.clock.offsetMs;
}

function getSavedMarketSymbol() {
  try {
    const saved = window.localStorage?.getItem(MARKET_STORAGE_KEY);
    return S.market.options.some(option => option.symbol === saved) ? saved : DEFAULT_MARKET_SYMBOL;
  } catch (_) {
    return DEFAULT_MARKET_SYMBOL;
  }
}

function getMarketOption(symbol = S.market.selectedSymbol) {
  return S.market.options.find(option => option.symbol === symbol) || {
    symbol,
    label: fmtSymbol(symbol),
    name: 'Выбранная пара',
  };
}

function getSelectedMarketLabel() {
  return getMarketOption().label;
}

function renderPairUI() {
  const option = getMarketOption();
  const chip = el('pair-chip');
  if (el('pair-chip-label')) el('pair-chip-label').textContent = option.label;
  if (el('set-symbol')) el('set-symbol').textContent = option.label;
  if (el('bm-symbol')) el('bm-symbol').textContent = option.label;
  if (chip) chip.classList.toggle('locked', Boolean(S.activeBet));
  renderPairMenu();
}

function renderPairMenu() {
  const menu = el('pair-menu');
  if (!menu) return;
  menu.innerHTML = S.market.options.map(option => `
    <button
      class="pair-option ${option.symbol === S.market.selectedSymbol ? 'active' : ''}"
      type="button"
      data-symbol="${option.symbol}"
      role="option"
      aria-selected="${option.symbol === S.market.selectedSymbol ? 'true' : 'false'}"
    >
      <span class="pair-option-main">
        <span class="pair-option-symbol">${option.label}</span>
        <span class="pair-option-name">${option.name}</span>
      </span>
      <span class="pair-option-mark">${option.symbol.replace('USDT', '')}</span>
    </button>
  `).join('');

  menu.querySelectorAll('.pair-option').forEach(btn => {
    btn.addEventListener('click', () => selectMarket(btn.dataset.symbol));
  });
}

function openPairMenu() {
  if (S.activeBet) {
    const msg = `Нельзя менять пару, пока активна ставка по ${fmtSymbol(S.activeBet.symbol)}.`;
    S.tg?.showAlert?.(msg) || alert(msg);
    return;
  }
  S.market.menuOpen = true;
  renderPairMenu();
  el('pair-menu')?.classList.add('open');
  el('pair-chip')?.classList.add('open');
  el('pair-chip')?.setAttribute('aria-expanded', 'true');
}

function closePairMenu() {
  S.market.menuOpen = false;
  el('pair-menu')?.classList.remove('open');
  el('pair-chip')?.classList.remove('open');
  el('pair-chip')?.setAttribute('aria-expanded', 'false');
}

function togglePairMenu() {
  if (S.market.menuOpen) closePairMenu();
  else openPairMenu();
}

function selectMarket(symbol, options = {}) {
  const { persist = true, force = false, refresh = true } = options;
  if (!symbol) return;
  if (S.activeBet && !force && symbol !== S.market.selectedSymbol) {
    const msg = `Нельзя менять пару, пока активна ставка по ${fmtSymbol(S.activeBet.symbol)}.`;
    S.tg?.showAlert?.(msg) || alert(msg);
    return;
  }
  S.market.selectedSymbol = symbol;
  if (persist) {
    try { window.localStorage?.setItem(MARKET_STORAGE_KEY, symbol); } catch (_) {}
  }
  renderPairUI();
  closePairMenu();
  updateTrendStrip();
  updateModalHeader();
  if (refresh) loadChart();
}

/* ═══════════════════════════════════
   INIT
═══════════════════════════════════ */
async function init() {
  if (S.tg) {
    S.tg.ready(); S.tg.expand();
    S.tg.setHeaderColor?.('#050507');
    S.tg.setBackgroundColor?.('#050507');
    S.initData = S.tg.initData || '';
  }

  S.market.selectedSymbol = getSavedMarketSymbol();
  renderPairUI();

  try {
    const me = await api('GET', '/api/me');
    S.user      = me;
    S.balance   = me.balance ?? 0;
    S.activeBet = me.active_bet || null;
    if (S.activeBet?.symbol) selectMarket(S.activeBet.symbol, { persist: false, force: true, refresh: false });
    renderUserUI();
    if (S.activeBet) showActiveBet();
    else enableBetBtns();
  } catch (_) { enableBetBtns(); }

  try {
    await api('GET', '/api/admin/users');
    S.isAdmin = true;
    el('admin-section').classList.remove('hidden');
  } catch (_) {}

  await loadChart();
  startPricePoll();
  startLiveChartMotion();
  loadBets();

  el('loading-screen').classList.add('hidden');
  el('main-app').classList.remove('hidden');
}

/* ═══════════════════════════════════
   NAVIGATION
═══════════════════════════════════ */
document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

el('pair-chip')?.addEventListener('click', event => {
  event.stopPropagation();
  togglePairMenu();
});

function switchPage(page) {
  closeBetModal();
  closePairMenu();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  el('page-' + page)?.classList.add('active');
  el('tab-'  + page)?.classList.add('active');
  S.page = page;
  if (page === 'stats')                 renderStatsPage();
  if (page === 'profile')               renderProfilePage();
  if (page === 'settings' && S.isAdmin) loadAdminData();
}

/* ═══════════════════════════════════
   CHART
═══════════════════════════════════ */
async function loadChart() {
  el('chart-loader').classList.remove('hidden');
  try {
    const symbol = S.market.selectedSymbol;
    const [candles, ticker] = await Promise.all([
      fetch(`/api/klines/${symbol}?interval=${S.chart.interval}&limit=80`).then(r => r.json()),
      fetch(`/api/ticker24h/${symbol}`).then(r => r.json()),
    ]);
    S.chart.candles = candles;
    S.chart.price  = parseFloat(ticker.price);
    S.chart.targetPrice = S.chart.price;
    if (!Number.isFinite(S.chart.displayPrice) || !S.chart.displayPrice) {
      S.chart.displayPrice = S.chart.price;
    }
    if (Math.abs(S.chart.displayPrice - S.chart.price) > Math.max(S.chart.price * 0.004, 60)) {
      S.chart.displayPrice = S.chart.price;
    }
    S.chart.change = parseFloat(ticker.change);
    S.chart.high   = parseFloat(ticker.high);
    S.chart.low    = parseFloat(ticker.low);
    const last = S.chart.candles[S.chart.candles.length - 1];
    if (last) {
      last.c = S.chart.displayPrice;
      last.h = Math.max(last.h, S.chart.displayPrice);
      last.l = Math.min(last.l, S.chart.displayPrice);
    }
    updatePriceUI();
    drawChart();
  } catch (e) { console.warn('chart', e); }
  finally { el('chart-loader').classList.add('hidden'); }
}

function updatePriceUI() {
  const p = getVisualPrice(), ch = S.chart.change;
  el('sc-price').textContent = fmtPrice(p);
  const sign = ch >= 0 ? '+' : '';
  const chEl = el('sc-change');
  chEl.textContent = sign + ch.toFixed(2) + '%';
  chEl.className   = 'stat-card ' + (ch >= 0 ? 'green' : 'red');
  updateTrendStrip();
  updateModalHeader();
}

function updateTrendStrip() {
  if (S.activeBet) {
    const b = S.activeBet;
    el('trend-text').textContent = `${fmtSymbol(b.symbol)}   ${b.direction === 'up' ? '↑ РОСТ' : '↓ ПАДЕНИЕ'}   ВХОД ${fmtPrice(b.entry_price)}   СТАВКА ₽${b.amount}`;
  } else {
    const p = getVisualPrice();
    el('trend-text').textContent = p
      ? `${getSelectedMarketLabel()}   ВХОД ${fmtPrice(p)}   ЦЕЛЬ ${fmtPrice(p * 1.005)}   СТОП ${fmtPrice(p * 0.995)}`
      : 'ВХОД — &nbsp; ЦЕЛЬ — &nbsp; СТОП —';
  }
  const plEl = el('sc-pl');
  const visualPrice = getVisualPrice();
  if (S.activeBet && visualPrice) {
    const diff = visualPrice - S.activeBet.entry_price;
    const win  = S.activeBet.direction === 'up' ? diff > 0 : diff < 0;
    plEl.textContent = 'P/L ' + (win ? '+₽' : '-₽') + (S.activeBet.amount * 0.9).toFixed(0);
    plEl.className   = 'stat-card ' + (win ? 'green' : 'red');
  } else {
    plEl.textContent = 'P/L —';
    plEl.className   = 'stat-card';
  }
}

function drawChart() {
  const canvas = el('chart-canvas');
  const wrap   = canvas.parentElement;
  const dpr    = window.devicePixelRatio || 1;
  canvas.width  = wrap.clientWidth  * dpr;
  canvas.height = wrap.clientHeight * dpr;
  canvas.style.width  = wrap.clientWidth  + 'px';
  canvas.style.height = wrap.clientHeight + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const PL = 46, PR = 8, PT = 8, PB = 20;
  const cW = W - PL - PR, cH = H - PT - PB;
  const volH = Math.floor(cH * 0.15), candH = cH - volH - 4;
  const cc = S.chart.candles;
  if (!cc.length) return;
  const maxP = Math.max(...cc.map(c => c.h)), minP = Math.min(...cc.map(c => c.l));
  const pRange = maxP - minP || 1, maxV = Math.max(...cc.map(c => c.v)) || 1;
  const gap = cW / cc.length, cndW = Math.max(1.5, gap * 0.6);
  const pY = p => PT + candH * (1 - (p - minP) / pRange);
  ctx.fillStyle = '#111214'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1c2030'; ctx.lineWidth = .5;
  for (let i = 0; i <= 4; i++) {
    const y = PT + (candH / 4) * i;
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke();
    ctx.fillStyle = '#4a5568'; ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(fmtK(maxP - (pRange / 4) * i), PL - 3, y + 3);
  }
  cc.forEach((c, i) => {
    const x = PL + gap * i + gap / 2, bull = c.c >= c.o, col = bull ? '#00C7C7' : '#FF405C';
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, pY(c.h)); ctx.lineTo(x, pY(c.l)); ctx.stroke();
    const bY = Math.min(pY(c.o), pY(c.c)), bH = Math.max(1.5, Math.abs(pY(c.o) - pY(c.c)));
    ctx.fillStyle = col; ctx.fillRect(x - cndW / 2, bY, cndW, bH);
    const vbH = Math.max(1, (PT + candH + 4 + volH) - (PT + candH + 4 + volH * (1 - c.v / maxV)));
    ctx.fillStyle = bull ? 'rgba(0,199,199,.3)' : 'rgba(255,64,92,.3)';
    ctx.fillRect(x - cndW / 2, PT + candH + 4 + volH - vbH, cndW, vbH);
  });
  const visualPrice = getVisualPrice();
  if (visualPrice) {
    const py = pY(visualPrice);
    ctx.setLineDash([3, 4]); ctx.strokeStyle = '#00C7C7'; ctx.lineWidth = .8;
    ctx.beginPath(); ctx.moveTo(PL, py); ctx.lineTo(W - PR, py); ctx.stroke();
    ctx.setLineDash([]);
    const tag = fmtK(visualPrice);
    ctx.font = 'bold 9px Inter,sans-serif'; ctx.textAlign = 'right';
    const tw = ctx.measureText(tag).width + 10;
    ctx.fillStyle = '#3B3D42';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(PL - tw - 2, py - 10, tw, 18, 4);
    else ctx.rect(PL - tw - 2, py - 10, tw, 18);
    ctx.fill();
    ctx.fillStyle = '#F2F4F7'; ctx.fillText(tag, PL - 4, py + 3);
  }
  if (S.activeBet) {
    const entryY = pY(S.activeBet.entry_price);
    const accent = S.activeBet.direction === 'up' ? '#24F6A7' : '#FF5A6A';
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PL, entryY); ctx.lineTo(W - PR, entryY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = 'bold 9px Inter,sans-serif'; ctx.textAlign = 'left';
    const label = 'ENTRY';
    const tagW = ctx.measureText(label).width + 10;
    ctx.fillStyle = accent;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(W - PR - tagW - 4, entryY - 10, tagW, 16, 5);
      ctx.fill();
    } else {
      ctx.fillRect(W - PR - tagW - 4, entryY - 10, tagW, 16);
    }
    ctx.fillStyle = '#08110E';
    ctx.fillText(label, W - PR - tagW + 1, entryY + 1);
  }
  if (visualPrice) {
    const liveX = PL + gap * (cc.length - 1) + gap / 2;
    const liveY = pY(visualPrice);
    ctx.fillStyle = S.activeBet ? (S.activeBet.direction === 'up' ? '#24F6A7' : '#FF5A6A') : '#00C7C7';
    ctx.beginPath(); ctx.arc(liveX, liveY, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .22;
    ctx.beginPath(); ctx.arc(liveX, liveY, 8, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
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

document.querySelectorAll('.tf').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tf').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.chart.interval = btn.dataset.iv;
    el('set-interval').textContent = btn.dataset.iv;
    loadChart();
  });
});

function startPricePoll() {
  setInterval(async () => {
    try {
      const t = await fetch(`/api/ticker24h/${S.market.selectedSymbol}`).then(r => r.json());
      S.chart.price  = parseFloat(t.price);
      S.chart.targetPrice = S.chart.price;
      if (!Number.isFinite(S.chart.displayPrice) || !S.chart.displayPrice) {
        S.chart.displayPrice = S.chart.price;
      }
      if (Math.abs(S.chart.displayPrice - S.chart.price) > Math.max(S.chart.price * 0.006, 90)) {
        S.chart.displayPrice = S.chart.price;
      }
      S.chart.change = parseFloat(t.change);
      if (S.chart.candles.length) {
        const last = S.chart.candles[S.chart.candles.length - 1];
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

function startLiveChartMotion() {
  clearInterval(window._liveChartTimer);
  window._liveChartTimer = setInterval(() => {
    if (!S.chart.candles.length) return;
    if (S.page !== 'home' && !S.activeBet) return;
    const target = Number.isFinite(S.chart.targetPrice) && S.chart.targetPrice > 0
      ? S.chart.targetPrice
      : S.chart.price;
    if (!Number.isFinite(target) || target <= 0) return;
    if (!Number.isFinite(S.chart.displayPrice) || S.chart.displayPrice <= 0) {
      S.chart.displayPrice = target;
    }

    const avgRange = getRecentRangeAverage();
    const activeBoost = S.activeBet ? 1.8 : 1;
    const drift = (target - S.chart.displayPrice) * (S.activeBet ? 0.24 : 0.18);
    const jitterBase = Math.max(target * 0.000025, avgRange * 0.09, 0.22) * activeBoost;
    const jitter = (Math.random() - 0.5) * jitterBase;
    const clampRange = Math.max(jitterBase * 2.4, target * 0.0008);

    let next = S.chart.displayPrice + drift + jitter;
    next = clamp(next, target - clampRange, target + clampRange);

    if (Math.abs(next - target) < Math.max(0.06, jitterBase * 0.08)) {
      next = target;
    }

    S.chart.displayPrice = next;

    const last = S.chart.candles[S.chart.candles.length - 1];
    if (last) {
      last.c = next;
      last.h = Math.max(last.h, next);
      last.l = Math.min(last.l, next);
    }

    updatePriceUI();
    updateActiveBetPL();
    if (S.page === 'home') drawChart();
  }, 180);
}

function getRecentRangeAverage() {
  const sample = S.chart.candles.slice(-12);
  if (!sample.length) return 0;
  return sample.reduce((sum, candle) => sum + Math.abs(candle.h - candle.l), 0) / sample.length;
}

function getVisualPrice() {
  if (Number.isFinite(S.chart.displayPrice) && S.chart.displayPrice > 0) return S.chart.displayPrice;
  return S.chart.price;
}

/* ═══════════════════════════════════
   USER UI
═══════════════════════════════════ */
function renderUserUI() {
  if (!S.user) return;
  const name  = S.user.first_name || S.user.username || 'Пользователь';
  const uname = S.user.username ? '@' + S.user.username : 'ID ' + (S.user.telegram_id || '');
  el('hc-name').textContent      = uname;
  el('stats-hc-name').textContent = uname;
  el('pr-name').textContent      = name;
  el('pr-hero-name').textContent = name;
  el('pr-hero-meta').textContent = 'UID ' + (S.user.telegram_id || '—');
  renderBalance();
}

function renderBalance() {
  el('hc-bal-val').textContent  = '₽' + rub(S.balance);
  el('pr-bal').textContent      = '₽' + rub(S.balance);
  el('pr-hero-bal').textContent = rub(S.balance);
  if (el('bm-balance')) el('bm-balance').textContent = '₽' + rub(S.balance);
}

/* ═══════════════════════════════════
   BET MODAL
═══════════════════════════════════ */
el('open-up-btn').addEventListener('click',   () => openBetModal('up'));
el('open-down-btn').addEventListener('click', () => openBetModal('down'));

function openBetModal(direction) {
  if (S.activeBet) return;
  closePairMenu();
  S.modal.direction = direction;
  const hdr   = el('bm-dir-header');
  const arrow = el('bm-dir-arrow');
  const title = el('bm-dir-title');
  hdr.className   = 'bm-dir-header ' + direction;
  arrow.textContent = direction === 'up' ? '↑' : '↓';
  title.textContent = direction === 'up' ? 'РОСТ' : 'ПАДЕНИЕ';
  updateModalHeader();
  updateConfirmBtn();
  el('bet-modal').classList.add('open');
  el('bet-modal').setAttribute('aria-hidden', 'false');
  el('modal-overlay').classList.add('show');
  el('modal-overlay').setAttribute('aria-hidden', 'false');
  S.tg?.HapticFeedback?.impactOccurred('light');
}

function closeBetModal() {
  el('bet-modal').classList.remove('open');
  el('bet-modal').setAttribute('aria-hidden', 'true');
  el('modal-overlay').classList.remove('show');
  el('modal-overlay').setAttribute('aria-hidden', 'true');
}

function updateModalHeader() {
  const p  = S.chart.price;
  const ch = S.chart.change;
  if (el('bm-symbol')) el('bm-symbol').textContent = getSelectedMarketLabel();
  if (el('bm-price'))  el('bm-price').textContent  = p ? fmtPrice(p) : '—';
  if (el('bm-change')) {
    const sign = ch >= 0 ? '+' : '';
    el('bm-change').textContent = sign + ch.toFixed(2) + '%';
    el('bm-change').className   = 'bm-change-badge ' + (ch > 0 ? 'up' : ch < 0 ? 'down' : 'neutral');
  }
  if (el('bm-balance')) el('bm-balance').textContent = '₽' + rub(S.balance);
}

function updateConfirmBtn() {
  const btn    = el('bet-confirm-btn');
  const amount = parseFloat(el('bet-amount').value) || 0;
  const dir    = S.modal.direction;
  btn.className = 'bm-confirm ' + dir;
  btn.textContent = `Поставить ₽${amount} на ${dir === 'up' ? 'РОСТ' : 'ПАДЕНИЕ'}`;
  btn.disabled = !S.initData && amount <= 0;
}

document.querySelectorAll('.bm-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bm-preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    el('bet-amount').value = btn.dataset.val;
    updateConfirmBtn();
  });
});

document.querySelectorAll('.bm-dur').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bm-dur').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeBetModal();
});

document.addEventListener('click', e => {
  const chip = el('pair-chip');
  const menu = el('pair-menu');
  if (!chip || !menu || !S.market.menuOpen) return;
  if (chip.contains(e.target) || menu.contains(e.target)) return;
  closePairMenu();
});

el('bet-amount').addEventListener('input', () => {
  document.querySelectorAll('.bm-preset').forEach(b => b.classList.remove('active'));
  updateConfirmBtn();
});

el('bet-confirm-btn').addEventListener('click', () => placeBet(S.modal.direction));

function enableBetBtns()  { el('open-up-btn').disabled = false; el('open-down-btn').disabled = false; el('bet-confirm-btn').disabled = false; }
function disableBetBtns() { el('open-up-btn').disabled = true;  el('open-down-btn').disabled = true;  el('bet-confirm-btn').disabled = true; }

async function placeBet(direction) {
  const amount = parseFloat(el('bet-amount').value);
  const dur    = parseInt(document.querySelector('.bm-dur.active')?.dataset.dur || '60');
  if (!amount || amount <= 0) { alert('Введите сумму ставки'); return; }
  if (amount > S.balance) {
    const msg = `Недостаточно средств! Ваш баланс: ₽${rub(S.balance)}`;
    S.tg?.showAlert?.(msg) || alert(msg); return;
  }
  disableBetBtns();
  try {
    const res = await api('POST', '/api/bet', { direction, amount, symbol: S.market.selectedSymbol, duration: dur });
    S.activeBet = res.bet;
    S.balance   = res.balance;
    if (S.activeBet?.symbol) selectMarket(S.activeBet.symbol, { persist: false, force: true, refresh: false });
    renderBalance();
    closeBetModal();
    showActiveBet();
    S.tg?.HapticFeedback?.impactOccurred('medium');
  } catch (e) {
    const msg = e.message || 'Ошибка при размещении ставки';
    S.tg?.showAlert?.(msg) || alert(msg);
    enableBetBtns();
  }
}

function showActiveBet() {
  const b = S.activeBet; if (!b) return;
  if (b.symbol) selectMarket(b.symbol, { persist: false, force: true, refresh: false });
  disableBetBtns();
  el('active-bet-bar').classList.remove('hidden');
  syncChartBetState();
  renderPairUI();
  const dirIcon = el('abb-dir-icon');
  dirIcon.textContent = b.direction === 'up' ? '↑' : '↓';
  dirIcon.className   = 'abb-dir ' + b.direction;
  el('abb-label').textContent = `${fmtSymbol(b.symbol)} • ${b.direction === 'up' ? 'РОСТ' : 'ПАДЕНИЕ'} • ₽${b.amount}`;
  el('abb-entry').textContent = 'Вход: ' + fmtPrice(b.entry_price);
  // кнопки показывают что ставка активна
  el('open-up-btn').querySelector('.ab-sub').textContent   = '⏱ в игре';
  el('open-down-btn').querySelector('.ab-sub').textContent = '⏱ в игре';
  startBetTimer(b.resolve_at);
  updateTrendStrip();
}

function startBetTimer(resolveAt) {
  clearTimeout(window._betTimer);
  updateBetTimer(resolveAt);
}

function updateBetTimer(resolveAt) {
  const remainingMs = Math.max(0, resolveAt * 1000 - nowServerMs());
  if (remainingMs <= 0) {
    el('abb-timer').textContent = '00:00';
    clearTimeout(window._betTimer);
    pollResolution();
    return;
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  el('abb-timer').textContent = pad(Math.floor(totalSeconds / 60)) + ':' + pad(totalSeconds % 60);

  const nextTickDelay = (remainingMs % 1000) || 1000;
  clearTimeout(window._betTimer);
  window._betTimer = setTimeout(() => updateBetTimer(resolveAt), nextTickDelay + 18);
}

async function pollResolution() {
  for (let i = 0; i < 12; i++) {
    await sleep(2000);
    try {
      const res = await api('GET', '/api/bets');
      const bet = res.bets.find(b => b.id === S.activeBet?.id);
      if (bet?.status === 'resolved') {
        S.balance = res.balance; S.activeBet = null; S.bets = res.bets;
        renderBalance(); hideActiveBet(); enableBetBtns();
        const won = bet.outcome === 'win';
        const msg = won ? `🎉 Победа! +₽${bet.payout.toFixed(2)}` : `❌ Поражение. -₽${bet.amount.toFixed(2)}`;
        S.tg?.showAlert?.(msg) || alert(msg);
        S.tg?.HapticFeedback?.notificationOccurred(won ? 'success' : 'error');
        updateTrendStrip(); return;
      }
    } catch (_) {}
  }
}

function hideActiveBet() {
  clearTimeout(window._betTimer);
  el('active-bet-bar').classList.add('hidden');
  el('open-up-btn').querySelector('.ab-sub').textContent   = 'Long +90%';
  el('open-down-btn').querySelector('.ab-sub').textContent = 'Short -100%';
  renderPairUI();
  syncChartBetState();
}

function updateActiveBetPL() {
  const visualPrice = getVisualPrice();
  if (!S.activeBet || !visualPrice) return;
  const { direction, entry_price, amount } = S.activeBet;
  const diff = visualPrice - entry_price, win = direction === 'up' ? diff > 0 : diff < 0;
  const plEl = el('abb-pl');
  if (Math.abs(diff) < 1) { plEl.textContent = '~₽0';                          plEl.className = 'abb-pl neutral'; }
  else if (win)            { plEl.textContent = '+₽' + (amount * 0.9).toFixed(2); plEl.className = 'abb-pl profit'; }
  else                     { plEl.textContent = '-₽' + amount.toFixed(2);          plEl.className = 'abb-pl loss'; }
  updateTrendStrip();
}

function syncChartBetState() {
  const chartArea = el('chart-area');
  if (!chartArea) return;
  chartArea.classList.remove('active-bet', 'bet-up', 'bet-down');
  if (S.activeBet) {
    chartArea.classList.add('active-bet', 'bet-' + S.activeBet.direction);
  }
}

/* ═══════════════════════════════════
   BETS / STATS / PROFILE
═══════════════════════════════════ */
async function loadBets() {
  try {
    const res = await api('GET', '/api/bets');
    S.bets = res.bets; S.balance = res.balance; renderBalance();
  } catch (_) {}
}

function renderStatsPage() {
  loadBets().then(() => {
    const resolved = S.bets.filter(b => b.status === 'resolved');
    const wins     = resolved.filter(b => b.outcome === 'win');
    const losses   = resolved.filter(b => b.outcome === 'lose');
    const profit   = wins.reduce((s, b) => s + b.payout - b.amount, 0) - losses.reduce((s, b) => s + b.amount, 0);
    const invested = resolved.reduce((s, b) => s + b.amount, 0);
    const roi      = invested ? ((profit / invested) * 100).toFixed(1) : '0';
    const wr       = resolved.length ? Math.round(wins.length / resolved.length * 100) : 0;
    el('stats-big-pl').textContent = (profit >= 0 ? '+₽' : '-₽') + Math.abs(profit).toFixed(2);
    el('stats-big-pl').style.color = profit >= 0 ? 'var(--green)' : 'var(--red2)';
    el('stats-pl').textContent = (profit >= 0 ? '+₽' : '-₽') + Math.abs(profit).toFixed(2);
    el('m-roi').querySelector('.metric-val').textContent     = roi + '%';
    el('m-winrate').querySelector('.metric-val').textContent = wr + '%';
    el('m-draws').querySelector('.metric-val').textContent   = '₽' + losses.reduce((s, b) => s + b.amount, 0).toFixed(2);
    el('stats-total').textContent = S.bets.length;
    el('stats-wins').textContent  = wins.length;
    const best = [...wins].sort((a, b) => b.payout - a.payout)[0];
    el('stats-summary').textContent = best
      ? `Лучшая ставка: ₽${best.payout.toFixed(2)} на ${fmtSymbol(best.symbol)}   +${((best.payout / best.amount - 1) * 100).toFixed(0)}%`
      : 'Лучшая ставка: — +0%';
    const listEl = el('bets-list');
    if (!S.bets.length) { listEl.innerHTML = '<div class="empty-state">Нет ставок</div>'; return; }
    listEl.innerHTML = S.bets.slice(0, 15).map(bet => {
      const amt = bet.status === 'pending'
        ? `<span class="blc-amount pending">₽${bet.amount.toFixed(2)}</span>`
        : bet.outcome === 'win'
          ? `<span class="blc-amount win">+₽${bet.payout.toFixed(2)}</span>`
          : `<span class="blc-amount lose">-₽${bet.amount.toFixed(2)}</span>`;
      const date = new Date(bet.created_at * 1000).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      return `<div class="blc-item"><div class="blc-left"><div class="blc-dir ${bet.direction}">${bet.direction==='up'?'↑':'↓'}</div><div><div class="blc-label">${fmtSymbol(bet.symbol)} • ${bet.direction==='up'?'РОСТ':'ПАДЕНИЕ'}</div><div class="blc-date">${date}</div></div></div>${amt}</div>`;
    }).join('');
  });
}

function renderProfilePage() {
  loadBets().then(() => {
    const resolved = S.bets.filter(b => b.status === 'resolved');
    const wins     = resolved.filter(b => b.outcome === 'win');
    const losses   = resolved.filter(b => b.outcome === 'lose');
    const wr       = resolved.length ? Math.round(wins.length / resolved.length * 100) : 0;
    el('pr-total-bets').textContent = S.bets.length;
    el('pr-wins').textContent       = wins.length;
    el('pr-losses').textContent     = losses.length;
    el('pr-winrate').textContent    = wr + '%';
    const actEl = el('pr-activity');
    if (!S.bets.length) { actEl.innerHTML = '<div class="empty-state sm">Нет ставок</div>'; return; }
    actEl.innerHTML = S.bets.slice(0, 3).map(bet => {
      const dir    = bet.direction === 'up' ? '↑ РОСТ' : '↓ ПАДЕНИЕ';
      const status = bet.status === 'pending' ? 'В игре' : (bet.outcome === 'win' ? 'Победа' : 'Поражение');
      return `<div class="act-item">${fmtSymbol(bet.symbol)} ${dir} — ₽${bet.amount.toFixed(2)} — ${status}</div>`;
    }).join('');
  });
}

/* ═══════════════════════════════════
   ADMIN
═══════════════════════════════════ */
document.querySelectorAll('.adm-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.adm-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.atab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    el('atab-' + btn.dataset.atab)?.classList.add('active');
  });
});

async function loadAdminData() {
  const [ur, br] = await Promise.allSettled([api('GET', '/api/admin/users'), api('GET', '/api/admin/bets')]);
  if (ur.status === 'fulfilled') { S.admin.users = ur.value.users; renderAdminUsers(); }
  else el('admin-users-list').innerHTML = `<div class="empty-state">Ошибка: ${ur.reason.message}</div>`;
  if (br.status === 'fulfilled') { S.admin.bets = br.value.bets; renderAdminBets(); }
}

function renderAdminUsers() {
  const listEl = el('admin-users-list');
  if (!S.admin.users.length) { listEl.innerHTML = '<div class="empty-state">Нет пользователей</div>'; return; }
  listEl.innerHTML = S.admin.users.map(u => {
    // ВАЖНО: явно приводим к числу чтобы избежать undefined
    const tid     = Number(u.telegram_id);
    const name    = esc(u.first_name || u.username || 'ID ' + tid);
    const meta    = [u.username ? '@' + u.username : null, 'ID ' + tid].filter(Boolean).join(' • ');
    const setting = u.outcome_setting || 'random';
    return `<div class="auc" id="auc-${tid}">
      <div class="auc-header" onclick="toggleAuc(${tid})">
        <div>
          <div class="auc-name">${name}</div>
          <div class="auc-meta">${esc(meta)}</div>
        </div>
        <div class="auc-right">
          <div class="auc-balance">₽${(u.balance || 0).toFixed(2)}</div>
          <div class="auc-outcome" id="auc-outcome-${tid}">${setting}</div>
        </div>
      </div>
      <div class="auc-controls hidden" id="aucc-${tid}">
        <div class="auc-ctrl-lbl">Исход ставок</div>
        <div class="outcome-btns">
          <button class="outcome-btn win ${setting==='win'?'active':''}"    onclick="setOutcome(${tid},'win')">Победа</button>
          <button class="outcome-btn lose ${setting==='lose'?'active':''}"  onclick="setOutcome(${tid},'lose')">Пораж.</button>
          <button class="outcome-btn rand ${setting==='random'?'active':''}" onclick="setOutcome(${tid},'random')">Рандом</button>
        </div>
        <div class="auc-ctrl-lbl">Баланс (₽)</div>
        <div class="balance-set-row">
          <input type="number" class="balance-input" id="balinput-${tid}"
                 value="${(u.balance || 0).toFixed(2)}" min="0" step="100">
          <button class="balance-set-btn" onclick="setBalance(${tid})">Сохранить</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleAuc(tid) { el('aucc-' + tid)?.classList.toggle('hidden'); }

async function setOutcome(tid, setting) {
  // явно приводим tid к числу
  const tidNum = parseInt(tid, 10);
  if (!Number.isFinite(tidNum)) { alert('Ошибка: некорректный ID'); return; }
  try {
    await api('POST', '/api/admin/outcome', { telegram_id: tidNum, setting: String(setting) });
    const u = S.admin.users.find(x => Number(x.telegram_id) === tidNum);
    if (u) u.outcome_setting = setting;
    el('aucc-' + tidNum)?.querySelectorAll('.outcome-btn').forEach(b => {
      b.classList.toggle('active',
        b.classList.contains(setting) || (setting === 'random' && b.classList.contains('rand'))
      );
    });
    const lbl = el('auc-outcome-' + tidNum);
    if (lbl) lbl.textContent = setting;
    S.tg?.HapticFeedback?.selectionChanged();
  } catch (e) { alert('Ошибка: ' + e.message); }
}

async function setBalance(tid) {
  // явно приводим tid к числу
  const tidNum = parseInt(tid, 10);
  if (!Number.isFinite(tidNum)) { alert('Ошибка: некорректный ID'); return; }
  const input  = el('balinput-' + tidNum);
  // заменяем запятую на точку (русская локаль)
  const rawVal = String(input?.value || '').replace(',', '.');
  const amt    = parseFloat(rawVal);
  if (!Number.isFinite(amt) || amt < 0) { alert('Введите корректную сумму (числом)'); return; }
  try {
    const res = await api('POST', '/api/admin/balance', { telegram_id: tidNum, amount: amt });
    const u = S.admin.users.find(x => Number(x.telegram_id) === tidNum);
    if (u) u.balance = amt;
    const card = el('auc-' + tidNum);
    if (card) card.querySelector('.auc-balance').textContent = '₽' + amt.toFixed(2);
    S.tg?.HapticFeedback?.notificationOccurred('success');
    const msg = `✅ Баланс обновлён: ₽${amt.toFixed(2)}`;
    S.tg?.showAlert?.(msg) || alert(msg);
  } catch (e) { alert('Ошибка: ' + e.message); }
}

function renderAdminBets() {
  const listEl = el('admin-bets-list');
  if (!S.admin.bets.length) { listEl.innerHTML = '<div class="empty-state">Нет ставок</div>'; return; }
  listEl.innerHTML = S.admin.bets.map(bet => {
    const date   = new Date(bet.created_at * 1000).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    const stCls  = bet.status === 'pending' ? 'pending' : bet.outcome;
    const stLbl  = bet.status === 'pending' ? 'В игре' : (bet.outcome === 'win' ? 'Победа' : 'Поражение');
    return `<div class="abc">
      <div class="abc-row"><span class="abc-lbl">Пользователь</span><span class="abc-val">ID ${bet.telegram_id}</span></div>
      <div class="abc-row"><span class="abc-lbl">Инструмент</span><span class="abc-val">${fmtSymbol(bet.symbol)}</span></div>
      <div class="abc-row"><span class="abc-lbl">Направление</span><span class="abc-val ${bet.direction}">${bet.direction==='up'?'↑ РОСТ':'↓ ПАДЕНИЕ'}</span></div>
      <div class="abc-row"><span class="abc-lbl">Ставка</span><span class="abc-val">₽${bet.amount.toFixed(2)}</span></div>
      <div class="abc-row"><span class="abc-lbl">Вход</span><span class="abc-val">${fmtPrice(bet.entry_price)}</span></div>
      <div class="abc-row"><span class="abc-lbl">Статус</span><span class="abc-val ${stCls}">${stLbl}</span></div>
      <div class="abc-row"><span class="abc-lbl">Дата</span><span class="abc-val">${date}</span></div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════
   UTILS
═══════════════════════════════════ */
function el(id) { return document.getElementById(id); }
function pad(n) { return String(n).padStart(2, '0'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function rub(n) { return (parseFloat(n)||0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function fmtPrice(n) { if (!n && n !== 0) return '—'; return '$' + parseFloat(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n.toFixed(0); }
function fmtSymbol(symbol) {
  if (!symbol) return '—';
  return symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}/USDT` : symbol;
}
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

window.addEventListener('DOMContentLoaded', init);
