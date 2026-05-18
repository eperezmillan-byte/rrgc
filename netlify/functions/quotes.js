// netlify/functions/quotes.js
// Yahoo Finance con flujo cookie + crumb (requerido desde 2023).
//
// Stooq cambió en 2024 y ahora exige apikey con captcha para downloads
// programáticos, así que volvemos a Yahoo pero haciendo el handshake correcto:
//
//   1) GET https://fc.yahoo.com  → guardamos la cookie A1/A3 del Set-Cookie
//   2) GET https://query2.finance.yahoo.com/v1/test/getcrumb (con esa cookie)
//      → recibimos el crumb (string corto tipo "AbCdEf12.gH")
//   3) GET https://query1.finance.yahoo.com/v8/finance/chart/SPY
//      ?interval=1d&range=6mo&crumb=<crumb>  (con la misma cookie)
//
// La cookie+crumb se cachean en memoria del proceso. Mientras Netlify mantenga
// "caliente" la instancia, se reusan. En cold start se hace de nuevo.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const COMMON_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Estado en memoria (se mantiene mientras Netlify reusa la instancia)
let authState = { cookie: null, crumb: null, expires: 0 };

async function getYahooAuth() {
  if (authState.crumb && Date.now() < authState.expires) {
    return authState;
  }

  // Paso 1: obtener cookie
  const sessionRes = await fetch('https://fc.yahoo.com/', {
    headers: COMMON_HEADERS,
    redirect: 'manual',
  });
  // Set-Cookie viene como header. En Node fetch puede venir como string múltiple.
  const setCookieRaw =
    sessionRes.headers.get('set-cookie') ||
    sessionRes.headers.get('Set-Cookie') ||
    '';
  if (!setCookieRaw) {
    throw new Error('fc.yahoo.com no devolvió Set-Cookie');
  }
  // Extraer A1=... o A3=...
  const cookieMatch = setCookieRaw.match(/\b(A[13]=[^;,\s]+)/);
  if (!cookieMatch) {
    throw new Error('Cookie A1/A3 no encontrada en Set-Cookie');
  }
  const cookie = cookieMatch[1];

  // Paso 2: obtener crumb
  const crumbRes = await fetch(
    'https://query2.finance.yahoo.com/v1/test/getcrumb',
    {
      headers: {
        'User-Agent': UA,
        Accept: 'text/plain,*/*',
        Cookie: cookie,
      },
    }
  );
  if (!crumbRes.ok) {
    throw new Error(`getcrumb HTTP ${crumbRes.status}`);
  }
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 64 || crumb.includes('<')) {
    throw new Error(`Crumb inválido: "${crumb.slice(0, 80)}"`);
  }

  authState = {
    cookie,
    crumb,
    expires: Date.now() + 25 * 60 * 1000, // 25 min
  };
  return authState;
}

async function fetchOne(symbol, interval, range) {
  let auth;
  try {
    auth = await getYahooAuth();
  } catch (err) {
    return { symbol, error: `auth: ${err.message}`, series: [] };
  }
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}&events=history` +
    `&crumb=${encodeURIComponent(auth.crumb)}`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: auth.cookie,
      },
    });
  } catch (err) {
    return { symbol, error: `network: ${err.message}`, series: [] };
  }

  if (!res.ok) {
    // Si nos rechaza por crumb expirado/inválido, invalidamos cache
    if (res.status === 401 || res.status === 403) {
      authState.expires = 0;
    }
    return { symbol, error: `HTTP ${res.status}`, series: [] };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { symbol, error: `parse: ${err.message}`, series: [] };
  }

  if (data?.chart?.error) {
    return {
      symbol,
      error: `yahoo: ${data.chart.error.code || data.chart.error.description || 'unknown'}`,
      series: [],
    };
  }

  const result = data?.chart?.result?.[0];
  if (!result) {
    return { symbol, error: 'sin resultado', series: [] };
  }

  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const closes = q.close || [];
  const highs = q.high || [];
  const lows = q.low || [];
  const opens = q.open || [];
  const volumes = q.volume || [];

  const series = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null && Number.isFinite(closes[i])) {
      series.push({
        t: timestamps[i] * 1000,
        o: opens[i] ?? closes[i],
        h: highs[i] ?? closes[i],
        l: lows[i] ?? closes[i],
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

    let symbols = symbolsRaw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (!symbols.includes('SPY')) symbols.push('SPY');
    symbols = Array.from(new Set(symbols)).slice(0, 12);

    const results = await Promise.all(
      symbols.map((s) => fetchOne(s, interval, range))
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=180',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        interval,
        range,
        fetchedAt: new Date().toISOString(),
        source: 'yahoo',
        data: results,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message, stack: err.stack }),
    };
  }
};
