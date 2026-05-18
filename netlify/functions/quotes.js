// netlify/functions/quotes.js
// Fuente: Twelve Data (https://twelvedata.com)
// Plan gratuito: 800 créditos/día, 8 requests/minuto.
// Soporta batch hasta 120 símbolos en una sola URL → ideal para nuestro caso.
//
// Requiere variable de entorno: TWELVE_DATA_API_KEY
// Se configura en Netlify: Site settings → Environment variables → Add variable
//
// Documentación: https://twelvedata.com/docs#time-series

const BASE = 'https://api.twelvedata.com/time_series';

function intervalToTD(interval) {
  return interval === '1wk' ? '1week' : '1day';
}

function outputSizeFor(interval) {
  return interval === '1wk' ? 130 : 200; // suficiente para SMA(14) + trayecto + proyección
}

// Convierte la respuesta de Twelve Data en nuestro formato interno.
// Twelve Data devuelve datetime en orden DESC; lo invertimos a ASC.
function normalizeBlock(symbol, block) {
  if (!block || block.status === 'error') {
    return {
      symbol,
      error: block?.message || 'error desconocido',
      series: [],
    };
  }
  const values = block.values || [];
  if (values.length === 0) {
    return { symbol, error: 'sin valores', series: [] };
  }
  // De más reciente a más antiguo → invertir
  const asc = values.slice().reverse();
  const series = [];
  for (const v of asc) {
    const c = parseFloat(v.close);
    if (!Number.isFinite(c)) continue;
    const t = Date.parse(
      v.datetime.length === 10 ? `${v.datetime}T00:00:00Z` : v.datetime.replace(' ', 'T') + 'Z'
    );
    if (!Number.isFinite(t)) continue;
    series.push({
      t,
      o: parseFloat(v.open),
      h: parseFloat(v.high),
      l: parseFloat(v.low),
      c,
      v: v.volume ? parseFloat(v.volume) : 0,
    });
  }
  return {
    symbol,
    currency: block.meta?.currency || 'USD',
    series,
  };
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
            'Falta la variable de entorno TWELVE_DATA_API_KEY. Configurarla en Netlify → Site settings → Environment variables.',
        }),
      };
    }

    const params = event.queryStringParameters || {};
    const symbolsRaw = (params.symbols || '').trim();
    const interval = params.interval === '1wk' ? '1wk' : '1d';
    const tdInterval = intervalToTD(interval);
    const outputsize = outputSizeFor(interval);

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

    // Batch: separados por coma
    const url =
      `${BASE}?symbol=${encodeURIComponent(symbols.join(','))}` +
      `&interval=${tdInterval}` +
      `&outputsize=${outputsize}` +
      `&order=desc` +
      `&format=JSON` +
      `&apikey=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: `Twelve Data HTTP ${res.status}`,
          detail: text.slice(0, 400),
        }),
      };
    }

    const data = await res.json();

    // Twelve Data tiene 2 formatos de respuesta:
    //   - 1 símbolo: { meta, values, status }
    //   - N símbolos (batch): { "SPY": {...}, "GGAL": {...}, ... }
    // Normalizamos a un array.
    let results;
    if (symbols.length === 1) {
      results = [normalizeBlock(symbols[0], data)];
    } else if (data && typeof data === 'object' && !Array.isArray(data)) {
      results = symbols.map((s) => normalizeBlock(s, data[s]));
    } else {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Formato de respuesta inesperado',
          sample: JSON.stringify(data).slice(0, 400),
        }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=180', // 3 min cache CDN
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        interval,
        range: interval === '1wk' ? '2y' : '6mo',
        fetchedAt: new Date().toISOString(),
        source: 'twelvedata',
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
