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
    change: 0,
    high: 0,
    low: 0,
  },
  activeBet: null,
  bets: [],
  admin: {
    profile: null,
    users: [],
    bets: [],
    workers: [],
  },
  market: {
    options: POPULAR_MARKETS,
    selectedSymbol: DEFAULT_MARKET_SYMBOL,
    menuOpen: false,
  },
  modal: {
    direction: 'up',
    keyboardOpen: false,
  },
};

async function api(method, path, body) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (S.initData) options.headers['X-Telegram-Init-Data'] = S.initData;
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(path, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: response.statusText }));
    let message = `${response.status} ${response.statusText}`;
    if (typeof data?.detail === 'string') message = data.detail;
    if (Array.isArray(data?.detail)) message = data.detail.map(item => item.msg || item.message || JSON.stringify(item)).join('; ');
    throw new Error(message);
  }

  const data = await response.json();
  if (typeof data?.server_time === 'number') syncServerClock(data.server_time);
  return data;
}

function syncServerClock(serverTime) {
  if (!Number.isFinite(serverTime)) return;
  const nextOffset = serverTime * 1000 - Date.now();
  S.clock.offsetMs = S.clock.syncedAt ? (S.clock.offsetMs + nextOffset) / 2 : nextOffset;
  S.clock.syncedAt = Date.now();
}

function nowServerMs() {
  return Date.now() + S.clock.offsetMs;
}

function showMessage(message) {
  S.tg?.showAlert?.(message) || alert(message);
}

function getSavedMarketSymbol() {
  try {
    const saved = window.localStorage?.getItem(MARKET_STORAGE_KEY);
    return S.market.options.some(option => option.symbol === saved) ? saved : DEFAULT_MARKET_SYMBOL;
  } catch (_) {
    return DEFAULT_MARKET_SYMBOL;
  }
}

function saveMarketSymbol(symbol) {
  try {
    window.localStorage?.setItem(MARKET_STORAGE_KEY, symbol);
  } catch (_) {}
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

  menu.querySelectorAll('.pair-option').forEach(button => {
    button.addEventListener('click', () => selectMarket(button.dataset.symbol));
  });
}

function renderPairUI() {
  const option = getMarketOption();
  if (el('pair-chip-label')) el('pair-chip-label').textContent = option.label;
  if (el('set-symbol')) el('set-symbol').textContent = option.label;
  if (el('bm-symbol')) el('bm-symbol').textContent = option.label;
  el('pair-chip')?.classList.toggle('locked', Boolean(S.activeBet));
  renderPairMenu();
}

function openPairMenu() {
  if (S.activeBet) {
    showMessage(`Нельзя менять пару, пока активна ставка по ${fmtSymbol(S.activeBet.symbol)}.`);
    return;
  }
  S.market.menuOpen = true;
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
    showMessage(`Нельзя менять пару, пока активна ставка по ${fmtSymbol(S.activeBet.symbol)}.`);
    return;
  }

  S.market.selectedSymbol = symbol;
  if (persist) saveMarketSymbol(symbol);
  renderPairUI();
  closePairMenu();
  updateTrendStrip();
  updateModalHeader();
  if (refresh) loadChart();
}

async function init() {
  if (S.tg) {
    S.tg.ready();
    S.tg.expand();
    S.tg.setHeaderColor?.('#050507');
    S.tg.setBackgroundColor?.('#050507');
    S.initData = S.tg.initData || '';
  }

  S.market.selectedSymbol = getSavedMarketSymbol();
  renderPairUI();

  try {
    const me = await api('GET', '/api/me');
    S.user = me;
    S.balance = me.balance ?? 0;
    S.activeBet = me.active_bet || null;
    if (S.activeBet?.symbol) {
      selectMarket(S.activeBet.symbol, { persist: false, force: true, refresh: false });
    }
    renderUserUI();
    if (S.activeBet) showActiveBet();
    else enableBetButtons();
  } catch (_) {
    enableBetButtons();
  }

  await loadAdminAccess();
  await Promise.all([loadChart(), loadBets()]);
  startPricePoll();

  el('loading-screen').classList.add('hidden');
  el('main-app').classList.remove('hidden');
}

document.querySelectorAll('.nav-tab').forEach(button => {
  button.addEventListener('click', () => switchPage(button.dataset.page));
});

el('pair-chip')?.addEventListener('click', event => {
  event.stopPropagation();
  togglePairMenu();
});

document.addEventListener('click', event => {
  const chip = el('pair-chip');
  const menu = el('pair-menu');
  if (!chip || !menu || !S.market.menuOpen) return;
  if (chip.contains(event.target) || menu.contains(event.target)) return;
  closePairMenu();
});

