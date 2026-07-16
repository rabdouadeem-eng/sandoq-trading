// =============================================================
// useBotSignal.js — يربط Sandoq بـ PRO-TRADING-BOT signal API
// يسولف كل POLL_INTERVAL_MS، وإذا الثقة كافية، كينفذ صفقة وهمية تلقائيا
// =============================================================
import { useEffect, useRef, useState, useCallback } from "react";

// 🔧 بدّل هذا بـ URL الحقيقي تاع PRO-TRADING-BOT على Render
const SIGNAL_API_URL =
  process.env.REACT_APP_SIGNAL_API_URL ||
  "https://pro-trading-bot-pevb.onrender.com/api/signals";

const POLL_INTERVAL_MS = 30_000; // 30 ثانية
const BOT_ENABLED_KEY = "sandoq_bot_autotrade_enabled";

export function loadBotEnabled() {
  const v = localStorage.getItem(BOT_ENABLED_KEY);
  return v === null ? false : v === "true"; // معطل بالافتراض — المستخدم يفعّلو بنفسه
}

export function saveBotEnabled(enabled) {
  localStorage.setItem(BOT_ENABLED_KEY, String(enabled));
}

/**
 * @param {Object} params
 * @param {Object} params.coinsBySymbol - { BTCUSDT: {...COINS entry} }
 * @param {Object} params.prices - أسعار حية { BTCUSDT: 63000, ... }
 * @param {Array}  params.trades - الصفقات الحالية
 * @param {Function} params.placeAuto - async (coin, side, reasons) => void  (نفس منطق place() الموجود)
 * @param {boolean} params.enabled - واش التنفيذ التلقائي مفعّل
 */
export function useBotSignal({ coinsBySymbol, prices, trades, placeAuto, enabled }) {
  const [lastSignals, setLastSignals] = useState({});
  const [lastError, setLastError] = useState(null);
  const executedRef = useRef(new Set()); // باش ما نكرروش نفس الإشارة مرتين متتاليتين

  const poll = useCallback(async () => {
    try {
      const res = await fetch(SIGNAL_API_URL);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();

      const bySymbol = {};
      for (const s of data.signals || []) bySymbol[s.symbol] = s;
      setLastSignals(bySymbol);
      setLastError(null);

      if (!enabled) return; // المستخدم عطّل التنفيذ التلقائي — نعرضو الإشارات فقط

      for (const sig of data.signals || []) {
        if (sig.signal === "hold") continue;
        if (sig.confidence < (data.threshold ?? 0.65)) continue;

        const coin = coinsBySymbol[sig.symbol];
        if (!coin) continue;

        // منع تكرار نفس الإشارة إلا إذا تبدلات (buy->sell ولا العكس)
        const signalKey = `${sig.symbol}:${sig.signal}`;
        if (executedRef.current.has(signalKey)) continue;

        // منع فتح صفقة جديدة إذا كاين وحدة مفتوحة بنفس العملة
        const hasOpen = trades.some((t) => t.symbol === sig.symbol && t.status === "OPEN");
        if (hasOpen) continue;

        const side = sig.signal === "buy" ? "BUY" : "SELL";
        await placeAuto(coin, side, sig.reasons, sig.confidence);

        executedRef.current.add(signalKey);
        // نمسحو المفتاح المعاكس باش تقدر تنفذ إشارة جديدة إذا تبدل الاتجاه
        executedRef.current.delete(`${sig.symbol}:${side === "BUY" ? "sell" : "buy"}`);
      }
    } catch (e) {
      setLastError(e.message || String(e));
    }
  }, [coinsBySymbol, trades, placeAuto, enabled]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  return { lastSignals, lastError };
}
