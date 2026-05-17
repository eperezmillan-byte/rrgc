// js/rrg.js
// Cálculo del JdK RS-Ratio y RS-Momentum (formulación TraderMark / StockCharts).
//
//   RS         = Close_ticker / Close_benchmark
//   RS_Ratio   = 100 · RS / SMA(RS, period)
//   RS_Mom     = 100 · RS_Ratio / SMA(RS_Ratio, period)
//
// Period default: 14 (estándar para gráficos diarios y semanales).

(function (global) {
  'use strict';

  function sma(arr, period, idx) {
    if (idx + 1 < period) return NaN;
    let sum = 0;
    for (let i = idx - period + 1; i <= idx; i++) sum += arr[i];
    return sum / period;
  }

  /**
   * Calcula RS-Ratio y RS-Momentum dados los precios alineados.
   * @param {number[]} stock - cierres del ticker
   * @param {number[]} bench - cierres del benchmark (SPY) alineados por índice
   * @param {number} period
   * @returns {{rsRatio:number[], rsMomentum:number[], rs:number[]}}
   */
  function calcRRG(stock, bench, period = 14) {
    const n = Math.min(stock.length, bench.length);
    const rs = new Array(n);
    for (let i = 0; i < n; i++) rs[i] = (stock[i] / bench[i]) * 100;

    const rsRatio = new Array(n).fill(NaN);
    for (let i = period - 1; i < n; i++) {
      const m = sma(rs, period, i);
      rsRatio[i] = 100 * (rs[i] / m);
    }

    const rsMomentum = new Array(n).fill(NaN);
    for (let i = 2 * period - 2; i < n; i++) {
      const m = sma(rsRatio, period, i);
      rsMomentum[i] = 100 * (rsRatio[i] / m);
    }

    return { rs, rsRatio, rsMomentum };
  }

  /**
   * Alinea dos series por timestamp. Devuelve los cierres en posiciones donde
   * ambos tienen dato.
   */
  function alignByTimestamp(seriesA, seriesB) {
    const mapB = new Map();
    for (const p of seriesB) mapB.set(p.t, p);
    const out = { tA: [], tB: [], dates: [] };
    for (const a of seriesA) {
      const b = mapB.get(a.t);
      if (b) {
        out.tA.push(a);
        out.tB.push(b);
        out.dates.push(a.t);
      }
    }
    return out;
  }

  /**
   * Devuelve los últimos N puntos no-NaN de un par (ratio, momentum).
   */
  function lastValidPoints(rsRatio, rsMomentum, n) {
    const points = [];
    for (let i = rsRatio.length - 1; i >= 0 && points.length < n; i--) {
      if (!isNaN(rsRatio[i]) && !isNaN(rsMomentum[i])) {
        points.unshift({ idx: i, ratio: rsRatio[i], mom: rsMomentum[i] });
      }
    }
    return points;
  }

  /**
   * Determina el cuadrante de un punto en el RRG.
   */
  function quadrant(ratio, mom) {
    if (ratio >= 100 && mom >= 100) return 'leading';
    if (ratio >= 100 && mom < 100) return 'weakening';
    if (ratio < 100 && mom >= 100) return 'improving';
    return 'lagging';
  }

  global.GacetaRRG = { calcRRG, alignByTimestamp, lastValidPoints, quadrant };
})(window);
