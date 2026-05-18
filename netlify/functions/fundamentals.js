// netlify/functions/fundamentals.js
// Fuente: Twelve Data
// Combina 3 endpoints por ticker: /statistics, /profile, /quote
// (Para 8 tickers son ~24 créditos; el plan free de 800/día cubre sobradamente.)
//
// Requiere variable de entorno: TWELVE_DATA_API_KEY

const BASE = 'https://api.twelvedata.com';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function num(x) {
  if (x == null || x === '') return null;
  const n = typeof x === 'number' ? x : parseFloat(x);
  return Number.isFinite(n) ? n : null;
}

async function fetchOne(symbol, apiKey) {
  try {
    const [stats, profile, quote] = await Promise.all([
      fetchJson(
        `${BASE}/statistics?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`
      ),
      fetchJson(
        `${BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`
      ).catch(() => ({})),
      fetchJson(
        `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`
      ).catch(() => ({})),
    ]);

    if (stats?.status === 'error') {
      return { symbol, error: stats.message || 'sin datos' };
    }

    // Twelve Data tiene una estructura "statistics.valuations_metrics" etc.
    const s = stats?.statistics || {};
    const val = s.valuations_metrics || {};
    const fin = s.financials || {};
    const inc = fin.income_statement || {};
    const opex = inc;
    const div = s.dividends_and_splits || {};
    const stock = s.stock_price_summary || {};

    return {
      symbol,
      shortName: profile?.name || symbol,
      longName: profile?.name || symbol,
      sector: profile?.sector || '—',
      industry: profile?.industry || '—',
      country: profile?.country || '—',
      website: profile?.website || '',
      marketCap: num(val.market_capitalization),
      marketCapFmt: null, // se formatea en frontend
      currentPrice: num(quote?.close) || num(quote?.previous_close),
      currency: quote?.currency || 'USD',
      // Valuación
      trailingPE: num(val.trailing_pe),
      forwardPE: num(val.forward_pe),
      priceToBook: num(val.price_to_book_mrq),
      pegRatio: num(val.peg_ratio),
      // Per share
      eps: num(inc.diluted_eps_ttm) || num(inc.eps),
      epsForward: num(fin.forward_annual_eps_estimate),
      bookValue: num(val.book_value_per_share_mrq),
      // Rentabilidad
      profitMargin: num(fin.profit_margin),
      operatingMargin: num(fin.operating_margin),
      roe: num(fin.return_on_equity_ttm),
      roa: num(fin.return_on_assets_ttm),
      // Crecimiento
      revenueGrowth: num(fin.quarterly_revenue_growth),
      earningsGrowth: num(fin.quarterly_earnings_growth_yoy),
      // Salud
      debtToEquity: num(fin.total_debt_to_equity_mrq),
      currentRatio: num(fin.current_ratio_mrq),
      // Dividendos
      dividendYield: num(div.forward_annual_dividend_yield),
      payoutRatio: num(div.payout_ratio),
      // Recomendación analistas
      recommendation: '—', // Twelve Data lo trae en /analyst_estimates (no incluido para ahorrar créditos)
      targetMean: null,
      // 52 semanas
      week52High: num(stock.fifty_two_week_high),
      week52Low: num(stock.fifty_two_week_low),
      // Beta
      beta: num(stock.beta),
    };
  } catch (err) {
    return { symbol, error: err.message };
  }
}

exports.handler = async (event) => {
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

  const results = await Promise.all(symbols.map((s) => fetchOne(s, apiKey)));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      fetchedAt: new Date().toISOString(),
      source: 'twelvedata',
      data: results,
    }),
  };
};
