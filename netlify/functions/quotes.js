// netlify/functions/quotes.js
// Fuente: Stooq (CSV directo, sin API key, estable desde datacenters de Netlify).
// Yahoo Finance bloquea muchos rangos IP de cloud providers; Stooq no.
//
// Endpoint: https://stooq.com/q/d/l/?s={ticker}.us&i={d|w}
// Devuelve CSV: Date,Open,High,Low,Close,Volume
// Tickers US (incluye ADRs argentinos en NYSE) usan sufijo .us

const STOOQ_BASE = 'https://stooq.com/q/d/l/';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/csv,text/plain,*/*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
};

// Mapea nuestros símbolos a la convención de Stooq.
// Por defecto agrega sufijo .us. Permite overrides explícitos si hiciera falta.
const STOOQ_OVERRIDES = {
  // ejemplo si alguno difiere: 'XYZ': 'xyz.uk'
};

function toStooqSymbol(symbol) {
  const up = symbol.trim().toUpperCase();
  if (STOOQ_OVERRIDES[up]) return STOOQ_OVERRIDES[up];
  if (up.includes('.')) return up.toLowerCase();
  return `${up.toLowerCase()}.us`;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase();
  if (!header.startsWith('date')) return []; // "No data" u otro texto
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 5) continue;
    const [date, o, h, l, c, v] = parts;
    const t = Date.parse(`${date}T00:00:00Z`);
    const cf = parseFloat(c);
    if (!Number.isFinite(t) || !Number.isFinite(cf)) continue;
    out.push({
      t,
      o: parseFloat(o),
      h: parseFloat(h),
      l: parseFloat(l),
      c: cf,
      v: v ? parseFloat(v) : 0,
    });
  }
  return out;
}

async function fetchOne(symbol, interval) {
  const stooqSym = toStooqSymbol(symbol);
  const i = interval === '1wk' ? 'w' : 'd';
  const url = `${STOOQ_BASE}?s=${encodeURIComponent(stooqSym)}&i=${i}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      return { symbol, error: `HTTP ${res.status}`, series: [] };
    }
    const text = await res.text();
    const series = parseCSV(text);
    if (series.length === 0) {
      return { symbol, error: 'No data', series: [] };
    }
    return {
      symbol,
      currency: 'USD',
      series,
    };
  } catch (err) {
    return { symbol, error: err.message, series: [] };
  }
}

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const symbolsRaw = (params.symbols || '').trim();
    const interval = params.interval === '1wk' ? '1wk' : '1d';
    const maxPoints = interval === '1wk' ? 130 : 200;

    if (!symbolsRaw) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'symbols param required' }),
      };
    }

    let symbols = symbolsRaw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (!symbols.includes('SPY')) symbols.push('SPY');
    symbols = Array.from(new Set(symbols)).slice(0, 12);

    const results = await Promise.all(symbols.map((s) => fetchOne(s, interval)));

    for (const r of results) {
      if (r.series && r.series.length > maxPoints) {
        r.series = r.series.slice(-maxPoints);
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=180',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        interval,
        range: interval === '1wk' ? '2y' : '6mo',
        fetchedAt: new Date().toISOString(),
        source: 'stooq',
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
