// =============================================================
// useBotSignal.js — يربط Sandoq بـ PRO-TRADING-BOT signal API
// يسولف كل POLL_INTERVAL_MS بالضبط (ثابت)، وإذا الثقة كافية، كينفذ صفقة وهمية تلقائيا
//
// 🔧 v2: تصليح race condition — الفحص كان كيتفعل عشرات المرات فالثانية
// بسبب تحديثات الأسعار الحية (WebSocket) اللي كانت كتعاود تشغل الـ effect.
// دابا نستعملو refs باش الفحص يبقى ثابت كل 30 ثانية بالضبط.
// =============================================================
import { useEffect, useRef, useState, useCallback } from "react";

const SIGNAL_API_URL =
  process.env.REACT_APP_SIGNAL_API_URL ||
  "https://pro-trading-bot-pevb.onrender.com/api/signals";

const POLL_INTERVAL_MS = 30_000; // 30 ثانية
const BOT_ENABLED_KEY = "sandoq_bot_autotrade_enabled";

export function loadBotEnabled() {
  const v = localStorage.getItem(BOT_ENABLED_KEY);
  return v === null ? false : v === "true"; // معطل بالافتراض
}

export function saveBotEnabled(enabled) {
  localStorage.setItem(BOT_ENABLED_KEY, String(enabled));
}

/**
 * @param {Object} params
 * @param {Object} params.coinsBySymbol
 * @param {Object} params.prices
 * @param {Array}  params.trades
 * @param {Function} params.placeAuto
 * @param {boolean} params.enabled
 */
export function useBotSignal({ coinsBySymbol, prices, trades, placeAuto, enabled }) {
  const [lastSignals, setLastSignals] = useState({});
  const [lastError, setLastError] = useState(null);
  const executedRef = useRef(new Set());
  const inFlightRef = useRef(false); // 🔒 يمنع تنفيذ poll() جديد إلا إذا سبقو كمل

  // نخزنو آخر نسخة من القيم المتغيرة فـ refs، باش poll() ما يعاودش يتخلق
  // كل مرة تتبدل prices/trades — هوما اللي كانوا كيسببو الـ race condition
  const latestRef = useRef({ coinsBySymbol, prices, trades, placeAuto, enabled });
  useEffect(() => {
    latestRef.current = { coinsBySymbol, prices, trades, placeAuto, enabled };
  }, [coinsBySymbol, prices, trades, placeAuto, enabled]);

  const poll = useCallback(async () => {
    if (inFlightRef.current) return; // فحص سابق مازال خدام — تجاهل هاد الدورة
    inFlightRef.current = true;
    try {
      const { coinsBySymbol, prices, trades, placeAuto, enabled } = latestRef.current;

      const res = await fetch(SIGNAL_API_URL);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();

      const bySymbol = {};
      for (const s of data.signals || []) bySymbol[s.symbol] = s;
      setLastSignals(bySymbol);
      setLastError(null);

      if (!enabled) return;

      for (const sig of data.signals || []) {
        if (sig.signal === "hold") continue;
        if (sig.confidence < (data.threshold ?? 0.65)) continue;

        const coin = coinsBySymbol[sig.symbol];
        if (!coin) continue;

        const signalKey = `${sig.symbol}:${sig.signal}`;
        if (executedRef.current.has(signalKey)) continue;

        const hasOpen = trades.some((t) => t.symbol === sig.symbol && t.status === "OPEN");
        if (hasOpen) continue;

        const side = sig.signal === "buy" ? "BUY" : "SELL";
        await placeAuto(coin, side, sig.reasons, sig.confidence);

        executedRef.current.add(signalKey);
        executedRef.current.delete(`${sig.symbol}:${side === "BUY" ? "sell" : "buy"}`);
      }
    } catch (e) {
      setLastError(e.message || String(e));
    } finally {
      inFlightRef.current = false;
    }
  }, []); // 🔑 بلا dependencies — poll() ثابت، ما يتخلقش من جديد أبدا

  useEffect(() => {
    poll(); // فحص أول مرة عند التحميل
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]); // poll ثابت دابا، فهاد effect يخدم مرة وحدة فقط

  return { lastSignals, lastError };
}
