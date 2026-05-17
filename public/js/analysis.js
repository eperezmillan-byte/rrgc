// js/analysis.js
// Análisis técnico simple para precio objetivo + clasificación de rotación.

(function (global) {
  'use strict';

  function sma(arr, period) {
    if (arr.length < period) return NaN;
    let s = 0;
    for (let i = arr.length - period; i < arr.length; i++) s += arr[i];
    return s / period;
  }

  function atr(highs, lows, closes, period = 14) {
    if (closes.length < period + 1) return NaN;
    const trs = [];
    for (let i = closes.length - period; i < closes.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }
    return trs.reduce((a, b) => a + b, 0) / trs.length;
  }

  function rsi(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) gains += d;
      else losses += -d;
    }
    const avgG = gains / period;
    const avgL = losses / period;
    if (avgL === 0) return 100;
    const rs = avgG / avgL;
    return 100 - 100 / (1 + rs);
  }

  /**
   * Precio objetivo técnico:
   *   - Dirección por sign(Close - SMA20).
   *   - Magnitud por 3 × ATR(14) (≈ 3 ruedas de rango).
   *   - Ajuste por RSI: si > 70 (sobrecomprado) o < 30 (sobrevendido), atenúa.
   */
  function priceTarget(highs, lows, closes) {
    const n = closes.length;
    if (n < 22) return { target: closes[n - 1], pct: 0, direction: 0 };

    const close = closes[n - 1];
    const m20 = sma(closes, 20);
    const atr14 = atr(highs, lows, closes, 14);
    const r = rsi(closes, 14);

    const direction = Math.sign(close - m20) || 1;
    // Atenuación si extremo
    let mult = 3;
    if (r > 70 && direction > 0) mult = 1.5;
    if (r < 30 && direction < 0) mult = 1.5;

    const target = close + direction * atr14 * mult;
    const pct = (target / close - 1) * 100;
    return {
      target: Number(target.toFixed(2)),
      pct: Number(pct.toFixed(2)),
      direction,
      close,
      sma20: m20,
      atr14,
      rsi: r,
    };
  }

  /**
   * Clasifica la trayectoria de los puntos en una de las categorías solicitadas.
   *   - CONSERVADORA: improving → leading
   *   - AGRESIVA:     lagging → improving
   *   - SALIDA:       leading → weakening
   *   - Cualquier otra: '—'
   */
  function classifyRotation(points) {
    if (!points || points.length < 2) {
      return { start: null, end: null, category: '—', dR: 0, dM: 0 };
    }
    const first = points[0];
    const last = points[points.length - 1];
    const start = window.GacetaRRG.quadrant(first.ratio, first.mom);
    const end = window.GacetaRRG.quadrant(last.ratio, last.mom);

    let category = '—';
    if (start === 'improving' && end === 'leading') category = 'CONSERVADORA';
    else if (start === 'lagging' && end === 'improving') category = 'AGRESIVA';
    else if (start === 'leading' && end === 'weakening') category = 'SALIDA';

    return {
      start,
      end,
      category,
      dR: last.ratio - first.ratio,
      dM: last.mom - first.mom,
    };
  }

  global.GacetaAnalysis = { priceTarget, classifyRotation, sma, atr, rsi };
})(window);