function switchPage(page) {
  closeBetModal();
  closePairMenu();
  document.querySelectorAll('.page').forEach(item => item.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(item => item.classList.remove('active'));
  el('page-' + page)?.classList.add('active');
  el('tab-' + page)?.classList.add('active');
  S.page = page;
  if (page === 'stats') renderStatsPage();
  if (page === 'profile') renderProfilePage();
  if (page === 'settings' && S.isAdmin) loadAdminData();
}

async function loadChart() {
  const loader = el('chart-loader');
  loader?.classList.remove('hidden');
  try {
    const symbol = S.market.selectedSymbol;
    const [candles, ticker] = await Promise.all([
      fetch(`/api/klines/${symbol}?interval=${S.chart.interval}&limit=80`).then(response => response.json()),
      fetch(`/api/ticker24h/${symbol}`).then(response => response.json()),
    ]);
    S.chart.candles = Array.isArray(candles) ? candles : [];
    S.chart.price = parseFloat(ticker.price) || 0;
    S.chart.change = parseFloat(ticker.change) || 0;
    S.chart.high = parseFloat(ticker.high) || 0;
    S.chart.low = parseFloat(ticker.low) || 0;
    updatePriceUI();
    drawChart();
  } catch (error) {
    console.warn('chart', error);
  } finally {
    loader?.classList.add('hidden');
  }
}

function updatePriceUI() {
  const price = S.chart.price;
  const change = S.chart.change;
  if (el('sc-price')) el('sc-price').textContent = fmtPrice(price);
  if (el('sc-change')) {
    el('sc-change').textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    el('sc-change').className = 'stat-card ' + (change >= 0 ? 'green' : 'red');
  }
  updateTrendStrip();
  updateModalHeader();
}

function updateTrendStrip() {
  if (!el('trend-text')) return;
  if (S.activeBet) {
    const bet = S.activeBet;
    el('trend-text').textContent = `${fmtSymbol(bet.symbol)}   ${bet.direction === 'up' ? '↑ РОСТ' : '↓ ПАДЕНИЕ'}   ВХОД ${fmtPrice(bet.entry_price)}   СТАВКА ₽${bet.amount}`;
  } else if (S.chart.price) {
    el('trend-text').textContent = `${getSelectedMarketLabel()}   ВХОД ${fmtPrice(S.chart.price)}   ЦЕЛЬ ${fmtPrice(S.chart.price * 1.005)}   СТОП ${fmtPrice(S.chart.price * 0.995)}`;
  } else {
    el('trend-text').textContent = 'ВХОД —   ЦЕЛЬ —   СТОП —';
  }

  const profitLoss = el('sc-pl');
  if (!profitLoss) return;
  if (S.activeBet && S.chart.price) {
    const diff = S.chart.price - S.activeBet.entry_price;
    const isWin = S.activeBet.direction === 'up' ? diff > 0 : diff < 0;
    profitLoss.textContent = 'P/L ' + (isWin ? '+₽' : '-₽') + (isWin ? (S.activeBet.amount * 0.9).toFixed(0) : S.activeBet.amount.toFixed(0));
    profitLoss.className = 'stat-card ' + (isWin ? 'green' : 'red');
  } else {
    profitLoss.textContent = 'P/L —';
    profitLoss.className = 'stat-card';
  }
}

function drawChart() {
  const canvas = el('chart-canvas');
  const wrap = el('chart-area');
  if (!canvas || !wrap || !S.chart.candles.length) return;

  const dpr = window.devicePixelRatio || 1;
  const width = wrap.clientWidth;
  const height = wrap.clientHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#111214';
  ctx.fillRect(0, 0, width, height);

  const candles = S.chart.candles.slice(-42);
  const paddingLeft = 44;
  const paddingRight = 18;
  const paddingTop = 10;
  const paddingBottom = 22;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const maxPrice = Math.max(...candles.map(item => item.h));
  const minPrice = Math.min(...candles.map(item => item.l));
  const priceRange = Math.max(maxPrice - minPrice, 1);
  const step = chartWidth / Math.max(candles.length, 1);

  const yForPrice = price => paddingTop + chartHeight * (1 - (price - minPrice) / priceRange);

  ctx.strokeStyle = '#1c2030';
  ctx.lineWidth = 0.6;
  for (let index = 0; index <= 4; index += 1) {
    const y = paddingTop + chartHeight * (index / 4);
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(width - paddingRight, y);
    ctx.stroke();
    const label = (maxPrice - (priceRange * index) / 4).toFixed(0);
    ctx.fillStyle = '#4a5568';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(label, paddingLeft - 4, y + 3);
  }

  candles.forEach((candle, index) => {
    const x = paddingLeft + step * index + step / 2;
    const isBull = candle.c >= candle.o;
    const color = isBull ? '#24F6A7' : '#FF5A6A';
    const bodyTop = yForPrice(Math.max(candle.c, candle.o));
    const bodyBottom = yForPrice(Math.min(candle.c, candle.o));
    const bodyHeight = Math.max(2, bodyBottom - bodyTop);
    const bodyWidth = Math.max(3, step * 0.58);

    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, yForPrice(candle.h));
    ctx.lineTo(x, yForPrice(candle.l));
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
  });

  if (S.chart.price) {
    const priceY = yForPrice(S.chart.price);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#4DD5FF';
    ctx.beginPath();
    ctx.moveTo(paddingLeft, priceY);
    ctx.lineTo(width - paddingRight, priceY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#4DD5FF';
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(fmtPriceShort(S.chart.price), paddingLeft + 8, Math.max(14, priceY - 6));
  }

  if (S.activeBet?.entry_price) {
    const entryY = yForPrice(S.activeBet.entry_price);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = S.activeBet.direction === 'up' ? '#24F6A7' : '#FF5A6A';
    ctx.beginPath();
    ctx.moveTo(paddingLeft, entryY);
    ctx.lineTo(width - paddingRight, entryY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

document.querySelectorAll('.tf').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tf').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    S.chart.interval = button.dataset.iv;
    if (el('set-interval')) el('set-interval').textContent = button.dataset.iv;
    loadChart();
  });
});

