// netlify/functions/scheduled-calc.js
// Función programada (cron). Configurada en netlify.toml: "0 16,22 * * 1-5"
// Esto es 13:00 y 19:00 hora Argentina (UTC-3) en días hábiles.
//
// Su tarea: pre-calentar el cache de Yahoo Finance pidiendo los tickers
// por defecto, para que cuando un usuario abra la app a las 13/19 hs
// la respuesta sea instantánea. Además registra el timestamp en blob
// para que el frontend lo muestre.

const { schedule } = require('@netlify/functions');

const DEFAULT_TICKERS = ['GGAL', 'BBAR', 'BMA', 'YPF', 'PAM', 'TGS', 'SUPV', 'VIST'];

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
};

async function warmTicker(symbol, interval, range) {
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    return { symbol, ok: res.ok, status: res.status };
  } catch (e) {
    return { symbol, ok: false, error: e.message };
  }
}

const handler = async (event) => {
  const symbols = [...DEFAULT_TICKERS, 'SPY'];

  // Calentar daily y weekly
  const dailyResults = await Promise.all(symbols.map((s) => warmTicker(s, '1d', '6mo')));
  const weeklyResults = await Promise.all(symbols.map((s) => warmTicker(s, '1wk', '2y')));

  const now = new Date();
  const stamp = now.toISOString();

  console.log(`[scheduled-calc] Ejecutado ${stamp}`);
  console.log('Daily:', dailyResults.map((r) => `${r.symbol}:${r.ok ? 'OK' : 'FAIL'}`).join(', '));
  console.log('Weekly:', weeklyResults.map((r) => `${r.symbol}:${r.ok ? 'OK' : 'FAIL'}`).join(', '));

  return {
    statusCode: 200,
    body: JSON.stringify({
      ranAt: stamp,
      symbols,
      daily: dailyResults,
      weekly: weeklyResults,
    }),
  };
};

exports.handler = schedule('0 16,22 * * 1-5', handler);
