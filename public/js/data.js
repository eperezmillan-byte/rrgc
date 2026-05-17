// js/data.js
// Capa de acceso a datos. Habla con las funciones serverless de Netlify.

(function (global) {
  'use strict';

  async function fetchQuotes(symbols, mode) {
    const interval = mode === 'weekly' ? '1wk' : '1d';
    const range = mode === 'weekly' ? '2y' : '6mo';
    const params = new URLSearchParams({
      symbols: symbols.join(','),
      interval,
      range,
    });
    const res = await fetch(`/api/quotes?${params.toString()}`);
    if (!res.ok) throw new Error(`Error al obtener cotizaciones (HTTP ${res.status})`);
    const json = await res.json();
    return json;
  }

  async function fetchFundamentals(symbols) {
    const params = new URLSearchParams({ symbols: symbols.join(',') });
    const res = await fetch(`/api/fundamentals?${params.toString()}`);
    if (!res.ok) throw new Error(`Error al obtener fundamentales (HTTP ${res.status})`);
    return await res.json();
  }

  global.GacetaData = { fetchQuotes, fetchFundamentals };
})(window);
