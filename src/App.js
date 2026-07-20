// =============================================================
// Sandoq — Personal Trading Demo (Web version, React + CRA)
// Live prices + candlestick chart via Binance public WebSocket
// =============================================================
import React, { useEffect, useMemo, useState, useCallback } from "react";
import CryptoJS from "crypto-js";
import { useBotSignal, loadBotEnabled, saveBotEnabled } from "./useBotSignal";

// -----------------------------
// 1) CONFIG (swap in one place)
// -----------------------------
const CONFIG = {
  dataSource: {
    name: "binance-ws (بيانات) + pionex (هدف التنفيذ لاحقاً)",
  },
  risk: {
    riskPerTradePct: 1.0,
    dailyLossLimitPct: 3.0,
    maxOpenTrades: 3,
  },
  theme: {
    bg: "#0E1116",
    card: "#161B22",
    border: "#262C36",
    text: "#E6EDF3",
    textMuted: "#8B949E",
    buy: "#2EA043",
    sell: "#DA3633",
    warn: "#D29922",
  },
};

// -----------------------------
// 2) COINS LIST (major / meme)
// -----------------------------
const COINS = [
  { symbol: "BTCUSDT", type: "major", name: "Bitcoin", icon: "₿" },
  { symbol: "ETHUSDT", type: "major", name: "Ethereum", icon: "Ξ" },
  { symbol: "BNBUSDT", type: "major", name: "BNB", icon: "Ⓑ" },
  { symbol: "SOLUSDT", type: "major", name: "Solana", icon: "◎" },
  { symbol: "DOGEUSDT", type: "meme", name: "Dogecoin", icon: "Ð" },
  { symbol: "SHIBUSDT", type: "meme", name: "Shiba", icon: "S" },
  { symbol: "PEPEUSDT", type: "meme", name: "Pepe", icon: "P" },
];

const MAX_CANDLES = 50;

// =============================================================
// 3) SECURE STORAGE (web)
// =============================================================
const SECRET_KEY_STORAGE = "sandoq_device_key";

function getOrCreateDeviceKey() {
  let key = localStorage.getItem(SECRET_KEY_STORAGE);
  if (!key) {
    key = CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex);
    localStorage.setItem(SECRET_KEY_STORAGE, key);
  }
  return key;
}

function encryptLocal(value) {
  try {
    const key = getOrCreateDeviceKey();
    return CryptoJS.AES.encrypt(value, key).toString();
  } catch (e) {
    return null;
  }
}

function decryptLocal(cipherText) {
  try {
    if (!cipherText) return null;
    const key = getOrCreateDeviceKey();
    const bytes = CryptoJS.AES.decrypt(cipherText, key);
    return bytes.toString(CryptoJS.enc.Utf8) || null;
  } catch (e) {
    return null;
  }
}

async function saveApiKey(key) {
  if (!key) return;
  const encrypted = encryptLocal(String(key));
  if (encrypted) localStorage.setItem("sandoq_api_key", encrypted);
}
async function loadApiKey() {
  const stored = localStorage.getItem("sandoq_api_key");
  return decryptLocal(stored);
}

// =============================================================
// 4) STORAGE
// =============================================================
const K_TRADES = "sandoq_trades";
const K_CONFIG = "sandoq_user_config";

async function loadTrades() {
  try {
    const v = localStorage.getItem(K_TRADES);
    return v ? JSON.parse(v) : [];
  } catch (e) {
    return [];
  }
}
async function saveTrades(trades) {
  localStorage.setItem(K_TRADES, JSON.stringify(trades));
}
async function loadUserConfig() {
  try {
    const v = localStorage.getItem(K_CONFIG);
    return v ? JSON.parse(v) : { capital: 1000, riskPct: CONFIG.risk.riskPerTradePct };
  } catch (e) {
    return { capital: 1000, riskPct: CONFIG.risk.riskPerTradePct };
  }
}
async function saveUserConfig(cfg) {
  localStorage.setItem(K_CONFIG, JSON.stringify(cfg));
}

