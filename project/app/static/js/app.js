const candleSvg = document.getElementById("candles");
const volumeSvg = document.getElementById("volume");
const navItems = document.querySelectorAll(".nav-item");
const panels = document.querySelectorAll(".panel");
const contentPanels = document.getElementById("content-panels");
const usernameEl = document.getElementById("username");
const subtitleEl = document.getElementById("user-subtitle");

const candles = [
  { o: 72940, h: 73020, l: 72910, c: 73005, v: 42 },
  { o: 73005, h: 73040, l: 72995, c: 73018, v: 55 },
  { o: 73018, h: 73110, l: 73005, c: 73085, v: 94 },
  { o: 73085, h: 73102, l: 73052, c: 73062, v: 66 },
  { o: 73062, h: 73104, l: 73040, c: 73092, v: 48 },
  { o: 73092, h: 73118, l: 73070, c: 73074, v: 79 },
  { o: 73074, h: 73132, l: 73055, c: 73112, v: 47 },
  { o: 73112, h: 73178, l: 73096, c: 73154, v: 118 },
  { o: 73154, h: 73166, l: 73105, c: 73124, v: 76 },
  { o: 73124, h: 73158, l: 73102, c: 73140, v: 60 },
  { o: 73140, h: 73182, l: 73118, c: 73126, v: 38 },
  { o: 73126, h: 73148, l: 73098, c: 73108, v: 52 },
  { o: 73108, h: 73124, l: 73072, c: 73086, v: 32 },
  { o: 73086, h: 73102, l: 73064, c: 73096, v: 210 },
  { o: 73096, h: 73138, l: 73082, c: 73131, v: 88 },
];

