// Upbit WebSocket: https://docs.upbit.com/kr/reference/websocket-ticker
const WS_URL = "wss://api.upbit.com/websocket/v1";
const MARKET = "KRW-BTC";
const MAX_POINTS = 120;
const MA_SHORT = 5;
const MA_LONG = 20;

const $ = (id) => document.getElementById(id);
const krw = new Intl.NumberFormat("ko-KR");
const points = [];
let lastPrice = null;
let retry = 0;

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
    const f = price > lastPrice ? "flash-up" : "flash-down";
    priceEl.classList.add(f);
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

  points.push(price);
  if (points.length > MAX_POINTS) points.shift();
  drawChart(dir);
}

function drawChart(dir) {
  const c = $("chart");
  const ctx = c.getContext("2d");
  const { width: w, height: h } = c;
  ctx.clearRect(0, 0, w, h);
  if (points.length < 2) return;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const X = (i) => (i / (MAX_POINTS - 1)) * w;
  const Y = (p) => h - 8 - ((p - min) / span) * (h - 16);

  const line = (series, color, width) => {
    ctx.beginPath();
    let started = false;
    series.forEach((p, i) => {
      if (p === null) return;
      started ? ctx.lineTo(X(i), Y(p)) : ctx.moveTo(X(i), Y(p));
      started = true;
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };

  line(points, dir === "down" ? "#3b82f6" : dir === "up" ? "#ef4444" : "#8b93a5", 2);
  line(movingAverage(MA_SHORT), "#facc15", 1.5);
  line(movingAverage(MA_LONG), "#a78bfa", 1.5);
}

// 최근 n개 체결가의 단순 이동평균 (데이터가 n개 미만인 구간은 null)
function movingAverage(n) {
  let sum = 0;
  return points.map((p, i) => {
    sum += p;
    if (i >= n) sum -= points[i - n];
    return i >= n - 1 ? sum / n : null;
  });
}

connect();