// =============================================================
// 5) BINANCE PUBLIC DATA
// =============================================================
const BINANCE_STREAM_MAP = {
  BTCUSDT: "btcusdt",
  ETHUSDT: "ethusdt",
  BNBUSDT: "bnbusdt",
  SOLUSDT: "solusdt",
  DOGEUSDT: "dogeusdt",
  SHIBUSDT: "shibusdt",
  PEPEUSDT: "pepeusdt",
};

const FALLBACK_SEED = {
  BTCUSDT: 63000, ETHUSDT: 3400, BNBUSDT: 590, SOLUSDT: 145,
  DOGEUSDT: 0.14, SHIBUSDT: 0.000023, PEPEUSDT: 0.0000085,
};

async function fetchPriceREST(symbol, knownPrice) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) throw new Error("REST fetch failed");
    const data = await res.json();
    const price = parseFloat(data.price);
    if (!price || isNaN(price)) throw new Error("Invalid REST price");

    // 🔒 فحص أمان: إيلا سعر REST بعيد بزاف (+5%) على آخر سعر حي معروف
    // من الـ WebSocket، نرفضوه ونستعملو السعر الحي (أوثق منه).
    if (knownPrice && Math.abs(price - knownPrice) / knownPrice > 0.05) {
      console.warn(
        `Sandoq: REST price for ${symbol} (${price}) is suspiciously far from live price (${knownPrice}); using live price instead.`
      );
      return knownPrice;
    }
    return price;
  } catch (e) {
    // 🔒 لا نرجع لأرقام قديمة مثبتة يدوياً فالكود (FALLBACK_SEED) —
    // نستعمل آخر سعر حي معروف إيلا كاين، وهو أدق بكثير من رقم ثابت.
    if (knownPrice) return knownPrice;
    return FALLBACK_SEED[symbol] ?? 1;
  }
}

async function fetchInitialKlines(symbol, limit = MAX_CANDLES) {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit}`
    );
    if (!res.ok) throw new Error("Klines fetch failed");
    const data = await res.json();
    return data.map((k) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));
  } catch (e) {
    return [];
  }
}

async function placeOrder({ symbol, side, qty, idempotencyKey, knownPrice }) {
  const cachedRaw = localStorage.getItem(`idem:${idempotencyKey}`);
  if (cachedRaw) return JSON.parse(cachedRaw);

  const orderId = `MOCK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const response = {
    orderId,
    symbol,
    side,
    type: "MARKET",
    qty,
    status: "FILLED",
    avgPrice: await fetchPriceREST(symbol, knownPrice),
    ts: Date.now(),
    idempotencyKey,
  };
  localStorage.setItem(`idem:${idempotencyKey}`, JSON.stringify(response));
  return response;
}

