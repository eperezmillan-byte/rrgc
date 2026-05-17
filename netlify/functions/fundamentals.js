// netlify/functions/fundamentals.js
// Obtiene métricas fundamentales de Yahoo para los tickers solicitados

const QS_BASE = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
};

const MODULES = [
  'price',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'assetProfile',
].join(',');

function r(field) {
  if (field == null) return null;
  if (typeof field === 'number') return field;
  if (typeof field === 'object' && 'raw' in field) return field.raw;
  return null;
}

function fmt(field) {
  if (field == null) return '—';
  if (typeof field === 'object' && 'fmt' in field) return field.fmt;
  return String(field);
}

async function fetchOne(symbol) {
  const url = `${QS_BASE}/${encodeURIComponent(symbol)}?modules=${MODULES}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return { symbol, error: `HTTP ${res.status}` };
    const data = await res.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return { symbol, error: 'No data' };

    const price = result.price || {};
    const summary = result.summaryDetail || {};
    const stats = result.defaultKeyStatistics || {};
    const finance = result.financialData || {};
    const profile = result.assetProfile || {};

    return {
      symbol,
      shortName: price.shortName || price.longName || symbol,
      longName: price.longName || price.shortName || symbol,
      sector: profile.sector || '—',
      industry: profile.industry || '—',
      country: profile.country || '—',
      website: profile.website || '',
      marketCap: r(price.marketCap),
      marketCapFmt: fmt(price.marketCap),
      currentPrice: r(finance.currentPrice) || r(price.regularMarketPrice),
      currency: price.currency || 'USD',
      // Valuación
      trailingPE: r(summary.trailingPE),
      forwardPE: r(summary.forwardPE),
      priceToBook: r(stats.priceToBook),
      pegRatio: r(stats.pegRatio),
      // Per share
      eps: r(stats.trailingEps),
      epsForward: r(stats.forwardEps),
      bookValue: r(stats.bookValue),
      // Rentabilidad
      profitMargin: r(finance.profitMargins),
      operatingMargin: r(finance.operatingMargins),
      roe: r(finance.returnOnEquity),
      roa: r(finance.returnOnAssets),
      // Crecimiento
      revenueGrowth: r(finance.revenueGrowth),
      earningsGrowth: r(finance.earningsGrowth),
      // Salud
      debtToEquity: r(finance.debtToEquity),
      currentRatio: r(finance.currentRatio),
      // Dividendos
      dividendYield: r(summary.dividendYield),
      payoutRatio: r(summary.payoutRatio),
      // Recomendación analistas
      recommendation: finance.recommendationKey || '—',
      targetMean: r(finance.targetMeanPrice),
      // 52 semanas
      week52High: r(summary.fiftyTwoWeekHigh),
      week52Low: r(summary.fiftyTwoWeekLow),
      // Beta
      beta: r(stats.beta) || r(summary.beta),
    };
  } catch (err) {
    return { symbol, error: err.message };
  }
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const symbolsRaw = (params.symbols || '').trim();
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
    .slice(0, 8);

  const results = await Promise.all(symbols.map(fetchOne));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
    body: JSON.stringify({ fetchedAt: new Date().toISOString(), data: results }),
  };
};
