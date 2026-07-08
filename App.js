// =============================================================
// Sandoq — Pionex Trading App (Web Version)
// ملف App.js - الملف الرئيسي
// =============================================================

import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

// -----------------------------
// 1) CONFIG — Pionex
// -----------------------------
const CONFIG = {
  dataSource: {
    name: "pionex",
    baseURL: "https://api.pionex.com",
    rest: {
      ticker: "/api/v1/market/tickers",
      order: "/api/v1/trade/order",
    },
    ws: {
      url: "wss://ws.pionex.com/wsPub",
    },
    symbols: {
      BTCUSDT: "BTC_USDT",
      ETHUSDT: "ETH_USDT",
      BNBUSDT: "BNB_USDT",
      SOLUSDT: "SOL_USDT",
      DOGEUSDT: "DOGE_USDT",
      SHIBUSDT: "SHIB_USDT",
      PEPEUSDT: "PEPE_USDT",
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
// 2) COINS
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
// 3) STORAGE (LocalStorage)
// =============================================================
const K_TRADES = "sandoq_trades";
const K_CONFIG = "sandoq_user_config";
const K_API_KEY = "pionex_api_key";
const K_API_SECRET = "pionex_api_secret";

async function loadTrades() {
  try {
    const v = localStorage.getItem(K_TRADES);
    return v ? JSON.parse(v) : [];
  } catch (e) { return []; }
}
async function saveTrades(trades) {
  localStorage.setItem(K_TRADES, JSON.stringify(trades));
}
async function loadUserConfig() {
  try {
    const v = localStorage.getItem(K_CONFIG);
    return v ? JSON.parse(v) : { capital: 1000, riskPct: CONFIG.risk.riskPerTradePct };
  } catch (e) { return { capital: 1000, riskPct: CONFIG.risk.riskPerTradePct }; }
}
async function saveUserConfig(cfg) {
  localStorage.setItem(K_CONFIG, JSON.stringify(cfg));
}
async function loadApiKey() {
  return localStorage.getItem(K_API_KEY) || "";
}
async function saveApiKey(key) {
  localStorage.setItem(K_API_KEY, key);
}
async function loadApiSecret() {
  return localStorage.getItem(K_API_SECRET) || "";
}
async function saveApiSecret(secret) {
  localStorage.setItem(K_API_SECRET, secret);
}

// =============================================================
// 4) API LAYER (Pionex)
// =============================================================
const CryptoJS = require("crypto-js");

async function fetchPriceREST(symbol) {
  const url = `${CONFIG.dataSource.baseURL}${CONFIG.dataSource.rest.ticker}?symbol=${symbol}`;
  try {
    const response = await fetch(url);
    const json = await response.json();
    if (json.result && json.data?.symbols?.length > 0) {
      return parseFloat(json.data.symbols[0].lastPrice || json.data.symbols[0].price);
    }
    return null;
  } catch (error) {
    console.error("خطأ في جلب السعر من Pionex:", error);
    return null;
  }
}

function hmacSha256(message, secret) {
  return CryptoJS.HmacSHA256(message, secret).toString(CryptoJS.enc.Hex);
}

async function placeOrder({ symbol, side, qty, idempotencyKey }) {
  const cached = localStorage.getItem(`idem:${idempotencyKey}`);
  if (cached) return JSON.parse(cached);

  const apiKey = await loadApiKey();
  const apiSecret = await loadApiSecret();

  if (!apiKey || !apiSecret) {
    throw new Error("مفتاح API والسر مطلوبان للتداول الحقيقي");
  }

  const timestamp = Date.now();
  const path = CONFIG.dataSource.rest.order;
  const query = `timestamp=${timestamp}`;
  const body = JSON.stringify({
    symbol: symbol,
    side: side,
    type: "MARKET",
    amount: String(qty),
  });

  const signaturePayload = `POST${path}?${query}${timestamp}${body}`;
  const signature = hmacSha256(signaturePayload, apiSecret);

  const url = `${CONFIG.dataSource.baseURL}${path}?${query}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PIONEX-KEY": apiKey,
        "PIONEX-SIGNATURE": signature,
      },
      body: body,
    });

    const json = await response.json();

    if (!json.result) {
      throw new Error(json.message || "فشل تنفيذ الأمر");
    }

    const order = {
      orderId: json.data.orderId || `PIONEX-${Date.now()}`,
      symbol: json.data.symbol || symbol,
      side: json.data.side || side,
      qty: parseFloat(json.data.size || json.data.amount || qty),
      status: json.data.status === "OPEN" ? "FILLED" : json.data.status,
      avgPrice: parseFloat(json.data.price || 0),
      ts: json.timestamp || Date.now(),
      idempotencyKey,
    };

    localStorage.setItem(`idem:${idempotencyKey}`, JSON.stringify(order));
    return order;
  } catch (error) {
    console.error("خطأ في وضع الأمر:", error);
    throw error;
  }
}

// =============================================================
// 5) WEBSOCKET (Pionex)
// =============================================================
function connectWS(onTick) {
  const ws = new WebSocket(CONFIG.dataSource.ws.url);

  ws.onopen = () => {
    console.log('✅ WebSocket متصل بـ Pionex');
    const symbols = Object.values(CONFIG.dataSource.symbols);
    ws.send(JSON.stringify({
      op: "SUBSCRIBE",
      topic: "TICKER",
      symbols: symbols,
    }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.topic === "TICKER" && data.data) {
        const symbol = data.symbol || data.data.symbol;
        const price = parseFloat(data.data.lastPrice || data.data.price || data.data.c);
        if (symbol && price) {
          onTick({ symbol, price, ts: data.timestamp || Date.now() });
        }
      }
    } catch (error) {
      console.warn("خطأ في WebSocket:", error);
    }
  };

  ws.onerror = (error) => console.error('❌ WebSocket Error:', error);
  ws.onclose = () => console.log('🔴 WebSocket Closed');

  return () => ws.close();
}

// =============================================================
// 6) RISK MANAGEMENT
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
    .filter(t => t.status === "CLOSED" && t.closedAt >= start.getTime())
    .reduce((s, t) => s + (t.pnl || 0), 0);
}

function openTradesCount(trades) {
  return trades.filter(t => t.status === "OPEN").length;
}

// =============================================================
// 7) APP COMPONENT
// =============================================================
function formatPrice(p) {
  if (p == null) return "—";
  if (p < 0.001) return p.toExponential(3);
  if (p < 1) return p.toFixed(6);
  if (p < 100) return p.toFixed(4);
  return p.toFixed(2);
}

function App() {
  const [prices, setPrices] = useState({});
  const [prevPrices, setPrev] = useState({});
  const [trades, setTrades] = useState([]);
  const [userCfg, setUserCfg] = useState({ capital: 1000, riskPct: 1.0 });
  const [selected, setSelected] = useState(COINS[0]);
  const [stopPct, setStopPct] = useState("1.5");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  useEffect(() => {
    (async () => {
      const [t, c, k, s] = await Promise.all([
        loadTrades(),
        loadUserConfig(),
        loadApiKey(),
        loadApiSecret()
      ]);
      setTrades(t);
      setUserCfg(c);
      setApiKey(k || "");
      setApiSecret(s || "");
    })();
  }, []);

  useEffect(() => {
    const close = connectWS((tick) => {
      setPrices(prev => {
        setPrev(p => ({ ...p, [tick.symbol]: prev[tick.symbol] }));
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
  const dailyLimit = (cap * (CONFIG.risk.dailyLossLimitPct / 100));
  const tradingHalted = realized <= -dailyLimit;
  const openCount = openTradesCount(trades);

  async function place(side) {
    if (tradingHalted) {
      alert("التداول متوقف: تم بلوغ حد الخسارة اليومية.");
      return;
    }
    if (openCount >= CONFIG.risk.maxOpenTrades) {
      alert(`تجاوز الحد: أقصى عدد صفقات مفتوحة ${CONFIG.risk.maxOpenTrades}`);
      return;
    }
    if (!entry || !stop) {
      alert("بيانات ناقصة: أدخل وقف الخسارة.");
      return;
    }
    if (suggestedQty <= 0) {
      alert("حجم غير صالح: تحقق من رأس المال ونسبة المخاطرة.");
      return;
    }
    if (!apiKey || !apiSecret) {
      alert("مطلوب API: أدخل مفتاح API والسر للتداول الحقيقي.");
      return;
    }

    try {
      const idem = newIdempotencyKey();
      const order = await placeOrder({
        symbol: selected.symbol,
        side: side,
        qty: suggestedQty,
        idempotencyKey: idem
      });

      const trade = {
        id: order.orderId,
        symbol: order.symbol,
        side: order.side,
        entry: order.avgPrice || entry,
        stop,
        qty: order.qty,
        status: "OPEN",
        openedAt: order.ts,
      };
      const next = [trade, ...trades];
      setTrades(next);
      await saveTrades(next);
      alert(`تم: أمر ${side} منفذ بسعر ${formatPrice(order.avgPrice || entry)}`);
    } catch (error) {
      alert("خطأ: " + (error.message || "فشل تنفيذ الأمر"));
    }
  }

  async function closeTrade(tradeId, atPrice) {
    const next = trades.map(t => {
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
    if (apiSecret) await saveApiSecret(apiSecret);
    alert("تم حفظ الإعدادات والمفتاح والسر محلياً.");
  }

  return (
    <div style={{ backgroundColor: CONFIG.theme.bg, minHeight: "100vh", padding: "20px", color: CONFIG.theme.text }}>
      <h1 style={{ textAlign: "center", color: CONFIG.theme.text }}>Sandoq · صندوق التداول</h1>
      <p style={{ textAlign: "center", color: CONFIG.theme.textMuted }}>بيانات حقيقية من: {CONFIG.dataSource.name}</p>

      {/* بطاقة رأس المال */}
      <div style={{ backgroundColor: CONFIG.theme.card, border: `1px solid ${CONFIG.theme.border}`, borderRadius: 16, padding: 16, marginBottom: 16 }}>
        <h3 style={{ color: CONFIG.theme.text }}>رأس المال والمخاطرة</h3>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={{ color: CONFIG.theme.text }}>رأس المال ($)</label>
          <input type="number" value={userCfg.capital} onChange={e => setUserCfg(c => ({ ...c, capital: e.target.value }))}
            style={{ backgroundColor: CONFIG.theme.bg, color: CONFIG.theme.text, border: `1px solid ${CONFIG.theme.border}`, borderRadius: 8, padding: "6px 12px", width: "50%", textAlign: "right" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={{ color: CONFIG.theme.text }}>مخاطرة/صفقة %</label>
          <input type="number" value={userCfg.riskPct} onChange={e => setUserCfg(c => ({ ...c, riskPct: e.target.value }))}
            style={{ backgroundColor: CONFIG.theme.bg, color: CONFIG.theme.text, border: `1px solid ${CONFIG.theme.border}`, borderRadius: 8, padding: "6px 12px", width: "50%", textAlign: "right" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={{ color: CONFIG.theme.text }}>وقف الخسارة %</label>
          <input type="number" value={stopPct} onChange={e => setStopPct(e.target.value)}
            style={{ backgroundColor: CONFIG.theme.bg, color: CONFIG.theme.text, border: `1px solid ${CONFIG.theme.border}`, borderRadius: 8, padding: "6px 12px", width: "50%", textAlign: "right" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, marginBottom: 12 }}>
          <div><span style={{ color: CONFIG.theme.textMuted, fontSize: 12 }}>حد خسارة اليوم</span><br/><span style={{ color: CONFIG.theme.text, fontSize: 16, fontWeight: 600 }}>${dailyLimit.toFixed(2)}</span></div>
          <div><span style={{ color: CONFIG.theme.textMuted, fontSize: 12 }}>خسارة اليوم</span><br/><span style={{ color: realized < 0 ? CONFIG.theme.sell : CONFIG.theme.text, fontSize: 16, fontWeight: 600 }}>${realized.toFixed(2)}</span></div>
          <div><span style={{ color: CONFIG.theme.textMuted, fontSize: 12 }}>صفقات مفتوحة</span><br/><span style={{ color: CONFIG.theme.text, fontSize: 16, fontWeight: 600 }}>{openCount}/{CONFIG.risk.maxOpenTrades}</span></div>
        </div>
        {tradingHalted && <p style={{ color: CONFIG.theme.sell, fontWeight: 600, textAlign: "center" }}>⛔ تم إيقاف التداول: بلوغ حد الخسارة اليومي</p>}
        <button onClick={saveSettings} style={{ width: "100%", padding: "8px", backgroundColor: "transparent", border: `1px solid ${CONFIG.theme.border}`, borderRadius: 8, color: CONFIG.theme.textMuted, cursor: "pointer" }}>حفظ الإعدادات</button>
      </div>

      {/* قائمة الأسعار */}
      <div style={{ backgroundColor: CONFIG.theme.card, border: `1px solid ${CONFIG.theme.border}`, borderRadius: 16, padding: 16, marginBottom: 16 }}>
        <h3 style={{ color: CONFIG.theme.text }}>الأسعار الحية (Pionex)</h3>
        {COINS.map(coin => {
          const dir = prices[coin.symbol] && prevPrices[coin.symbol] != null ? (prices[coin.symbol] >= prevPrices[coin.symbol] ? 1 : -1) : 0;
          return (
            <div key={coin.symbol} onClick={() => setSelected(coin)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 8px", borderBottom: `1px solid ${CONFIG.theme.border}`, cursor: "pointer", borderRadius: 8, backgroundColor: selected.symbol === coin.symbol ? CONFIG.theme.border : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22, color: CONFIG.theme.text }}>{coin.icon}</span>
                <div><div style={{ color: CONFIG.theme.text }}>{coin.name}</div><div style={{ color: CONFIG.theme.textMuted, fontSize: 11 }}>{coin.type === "major" ? "رئيسية" : "ميم كوين"}</div></div>
              </div>
              <span style={{ color: dir === 1 ? CONFIG.theme.buy : dir === -1 ? CONFIG.theme.sell : CONFIG.theme.text, fontWeight: 600 }}>{prices[coin.symbol] != null ? formatPrice(prices[coin.symbol]) : "—"}</span>
            </div>
          );
        })}
      </div>

      {/* لوحة الأمر */}
      <div style={{ backgroundColor: CONFIG.theme.card, border: `1px solid ${CONFIG.theme.border}`, borderRadius: 16, padding: 16, marginBottom: 16 }}>
        <h3 style={{ color: CONFIG.theme.text }}>أمر سوق — {selected.name}</h3>
        <p style={{ color: CONFIG.theme.textMuted }}>السعر: {formatPrice(entry)} · وقف: {formatPrice(stop)}</p>
        <p style={{ color: CONFIG.theme.textMuted }}>الكمية المقترحة: {suggestedQty}</p>
        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <button disabled={tradingHalted} onClick={() => place("BUY")} style={{ flex: 1, padding: "12px", backgroundColor: CONFIG.theme.buy, border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 16, cursor: "pointer", opacity: tradingHalted ? 0.4 : 1 }}>شراء</button>
          <button disabled={tradingHalted} onClick={() => place("SELL")} style={{ flex: 1, padding: "12px", backgroundColor: CONFIG.theme.sell, border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 16, cursor: "pointer", opacity: tradingHalted ? 0.4 : 1 }}>بيع</button>
        </div>
      </div>

      {/* سجل الصفقات */}
      <div style={{ backgroundColor: CONFIG.theme.card, border: `1px solid ${CONFIG.theme.border}`, borderRadius: 16, padding: 16, marginBottom: 16 }}>
        <h3 style={{ color: CONFIG.theme.text }}>سجل الصفقات ({trades.length})</h3>
        {trades.length === 0 && <p style={{ color: CONFIG.theme.textMuted }}>لا توجد صفقات بعد.</p>}
        {trades.map(t => {
          const isOpen = t.status === "OPEN";
          return (
            <div key={t.id} style={{ backgroundColor: CONFIG.theme.bg, borderRadius: 8, padding: 10, marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: CONFIG.theme.text, fontWeight: 600 }}>{t.side === "BUY" ? "شراء" : "بيع"} {t.symbol}</span>
                <span style={{ color: isOpen ? CONFIG.theme.warn : (t.pnl >= 0 ? CONFIG.theme.buy : CONFIG.theme.sell), fontWeight: 600 }}>{isOpen ? "مفتوحة" : (t.pnl >= 0 ? `+${t.pnl.toFixed(2)}` : t.pnl.toFixed(2))}</span>
              </div>
              <div style={{ color: CONFIG.theme.textMuted, fontSize: 12 }}>دخول: {formatPrice(t.entry)} · وقف: {formatPrice(t.stop)} · كمية: {t.qty}</div>
              {!isOpen && <div style={{ color: CONFIG.theme.textMuted, fontSize: 12 }}>خروج: {formatPrice(t.exit)} · {new Date(t.closedAt).toLocaleString()}</div>}
              {isOpen && <button onClick={() => closeTrade(t.id, prices[t.symbol] ?? t.entry)} style={{ width: "100%", padding: "8px", backgroundColor: "transparent", border: `1px solid ${CONFIG.theme.border}`, borderRadius: 8, color: CONFIG.theme.textMuted, cursor: "pointer", marginTop: 4 }}>إغلاق بسعر السوق</button>}
            </div>
          );
        })}
      </div>

      {/* مفتاح API والسر */}
      <div style={{ backgroundColor: CONFIG.theme.card, border: `1px solid ${CONFIG.theme.border}`, borderRadius: 16, padding: 16, marginBottom: 16 }}>
        <h3 style={{ color: CONFIG.theme.text }}>مفتاح API والسر (للتداول الحقيقي)</h3>
        <input type="password" placeholder="مفتاح API من Pionex" value={apiKey} onChange={e => setApiKey(e.target.value)}
          style={{ width: "100%", backgroundColor: CONFIG.theme.bg, color: CONFIG.theme.text, border: `1px solid ${CONFIG.theme.border}`, borderRadius: 8, padding: "6px 12px", marginBottom: 8 }} />
        <input type="password" placeholder="السر (Secret) من Pionex" value={apiSecret} onChange={e => setApiSecret(e.