// =============================================================
// 6) WEBSOCKET LAYER — شموع (klines) + صفقات فردية من Binance
// =============================================================
function connectKlineWS(onCandle, onTickerPrice) {
  const klineStreams = Object.values(BINANCE_STREAM_MAP)
    .map((s) => `${s}@kline_1m`)
    .join("/");
  const tradeStreams = Object.values(BINANCE_STREAM_MAP)
    .map((s) => `${s}@trade`)
    .join("/");
  const url = `wss://stream.binance.com:9443/stream?streams=${klineStreams}/${tradeStreams}`;

  let ws = null;
  let closedByUser = false;
  let reconnectDelay = 2000;

  function connect() {
    try {
      ws = new WebSocket(url);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      reconnectDelay = 2000;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const d = msg.data;
        if (!d) return;

        if (d.e === "kline" && d.k) {
          const k = d.k;
          onCandle({
            symbol: d.s,
            candle: {
              time: k.t,
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
            },
          });
        } else if (d.s && d.p) {
          onTickerPrice({ symbol: d.s, price: parseFloat(d.p), ts: d.T || Date.now() });
        }
      } catch (e) {
        // تجاهل رسائل غير متوقعة
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => {
      if (!closedByUser) scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    setTimeout(() => {
      if (!closedByUser) {
        reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
        connect();
      }
    }, reconnectDelay);
  }

  connect();

  return () => {
    closedByUser = true;
    if (ws) ws.close();
  };
}

// =============================================================
// 7) RISK MANAGEMENT
// =============================================================
function calcPositionSize({ capital, riskPct, entryPrice, stopPrice }) {
  if (!entryPrice || !stopPrice) return 0;
  const amountRisked = capital * (riskPct / 100);
  const perUnitRisk = Math.abs(entryPrice - stopPrice);
  if (perUnitRisk === 0) return 0;
  return +(amountRisked / perUnitRisk).toFixed(6);
}

function calcTakeProfit(entry, stop, side) {
  if (!entry || !stop) return null;
  const dist = Math.abs(entry - stop);
  return side === "BUY"
    ? +(entry + dist * 2).toFixed(8)
    : +(entry - dist * 2).toFixed(8);
}
function newIdempotencyKey() {
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function dailyRealizedPnL(trades) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return trades
    .filter((t) => t.status === "CLOSED" && t.closedAt >= start.getTime())
    .reduce((s, t) => s + (t.pnl || 0), 0);
}

function openTradesCount(trades) {
  return trades.filter((t) => t.status === "OPEN").length;
}

function formatPrice(p) {
  if (p == null) return "—";
  if (p < 0.001) return p.toExponential(3);
  if (p < 1) return p.toFixed(6);
  if (p < 100) return p.toFixed(4);
  return p.toFixed(2);
}

// =============================================================
// 8) UI COMPONENTS
// =============================================================
function CandleChart({ candles }) {
  const width = 448;
  const height = 160;
  const padding = 8;
  const rightAxisWidth = 62; // مساحة أرقام الأسعار

  if (!candles || candles.length < 2) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: CONFIG.theme.textMuted,
          fontSize: 13,
        }}
      >
        بانتظار بيانات كافية للرسم...
      </div>
    );
  }

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = max - min || 1;

  const chartWidth = width - padding * 2 - rightAxisWidth;
  const chartHeight = height - padding * 2;
  const candleSlot = chartWidth / candles.length;
  const candleWidth = Math.max(2, candleSlot * 0.6);

  const yFor = (price) => padding + (1 - (price - min) / range) * chartHeight;

  // 4 مستويات سعر موزعة بالتساوي على المحور العمودي
  const priceLevels = [0, 1 / 3, 2 / 3, 1].map((t) => min + range * t);

  const firstTime = new Date(candles[0].time);
  const lastTime = new Date(candles[candles.length - 1].time);
  const fmtTime = (d) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {/* خطوط شبكة أفقية + أرقام الأسعار */}
        {priceLevels.map((p, i) => (
          <g key={i}>
            <line
              x1={padding}
              x2={padding + chartWidth}
              y1={yFor(p)}
              y2={yFor(p)}
              stroke={CONFIG.theme.border}
              strokeWidth="1"
              strokeDasharray="2,3"
            />
            <text
              x={padding + chartWidth + 6}
              y={yFor(p) + 3}
              fontSize="9"
              fill={CONFIG.theme.textMuted}
            >
              {formatPrice(p)}
            </text>
          </g>
        ))}

        {candles.map((c, i) => {
          const x = padding + i * candleSlot + candleSlot / 2;
          const isUp = c.close >= c.open;
          const color = isUp ? CONFIG.theme.buy : CONFIG.theme.sell;
          const bodyTop = yFor(Math.max(c.open, c.close));
          const bodyBottom = yFor(Math.min(c.open, c.close));
          const bodyHeight = Math.max(1, bodyBottom - bodyTop);

          return (
            <g key={c.time}>
              <line x1={x} x2={x} y1={yFor(c.high)} y2={yFor(c.low)} stroke={color} strokeWidth="1" />
              <rect
                x={x - candleWidth / 2}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                fill={color}
              />
            </g>
          );
        })}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: CONFIG.theme.textMuted,
          marginTop: 2,
          paddingRight: rightAxisWidth,
        }}
      >
        <span>{fmtTime(firstTime)}</span>
        <span>{fmtTime(lastTime)}</span>
      </div>
    </div>
  );
    }
