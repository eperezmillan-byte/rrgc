// netlify/functions/quotes.js
// Proxy a Yahoo Finance para obtener historia diaria/semanal de varios tickers
// Resuelve el problema de CORS llamando desde el servidor

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
};

async function fetchOne(symbol, interval, range) {
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&events=history`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    return { symbol, error: `HTTP ${res.status}` };
  }
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    return { symbol, error: 'No data' };
  }
  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const closes = q.close || [];
  const highs = q.high || [];
  const lows = q.low || [];
  const opens = q.open || [];
  const volumes = q.volume || [];

  // Filtrar puntos nulos
  const series = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null) {
      series.push({
        t: timestamps[i] * 1000,
        o: opens[i],
        h: highs[i],
        l: lows[i],
        c: closes[i],
        v: volumes[i] || 0,
      });
    }
  }

  return {
    symbol,
    currency: result.meta?.currency || 'USD',
    series,
  };
}

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const symbolsRaw = (params.symbols || '').trim();
    const interval = params.interval === '1wk' ? '1wk' : '1d';
    const range = params.range || (interval === '1wk' ? '2y' : '6mo');

    if (!symbolsRaw) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'symbols param required' }),
      };
    }

    const symbols = symbolsRaw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 12); // SPY + máx 8 + margen

    // Aseguramos SPY siempre incluido (benchmark)
    if (!symbols.includes('SPY')) symbols.push('SPY');

    const results = await Promise.all(symbols.map((s) => fetchOne(s, interval, range)));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=180', // 3 min cache
      },
      body: JSON.stringify({
        interval,
        range,
        fetchedAt: new Date().toISOString(),
        data: results,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
