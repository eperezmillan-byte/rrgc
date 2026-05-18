// js/chart.js
// Renderer del Relative Rotation Graph sobre canvas.
//
// Estética: editorial Gaceta. Cuadrantes con tintes muy suaves, ejes finos,
// etiquetas en mono, trails con fade. La proyección de 3 ruedas se dibuja
// con línea punteada y marcadores huecos (en blanco) saliendo de la punta.

(function (global) {
  'use strict';

  // Paleta de colores para tickers (dark-mode: luminosos sobre fondo oscuro)
  const PALETTE = [
    '#e8e0c8', // crema (reemplaza navy)
    '#d47366', // terracota
    '#d4b56f', // gold
    '#6fb472', // sage
    '#b08fc7', // plum
    '#5fa8ab', // teal
    '#d47a7a', // brick
    '#9bc26a', // olive
  ];

  const COLORS = {
    paperWarm: '#1c2230',
    paper: '#14181f',
    paperDeep: '#0d1117',
    ink: '#e8e0c8',
    inkSoft: '#c2bba5',
    inkMuted: '#8a8474',
    gold: '#d4b56f',
    rule: '#2e3645',
    ruleSoft: '#232a37',
    qLeading: 'rgba(111, 180, 114, 0.08)',
    qWeakening: 'rgba(212, 168, 95, 0.08)',
    qLagging: 'rgba(212, 115, 102, 0.08)',
    qImproving: 'rgba(122, 158, 194, 0.08)',
    spy: '#d4b56f',
  };

  function colorFor(idx) {
    return PALETTE[idx % PALETTE.length];
  }

  /**
   * Renderiza el RRG dado el payload.
   * payload = {
   *   items: [{ symbol, color, trail:[{ratio,mom}], projection:[{ratio,mom}], target:{target,pct,direction} }],
   *   stamp: '2025-05-17 13:00 ART',
   *   modeLabel: '10 días · diario',
   *   benchmark: 'SPY'
   * }
   */
  function drawRRG(canvas, payload) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 1200;
    const cssH = canvas.clientHeight || 780;

    // Set canvas resolution
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Fondo
    ctx.fillStyle = COLORS.paperWarm;
    ctx.fillRect(0, 0, cssW, cssH);

    // Padding
    const PAD = { top: 38, right: 48, bottom: 72, left: 68 };
    const plotX = PAD.left;
    const plotY = PAD.top;
    const plotW = cssW - PAD.left - PAD.right;
    const plotH = cssH - PAD.top - PAD.bottom;

    // Determinar rangos
    const allR = [], allM = [];
    for (const it of payload.items) {
      if (it.error || !it.trail) continue;
      for (const p of it.trail) {
        if (!isFinite(p.ratio) || !isFinite(p.mom)) continue;
        allR.push(p.ratio); allM.push(p.mom);
      }
      for (const p of it.projection) {
        if (!isFinite(p.ratio) || !isFinite(p.mom)) continue;
        allR.push(p.ratio); allM.push(p.mom);
      }
    }
    let xRange = 4, yRange = 4;
    if (allR.length) {
      const xMin = Math.min(...allR), xMax = Math.max(...allR);
      xRange = Math.max(Math.abs(xMin - 100), Math.abs(xMax - 100)) * 1.18 + 0.6;
    }
    if (allM.length) {
      const yMin = Math.min(...allM), yMax = Math.max(...allM);
      yRange = Math.max(Math.abs(yMin - 100), Math.abs(yMax - 100)) * 1.18 + 0.6;
    }
    // mínimo razonable para que el RRG no se vea aplastado
    xRange = Math.max(xRange, 2.5);
    yRange = Math.max(yRange, 2.5);

    const xLo = 100 - xRange, xHi = 100 + xRange;
    const yLo = 100 - yRange, yHi = 100 + yRange;

    const toX = (r) => plotX + ((r - xLo) / (xHi - xLo)) * plotW;
    const toY = (m) => plotY + plotH - ((m - yLo) / (yHi - yLo)) * plotH;
    const cx = toX(100), cy = toY(100);

    // Fondos de cuadrante
    ctx.fillStyle = COLORS.qLeading;
    ctx.fillRect(cx, plotY, plotX + plotW - cx, cy - plotY); // top-right
    ctx.fillStyle = COLORS.qWeakening;
    ctx.fillRect(cx, cy, plotX + plotW - cx, plotY + plotH - cy); // bottom-right
    ctx.fillStyle = COLORS.qImproving;
    ctx.fillRect(plotX, plotY, cx - plotX, cy - plotY); // top-left
    ctx.fillStyle = COLORS.qLagging;
    ctx.fillRect(plotX, cy, cx - plotX, plotY + plotH - cy); // bottom-left

    // Borde del plot
    ctx.strokeStyle = COLORS.ruleSoft;
    ctx.lineWidth = 1;
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    // Grilla menor: lineas cada ~0.5 unidad si rango pequeño, 1 si grande
    drawGridlines(ctx, plotX, plotY, plotW, plotH, xLo, xHi, yLo, yHi, toX, toY);

    // Crosshair en (100, 100) - el "centro SPY"
    ctx.strokeStyle = 'rgba(26, 31, 46, 0.42)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, plotY); ctx.lineTo(cx, plotY + plotH);
    ctx.moveTo(plotX, cy); ctx.lineTo(plotX + plotW, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Etiquetas de cuadrante
    drawQuadrantLabels(ctx, plotX, plotY, plotW, plotH, cx, cy);

    // Marcador SPY en el centro
    drawSpyMarker(ctx, cx, cy, payload.benchmark || 'SPY');

    // Ejes (labels numéricos)
    drawAxisLabels(ctx, plotX, plotY, plotW, plotH, xLo, xHi, yLo, yHi, toX, toY);

    // Ahora cada ticker: trail + último punto + proyección + label
    // (recolectamos posiciones de labels para evitar solapes brutos)
    const labelBoxes = [];

    payload.items.forEach((item, idx) => {
      if (item.error || !item.trail) return;
      const color = item.color || colorFor(idx);
      drawTickerTrail(ctx, item, color, toX, toY);
    });

    // Etiquetas se dibujan al final para que queden arriba
    payload.items.forEach((item, idx) => {
      if (item.error || !item.trail) return;
      const color = item.color || colorFor(idx);
      const last = item.trail[item.trail.length - 1];
      if (!last) return;
      const lx = toX(last.ratio), ly = toY(last.mom);
      const quad = quadrantOf(last.ratio, last.mom);
      drawTickerLabel(ctx, item, color, lx, ly, quad, plotX, plotY, plotW, plotH, labelBoxes);
    });

    // Header: título y benchmark
    drawHeader(ctx, cssW, PAD, payload);

    // Footer: timestamp + leyenda de proyección
    drawFooter(ctx, cssW, cssH, PAD, payload);
  }

  // ============================================================
  // Helpers
  // ============================================================

  function quadrantOf(r, m) {
    if (r >= 100 && m >= 100) return 'leading';
    if (r >= 100 && m < 100) return 'weakening';
    if (r < 100 && m >= 100) return 'improving';
    return 'lagging';
  }

  function drawGridlines(ctx, x, y, w, h, xLo, xHi, yLo, yHi, toX, toY) {
    ctx.strokeStyle = COLORS.ruleSoft;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    // Determinar step
    const stepX = niceStep(xHi - xLo);
    const stepY = niceStep(yHi - yLo);
    const sx = Math.ceil(xLo / stepX) * stepX;
    for (let v = sx; v <= xHi; v += stepX) {
      if (Math.abs(v - 100) < 1e-6) continue;
      const px = toX(v);
      ctx.moveTo(px, y); ctx.lineTo(px, y + h);
    }
    const sy = Math.ceil(yLo / stepY) * stepY;
    for (let v = sy; v <= yHi; v += stepY) {
      if (Math.abs(v - 100) < 1e-6) continue;
      const py = toY(v);
      ctx.moveTo(x, py); ctx.lineTo(x + w, py);
    }
    ctx.stroke();
  }

  function niceStep(range) {
    if (range <= 2) return 0.25;
    if (range <= 5) return 0.5;
    if (range <= 12) return 1;
    if (range <= 25) return 2;
    return 5;
  }

  function drawQuadrantLabels(ctx, x, y, w, h, cx, cy) {
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(26, 31, 46, 0.55)';
    // top-right: Leading
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('LEADING', x + w - 8, y + 8);
    // top-left: Improving
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('IMPROVING', x + 8, y + 8);
    // bottom-right: Weakening
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('WEAKENING', x + w - 8, y + h - 8);
    // bottom-left: Lagging
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('LAGGING', x + 8, y + h - 8);
  }

  function drawSpyMarker(ctx, cx, cy, label) {
    // Anillo + punto en centro
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.paperWarm;
    ctx.fill();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.ink;
    ctx.fill();

    // Label centro
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx + 11, cy);
    ctx.font = '500 9px "Inter", sans-serif';
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText('benchmark · 100,100', cx + 11, cy + 11);
  }

  function drawAxisLabels(ctx, x, y, w, h, xLo, xHi, yLo, yHi, toX, toY) {
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.inkMuted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const stepX = niceStep(xHi - xLo);
    const sx = Math.ceil(xLo / stepX) * stepX;
    for (let v = sx; v <= xHi; v += stepX) {
      if (Math.abs(v - xLo) < stepX * 0.1 || Math.abs(v - xHi) < stepX * 0.1) continue;
      ctx.fillText(fmtTick(v), toX(v), y + h + 4);
    }
    // 100 destacado
    ctx.fillStyle = COLORS.ink;
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.fillText('100', toX(100), y + h + 4);

    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.inkMuted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const stepY = niceStep(yHi - yLo);
    const sy = Math.ceil(yLo / stepY) * stepY;
    for (let v = sy; v <= yHi; v += stepY) {
      if (Math.abs(v - yLo) < stepY * 0.1 || Math.abs(v - yHi) < stepY * 0.1) continue;
      ctx.fillText(fmtTick(v), x - 6, toY(v));
    }
    ctx.fillStyle = COLORS.ink;
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.fillText('100', x - 6, toY(100));

    // Títulos de ejes
    ctx.font = 'italic 500 11px "Cormorant Garamond", serif';
    ctx.fillStyle = COLORS.inkSoft;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('JdK RS-Ratio →', x + w, y + h + 22);

    ctx.save();
    ctx.translate(x - 38, y + 4);
    ctx.rotate(0); // no rotamos, lo ponemos arriba del eje
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('↑ JdK RS-Momentum', 0, 0);
    ctx.restore();
  }

  function fmtTick(v) {
    if (Math.abs(v) >= 100) return v.toFixed(0);
    return v.toFixed(1);
  }

  function drawTickerTrail(ctx, item, color, toX, toY) {
    const trail = item.trail || [];
    if (trail.length < 1) return;

    // Línea del trail (con fade hacia el inicio usando gradiente segmentado)
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      const opacity = 0.25 + 0.7 * (i / (trail.length - 1));
      ctx.strokeStyle = withAlpha(color, opacity);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(toX(a.ratio), toY(a.mom));
      ctx.lineTo(toX(b.ratio), toY(b.mom));
      ctx.stroke();
    }

    // Puntos del trail
    for (let i = 0; i < trail.length - 1; i++) {
      const p = trail[i];
      const opacity = 0.25 + 0.7 * (i / Math.max(trail.length - 1, 1));
      ctx.fillStyle = withAlpha(color, opacity);
      ctx.beginPath();
      ctx.arc(toX(p.ratio), toY(p.mom), 2.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Último punto (real, más grande con borde)
    const last = trail[trail.length - 1];
    const lx = toX(last.ratio), ly = toY(last.mom);
    ctx.beginPath();
    ctx.arc(lx, ly, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = COLORS.paperWarm;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Proyección: línea punteada + marcadores huecos
    const proj = item.projection || [];
    if (proj.length) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = withAlpha(color, 0.85);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      for (const p of proj) ctx.lineTo(toX(p.ratio), toY(p.mom));
      ctx.stroke();
      ctx.setLineDash([]);

      for (const p of proj) {
        const px = toX(p.ratio), py = toY(p.mom);
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.paperWarm; // hueco / "en blanco"
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
  }

  function drawTickerLabel(ctx, item, color, lx, ly, quad, x, y, w, h, boxes) {
    const sym = item.symbol;
    const tgt = item.target;
    const tgtLine = tgt && isFinite(tgt.target)
      ? `$${tgt.target.toFixed(2)}  ${tgt.pct >= 0 ? '+' : ''}${tgt.pct.toFixed(2)}%`
      : '';

    ctx.font = '700 11px "JetBrains Mono", monospace';
    const wSym = ctx.measureText(sym).width;
    ctx.font = '500 10px "JetBrains Mono", monospace';
    const wTgt = ctx.measureText(tgtLine).width;
    const boxW = Math.max(wSym, wTgt) + 14;
    const boxH = tgtLine ? 32 : 18;

    // Offset según cuadrante (alejar de centro)
    let dx = 12, dy = -14;
    if (quad === 'leading') { dx = 12; dy = -boxH - 4; }
    else if (quad === 'weakening') { dx = 12; dy = 10; }
    else if (quad === 'improving') { dx = -boxW - 12; dy = -boxH - 4; }
    else if (quad === 'lagging') { dx = -boxW - 12; dy = 10; }

    let bx = lx + dx, by = ly + dy;
    // Clamp dentro del plot
    bx = Math.max(x + 2, Math.min(bx, x + w - boxW - 2));
    by = Math.max(y + 2, Math.min(by, y + h - boxH - 2));

    // Anti-colisión: si pisa otra caja existente, desplazar verticalmente
    let attempts = 0;
    while (attempts < 5 && collides({ x: bx, y: by, w: boxW, h: boxH }, boxes)) {
      by += boxH + 4;
      if (by + boxH > y + h) { by = y + 2; bx += boxW + 4; }
      attempts++;
    }
    boxes.push({ x: bx, y: by, w: boxW, h: boxH });

    // Connector tenue al punto
    ctx.strokeStyle = withAlpha(color, 0.4);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    const anchorX = bx + (lx > bx + boxW / 2 ? boxW : 0);
    const anchorY = by + boxH / 2;
    ctx.lineTo(anchorX, anchorY);
    ctx.stroke();

    // Caja
    ctx.fillStyle = withAlpha(COLORS.paperWarm, 0.95);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    roundedRect(ctx, bx, by, boxW, boxH, 3);
    ctx.fill();
    ctx.stroke();

    // Símbolo
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(sym, bx + 7, by + 4);

    if (tgtLine) {
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.fillStyle = tgt.pct >= 0 ? '#4a7c4e' : '#a8503c';
      ctx.fillText(tgtLine, bx + 7, by + 18);
    }
  }

  function collides(a, list) {
    for (const b of list) {
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) return true;
    }
    return false;
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function withAlpha(hex, a) {
    // hex #rrggbb → rgba
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  function drawHeader(ctx, cssW, PAD, payload) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '600 14px "Cormorant Garamond", serif';
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(`Rotación relativa vs ${payload.benchmark || 'SPY'}`, PAD.left, 12);
    ctx.font = 'italic 500 11px "Cormorant Garamond", serif';
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText(`${payload.modeLabel || ''}`, PAD.left, 32);
  }

  function drawFooter(ctx, cssW, cssH, PAD, payload) {
    // Leyenda proyección (izquierda inferior)
    const fy = cssH - 18;
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.inkMuted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const legend = '— — —  proyección 3 ruedas (Monte Carlo + Hurst)';
    ctx.fillText(legend, PAD.left, fy);

    // Timestamp + mode (derecha inferior, discreto)
    if (payload.stamp) {
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.inkMuted;
      ctx.fillText(payload.stamp, cssW - PAD.right, fy);
    }
  }

  global.GacetaChart = { drawRRG, PALETTE, colorFor };
})(window);