function startPricePoll() {
  clearInterval(window.__pricePollTimer);
  clearInterval(window.__chartReloadTimer);

  window.__pricePollTimer = setInterval(async () => {
    try {
      const ticker = await fetch(`/api/ticker24h/${S.market.selectedSymbol}`).then(response => response.json());
      S.chart.price = parseFloat(ticker.price) || S.chart.price;
      S.chart.change = parseFloat(ticker.change) || 0;
      S.chart.high = parseFloat(ticker.high) || 0;
      S.chart.low = parseFloat(ticker.low) || 0;
      updatePriceUI();
      if (S.page === 'home') drawChart();
      updateActiveBetPL();
    } catch (_) {}
  }, 3000);

  window.__chartReloadTimer = setInterval(() => {
    if (S.page === 'home') loadChart();
  }, 60000);
}

window.addEventListener('resize', () => {
  if (S.page === 'home') drawChart();
  syncModalViewport();
});

function renderUserUI() {
  if (!S.user) return;
  const name = S.user.first_name || S.user.username || 'Пользователь';
  const username = S.user.username ? '@' + S.user.username : 'ID ' + (S.user.telegram_id || '');
  if (el('hc-name')) el('hc-name').textContent = username;
  if (el('stats-hc-name')) el('stats-hc-name').textContent = username;
  if (el('pr-name')) el('pr-name').textContent = name;
  if (el('pr-hero-name')) el('pr-hero-name').textContent = name;
  if (el('pr-hero-meta')) el('pr-hero-meta').textContent = 'UID ' + (S.user.telegram_id || '—');
  renderBalance();
}

function renderBalance() {
  if (el('hc-bal-val')) el('hc-bal-val').textContent = '₽' + rub(S.balance);
  if (el('pr-bal')) el('pr-bal').textContent = '₽' + rub(S.balance);
  if (el('pr-hero-bal')) el('pr-hero-bal').textContent = rub(S.balance);
  if (el('bm-balance')) el('bm-balance').textContent = '₽' + rub(S.balance);
}

el('open-up-btn')?.addEventListener('click', () => openBetModal('up'));
el('open-down-btn')?.addEventListener('click', () => openBetModal('down'));
el('bet-confirm-btn')?.addEventListener('click', () => placeBet(S.modal.direction));
el('bet-amount')?.addEventListener('input', () => {
  document.querySelectorAll('.bm-preset').forEach(button => button.classList.remove('active'));
  updateConfirmButton();
  syncModalViewport();
});

el('bet-amount')?.addEventListener('focus', () => {
  window.setTimeout(syncModalViewport, 40);
});

el('bet-amount')?.addEventListener('blur', () => {
  window.setTimeout(syncModalViewport, 120);
});

document.querySelectorAll('.bm-preset').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.bm-preset').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    if (el('bet-amount')) el('bet-amount').value = button.dataset.val;
    updateConfirmButton();
  });
});

document.querySelectorAll('.bm-dur').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.bm-dur').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
  });
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeBetModal();
});

window.visualViewport?.addEventListener('resize', syncModalViewport);
window.visualViewport?.addEventListener('scroll', syncModalViewport);

function openBetModal(direction) {
  if (S.activeBet) return;
  S.modal.direction = direction;
  const header = el('bm-dir-header');
  if (header) header.className = 'bm-dir-header ' + direction;
  if (el('bm-dir-arrow')) el('bm-dir-arrow').textContent = direction === 'up' ? '↑' : '↓';
  if (el('bm-dir-title')) el('bm-dir-title').textContent = direction === 'up' ? 'РОСТ' : 'ПАДЕНИЕ';
  updateModalHeader();
  updateConfirmButton();
  el('bet-modal')?.classList.add('open');
  el('bet-modal')?.setAttribute('aria-hidden', 'false');
  el('modal-overlay')?.classList.add('show');
  el('modal-overlay')?.setAttribute('aria-hidden', 'false');
  syncModalViewport();
  window.setTimeout(() => {
    const amountInput = el('bet-amount');
    amountInput?.focus({ preventScroll: true });
    amountInput?.select?.();
    syncModalViewport();
  }, 80);
}

function closeBetModal() {
  el('bet-modal')?.classList.remove('open');
  el('bet-modal')?.setAttribute('aria-hidden', 'true');
  el('modal-overlay')?.classList.remove('show');
  el('modal-overlay')?.setAttribute('aria-hidden', 'true');
  S.modal.keyboardOpen = false;
  syncModalViewport();
}

