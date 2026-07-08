// =============================================================
// Sandoq — Personal Trading Demo (single-file, Expo + React Native)
// BingX-style data source, swappable via config.js semantics below
// =============================================================

// -----------------------------
// 1) CONFIG (swap in one place)
// -----------------------------
// في تطبيق حقيقي: انقل هذا القسم إلى src/config.js واستورده.
// هنا نعرّفه داخل الملف ليظل تطبيقاً واحداً.
const CONFIG = {
  // مصدر البيانات — غيّر هذا الكائن فقط لتبديل المنصة
  dataSource: {
    name: "bingx",
    baseURL: "https://open-api.bingx.com",
    rest: {
      ticker: "/openApi/swap/v2/quote/ticker",          // سعر آخر
      order:  "/openApi/swap/v2/trade/order",            // أوامر فورية
    },
    // محاكاة WebSocket — في الإنتاج استبدلها بعنوان حقيقي:
    // wss://open-api-swap.bingx.com/swap-market
    // والـ subscription payload حسب توثيق BingX
    ws: {
      url: "SIMULATED", // محاكاة لتجنّب تعقيدات بيئة Expo preview
      pingIntervalMs: 20000,
    },
    // تعيين أزواج التداول
    symbols: {
      BTCUSDT: "BTC-USDT",
      ETHUSDT: "ETH-USDT",
      BNBUSDT: "BNB-USDT",
      SOLUSDT: "SOL-USDT",
      DOGEUSDT: "DOGE-USDT",
      SHIBUSDT: "SHIB-USDT",
      PEPEUSDT: "PEPE-USDT",
    },
  },

  // نظام إدارة المخاطر — قيم قابلة للتعديل
  risk: {
    riskPerTradePct: 1.0,        // % المخاطرة لكل صفقة (افتراضي 1%)
    dailyLossLimitPct: 3.0,      // حد الخسارة اليومية % من رأس المال
    maxOpenTrades: 3,            // أقصى عدد صفقات مفتوحة
  },

  // ألوان محايدة (لا شعارات منصات)
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
  { symbol: "BTCUSDT",  type: "major", name: "Bitcoin",  icon: "₿" },
  { symbol: "ETHUSDT",  type: "major", name: "Ethereum", icon: "Ξ" },
  { symbol: "BNBUSDT",  type: "major", name: "BNB",      icon: "Ⓑ" },
  { symbol: "SOLUSDT",  type: "major", name: "Solana",   icon: "◎" },
  { symbol: "DOGEUSDT", type: "meme",  name: "Dogecoin", icon: "Ð" },
  { symbol: "SHIBUSDT", type: "meme",  name: "Shiba",    icon: "S" },
  { symbol: "PEPEUSDT", type: "meme",  name: "Pepe",     icon: "P" },
];

// =============================================================
// 3) SECURE STORAGE (expo-secure-store) — مع بديل آمن للويب
// =============================================================
let SecureStore;
try {
  // الاستيراد الصحيح — قيمة افتراضية تمنع تعطل Web/preview
  SecureStore = require("expo-secure-store");
} catch (e) {
  // بديل في الذاكرة للبيئات التي لا تدعم expo-secure-store
  SecureStore = {
    _mem: new Map(),
    async setItemAsync(k, v) { this._mem.set(k, v); },
    async getItemAsync(k)    { return this._mem.get(k) ?? null; },
    async deleteItemAsync(k) { this._mem.delete(k); },
  };
}

// تخزين مفاتيح API بشكل مشفّر محلياً
async function saveApiKey(key) {
  if (!key) return;
  try { await SecureStore.setItemAsync("sandoq_api_key", String(key)); }
  catch (e) { console.warn("SecureStore unavailable:", e?.message); }
}
async function loadApiKey() {
  try { return await SecureStore.getItemAsync("sandoq_api_key"); }
  catch (e) { return null; }
}

// =============================================================
// 4) STORAGE — سجل الصفقات + الإعدادات
// =============================================================
let AsyncStorage;
try { AsyncStorage = require("@react-native-async-storage/async-storage").default; }
catch (e) {
  // بديل في الذاكرة
  const mem = new Map();
  AsyncStorage = {
    async setItem(k, v) { mem.set(k, v); },
    async getItem(k)    { return mem.get(k) ?? null; },
    async removeItem(k) { mem.delete(k); },
  };
}