function PriceRow({ coin, price, prevPrice, onSelect, selected }) {
  const dir = price != null && prevPrice != null ? (price >= prevPrice ? 1 : -1) : 0;
  const color = dir === 1 ? CONFIG.theme.buy : dir === -1 ? CONFIG.theme.sell : CONFIG.theme.text;

  return (
    <div
      onClick={() => onSelect(coin)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 8px",
        borderRadius: 8,
        cursor: "pointer",
        marginBottom: 4,
        background: selected ? "#1F2530" : "transparent",
        border: selected ? `1px solid ${CONFIG.theme.border}` : "1px solid transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20, width: 28, textAlign: "center" }}>{coin.icon}</span>
        <div>
          <div style={{ fontWeight: 700 }}>{coin.name}</div>
          <div style={{ fontSize: 11, color: CONFIG.theme.textMuted }}>
            {coin.type === "major" ? "رئيسية" : "ميم كوين"}
          </div>
        </div>
      </div>
      <div style={{ color, fontWeight: 700 }}>
        {price != null ? formatPrice(price) : "—"}
      </div>
    </div>
  );
}

function TradeItem({ trade, currentPrice, onClose }) {
  const isOpen = trade.status === "OPEN";

  // 📏 المسافة (بالنقاط) والنسبة المئوية بين الدخول والوقف/الهدف
  const slDist = trade.stop != null ? Math.abs(trade.entry - trade.stop) : null;
  const tpDist = trade.tp != null ? Math.abs(trade.entry - trade.tp) : null;
  const slPct = slDist != null && trade.entry ? (slDist / trade.entry) * 100 : null;
  const tpPct = tpDist != null && trade.entry ? (tpDist / trade.entry) * 100 : null;

  // 💰 كمية الربح/الخسارة المحتملة (إذا وصل السعر للهدف/الوقف)
  const potentialProfit = tpDist != null ? tpDist * trade.qty : null;
  const potentialLoss = slDist != null ? slDist * trade.qty : null;

  return (
    <div
      style={{
        background: "#10141B",
        border: `1px solid ${CONFIG.theme.border}`,
        borderRadius: 8,
        padding: 10,
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700 }}>
          {trade.source === "bot" && (
            <span
              style={{
                fontSize: 10,
                background: "#1F2530",
                border: "1px solid #262C36",
                borderRadius: 6,
                padding: "2px 6px",
                marginRight: 6,
              }}
            >
              🤖 بوت
            </span>
          )}
          {trade.side === "BUY" ? "شراء" : "بيع"} {trade.symbol}
        </span>
        <span
          style={{
            fontWeight: 700,
            color: isOpen
              ? CONFIG.theme.warn
              : trade.pnl >= 0
              ? CONFIG.theme.buy
              : CONFIG.theme.sell,
          }}
        >
          {isOpen ? "مفتوحة" : trade.pnl >= 0 ? `+${trade.pnl.toFixed(2)}` : trade.pnl.toFixed(2)}
        </span>
      </div>

      {/* 🎯 EP / SL / TP — بيانات واضحة */}
      <div style={{ fontSize: 12, color: CONFIG.theme.textMuted, marginTop: 6, lineHeight: 1.7 }}>
        <div>
          <span style={{ color: CONFIG.theme.text, fontWeight: 700 }}>EP</span>{" "}
          {formatPrice(trade.entry)}
        </div>
        {trade.stop != null && (
          <div>
            <span style={{ color: CONFIG.theme.sell, fontWeight: 700 }}>SL</span>{" "}
            {formatPrice(trade.stop)}
            {slPct != null && ` (−${slPct.toFixed(2)}%)`}
          </div>
        )}
        {trade.tp != null && (
          <div>
            <span style={{ color: CONFIG.theme.buy, fontWeight: 700 }}>TP</span>{" "}
            {formatPrice(trade.tp)}
            {tpPct != null && ` (+${tpPct.toFixed(2)}%)`}
          </div>
        )}
        <div>الكمية: {trade.qty}</div>
        {isOpen && potentialProfit != null && (
          <div style={{ color: CONFIG.theme.buy }}>
            ربح محتمل عند TP: +${potentialProfit.toFixed(2)}
          </div>
        )}
        {isOpen && potentialLoss != null && (
          <div style={{ color: CONFIG.theme.sell }}>
            خسارة محتملة عند SL: −${potentialLoss.toFixed(2)}
          </div>
        )}
      </div>

      {!isOpen && (
        <div style={{ fontSize: 12, color: CONFIG.theme.textMuted, marginTop: 4 }}>
          خروج: {formatPrice(trade.exit)} · {new Date(trade.closedAt).toLocaleString()}
        </div>
      )}
      {isOpen && (
        <button
          onClick={() => onClose(trade.id, currentPrice ?? trade.entry)}
          style={ghostBtnStyle}
        >
          
          إغلاق بسعر السوق
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, muted }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 11, color: CONFIG.theme.textMuted }}>{label}</div>
      <div style={{ fontWeight: 700, color: muted ? CONFIG.theme.sell : CONFIG.theme.text }}>
        {value}
      </div>
    </div>
  );
}

