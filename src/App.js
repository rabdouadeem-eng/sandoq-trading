// =============================================================
// Sandoq — Personal Trading Demo (Web version, React + CRA)
// Live prices via Binance public WebSocket (market data only)
// =============================================================
import React, { useEffect, useMemo, useState, useCallback } from "react";
import CryptoJS from "crypto-js";

// -----------------------------
// 1) CONFIG (swap in one place)
// -----------------------------
const CONFIG = {
  dataSource: {
    name: "binance-ws (بيانات) + pionex (هدف التنفيذ لاحقاً)",
    baseURL: "https://api.pionex.com",
    rest: {
      ticker: "/api/v1/market/tickers",
      order: "/api/v1/trade/order",
    },
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

// =============================================================
// 3) SECURE STORAGE (web) — تشفير محلي بسيط عبر crypto-js
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
// 4) STORAGE — سجل الصفقات + الإعدادات (localStorage)
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
// 5) BINANCE PUBLIC DATA — بيانات سوق عامة فقط (بلا حساب/تداول)
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

async function fetchPriceREST(symbol) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) throw new Error("REST fetch failed");
    const data = await res.json();
    return parseFloat(data.price);
  } catch (e) {
    return FALLBACK_SEED[symbol] ?? 1;
  }
}

async function placeOrder({ symbol, side, qty, idempotencyKey }) {
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
    avgPrice: await fetchPriceREST(symbol),
    ts: Date.now(),
    idempotencyKey,
  };
  localStorage.setItem(`idem:${idempotencyKey}`, JSON.stringify(response));
  return response;
}