function createSvgNode(tag, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function renderChart() {
  if (!candleSvg || !volumeSvg) return;

  candleSvg.innerHTML = "";
  volumeSvg.innerHTML = "";

  const width = 320;
  const priceWidth = 268;
  const xStep = priceWidth / candles.length;
  const candleWidth = 8;
  const low = Math.min(...candles.map((item) => item.l)) - 25;
  const high = Math.max(...candles.map((item) => item.h)) + 25;
  const scaleY = (value) => 14 + ((high - value) / (high - low)) * 162;

  for (let i = 0; i < 5; i += 1) {
    const y = 18 + i * 38;
    candleSvg.appendChild(
      createSvgNode("line", {
        x1: 0,
        y1: y,
        x2: width,
        y2: y,
        stroke: "rgba(255,255,255,0.07)",
        "stroke-width": 1,
      }),
    );
  }

  [42, 90, 138, 186, 234].forEach((x) => {
    candleSvg.appendChild(
      createSvgNode("line", {
        x1: x,
        y1: 18,
        x2: x,
        y2: 182,
        stroke: "rgba(255,255,255,0.05)",
        "stroke-width": 1,
      }),
    );
  });

  candleSvg.appendChild(
    createSvgNode("line", {
      x1: 64,
      y1: 18,
      x2: 64,
      y2: 182,
      stroke: "rgba(200,204,214,0.7)",
      "stroke-dasharray": "4 4",
      "stroke-width": 1,
    }),
  );

  const lastPrice = candles[candles.length - 1].c;
  const lastPriceY = scaleY(lastPrice);
  candleSvg.appendChild(
    createSvgNode("line", {
      x1: 0,
      y1: lastPriceY,
      x2: priceWidth,
      y2: lastPriceY,
      stroke: "rgba(0, 209, 199, 0.7)",
      "stroke-dasharray": "3 3",
      "stroke-width": 1,
    }),
  );

  candles.forEach((item, index) => {
    const x = 12 + index * xStep;
    const rise = item.c >= item.o;
    const color = rise ? "#00c7c7" : "#ff405c";
    const bodyTop = scaleY(Math.max(item.o, item.c));
    const bodyBottom = scaleY(Math.min(item.o, item.c));
    const bodyHeight = Math.max(6, bodyBottom - bodyTop);

    candleSvg.appendChild(
      createSvgNode("line", {
        x1: x,
        y1: scaleY(item.h),
        x2: x,
        y2: scaleY(item.l),
        stroke: color,
        "stroke-width": 1,
      }),
    );

    candleSvg.appendChild(
      createSvgNode("rect", {
        x: x - candleWidth / 2,
        y: bodyTop,
        width: candleWidth,
        height: bodyHeight,
        fill: color,
        rx: 0.5,
      }),
    );
  });

  const priceLabels = [
    high,
    high - (high - low) * 0.25,
    high - (high - low) * 0.5,
    high - (high - low) * 0.75,
    low,
  ];

  priceLabels.forEach((value, index) => {
    candleSvg.appendChild(
      createSvgNode("text", {
        x: 284,
        y: 34 + index * 38,
        fill: "#a9adb6",
        "font-size": "10",
        "font-weight": "600",
      }),
    ).textContent = Math.round(value).toLocaleString("en-US");
  });

  ["23:00", "23:30", "00:00", "00:45"].forEach((value, index) => {
    candleSvg.appendChild(
      createSvgNode("text", {
        x: 14 + index * 80,
        y: 202,
        fill: "#8d93a0",
        "font-size": "10",
        "font-weight": "600",
      }),
    ).textContent = value;
  });

  const tagGroup = createSvgNode("g", {});
  tagGroup.appendChild(
    createSvgNode("rect", {
      x: 276,
      y: lastPriceY - 11,
      width: 44,
      height: 22,
      rx: 6,
      fill: "#3b3d42",
    }),
  );
  const tagText = createSvgNode("text", {
    x: 282,
    y: lastPriceY + 4,
    fill: "#f2f4f7",
    "font-size": "10",
    "font-weight": "700",
  });
  tagText.textContent = Math.round(lastPrice).toLocaleString("en-US");
  tagGroup.appendChild(tagText);
  candleSvg.appendChild(tagGroup);

  const maxVolume = Math.max(...candles.map((item) => item.v));
  candles.forEach((item, index) => {
    const x = 12 + index * xStep - 3;
    const barHeight = (item.v / maxVolume) * 52;
    const rise = item.c >= item.o;
    volumeSvg.appendChild(
      createSvgNode("rect", {
        x,
        y: 58 - barHeight,
        width: 8,
        height: barHeight,
        fill: rise ? "rgba(30,138,128,0.75)" : "rgba(178,74,79,0.8)",
      }),
    );
  });
}

function switchPanel(target) {
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.tab === target));
  panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === target));
  if (contentPanels) {
    contentPanels.classList.toggle("visible", target !== "home");
  }
}

function syncViewportHeight() {
  const tg = window.Telegram?.WebApp;
  const viewportHeight = tg?.viewportStableHeight || tg?.viewportHeight || window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${Math.round(viewportHeight)}px`);
}

function bootTelegram() {
  if (!window.Telegram || !window.Telegram.WebApp) return;

  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();
  syncViewportHeight();

  const user = tg.initDataUnsafe?.user;
  if (user) {
    const name = user.username ? `@${user.username}` : user.first_name;
    usernameEl.textContent = name;
    subtitleEl.textContent = "Telegram Mini App trader";
  }

  const attachAction = (id, payload) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.addEventListener("click", () => {
      if (tg.HapticFeedback) {
        tg.HapticFeedback.impactOccurred("light");
      }
      tg.sendData(JSON.stringify(payload));
    });
  };

  attachAction("up-action", { action: "up", pair: "BTCUSDT" });
  attachAction("down-action", { action: "down", pair: "BTCUSDT" });
}

navItems.forEach((item) => {
  item.addEventListener("click", () => switchPanel(item.dataset.tab));
});

window.addEventListener("resize", syncViewportHeight);
switchPanel("home");
syncViewportHeight();
renderChart();
bootTelegram();
