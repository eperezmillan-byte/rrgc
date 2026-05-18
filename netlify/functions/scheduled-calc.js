// netlify/functions/scheduled-calc.js
// Función programada (cron). Configurada en netlify.toml: "0 16,22 * * 1-5"
// 13:00 y 19:00 hora Argentina (UTC-3) en días hábiles.
//
// Sólo pre-calienta SPY para que el benchmark esté listo inmediatamente.
// Los tickers de cartera ya no se cachean acá: ahora el usuario los ingresa
// manualmente en la app (campos vacíos por defecto).

const { schedule } = require('@netlify/functions');

const BASE = 'https://api.twelvedata.com/time_series';

async function warmSymbol(symbol, interval, apiKey) {
  const url =
    `${BASE}?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${interval}` +
    `&outputsize=${interval === '1week' ? 130 : 200}` +
    `&order=desc&format=JSON` +
    `&apikey=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    return { symbol, interval, ok: res.ok, status: res.status };
  } catch (e) {
    return { symbol, interval, ok: false, error: e.message };
  }
}

const handler = async () => {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const stamp = new Date().toISOString();

  if (!apiKey) {
    console.warn('[scheduled-calc] TWELVE_DATA_API_KEY no configurada');
    return { statusCode: 200, body: JSON.stringify({ ranAt: stamp, skipped: true }) };
  }

  // Sólo SPY (benchmark) en daily + weekly. 2 créditos por ejecución.
  const results = await Promise.all([
    warmSymbol('SPY', '1day', apiKey),
    warmSymbol('SPY', '1week', apiKey),
  ]);

  console.log(`[scheduled-calc] ranAt=${stamp}`,
    results.map((r) => `${r.symbol}/${r.interval}:${r.ok ? 'OK' : 'FAIL'}`).join(', ')
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ ranAt: stamp, results }),
  };
};

exports.handler = schedule('0 16,22 * * 1-5', handler);
