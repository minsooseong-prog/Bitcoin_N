// Upbit WebSocket: https://docs.upbit.com/kr/reference/websocket-ticker
// Upbit REST 캔들:  https://docs.upbit.com/kr/reference/list-candles-minutes
const WS_URL = "wss://api.upbit.com/websocket/v1";
const REST_URL = "https://api.upbit.com/v1/candles";
const MARKET = "KRW-BTC";
const CANDLE_COUNT = 80;
const MA_SHORT = 5;
const MA_LONG = 20;
const UP = "#ef4444";   // 한국 관례: 상승 = 빨강
const DOWN = "#3b82f6"; // 하락 = 파랑

// 차트 단위: 분봉은 minutes/{unit}, 일봉은 days
const TIMEFRAMES = [
  { label: "1분", path: "minutes/1", ms: 60e3 },
  { label: "5분", path: "minutes/5", ms: 5 * 60e3 },
  { label: "15분", path: "minutes/15", ms: 15 * 60e3 },
  { label: "1시간", path: "minutes/60", ms: 60 * 60e3 },
  { label: "일", path: "days", ms: 24 * 60 * 60e3 },
  { label: "주", path: "weeks", ms: 7 * 24 * 60 * 60e3 },
  { label: "월", path: "months", month: true },
];

// 캔들 시작 시각 t 다음 구간의 시작 시각 (월봉은 달마다 길이가 다름)
function nextStart(t) {
  if (tf.month) {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return t + tf.ms;
}

const $ = (id) => document.getElementById(id);
const krw = new Intl.NumberFormat("ko-KR");
let candles = []; // 오래된 순 {t, o, h, l, c, v}
let tf = TIMEFRAMES[0];
let lastPrice = null;
let retry = 0;

/* ---------- 캔들 (REST) ---------- */
async function loadCandles() {
  const url = `${REST_URL}/${tf.path}?market=${MARKET}&count=${CANDLE_COUNT}`;
  const mine = tf;
  try {
    const rows = await (await fetch(url)).json();
    if (mine !== tf || !Array.isArray(rows)) return;
    candles = rows.reverse().map((r) => ({
      t: Date.parse(r.candle_date_time_utc + "Z"),
      o: r.opening_price,
      h: r.high_price,
      l: r.low_price,
      c: r.trade_price,
      v: r.candle_acc_trade_volume,
    }));
    drawChart();
  } catch (_) { /* 다음 주기에 재시도 */ }
}

// 실시간 체결가를 마지막 캔들에 반영하고, 새 구간이 시작되면 캔들을 추가
function applyTick(price, ts, vol) {
  if (!candles.length) return;
  let last = candles[candles.length - 1];
  if (ts >= nextStart(last.t)) {
    // 서버 캔들 기준으로 구간 경계를 따라가 체결 시각이 속한 구간을 찾는다
    let start = nextStart(last.t);
    while (nextStart(start) <= ts) start = nextStart(start);
    last = { t: start, o: price, h: price, l: price, c: price, v: 0 };
    candles.push(last);
    if (candles.length > CANDLE_COUNT) candles.shift();
  }
  last.c = price;
  last.h = Math.max(last.h, price);
  last.l = Math.min(last.l, price);
  last.v += vol || 0;
}

function buildTimeframeButtons() {
  const box = $("tf");
  TIMEFRAMES.forEach((x, i) => {
    const b = document.createElement("button");
    b.textContent = x.label;
    b.className = i === 0 ? "active" : "";
    b.onclick = () => {
      tf = x;
      candles = [];
      [...box.children].forEach((el) => el.classList.toggle("active", el === b));
      loadCandles();
    };
    box.appendChild(b);
  });
}

/* ---------- 실시간 시세 (WebSocket) ---------- */
function connect() {
  const ws = new WebSocket(WS_URL);
  ws.binaryType = "blob";

  ws.onopen = () => {
    retry = 0;
    setStatus(true);
    ws.send(JSON.stringify([
      { ticket: "bitcoin-n-" + Math.random().toString(36).slice(2) },
      { type: "ticker", codes: [MARKET] },
      { format: "DEFAULT" },
    ]));
  };

  ws.onmessage = async (e) => {
    try {
      render(JSON.parse(await e.data.text()));
    } catch (_) { /* ignore malformed frame */ }
  };

  ws.onclose = () => {
    setStatus(false);
    setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
  };
  ws.onerror = () => ws.close();
}

function setStatus(on) {
  const el = $("status");
  el.textContent = on ? "● 실시간" : "재연결 중…";
  el.className = "status " + (on ? "on" : "off");
}

function render(t) {
  if (t.type !== "ticker") return;
  const price = t.trade_price;
  const dir = t.change === "RISE" ? "up" : t.change === "FALL" ? "down" : "";

  const priceEl = $("price");
  priceEl.textContent = krw.format(price) + " 원";
  priceEl.className = "price " + dir;
  if (lastPrice !== null && price !== lastPrice) {
    priceEl.classList.add(price > lastPrice ? "flash-up" : "flash-down");
  }
  lastPrice = price;

  const sign = t.signed_change_price > 0 ? "+" : "";
  const changeEl = $("change");
  changeEl.textContent =
    `${sign}${krw.format(t.signed_change_price)} (${sign}${(t.signed_change_rate * 100).toFixed(2)}%) 전일 대비`;
  changeEl.className = "change " + dir;

  $("high").textContent = krw.format(t.high_price) + " 원";
  $("low").textContent = krw.format(t.low_price) + " 원";
  $("value").textContent = Math.round(t.acc_trade_price_24h / 1e8).toLocaleString("ko-KR") + " 억원";
  $("volume").textContent = t.acc_trade_volume_24h.toFixed(2) + " BTC";
  $("time").textContent = "최근 체결: " + new Date(t.trade_timestamp).toLocaleTimeString("ko-KR");

  applyTick(price, t.trade_timestamp, t.trade_volume);
  drawChart();
}

/* ---------- 차트 ---------- */
// 종가 기준 단순 이동평균 (데이터가 n개 미만인 구간은 null)
function movingAverage(n) {
  let sum = 0;
  return candles.map((k, i) => {
    sum += k.c;
    if (i >= n) sum -= candles[i - n].c;
    return i >= n - 1 ? sum / n : null;
  });
}

function drawChart() {
  const canvas = $("chart");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (candles.length < 2) return;

  const axisW = 70;                 // 오른쪽 가격 눈금 영역
  const volH = h * 0.18;            // 아래쪽 거래량 영역
  const top = 8, bottom = h - volH - 6;
  const plotW = w - axisW;

  let min = Math.min(...candles.map((k) => k.l));
  let max = Math.max(...candles.map((k) => k.h));
  const pad = (max - min || 1) * 0.05;
  min -= pad; max += pad;
  const Y = (p) => top + (1 - (p - min) / (max - min)) * (bottom - top);
  const slot = plotW / CANDLE_COUNT;
  const X = (i) => (i + 0.5) * slot;
  const bodyW = Math.max(1, slot * 0.7);

  // 가로 눈금선 + 가격 라벨
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (let g = 0; g <= 4; g++) {
    const p = min + ((max - min) * g) / 4;
    const y = Y(p);
    ctx.strokeStyle = "rgba(255,255,255,.06)";
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
    ctx.fillStyle = "#8b93a5";
    ctx.fillText(krw.format(Math.round(p)), plotW + 6, y);
  }

  // 거래량 막대
  const maxV = Math.max(...candles.map((k) => k.v)) || 1;
  candles.forEach((k, i) => {
    const vh = (k.v / maxV) * volH;
    ctx.fillStyle = (k.c >= k.o ? UP : DOWN) + "66";
    ctx.fillRect(X(i) - bodyW / 2, h - vh, bodyW, vh);
  });

  // 캔들 (꼬리 + 몸통)
  candles.forEach((k, i) => {
    const color = k.c >= k.o ? UP : DOWN;
    const x = X(i);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, Y(k.h)); ctx.lineTo(x, Y(k.l)); ctx.stroke();
    const yo = Y(k.o), yc = Y(k.c);
    ctx.fillRect(x - bodyW / 2, Math.min(yo, yc), bodyW, Math.max(1, Math.abs(yo - yc)));
  });

  // 이동평균선
  const line = (series, color) => {
    ctx.beginPath();
    let started = false;
    series.forEach((p, i) => {
      if (p === null) return;
      started ? ctx.lineTo(X(i), Y(p)) : ctx.moveTo(X(i), Y(p));
      started = true;
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  line(movingAverage(MA_SHORT), "#facc15");
  line(movingAverage(MA_LONG), "#a78bfa");

  // 현재가 점선
  const cy = Y(candles[candles.length - 1].c);
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "#8b93a5";
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(plotW, cy); ctx.stroke();
  ctx.setLineDash([]);
}

buildTimeframeButtons();
loadCandles();
setInterval(loadCandles, 30000); // 실시간 반영분을 서버 캔들로 주기적 보정
window.addEventListener("resize", drawChart);
connect();