const cardStyle = {
  background: CONFIG.theme.card,
  margin: "12px 0",
  padding: 14,
  borderRadius: 10,
  border: `1px solid ${CONFIG.theme.border}`,
};
const inputStyle = {
  background: "#0B0E13",
  border: `1px solid ${CONFIG.theme.border}`,
  color: CONFIG.theme.text,
  borderRadius: 8,
  padding: "8px 10px",
  width: 140,
  fontSize: 14,
};
const labelStyle = { color: CONFIG.theme.textMuted, fontSize: 13 };
const ghostBtnStyle = {
  background: "transparent",
  border: `1px solid ${CONFIG.theme.border}`,
  color: CONFIG.theme.text,
  borderRadius: 8,
  padding: "8px 12px",
  marginTop: 8,
  width: "100%",
};

// =============================================================
// 9) MAIN APP
// =============================================================
export default function App() {
  const [prices, setPrices] = useState({});
  const [prevPrices, setPrevPrices] = useState({});
  const [candleHistory, setCandleHistory] = useState({});
  const [trades, setTrades] = useState([]);
  const [userCfg, setUserCfg] = useState({ capital: 1000, riskPct: 1.0 });
  const [selected, setSelected] = useState(COINS[0]);
  const [stopPct, setStopPct] = useState("1.5");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState(null);
  const [botEnabled, setBotEnabledState] = useState(loadBotEnabled());

  useEffect(() => {
    (async () => {
      const [t, c, k] = await Promise.all([loadTrades(), loadUserConfig(), loadApiKey()]);
      setTrades(t);
      setUserCfg(c);
      if (c && c.stopPct != null) setStopPct(String(c.stopPct));
      setApiKey(k || "");
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const initial = {};
      const initialPrices = {};
      for (const coin of COINS) {
        const candles = await fetchInitialKlines(coin.symbol);
        initial[coin.symbol] = candles;
        if (candles.length > 0) initialPrices[coin.symbol] = candles[candles.length - 1].close;
      }
      setCandleHistory(initial);
      setPrices((p) => ({ ...p, ...initialPrices }));
    })();

    const close = connectKlineWS(
      (data) => {
        setCandleHistory((prev) => {
          const list = p
