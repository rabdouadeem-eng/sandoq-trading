// =============================================================
// useBotSignal.js — يربط Sandoq بـ PRO-TRADING-BOT signal API
// v4: الحماية كاملة هنا وحدها (بلا ما نحتاجو تعديل App.js).
// cooldown محفوظ فـ localStorage (5 دقايق لكل عملة) — كيبقى حي
// حتى لو الصفحة تعاود تفتح (remount) قبل ما trades يتحملو.
// =============================================================
import { useEffect, useRef, useState, useCallback } from "react";

const SIGNAL_API_URL =
  process.env.REACT_APP_SIGNAL_API_URL ||
  "https://pro-trading-bot-pevb.onrender.com/api/signals";

const POLL_INTERVAL_MS = 30_000; // 30 ثانية
const BOT_ENABLED_KEY = "sandoq_bot_autotrade_enabled";
const COOLDOWN_KEY = "sandoq_bot_last_trade_ts"; // { SYMBOL: timestamp }
const COOLDOWN_MS = 5 * 60 * 1000; // 5 دقايق — بلا صفقة جديدة لنفس العملة

export function loadBotEnabled() {
  const v = localStorage.getItem(BOT_ENABLED_KEY);
  return v === null ? false : v === "true";
}

export function saveBotEnabled(enabled) {
  localStorage.setItem(BOT_ENABLED_KEY, String(enabled));
}

function loadCooldowns() {
  try {
    return JSON.parse(localStorage.getItem(COOLDOWN_KEY) || "{}");
  } catch {
    return {};
  }
}

function markTraded(symbol) {
  const map = loadCooldowns();
  map[symbol] = Date.now();
  localStorage.setItem(COOLDOWN_KEY, JSON.stringify(map));
}

function isInCooldown(symbol) {
  const map = loadCooldowns();
  const last = map[symbol];
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
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
  const inFlightRef = useRef(false);

  const latestRef = useRef({ coinsBySymbol, prices, trades, placeAuto, enabled });
  useEffect(() => {
    latestRef.current = { coinsBySymbol, prices, trades, placeAuto, enabled };
  }, [coinsBySymbol, prices, trades, placeAuto, enabled]);

  const poll = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const { coinsBySymbol, trades, placeAuto, enabled } = latestRef.current;

      const res = await fetch(SIGNAL_API_URL);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();

      const bySymbol = {};
      for (const s of data.signals || []) bySymbol[s.symbol] = s;
      setLastSignals(bySymbol);
      setLastError(null);

      // 🔒 ما ننفذوش صفقات إلا إذا البوت مفعّل
      if (!enabled) return;

      for (const sig of data.signals || []) {
        if (sig.signal === "hold") continue;
        if (sig.confidence < (data.threshold ?? 0.65)) continue;

        const coin = coinsBySymbol[sig.symbol];
        if (!coin) continue;

        const signalKey = `${sig.symbol}:${sig.signal}`;
        if (executedRef.current.has(signalKey)) continue;

        // 🔒 حماية فالذاكرة (نفس الجلسة)
        const hasOpen = trades.some((t) => t.symbol === sig.symbol && t.status === "OPEN");
        if (hasOpen) continue;

        // 🔒 حماية محفوظة فـ localStorage (كتبقى حتى بعد remount/refresh)
        if (isInCooldown(sig.symbol)) continue;

        const side = sig.signal === "buy" ? "BUY" : "SELL";
        await placeAuto(coin, side, sig.reasons, sig.confidence);

        markTraded(sig.symbol);
        executedRef.current.add(signalKey);
        executedRef.current.delete(`${sig.symbol}:${side === "BUY" ? "sell" : "buy"}`);
      }
    } catch (e) {
      setLastError(e.message || String(e));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  return { lastSignals, lastError };
}