function updateModalHeader() {
  const price = S.chart.price;
  const change = S.chart.change;
  if (el('bm-symbol')) el('bm-symbol').textContent = getSelectedMarketLabel();
  if (el('bm-price')) el('bm-price').textContent = price ? fmtPrice(price) : '—';
  if (el('bm-change')) {
    el('bm-change').textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    el('bm-change').className = 'bm-change-badge ' + (change > 0 ? 'up' : change < 0 ? 'down' : 'neutral');
  }
  if (el('bm-balance')) el('bm-balance').textContent = '₽' + rub(S.balance);
}

function updateConfirmButton() {
  const button = el('bet-confirm-btn');
  if (!button) return;
  const amount = parseFloat(el('bet-amount')?.value || '0') || 0;
  const direction = S.modal.direction;
  button.className = 'bm-confirm ' + direction;
  button.textContent = `Поставить ₽${amount} на ${direction === 'up' ? 'РОСТ' : 'ПАДЕНИЕ'}`;
  button.disabled = amount <= 0 || !S.initData;
}

function syncModalViewport() {
  const modal = el('bet-modal');
  if (!modal) return;

  const rootStyle = document.documentElement.style;
  const viewport = window.visualViewport;
  const baseHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  let keyboardOffset = 0;
  let viewportHeight = baseHeight;

  if (viewport) {
    viewportHeight = viewport.height;
    keyboardOffset = Math.max(0, baseHeight - (viewport.height + viewport.offsetTop));
  }

  S.modal.keyboardOpen = keyboardOffset > 120;
  modal.classList.toggle('keyboard-open', S.modal.keyboardOpen);
  rootStyle.setProperty('--bet-modal-bottom-offset', `${Math.max(0, keyboardOffset)}px`);
  rootStyle.setProperty('--bet-modal-max-height', `${Math.max(320, viewportHeight)}px`);

  if (S.modal.keyboardOpen) {
    const focused = document.activeElement;
    if (focused && modal.contains(focused)) {
      window.setTimeout(() => {
        focused.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 60);
    }
  }
}

function enableBetButtons() {
  if (el('open-up-btn')) el('open-up-btn').disabled = false;
  if (el('open-down-btn')) el('open-down-btn').disabled = false;
  if (el('bet-confirm-btn')) el('bet-confirm-btn').disabled = false;
}

function disableBetButtons() {
  if (el('open-up-btn')) el('open-up-btn').disabled = true;
  if (el('open-down-btn')) el('open-down-btn').disabled = true;
  if (el('bet-confirm-btn')) el('bet-confirm-btn').disabled = true;
}

async function placeBet(direction) {
  const amount = parseFloat(el('bet-amount')?.value || '0');
  const duration = parseInt(document.querySelector('.bm-dur.active')?.dataset.dur || '60', 10);
  if (!amount || amount <= 0) {
    showMessage('Введите сумму ставки');
    return;
  }
  if (amount > S.balance) {
    showMessage(`Недостаточно средств. Баланс: ₽${rub(S.balance)}`);
    return;
  }

  disableBetButtons();
  try {
    const result = await api('POST', '/api/bet', {
      direction,
      amount,
      symbol: S.market.selectedSymbol,
      duration,
    });
    S.activeBet = result.bet;
    S.balance = result.balance;
    if (S.activeBet?.symbol) selectMarket(S.activeBet.symbol, { persist: false, force: true, refresh: false });
    renderBalance();
    closeBetModal();
    showActiveBet();
    S.tg?.HapticFeedback?.impactOccurred('medium');
  } catch (error) {
    enableBetButtons();
    showMessage(error.message || 'Ошибка при размещении ставки');
  }
}

function showActiveBet() {
  const bet = S.activeBet;
  if (!bet) return;
  disableBetButtons();
  el('active-bet-bar')?.classList.remove('hidden');
  renderPairUI();
  syncChartBetState();
  if (el('abb-dir-icon')) {
    el('abb-dir-icon').textContent = bet.direction === 'up' ? '↑' : '↓';
    el('abb-dir-icon').className = 'abb-dir ' + bet.direction;
  }
  if (el('abb-label')) el('abb-label').textContent = `${fmtSymbol(bet.symbol)} • ${bet.direction === 'up' ? 'РОСТ' : 'ПАДЕНИЕ'} • ₽${bet.amount}`;
  if (el('abb-entry')) el('abb-entry').textContent = 'Вход: ' + fmtPrice(bet.entry_price);
  if (el('open-up-btn')?.querySelector('.ab-sub')) el('open-up-btn').querySelector('.ab-sub').textContent = '⏱ в игре';
  if (el('open-down-btn')?.querySelector('.ab-sub')) el('open-down-btn').querySelector('.ab-sub').textContent = '⏱ в игре';
  startBetTimer(bet.resolve_at);
  updateActiveBetPL();
  updateTrendStrip();
}

function hideActiveBet() {
  clearTimeout(window.__betTimer);
  el('active-bet-bar')?.classList.add('hidden');
  if (el('open-up-btn')?.querySelector('.ab-sub')) el('open-up-btn').querySelector('.ab-sub').textContent = 'Long +90%';
  if (el('open-down-btn')?.querySelector('.ab-sub')) el('open-down-btn').querySelector('.ab-sub').textContent = 'Short -100%';
  renderPairUI();
  syncChartBetState();
}

function syncChartBetState() {
  const chartArea = el('chart-area');
  if (!chartArea) return;
  chartArea.classList.remove('active-bet', 'bet-up', 'bet-down');
  if (S.activeBet) chartArea.classList.add('active-bet', 'bet-' + S.activeBet.direction);
}

function startBetTimer(resolveAt) {
  clearTimeout(window.__betTimer);
  updateBetTimer(resolveAt);
}

function updateBetTimer(resolveAt) {
  const remainingMs = Math.max(0, resolveAt * 1000 - nowServerMs());
  if (remainingMs <= 0) {
    if (el('abb-timer')) el('abb-timer').textContent = '00:00';
    pollResolution();
    return;
  }
  const totalSeconds = Math.ceil(remainingMs / 1000);
  if (el('abb-timer')) el('abb-timer').textContent = `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
  window.__betTimer = setTimeout(() => updateBetTimer(resolveAt), (remainingMs % 1000) || 1000);
}

async function pollResolution() {
  for (let index = 0; index < 12; index += 1) {
    await sleep(2000);
    try {
      const result = await api('GET', '/api/bets');
      const bet = result.bets.find(item => item.id === S.activeBet?.id);
      if (!bet || bet.status !== 'resolved') continue;
      S.balance = result.balance;
      S.activeBet = null;
      S.bets = result.bets;
      renderBalance();
      hideActiveBet();
      enableBetButtons();
      const won = bet.outcome === 'win';
      showMessage(won ? `Победа! +₽${bet.payout.toFixed(2)}` : `Поражение. -₽${bet.amount.toFixed(2)}`);
      S.tg?.HapticFeedback?.notificationOccurred(won ? 'success' : 'error');
      updateTrendStrip();
      return;
    } catch (_) {}
  }
}

function updateActiveBetPL() {
  if (!S.activeBet || !S.chart.price || !el('abb-pl')) return;
  const diff = S.chart.price - S.activeBet.entry_price;
  const isWin = S.activeBet.direction === 'up' ? diff > 0 : diff < 0;
  const element = el('abb-pl');
  if (Math.abs(diff) < 1) {
    element.textContent = '~₽0';
    element.className = 'abb-pl neutral';
  } else if (isWin) {
    element.textContent = '+₽' + (S.activeBet.amount * 0.9).toFixed(2);
    element.className = 'abb-pl profit';
  } else {
    element.textContent = '-₽' + S.activeBet.amount.toFixed(2);
    element.className = 'abb-pl loss';
  }
  updateTrendStrip();
}

async function loadBets() {
  try {
    const result = await api('GET', '/api/bets');
    S.bets = result.bets || [];
    S.balance = result.balance || S.balance;
    renderBalance();
  } catch (_) {}
}

function renderStatsPage() {
  loadBets().then(() => {
    const resolved = S.bets.filter(bet => bet.status === 'resolved');
    const wins = resolved.filter(bet => bet.outcome === 'win');
    const losses = resolved.filter(bet => bet.outcome === 'lose');
    const netProfit = wins.reduce((sum, bet) => sum + (bet.payout - bet.amount), 0) - losses.reduce((sum, bet) => sum + bet.amount, 0);
    const invested = resolved.reduce((sum, bet) => sum + bet.amount, 0);
    const roi = invested ? ((netProfit / invested) * 100).toFixed(1) : '0';
    const winRate = resolved.length ? Math.round((wins.length / resolved.length) * 100) : 0;

    if (el('stats-big-pl')) {
      el('stats-big-pl').textContent = `${netProfit >= 0 ? '+' : '-'}₽${Math.abs(netProfit).toFixed(2)}`;
      el('stats-big-pl').style.color = netProfit >= 0 ? 'var(--green)' : 'var(--red2)';
    }
    if (el('stats-pl')) el('stats-pl').textContent = `${netProfit >= 0 ? '+' : '-'}₽${Math.abs(netProfit).toFixed(2)}`;
    if (el('m-roi')) el('m-roi').querySelector('.metric-val').textContent = roi + '%';
    if (el('m-winrate')) el('m-winrate').querySelector('.metric-val').textContent = winRate + '%';
    if (el('m-draws')) el('m-draws').querySelector('.metric-val').textContent = '₽' + losses.reduce((sum, bet) => sum + bet.amount, 0).toFixed(2);
    if (el('stats-total')) el('stats-total').textContent = String(S.bets.length);
    if (el('stats-wins')) el('stats-wins').textContent = String(wins.length);

    const bestWin = [...wins].sort((a, b) => b.payout - a.payout)[0];
    if (el('stats-summary')) {
      el('stats-summary').textContent = bestWin
        ? `Лучшая ставка: ₽${bestWin.payout.toFixed(2)} на ${fmtSymbol(bestWin.symbol)}`
        : 'Лучшая ставка: —';
    }

    const list = el('bets-list');
    if (!list) return;
    if (!S.bets.length) {
      list.innerHTML = '<div class="empty-state">Нет ставок</div>';
      return;
    }
    list.innerHTML = S.bets.slice(0, 15).map(bet => {
      const amountLabel = bet.status === 'pending'
        ? `<span class="blc-amount pending">₽${bet.amount.toFixed(2)}</span>`
        : bet.outcome === 'win'
          ? `<span class="blc-amount win">+₽${bet.payout.toFixed(2)}</span>`
          : `<span class="blc-amount lose">-₽${bet.amount.toFixed(2)}</span>`;
      const date = new Date(bet.created_at * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      return `<div class="blc-item">
        <div class="blc-left">
          <div class="blc-dir ${bet.direction}">${bet.direction === 'up' ? '↑' : '↓'}</div>
          <div>
            <div class="blc-label">${fmtSymbol(bet.symbol)} • ${bet.direction === 'up' ? 'РОСТ' : 'ПАДЕНИЕ'}</div>
            <div class="blc-date">${date}</div>
          </div>
        </div>
        ${amountLabel}
      </div>`;
    }).join('');
  });
}

function renderProfilePage() {
  loadBets().then(() => {
    const resolved = S.bets.filter(bet => bet.status === 'resolved');
    const wins = resolved.filter(bet => bet.outcome === 'win');
    const losses = resolved.filter(bet => bet.outcome === 'lose');
    const winRate = resolved.length ? Math.round((wins.length / resolved.length) * 100) : 0;

    if (el('pr-total-bets')) el('pr-total-bets').textContent = String(S.bets.length);
    if (el('pr-wins')) el('pr-wins').textContent = String(wins.length);
    if (el('pr-losses')) el('pr-losses').textContent = String(losses.length);
    if (el('pr-winrate')) el('pr-winrate').textContent = winRate + '%';

    const activity = el('pr-activity');
    if (!activity) return;
    if (!S.bets.length) {
      activity.innerHTML = '<div class="empty-state sm">Нет ставок</div>';
      return;
    }

    activity.innerHTML = S.bets.slice(0, 3).map(bet => {
      const direction = bet.direction === 'up' ? '↑ РОСТ' : '↓ ПАДЕНИЕ';
      const status = bet.status === 'pending' ? 'В игре' : (bet.outcome === 'win' ? 'Победа' : 'Поражение');
      return `<div class="act-item">${fmtSymbol(bet.symbol)} ${direction} — ₽${bet.amount.toFixed(2)} — ${status}</div>`;
    }).join('');
  });
}

document.querySelectorAll('.adm-tab').forEach(button => {
  button.addEventListener('click', () => activateAdminTab(button.dataset.atab));
});

el('worker-username-input')?.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  createWorker();
});

async function loadAdminAccess() {
  try {
    const result = await api('GET', '/api/admin/access');
    S.isAdmin = true;
    S.admin.profile = result.admin;
    el('admin-section')?.classList.remove('hidden');
    renderAdminShell();
    return true;
  } catch (_) {
    S.isAdmin = false;
    S.admin.profile = null;
    el('admin-section')?.classList.add('hidden');
    return false;
  }
}

function getCurrentAdminTab() {
  return document.querySelector('.adm-tab.active')?.dataset.atab || null;
}

function activateAdminTab(tab) {
  const target = tab && !el('admin-tab-' + tab)?.classList.contains('hidden') ? tab : 'bets';
  document.querySelectorAll('.adm-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.atab === target);
  });
  document.querySelectorAll('.atab-content').forEach(content => {
    content.classList.toggle('active', content.id === 'atab-' + target);
  });
}

function renderAdminShell() {
  const profile = S.admin.profile;
  if (!profile) return;

  const isOwner = profile.role === 'owner';
  if (el('admin-title')) el('admin-title').textContent = isOwner ? 'Панель главного админа' : 'Панель воркера';
  if (el('admin-subtitle')) {
    el('admin-subtitle').textContent = isOwner
      ? 'Игроки, ставки и контроль воркеров в одном месте.'
      : `Ваш код: ${profile.worker_code || '—'} • Клиентов: ${profile.clients_total || 0}`;
  }
  el('admin-tab-users')?.classList.toggle('hidden', !isOwner);
  el('admin-tab-workers')?.classList.toggle('hidden', !isOwner);
  el('worker-create-card')?.classList.toggle('hidden', !isOwner);
  if (el('admin-tab-bets')) el('admin-tab-bets').textContent = isOwner ? 'Ставки' : 'Мои ставки';
  const activeTab = getCurrentAdminTab();
  activateAdminTab(isOwner ? (activeTab === 'bets' || activeTab === 'workers' ? activeTab : 'users') : 'bets');
}

async function loadAdminData() {
  const hasAccess = S.admin.profile ? true : await loadAdminAccess();
  if (!hasAccess || !S.admin.profile) return;

  renderAdminShell();
  const isOwner = S.admin.profile.role === 'owner';
  const [usersResult, betsResult, workersResult] = await Promise.allSettled([
    isOwner ? api('GET', '/api/admin/users') : Promise.resolve(null),
    api('GET', '/api/admin/bets'),
    isOwner ? api('GET', '/api/admin/workers') : Promise.resolve(null),
  ]);

  if (isOwner) {
    if (usersResult.status === 'fulfilled' && usersResult.value) {
      S.admin.users = usersResult.value.users || [];
      renderAdminUsers();
    } else {
      el('admin-users-list').innerHTML = `<div class="empty-state">Ошибка: ${usersResult.reason?.message || 'не удалось загрузить игроков'}</div>`;
    }
  }

  if (betsResult.status === 'fulfilled' && betsResult.value) {
    S.admin.bets = betsResult.value.bets || [];
    renderAdminBets();
  } else {
    el('admin-bets-list').innerHTML = `<div class="empty-state">Ошибка: ${betsResult.reason?.message || 'не удалось загрузить ставки'}</div>`;
  }

  if (isOwner) {
    if (workersResult.status === 'fulfilled' && workersResult.value) {
      S.admin.workers = workersResult.value.workers || [];
      renderAdminWorkers();
    } else {
      el('admin-workers-list').innerHTML = `<div class="empty-state">Ошибка: ${workersResult.reason?.message || 'не удалось загрузить воркеров'}</div>`;
    }
  }
}

function formatReferralLabel(user) {
  if (user.worker_code === '0000') return 'Тестовый код 0000';
  if (user.worker_username && user.worker_code) return `Привёл @${user.worker_username} • код ${user.worker_code}`;
  return 'Клиент без воркера';
}

function renderAdminUsers() {
  const list = el('admin-users-list');
  if (!list) return;
  if (!S.admin.users.length) {
    list.innerHTML = '<div class="empty-state">Нет игроков</div>';
    return;
  }

  list.innerHTML = S.admin.users.map(user => {
    const telegramId = Number(user.telegram_id);
    const name = esc(user.first_name || user.username || ('ID ' + telegramId));
    const meta = [user.username ? '@' + user.username : null, 'ID ' + telegramId].filter(Boolean).join(' • ');
    const setting = user.outcome_setting || 'random';
    return `<div class="auc" id="auc-${telegramId}">
      <div class="auc-header" onclick="toggleAuc(${telegramId})">
        <div>
          <div class="auc-name">${name}</div>
          <div class="auc-meta">${esc(meta)}</div>
          <div class="auc-ref">${esc(formatReferralLabel(user))}</div>
        </div>
        <div class="auc-right">
          <div class="auc-balance">₽${(user.balance || 0).toFixed(2)}</div>
          <div class="auc-outcome" id="auc-outcome-${telegramId}">${setting}</div>
        </div>
      </div>
      <div class="auc-controls hidden" id="aucc-${telegramId}">
        <div class="auc-ctrl-lbl">Исход ставок</div>
        <div class="outcome-btns">
          <button class="outcome-btn win ${setting === 'win' ? 'active' : ''}" onclick="setOutcome(${telegramId}, 'win')">Победа</button>
          <button class="outcome-btn lose ${setting === 'lose' ? 'active' : ''}" onclick="setOutcome(${telegramId}, 'lose')">Поражение</button>
          <button class="outcome-btn rand ${setting === 'random' ? 'active' : ''}" onclick="setOutcome(${telegramId}, 'random')">Рандом</button>
        </div>
        <div class="auc-ctrl-lbl">Баланс (₽)</div>
        <div class="balance-set-row">
          <input type="number" class="balance-input" id="balinput-${telegramId}" value="${(user.balance || 0).toFixed(2)}" min="0" step="100">
          <button class="balance-set-btn" onclick="setBalance(${telegramId})">Сохранить</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleAuc(tid) {
  el('aucc-' + tid)?.classList.toggle('hidden');
}

async function setOutcome(tid, setting) {
  const telegramId = parseInt(tid, 10);
  if (!Number.isFinite(telegramId)) {
    showMessage('Некорректный ID игрока');
    return;
  }

  try {
    await api('POST', '/api/admin/outcome', { telegram_id: telegramId, setting });
    const user = S.admin.users.find(item => Number(item.telegram_id) === telegramId);
    if (user) user.outcome_setting = setting;
    el('aucc-' + telegramId)?.querySelectorAll('.outcome-btn').forEach(button => {
      button.classList.toggle('active', button.classList.contains(setting) || (setting === 'random' && button.classList.contains('rand')));
    });
    if (el('auc-outcome-' + telegramId)) el('auc-outcome-' + telegramId).textContent = setting;
    S.tg?.HapticFeedback?.selectionChanged();
  } catch (error) {
    showMessage(error.message);
  }
}

async function setBalance(tid) {
  const telegramId = parseInt(tid, 10);
  if (!Number.isFinite(telegramId)) {
    showMessage('Некорректный ID игрока');
    return;
  }

  const amount = parseFloat(String(el('balinput-' + telegramId)?.value || '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0) {
    showMessage('Введите корректную сумму');
    return;
  }

  try {
    await api('POST', '/api/admin/balance', { telegram_id: telegramId, amount });
    const user = S.admin.users.find(item => Number(item.telegram_id) === telegramId);
    if (user) user.balance = amount;
    const card = el('auc-' + telegramId);
    if (card) card.querySelector('.auc-balance').textContent = '₽' + amount.toFixed(2);
    showMessage(`Баланс обновлён: ₽${amount.toFixed(2)}`);
  } catch (error) {
    showMessage(error.message);
  }
}

function renderAdminBets() {
  const list = el('admin-bets-list');
  if (!list) return;
  if (!S.admin.bets.length) {
    list.innerHTML = '<div class="empty-state">Нет ставок</div>';
    return;
  }

  list.innerHTML = S.admin.bets.map(bet => {
    const date = new Date(bet.created_at * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const statusClass = bet.status === 'pending' ? 'pending' : bet.outcome;
    const statusLabel = bet.status === 'pending' ? 'В игре' : (bet.outcome === 'win' ? 'Победа' : 'Поражение');
    const workerLabel = bet.worker_code === '0000'
      ? '0000 • тест'
      : bet.worker_username
        ? '@' + esc(bet.worker_username) + ' • ' + esc(bet.worker_code || '—')
        : '—';
    return `<div class="abc">
      <div class="abc-row"><span class="abc-lbl">Игрок</span><span class="abc-val">${esc(bet.player_name || ('ID ' + bet.telegram_id))}</span></div>
      <div class="abc-row"><span class="abc-lbl">Telegram</span><span class="abc-val">${bet.player_username ? '@' + esc(bet.player_username) : 'ID ' + bet.telegram_id}</span></div>
      <div class="abc-row"><span class="abc-lbl">Воркер</span><span class="abc-val">${workerLabel}</span></div>
      <div class="abc-row"><span class="abc-lbl">Инструмент</span><span class="abc-val">${fmtSymbol(bet.symbol)}</span></div>
      <div class="abc-row"><span class="abc-lbl">Направление</span><span class="abc-val ${bet.direction}">${bet.direction === 'up' ? '↑ РОСТ' : '↓ ПАДЕНИЕ'}</span></div>
      <div class="abc-row"><span class="abc-lbl">Ставка</span><span class="abc-val">₽${bet.amount.toFixed(2)}</span></div>
      <div class="abc-row"><span class="abc-lbl">Вход</span><span class="abc-val">${fmtPrice(bet.entry_price)}</span></div>
      <div class="abc-row"><span class="abc-lbl">Статус</span><span class="abc-val ${statusClass}">${statusLabel}</span></div>
      <div class="abc-row"><span class="abc-lbl">Дата</span><span class="abc-val">${date}</span></div>
    </div>`;
  }).join('');
}

function renderAdminWorkers() {
  const list = el('admin-workers-list');
  if (!list) return;
  if (!S.admin.workers.length) {
    list.innerHTML = '<div class="empty-state">Нет воркеров</div>';
    return;
  }

  list.innerHTML = S.admin.workers.map(worker => {
    const isTest = Boolean(worker.is_test);
    const title = isTest ? 'Тестовый код' : '@' + esc(worker.username || 'worker');
    const clients = Array.isArray(worker.clients) ? worker.clients : [];
    const clientsHtml = clients.length
      ? clients.map(client => {
          const clientName = esc(client.first_name || client.username || ('ID ' + client.telegram_id));
          const clientMeta = [client.username ? '@' + esc(client.username) : null, 'ID ' + client.telegram_id, `${client.bets_count || 0} ставок`].filter(Boolean).join(' • ');
          return `<div class="worker-client-card">
            <div class="worker-client-name">${clientName}</div>
            <div class="worker-client-meta">${clientMeta}</div>
          </div>`;
        }).join('')
      : '<div class="empty-state sm">Пока нет клиентов</div>';

    return `<div class="worker-card ${isTest ? 'test' : ''}">
      <div class="worker-card-head">
        <div>
          <div class="worker-card-name">${title}</div>
          <div class="worker-card-meta">Код ${worker.code} • Клиентов ${worker.client_count || 0}</div>
        </div>
        <div class="worker-code-badge">${worker.code}</div>
      </div>
      <div class="worker-client-list">${clientsHtml}</div>
    </div>`;
  }).join('');
}

async function createWorker() {
  const input = el('worker-username-input');
  const username = String(input?.value || '').trim();
  if (!username) {
    showMessage('Введите username воркера');
    return;
  }

  try {
    const result = await api('POST', '/api/admin/workers', { username });
    if (input) input.value = '';
    await loadAdminData();
    showMessage(`Воркер @${result.worker.username} добавлен. Код: ${result.worker.code}`);
  } catch (error) {
    showMessage(error.message);
  }
}

function el(id) { return document.getElementById(id); }
function pad(n) { return String(n).padStart(2, '0'); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function rub(value) {
  return (parseFloat(value) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtPrice(value) {
  if (!value && value !== 0) return '—';
  return '$' + parseFloat(value).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPriceShort(value) {
  if (!value && value !== 0) return '—';
  return '$' + parseFloat(value).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtSymbol(symbol) {
  if (!symbol) return '—';
  return symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}/USDT` : symbol;
}

window.addEventListener('DOMContentLoaded', init);
