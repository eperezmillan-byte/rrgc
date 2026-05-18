// netlify/functions/quotes.js
// Fuente: Twelve Data (https://twelvedata.com)
// Plan gratuito: 800 créditos/día, 8 requests/minuto.
//
// Estrategia: requests individuales por símbolo (en paralelo).
// El batch comma-separated tiene formato de respuesta inconsistente entre planes,
// así que esta versión es más robusta. 8 ADRs + SPY = 9 créditos por cálculo.
//
// Requiere: variable de entorno TWELVE_DATA_API_KEY

const BASE = 'https://api.twelvedata.com/time_series';

function intervalToTD(interval) {
  return interval === '1wk' ? '1week' : '1day';
}

function outputSizeFor(interval) {
  return interval === '1wk' ? 130 : 200;
}

function parseValues(values) {
  // Twelve Data devuelve más reciente primero, los pasamos a ASC
  const asc = values.slice().reverse();
  const out = [];
  for (const v of asc) {
    const c = parseFloat(v.close);
    if (!Number.isFinite(c)) continue;
    const raw = v.datetime || '';
    const iso =
      raw.length === 10 ? `${raw}T00:00:00Z` : raw.replace(' ', 'T') + 'Z';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    out.push({
      t,
      o: parseFloat(v.open) || c,
      h: parseFloat(v.high) || c,
      l: parseFloat(v.low) || c,
      c,
      v: v.volume ? parseFloat(v.volume) : 0,
    });
  }
  return out;
}

async function fetchOne(symbol, tdInterval, outputsize, apiKey) {
  const url =
    `${BASE}?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${tdInterval}` +
    `&outputsize=${outputsize}` +
    `&order=desc` +
    `&format=JSON` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return { symbol, error: `HTTP ${res.status}`, series: [] };
    }
    const data = await res.json();

    // Casos de error de Twelve Data:
    // {"code": 401, "message": "...", "status": "error"}
    // {"code": 429, ...}  → rate limit
    // {"code": 400, ...}  → símbolo inválido
    if (data?.status === 'error') {
      return {
        symbol,
        error: `${data.code || ''} ${data.message || 'error desconocido'}`.trim(),
        series: [],
      };
    }

    // Caso éxito: { meta: {...}, values: [...], status: "ok" }
    const values = data?.values || [];
    if (!Array.isArray(values) || values.length === 0) {
      return { symbol, error: 'sin valores', series: [] };
    }

    return {
      symbol,
      currency: data.meta?.currency || 'USD',
      series: parseValues(values),
    };
  } catch (err) {
    return { symbol, error: `network: ${err.message}`, series: [] };
  }
}

exports.handler = async (event) => {
  try {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error:
            'Falta TWELVE_DATA_API_KEY. Configurar en Netlify → Site settings → Environment variables.',
        }),
      };
    }

    const params = event.queryStringParameters || {};
    const symbolsRaw = (params.symbols || '').trim();
    const interval = params.interval === '1wk' ? '1wk' : '1d';
    const tdInterval = intervalToTD(interval);
    const outputsize = outputSizeFor(interval);
    const debug = params.debug === '1';

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

    // Requests paralelos individuales
    const results = await Promise.all(
      symbols.map((s) => fetchOne(s, tdInterval, outputsize, apiKey))
    );

    const body = {
      interval,
      range: interval === '1wk' ? '2y' : '6mo',
      fetchedAt: new Date().toISOString(),
      source: 'twelvedata',
      data: results,
    };

    if (debug) {
      body.debug = {
        symbolsRequested: symbols,
        symbolsReturned: results.map((r) => r.symbol),
        errors: results.filter((r) => r.error).map((r) => ({ symbol: r.symbol, error: r.error })),
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=180',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(body),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
