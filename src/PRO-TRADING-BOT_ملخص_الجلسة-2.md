# 📋 ملخص جلسة PRO-TRADING-BOT — 15-16 يوليوز 2026

## 🎯 الهدف
ربط PRO-TRADING-BOT (بوت تحليل ذكي بـ Python) بـ Sandoq (تطبيق تداول ورقي React)، مع الحفاظ على gold-silver-bot (MT5) منفصل تماما.

---

## ✅ ما تم إنجازه

### 1) بنية `signal_server.py` (Flask API جديد)
- ملف جديد فـ `api/signal_server.py`
- يحلل 7 عملات (BTC, ETH, BNB, SOL, DOGE, SHIB, PEPE) عبر:
  - `TechnicalIndicators` (RSI, MACD, Bollinger, Stochastic)
  - `BottomTopDetector` (كشف القاع/الذروة)
  - `TradingMentor` (AI، هادئ حتى يتدرب)
- 3 endpoints:
  - `GET /api/health` → `{"status":"ok"}`
  - `GET /api/signal/<symbol>` → إشارة عملة واحدة
  - `GET /api/signals` → إشارات كل العملات (هذا اللي يستعملو Sandoq)
- كاش خفيف (20 ثانية) باش ما نضربوش MEXC بزاف

### 2) مصدر البيانات: MEXC بدل Binance
- Binance.com كيبلوكي IP ديال Render (451 geo-restriction) — نفس مشكل Trading-Bot- القديم
- الحل: `get_klines_mexc()` — نداء REST مباشر لـ `api.mexc.com`، بلا `python-binance` خالص
- **تأكد بالمقارنة مع Pionex:** BTC عندنا 64,758$ vs Pionex 64,803$ (فرق <0.1%، طبيعي)

### 3) تنبيهات تيليجرام
- بوت جديد: `@abdellah_pro_trading_bot` (منفصل عن MyfadherBOT/ABDUGEMINIBOT)
- `TELEGRAM_BOT_TOKEN` = `8709256894:AAGT5xoHrSxzB...`
- `TELEGRAM_CHAT_ID` = `7594698936`
- يبعث رسالة غير كي تتبدل الإشارة (buy/sell جديدة، ثقة ≥65%) — بلا تكرار كل polling

### 4) صلحنا 6 ملفات معطوبة فـ GitHub
كانت مشكلة متكررة: نسخ من Arena.ai دايما كيخلط الأسماء/المحتوى بين الملفات.

| الملف | المشكل | الحل |
|---|---|---|
| `Config/Settings.py` | حروف كبيرة (Case-sensitive على Linux) | Rename → `config/settings.py` |
| `Binance (core)/binance_connector.py` | اسم مجلد فيه مسافة وقوس (import مستحيل) | Move → `core/binance_connector.py` |
| `AI (ai_teacher)/trading_mentor.py` | نفس المشكل | Move → `ai_teacher/trading_mentor.py` |
| `strategies/technical_indicators.py)` | قوس زايد فالاسم + محتوى معطوب (BinanceConnector مكرر) | Rename + استبدال المحتوى الصحيح |
| `strategies/bottom_top_detector.py)` | نفس المشكل بالضبط | Rename + استبدال المحتوى الصحيح |
| `core/trading_engine.py)` | قوس زايد فالاسم (لسا معلق، ماشي حرج) | ⏳ نظافة لاحقة |

### 5) إعدادات Render
- `PYTHON_VERSION = 3.11.0` (تفادي compilation errors مع pandas)
- Start Command: `gunicorn api.signal_server:app`
- `flask`, `flask-cors`, `gunicorn` مزيدين لـ `requirements.txt`
- `api/__init__.py` فارغ (باش `api/` يكون package قابل للاستيراد)

### 6) نتيجة نهائية
```
https://pro-trading-bot-pevb.onrender.com/api/health   → {"status":"ok"}
https://pro-trading-bot-pevb.onrender.com/api/signals  → إشارات حية من MEXC
```

---

## ⚠️ نقاط أمان مهمة (خاصك تتذكرهم)

1. **`core/trading_engine.py` = تداول حقيقي بفلوس حقيقية** — `execute_strategy()` كيستدعي `place_buy_order()`/`place_sell_order()` مباشرة. **ما ديرش `python main.py` بأي mode** إلا كنت واعي 100%.
2. **`--mode test` فـ `main.py` ماشي آمن** — الاسم كيخدع، كيدير صفقات حقيقية.
3. `Config/Settings.py` عندها `TESTNET = True` — خليها كيما هي لأي استعمال آخر غير `signal_server.py`.
4. bug صغير: `trading_engine.py` كيستعمل `np.log10()` بلا `import numpy as np` — خاص يتصلح قبل أي استعمال حقيقي.

---

## 📌 الخطوة الجاية
ربط `signal_server.py` بـ Sandoq عبر `useBotSignal.js` (الملف جاهز من البداية) — التداول التلقائي **وهمي 100%** (localStorage)، بلا خطر مالي، مزيان لمرحلة الاختبار.

**الملفات الجاهزة للدمج:**
- `useBotSignal.js` (React hook)
- `APP_JS_PATCH_INSTRUCTIONS.js` (تعليمات دقيقة للدمج فـ App.js)