const K_TRADES  = "sandoq_trades";
const K_CONFIG  = "sandoq_user_config";

async function loadTrades() {
  try { const v = await AsyncStorage.getItem(K_TRADES); return v ? JSON.parse(v) : []; }
  catch (e) { return []; }
}
async function saveTrades(trades) {
  await AsyncStorage.setItem(K_TRADES, JSON.stringify(trades));
}
async function loadUserConfig() {
  try {
    const v = await AsyncStorage.getItem(K_CONFIG);
    return v ? JSON.parse(v) : { capital: 1000, riskPct: CONFIG.risk.riskPerTradePct };
  } catch (e) { return { capital: 1000, riskPct: CONFIG.risk.riskPerTradePct }; }
}
async function saveUserConfig(cfg) {
  await AsyncStorage.setItem(K_CONFIG, JSON.stringify(cfg));
}

// =============================================================
// 5) API LAYER (REST) — يدعم التبديل عبر CONFIG.dataSource
// =============================================================
async function fetchPriceREST(symbol) {
  // في الإنتاج: استدعاء حقيقي لـ BingX
  // const url = `${CONFIG.dataSource.baseURL}${CONFIG.dataSource.rest.ticker}?symbol=${symbol}`;
  // const res = await fetch(url);
  // const json = await res.json();
  // return parseFloat(json.data?.lastPrice ?? 0);
  //
  // للعرض التجريبي: محاكاة واقعية بسعر أساس + ضوضاء صغيرة
  const seed = {
    BTCUSDT: 67000, ETHUSDT: 3500, BNBUSDT: 600, SOLUSDT: 150,
    DOGEUSDT: 0.15, SHIBUSDT: 0.000024, PEPEUSDT: 0.000009,
  };
  const base = seed[symbol] ?? 1;
  const drift = (Math.random() - 0.5) * 0.004; // ±0.2%
  const price = base * (1 + drift);
  return price;
}