// =============================================================
// 6) WEBSOCKET LAYER — اتصال حي حقيقي بـ Binance (بيانات عامة)
// =============================================================
function connectWS(onTick) {
  const streams = Object.values(BINANCE_STREAM_MAP)
    .map((s) => `${s}@trade`)
    .join("/");
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

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
        const trade = msg.data;
        if (!trade || !trade.s || !trade.p) return;
        onTick({
          symbol: trade.s,
          price: parseFloat(trade.p),
          ts: trade.T || Date.now(),
        });
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

  (async () => {
    for (const symbol of Object.keys(BINANCE_STREAM_MAP)) {
      const price = await fetchPriceREST(symbol);
      onTick({ symbol, price, ts: Date.now() });
    }
  })();

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
// 8) UI COMPONENTS (HTML/React عادية)
// =============================================================
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
      <div style={{ fontSize: 12, color: CONFIG.theme.textMuted, marginTop: 4 }}>
        دخول: {formatPrice(trade.entry)} · وقف: {formatPrice(trade.stop)} · كمية: {trade.qty}
      </div>
      {!isOpen && (
        <div style={{ fontSize: 12, color: CONFIG.theme.textMuted }}>
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
  const [trades, setTrades] = useState([]);
  const [userCfg, setUserCfg] = useState({ capital: 1000, riskPct: 1.0 });
  const [selected, setSelected] = useState(COINS[0]);
  const [stopPct, setStopPct] = useState("1.5");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState(null);

  useEffect(() => {
    (async () => {
      const [t, c, k] = await Promise.all([loadTrades(), loadUserConfig(), loadApiKey()]);
      setTrades(t);
      setUserCfg(c);
      setApiKey(k || "");
    })();
  }, []);

  useEffect(() => {
    const close = connectWS((tick) => {
      setPrices((prev) => {
        setPrevPrices((pv) => ({ ...pv, [tick.symbol]: prev[tick.symbol] ?? pv[tick.symbol] }));
        return { ...prev, [tick.symbol]: tick.price };
      });
    });
    return close;
  }, []);

  const entry = prices[selected.symbol];
  const stop = useMemo(() => {
    const s = parseFloat(stopPct);
    if (!entry || !isFinite(s)) return null;
    return +(entry * (1 - s / 100)).toFixed(8);
  }, [entry, stopPct]);

  const suggestedQty = useMemo(() => {
    if (!entry || !stop) return 0;
    return calcPositionSize({
      capital: parseFloat(userCfg.capital) || 0,
      riskPct: parseFloat(userCfg.riskPct) || 0,
      entryPrice: entry,
      stopPrice: stop,
    });
  }, [entry, stop, userCfg]);

  const realized = useMemo(() => dailyRealizedPnL(trades), [trades]);
  const cap = parseFloat(userCfg.capital) || 0;
  const dailyLimit = cap * (CONFIG.risk.dailyLossLimitPct / 100);
  const tradingHalted = realized <= -dailyLimit;
  const openCount = openTradesCount(trades);

  const showMessage = useCallback((title, body) => {
    setMessage({ title, body });
    setTimeout(() => setMessage(null), 3500);
  }, []);

  async function place(side) {
    if (tradingHalted) return showMessage("التداول متوقف", "تم بلوغ حد الخسارة اليومية.");
    if (openCount >= CONFIG.risk.maxOpenTrades)
      return showMessage("تجاوز الحد", `أقصى عدد صفقات مفتوحة: ${CONFIG.risk.maxOpenTrades}`);
    if (!entry || !stop) return showMessage("بيانات ناقصة", "أدخل وقف الخسارة.");
    if (suggestedQty <= 0) return showMessage("حجم غير صالح", "تحقق من رأس المال ونسبة المخاطرة.");

    const idem = newIdempotencyKey();
    const order = await placeOrder({ symbol: selected.symbol, side, qty: suggestedQty, idempotencyKey: idem });

    const trade = {
      id: order.orderId,
      symbol: order.symbol,
      side: order.side,
      entry: order.avgPrice,
      stop,
      qty: order.qty,
      status: "OPEN",
      openedAt: order.ts,
    };
    const next = [trade, ...trades];
    setTrades(next);
    await saveTrades(next);
    showMessage("تم", `أمر ${side === "BUY" ? "شراء" : "بيع"} مسجّل بسعر ${formatPrice(order.avgPrice)}`);
  }

  async function closeTrade(tradeId, atPrice) {
    const next = trades.map((t) => {
      if (t.id !== tradeId || t.status !== "OPEN") return t;
      const pnl = (atPrice - t.entry) * t.qty * (t.side === "BUY" ? 1 : -1);
      return { ...t, status: "CLOSED", exit: atPrice, closedAt: Date.now(), pnl: +pnl.toFixed(4) };
    });
    setTrades(next);
    await saveTrades(next);
  }

  async function saveSettings() {
    await saveUserConfig(userCfg);
    if (apiKey) await saveApiKey(apiKey);
    showMessage("حُفظت", "تم حفظ الإعدادات والمفتاح مشفّر محلياً.");
  }

  return (
    <div style={{ background: CONFIG.theme.bg, color: CONFIG.theme.text, minHeight: "100vh" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Sandoq · صندوق التداول</h1>
        <p style={{ fontSize: 12, color: CONFIG.theme.textMuted, marginBottom: 16 }}>
          ديمو لمستخدم واحد · أسعار حية من Binance · تنفيذ محلي وهمي
        </p>

        {message && (
          <div
            style={{
              background: "#1F2530",
              border: `1px solid ${CONFIG.theme.border}`,
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <div style={{ fontWeight: 700 }}>{message.title}</div>
            <div style={{ fontSize: 13, color: CONFIG.theme.textMuted }}>{message.body}</div>
          </div>
        )}

        <div style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>رأس المال والمخاطرة</div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={labelStyle}>رأس المال ($)</span>
            <input
              type="number"
              style={inputStyle}
              value={userCfg.capital}
              onChange={(e) => setUserCfg((c) => ({ ...c, capital: e.target.value }))}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={labelStyle}>مخاطرة/صفقة %</span>
            <input
              type="number"
              style={inputStyle}
              value={userCfg.riskPct}
              onChange={(e) => setUserCfg((c) => ({ ...c, riskPct: e.target.value }))}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={labelStyle}>وقف الخسارة %</span>
            <input
              type="number"
              style={inputStyle}
              value={stopPct}
              onChange={(e) => setStopPct(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <Stat label="حد خسارة اليوم" value={`$${dailyLimit.toFixed(2)}`} />
            <Stat label="خسارة اليوم" value={`$${realized.toFixed(2)}`} muted={realized < 0} />
            <Stat label="صفقات مفتوحة" value={`${openCount}/${CONFIG.risk.maxOpenTrades}`} />
          </div>

          {tradingHalted && (
            <div style={{ color: CONFIG.theme.sell, marginTop: 10, fontWeight: 700 }}>
              ⛔ تم إيقاف التداول: بلوغ حد الخسارة اليومي
            </div>
          )}

          <button style={ghostBtnStyle} onClick={saveSettings}>
            حفظ الإعدادات
          </button>
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>الأسعار الحية</div>
          {COINS.map((coin) => (
            <PriceRow
              key={coin.symbol}
              coin={coin}
              price={prices[coin.symbol]}
              prevPrice={prevPrices[coin.symbol]}
              onSelect={setSelected}
              selected={selected.symbol === coin.symbol}
            />
          ))}
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>أمر سوق — {selected.name}</div>
          <div style={{ fontSize: 13, color: CONFIG.theme.textMuted }}>
            السعر: {formatPrice(entry)} · وقف: {formatPrice(stop)}
          </div>
          <div style={{ fontSize: 13, color: CONFIG.theme.textMuted, marginBottom: 10 }}>
            الكمية المقترحة: {suggestedQty}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              disabled={tradingHalted}
              onClick={() => place("BUY")}
              style={{
                flex: 1,
                background: CONFIG.theme.buy,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "12px 0",
                fontWeight: 700,
                opacity: tradingHalted ? 0.5 : 1,
              }}
            >
              شراء
            </button>
            <button
              disabled={tradingHalted}
              onClick={() => place("SELL")}
              style={{
                flex: 1,
                background: CONFIG.theme.sell,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "12px 0",
                fontWeight: 700,
                opacity: tradingHalted ? 0.5 : 1,
              }}
           
