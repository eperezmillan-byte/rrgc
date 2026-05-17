// js/projection.js
// Proyección Monte Carlo modulada por el exponente de Hurst (R/S analysis).
//
// 1. Calculamos H mediante Rescaled Range sobre log-retornos.
// 2. Simulamos N rutas de log-retornos futuros con incrementos
//    z * sigma * (dt^H), donde z ~ N(0,1) y dt = 1 rueda.
//    Esto es una aproximación discreta del fractional Brownian motion.
// 3. Promediamos las trayectorias para obtener un path central proyectado.
// 4. Devolvemos esos 3 precios proyectados (mean path).
//
// Hurst H > 0.5 → series persistente (trending)
// Hurst H < 0.5 → series anti-persistente (mean reverting)
// Hurst H = 0.5 → random walk geométrico clásico (GBM).

(function (global) {
  'use strict';

  // Box–Muller para normal estándar
  function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Calcula el exponente de Hurst por R/S analysis.
   */
  function hurstExponent(prices) {
    if (prices.length < 30) return 0.5;
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
    const N = returns.length;
    // Tamaños de chunk: 10, 20, 40, 80 (acotados por longitud)
    const sizes = [10, 20, 40, 80].filter((s) => s * 2 <= N);
    if (sizes.length < 2) return 0.5;

    const logN = [];
    const logRS = [];
    for (const sz of sizes) {
      const rsVals = [];
      const numChunks = Math.floor(N / sz);
      for (let c = 0; c < numChunks; c++) {
        const chunk = returns.slice(c * sz, (c + 1) * sz);
        const mean = chunk.reduce((a, b) => a + b, 0) / sz;
        let cum = 0, mx = -Infinity, mn = Infinity;
        for (const x of chunk) {
          cum += x - mean;
          if (cum > mx) mx = cum;
          if (cum < mn) mn = cum;
        }
        const range = mx - mn;
        let varSum = 0;
        for (const x of chunk) varSum += (x - mean) ** 2;
        const std = Math.sqrt(varSum / sz);
        if (std > 1e-12 && range > 0) rsVals.push(range / std);
      }
      if (rsVals.length) {
        const avg = rsVals.reduce((a, b) => a + b, 0) / rsVals.length;
        logN.push(Math.log(sz));
        logRS.push(Math.log(avg));
      }
    }
    if (logN.length < 2) return 0.5;
    // Regresión lineal: pendiente = H
    const mN = logN.reduce((a, b) => a + b, 0) / logN.length;
    const mRS = logRS.reduce((a, b) => a + b, 0) / logRS.length;
    let num = 0, den = 0;
    for (let i = 0; i < logN.length; i++) {
      num += (logN[i] - mN) * (logRS[i] - mRS);
      den += (logN[i] - mN) ** 2;
    }
    if (den === 0) return 0.5;
    const H = num / den;
    return Math.max(0.1, Math.min(0.9, H));
  }

  /**
   * Devuelve μ y σ de log-retornos.
   */
  function returnStats(prices, lookback = 60) {
    const slice = prices.slice(-Math.min(lookback, prices.length));
    const returns = [];
    for (let i = 1; i < slice.length; i++) {
      returns.push(Math.log(slice[i] / slice[i - 1]));
    }
    if (!returns.length) return { mu: 0, sigma: 0 };
    const mu = returns.reduce((a, b) => a + b, 0) / returns.length;
    let varSum = 0;
    for (const r of returns) varSum += (r - mu) ** 2;
    const sigma = Math.sqrt(varSum / Math.max(returns.length - 1, 1));
    return { mu, sigma };
  }

  /**
   * Simulación Monte Carlo de N rutas, H ruedas adelante, devuelve precios promedio.
   */
  function projectPath(lastPrice, mu, sigma, H, steps = 3, nSims = 500) {
    // Para fBm discreto: scaling sigma * dt^H, con dt = 1
    // simple approx: increment = mu + sigma * z * (k^H - (k-1)^H) at step k? — no,
    // usamos increments iid escalados por H: increment_k = mu + sigma * z * (1)^H
    // Para captar persistencia/anti-persistencia ajustamos sigma efectiva
    // como sigma_eff = sigma * step^(H - 0.5) sobre el horizonte acumulado.
    //
    // Aquí: path_k = path_{k-1} * exp(mu + sigma_eff_k * z_k)
    // donde sigma_eff_k = sigma * (k^(2H) - (k-1)^(2H))^0.5 / 1 [stationary fBm-like increments]
    const avg = new Array(steps).fill(0);
    for (let s = 0; s < nSims; s++) {
      let p = lastPrice;
      for (let k = 1; k <= steps; k++) {
        const sigmaK = sigma * Math.sqrt(Math.pow(k, 2 * H) - Math.pow(k - 1, 2 * H));
        const incr = mu + sigmaK * randn();
        p = p * Math.exp(incr);
        avg[k - 1] += p;
      }
    }
    for (let k = 0; k < steps; k++) avg[k] /= nSims;
    return avg;
  }

  /**
   * Proyecta precios futuros para ticker y benchmark, y compone los RS-Ratio y
   * RS-Momentum futuros usando la misma fórmula del RRG.
   *
   * @param {number[]} stockCloses - cierres históricos del ticker
   * @param {number[]} benchCloses - cierres históricos del benchmark, alineados
   * @param {number} period - periodo para SMAs (14 por default)
   * @param {number} steps - ruedas a proyectar (3 por default)
   * @returns {{points:Array<{ratio:number,mom:number}>, H_ticker:number, H_bench:number, target:number[]}}
   */
  function projectRRG(stockCloses, benchCloses, period = 14, steps = 3) {
    const H_ticker = hurstExponent(stockCloses);
    const H_bench = hurstExponent(benchCloses);
    const tStats = returnStats(stockCloses);
    const bStats = returnStats(benchCloses);

    const tProj = projectPath(stockCloses[stockCloses.length - 1], tStats.mu, tStats.sigma, H_ticker, steps);
    const bProj = projectPath(benchCloses[benchCloses.length - 1], bStats.mu, bStats.sigma, H_bench, steps);

    // Construir cierres extendidos
    const stockExt = stockCloses.concat(tProj);
    const benchExt = benchCloses.concat(bProj);
    const rrg = window.GacetaRRG.calcRRG(stockExt, benchExt, period);

    const out = [];
    for (let k = 1; k <= steps; k++) {
      const idx = stockExt.length - steps + k - 1;
      out.push({ ratio: rrg.rsRatio[idx], mom: rrg.rsMomentum[idx] });
    }

    return {
      points: out,
      H_ticker,
      H_bench,
      target: tProj,
    };
  }

  global.GacetaProjection = { hurstExponent, returnStats, projectPath, projectRRG };
})(window);