async function placeOrder({ symbol, side, qty, idempotencyKey }) {
  // idempotency: نمنع تكرار الأمر عند فشل الاتصال
  const cached = await AsyncStorage.getItem(`idem:${idempotencyKey}`);
  if (cached) return JSON.parse(cached);

  // محاكاة استجابة BingX
  const orderId = `MOCK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const response = {
    orderId,
    symbol,
    side,                 // "BUY" | "SELL"
    type: "MARKET",
    qty,
    status: "FILLED",
    avgPrice: await fetchPriceREST(symbol),
    ts: Date.now(),
    idempotencyKey,
  };
  await AsyncStorage.setItem(`idem:${idempotencyKey}`, JSON.stringify(response));
  return response;
}

// =============================================================
// 6) WEBSOCKET LAYER — محاكاة + fallback REST
// =============================================================
// في الإنتاج: استبدل connectWS بمنطق حقيقي يحترم CONFIG.dataSource.ws.url
function connectWS(onTick) {
  if (CONFIG.dataSource.ws.url !== "SIMULATED") {
    // مكانك الحقيقي:
    // const ws = new WebSocket(CONFIG.dataSource.ws.url);
    // ws.onmessage = (e) => onTick(JSON.parse(e.data));
    // return () => ws.close();
  }
  // محاكاة: تحديث كل 1500ms لكل عملة
  const state = Object.fromEntries(COINS.map(c => [c.symbol, null]));
  const timer = setInterval(async () => {
    for (const c of COINS) {
      const p = await fetchPriceREST(c.symbol);
      state[c.symbol] = p;
      onTick({ symbol: c.symbol, price: p, ts: Date.now() });
    }
  }, 1500);
  return () => clearInterval(timer);
}

// =============================================================
// 7) RISK MANAGEMENT
// =============================================================
function calcPositionSize({ capital, riskPct, entryPrice, stopPrice }) {
  // حجم الصفقة بناءً على المخاطرة والوقف
  // amountRisked = capital * (riskPct/100)
  // perUnitRisk  = |entryPrice - stopPrice|
  // qty          = amountRisked / perUnitRisk
  if (!entryPrice || !stopPrice) return 0;
  const amountRisked = capital * (riskPct / 100);
  const perUnitRisk  = Math.abs(entryPrice - stopPrice);
  if (perUnitRisk === 0) return 0;
  return +(amountRisked / perUnitRisk).toFixed(6);
}

function newIdempotencyKey() {
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function dailyRealizedPnL(trades) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return trades
    .filter(t => t.status === "CLOSED" && t.closedAt >= start.getTime())
    .reduce((s, t) => s + (t.pnl || 0), 0);
}

function openTradesCount(trades) {
  return trades.filter(t => t.status === "OPEN").length;
}

// =============================================================
// 8) REACT NATIVE APP
// =============================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ScrollView, Alert, Platform, StatusBar,
} from "react-native";

// ---- مكوّنات صغيرة قابلة للاختبار ----
function PriceRow({ coin, price, onSelect, selected }) {
  const dir = price && coin._prev != null ? (price >= coin._prev ? 1 : -1) : 0;
  return (
    <TouchableOpacity
      onPress={() => onSelect(coin)}
      style={[styles.row, selected && styles.rowSelected]}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.coinIcon}>{coin.icon}</Text>
        <View>
          <Text style={styles.coinName}>{coin.name}</Text>
          <Text style={styles.coinType}>
            {coin.type === "major" ? "رئيسية" : "ميم كوين"}
          </Text>
        </View>
      </View>
      <Text style={[
        styles.price,
        dir === 1  && { color: CONFIG.theme.buy },
        dir === -1 && { color: CONFIG.theme.sell },
      ]}>
        {price != null ? formatPrice(price) : "—"}
      </Text>
    </TouchableOpacity>
  );
}

function formatPrice(p) {
  if (p == null) return "—";
  if (p < 0.001) return p.toExponential(3);
  if (p < 1)     return p.toFixed(6);
  if (p < 100)   return p.toFixed(4);
  return p.toFixed(2);
}

function TradeItem({ trade }) {
  const isOpen = trade.status === "OPEN";
  return (
    <View style={styles.tradeCard}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={styles.tradeTitle}>
          {trade.side === "BUY" ? "شراء" : "بيع"} {trade.symbol}
        </Text>
        <Text style={[
          styles.tradeBadge,
          { color: isOpen ? CONFIG.theme.warn : (trade.pnl >= 0 ? CONFIG.theme.buy : CONFIG.theme.sell) },
        ]}>
          {isOpen ? "مفتوحة" : (trade.pnl >= 0 ? `+${trade.pnl.toFixed(2)}` : trade.pnl.toFixed(2))}
        </Text>
      </View>
      <Text style={styles.tradeMeta}>
        دخول: {formatPrice(trade.entry)} · وقف: {formatPrice(trade.stop)} · كمية: {trade.qty}
      </Text>
      {!isOpen && (
        <Text style={styles.tradeMeta}>
          خروج: {formatPrice(trade.exit)} · {new Date(trade.closedAt).toLocaleString()}
        </Text>
      )}
    </View>
  );
}

// ---- التطبيق الرئيسي ----
export default function App() {
  const [prices, setPrices]     = useState({});
  const [prevPrices, setPrev]   = useState({});
  const [trades, setTrades]     = useState([]);
  const [userCfg, setUserCfg]   = useState({ capital: 1000, riskPct: 1.0 });
  const [selected, setSelected] = useState(COINS[0]);
  const [stopPct, setStopPct]   = useState("1.5");   // وقف افتراضي %
  const [apiKey, setApiKey]     = useState("");

  // تحميل أولي
  useEffect(() => {
    (async () => {
      const [t, c, k] = await Promise.all([loadTrades(), loadUserConfig(), loadApiKey()]);
      setTrades(t);
      setUserCfg(c);
      setApiKey(k || "");
    })();
  }, []);

  // WebSocket + fallback
  useEffect(() => {
    const close = connectWS((tick) => {
      setPrices(prev => {
        setPrev(p => ({ ...p, [tick.symbol]: prev[tick.symbol] }));
        return { ...prev, [tick.symbol]: tick.price };
      });
    });
    return close;
  }, []);

  // تثبيت prev لكل صف
  const enrichedCoins = useMemo(() => COINS.map(c => ({ ...c, _prev: prevPrices[c.symbol] })), [prevPrices]);

  // حساب حجم الصفقة المقترح
  const entry = prices[selected.symbol];
  const stop  = useMemo(() => {
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

  // قيود التداول اليومية
  const realized = useMemo(() => dailyRealizedPnL(trades), [trades]);
  const cap = parseFloat(userCfg.capital) || 0;
  const dailyLimit = (cap * (CONFIG.risk.dailyLossLimitPct / 100));
  const tradingHalted = realized <= -dailyLimit;
  const openCount = openTradesCount(trades);

  async function place(side) {
    if (tradingHalted) {
      return Alert.alert("التداول متوقف", "تم بلوغ حد الخسارة اليومية.");
    }
    if (openCount >= CONFIG.risk.maxOpenTrades) {
      return Alert.alert("تجاوز الحد", `أقصى عدد صفقات مفتوحة: ${CONFIG.risk.maxOpenTrades}`);
    }
    if (!entry || !stop) return Alert.alert("بيانات ناقصة", "أدخل وقف الخسارة.");
    if (suggestedQty <= 0) return Alert.alert("حجم غير صالح", "تحقق من رأس المال ونسبة المخاطرة.");

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
    Alert.alert("تم", `أمر ${side} مسجّل بسعر ${formatPrice(order.avgPrice)}`);
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
    Alert.alert("حُفظت", "تم حفظ الإعدادات والمفتاح مشفّر محلياً.");
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.h1}>Sandoq · صندوق التداول</Text>
        <Text style={styles.h2}>ديمو لمستخدم واحد · مصدر البيانات: {CONFIG.dataSource.name}</Text>

        {/* بطاقة رأس المال والمخاطرة */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>رأس المال والمخاطرة</Text>
          <View style={styles.formRow}>
            <Text style={styles.label}>رأس المال ($)</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={String(userCfg.capital)}
              onChangeText={v => setUserCfg(c => ({ ...c, capital: v }))}
            />
          </View>
          <View style={styles.formRow}>
            <Text style={styles.label}>مخاطرة/صفقة %</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={String(userCfg.riskPct)}
              onChangeText={v => setUserCfg(c => ({ ...c, riskPct: v }))}
            />
          </View>
          <View style={styles.formRow}>
            <Text style={styles.label}>وقف الخسارة %</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={stopPct}
              onChangeText={setStopPct}
            />
          </View>
          <View style={styles.stats}>
            <Stat label="حد خسارة اليوم" value={`$${dailyLimit.toFixed(2)}`} />
            <Stat label="خسارة اليوم"    value={`$${realized.toFixed(2)}`} muted={realized < 0} />
            <Stat label="صفقات مفتوحة"  value={`${openCount}/${CONFIG.risk.maxOpenTrades}`} />
          </View>
          {tradingHalted && (
            <Text style={styles.alert}>⛔ تم إيقاف التداول: بلوغ حد الخسارة اليومي</Text>
          )}
          <TouchableOpacity style={styles.btnGhost} onPress={saveSettings}>
            <Text style={styles.btnGhostText}>حفظ الإعدادات</Text>
          </TouchableOpacity>
        </View>

        {/* قائمة الأسعار */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>الأسعار الحية</Text>
          {enrichedCoins.map(coin => (
            <PriceRow
              key={coin.symbol}
              coin={coin}
              price={prices[coin.symbol]}
              onSelect={setSelected}
              selected={selected.symbol === coin.symbol}
            />
          ))}
        </View>

        {/* لوحة الأمر */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>أمر سوق — {selected.name}</Text>
          <Text style={styles.muted}>السعر: {formatPrice(entry)} · وقف: {formatPrice(stop)}</Text>
          <Text style={styles.muted}>الكمية المقترحة: {suggestedQty}</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: CONFIG.theme.buy }, tradingHalted && styles.btnDisabled]}
              disabled={tradingHalted}
              onPress={() => place("BUY")}
            >
              <Text style={styles.btnText}>شراء</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: CONFIG.theme.sell }, tradingHalted && styles.btnDisabled]}
              disabled={tradingHalted}
              onPress={() => place("SELL")}
            >
              <Text style={styles.btnText}>بيع</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* السجل */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>سجل الصفقات ({trades.length})</Text>
          {trades.length === 0 && <Text style={styles.muted}>لا توجد صفقات بعد.</Text>}
          {trades.map(t => (
            <View key={t.id}>
              <TradeItem trade={t} />
              {t.status === "OPEN" && (
                <TouchableOpacity
                  style={styles.btnGhost}
                  onPress={() => closeTrade(t.id, prices[t.symbol] ?? t.entry)}
                >
                  <Text style={styles.btnGhostText}>إغلاق بسعر السوق</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>

        {/* مفتاح API (اختياري) */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>مفتاح API (اختياري — يُشفّر محلياً)</Text>
          <TextInput
            style={styles.input}
            placeholder="أدخل المفتاح إن أردت ربطاً حقيقياً"
            placeholderTextColor={CONFIG.theme.textMuted}
            secureTextEntry
            value={apiKey}
            onChangeText={setApiKey}
          />
          <Text style={styles.muted}>
            يُخزَّن عبر expo-secure-store. في وضع الديمو لا يُستعمل لإرسال أوامر حقيقية.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, muted }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, muted && { color: CONFIG.theme.sell }]}>{value}</Text>
    </View>
  );
}

// =============================================================
// 9) STYLES
// =============================================================
const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: CONFIG.theme.bg },
  h1:          { color: CONFIG.theme.text, fontSize: 22, fontWeight: "700", padding: 16, paddingBottom: 4 },
  h2:          { color: CONFIG.theme.textMuted, fontSize: 12, paddingHorizontal: 16, paddingBottom: 12 },
  card:        { backgroundColor: CONFIG.theme.card, margin: 12, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: CONFIG.theme.border },
  cardTitle:   { color: CONFIG.theme.text, fontWeight: "700", marginBottom: 8 },
  formRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: 4 },
  label:       { color: CONFIG.theme.textMuted, flex: 1 },
  input:       { flex: 1, color: CONFIG.theme.text, borderWidth: 1, borderColor: CONFIG.theme.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, textAlign: "right" },
  stats:       { flexDirection: "row", marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: CONFIG.theme.border },
  statLabel:   { color: CONFIG.theme.textMuted, fontSize: 11 },
  statValue:   { color: CONFIG.theme.text, fontSize: 16, fontWeight: "700", marginTop: 2 },
  alert:       { color: CONFIG.theme.sell, marginTop: 8, fontWeight: "700" },
  btnGhost:    { marginTop: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: CONFIG.theme.border, alignItems: "center" },
  btnGhostText:{ color: CONFIG.theme.text },
  btnRow:      { flexDirection: "row", marginTop: 12, gap: 8 },
  btn:         { flex: 1, padding: 12, borderRadius: 8, alignItems: "center" },
  btnDisabled: { opacity: 0.4 },
  btnText:     { color: "#fff", fontWeight: "700" },
  row:         { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: CONFIG.theme.border },
  rowSelected: { backgroundColor: "rgba(255,255,255,0.04)" },
  rowLeft:     { flexDirection: "row", alignItems: "center", gap: 10 },
  coinIcon:    { color: CONFIG.theme.text, fontSize: 20, width: 30, textAlign: "center" },
  coinName:    { color: CONFIG.theme.text, fontWeight: "600" },
  coinType:    { color: CONFIG.theme.textMuted, fontSize: 11 },
  price:       { color: CONFIG.theme.text, fontWeight: "700" },
  muted:       { color: CONFIG.theme.textMuted, marginTop: 4 },
  tradeCard:   { backgroundColor: CONFIG.theme.bg, padding: 10, borderRadius: 8, marginTop: 8, borderWidth: 1, borderColor: CONFIG.theme.border },
  tradeTitle:  { color: CONFIG.theme.text, fontWeight: "700" },
  tradeBadge:  { fontWeight: "700" },
  tradeMeta:   { color: CONFIG.theme.textMuted, fontSize: 12, marginTop: 2 },
});
