// js/app.js
// Orquestador principal. Maneja inputs, modo (días/semanas), pestañas,
// cálculo, descarga PNG, compartir Web Share API.

(function () {
  'use strict';

  // ========== CONFIG ==========
  const DEFAULT_TICKERS = ['GGAL', 'BBAR', 'BMA', 'YPF', 'PAM', 'TGS', 'SUPV', 'VIST'];
  const BENCHMARK = 'SPY';
  const PERIOD = 14; // SMAs del RRG
  const TRAIL_LEN = 10; // últimas 10 ruedas/semanas
  const PROJECTION_STEPS = 3;

  // ========== ESTADO ==========
  let state = {
    mode: 'daily', // 'daily' | 'weekly'
    inputs: DEFAULT_TICKERS.slice(),
    payload: null, // último resultado de cálculo
    fundamentals: null,
    busy: false,
  };

  // ========== DOM ==========
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const grid = $('#tickerGrid');
  const btnCalc = $('#btnCalc');
  const btnDownload = $('#btnDownload');
  const btnShare = $('#btnShare');
  const stampValue = $('#stampValue');
  const stampMode = $('#stampMode');
  const placeholder = $('#chartPlaceholder');
  const loader = $('#chartLoader');
  const canvas = $('#rrgCanvas');
  const legendEl = $('#chartLegend');
  const toastEl = $('#toast');
  const rotationTbody = $('#rotationTable tbody');
  const fundTbody = $('#fundTable tbody');

  // ========== INIT ==========
  function init() {
    renderTickerInputs();
    bindControls();
    bindTabs();
    bindModeToggle();
    updateStamp();
  }

  function renderTickerInputs() {
    grid.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'ticker-input';
      inp.maxLength = 8;
      inp.placeholder = `Ticker ${i + 1}`;
      inp.value = state.inputs[i] || '';
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      inp.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
        state.inputs[i] = e.target.value;
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); calculate(); }
      });
      grid.appendChild(inp);
    }
  }

  function bindControls() {
    btnCalc.addEventListener('click', calculate);
    btnDownload.addEventListener('click', downloadPNG);
    btnShare.addEventListener('click', shareChart);
  }

  function bindModeToggle() {
    $$('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.mode-btn').forEach((b) => {
          b.classList.remove('is-active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('is-active');
        btn.setAttribute('aria-pressed', 'true');
        state.mode = btn.dataset.mode;
        updateStamp();
        // Actualizar labels que dependen del modo
        $$('[data-period-label]').forEach((el) => {
          el.textContent = state.mode === 'weekly' ? 'semanas' : 'días';
        });
      });
    });
  }

  function bindTabs() {
    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        $$('.tab').forEach((t) => {
          t.classList.toggle('is-active', t === tab);
          t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
        });
        $$('.tab-panel').forEach((p) => {
          const matches = p.id === `tab-${target}`;
          p.classList.toggle('is-active', matches);
          if (matches) p.removeAttribute('hidden');
          else p.setAttribute('hidden', '');
        });
      });
    });
  }

  // ========== CÁLCULO PRINCIPAL ==========
  async function calculate() {
    if (state.busy) return;
    const symbols = state.inputs.map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) {
      toast('Cargá al menos un ticker.');
      return;
    }

    state.busy = true;
    btnCalc.disabled = true;
    placeholder.hidden = true;
    loader.hidden = false;
    toast('Obteniendo cotizaciones...');

    try {
      const allSymbols = symbols.concat([BENCHMARK]);
      const data = await GacetaData.fetchQuotes(allSymbols, state.mode);

      const benchSeries = data.data.find((d) => d.symbol === BENCHMARK);
      if (!benchSeries || benchSeries.error) {
        throw new Error('No se pudo obtener SPY (benchmark).');
      }

      const items = [];
      for (let i = 0; i < symbols.length; i++) {
        const sym = symbols[i];
        const ds = data.data.find((d) => d.symbol === sym);
        if (!ds || ds.error || !ds.series || ds.series.length < 30) {
          items.push({ symbol: sym, color: GacetaChart.colorFor(i), error: ds?.error || 'datos insuficientes' });
          continue;
        }
        const aligned = GacetaRRG.alignByTimestamp(ds.series, benchSeries.series);
        const stockCloses = aligned.tA.map((p) => p.c);
        const benchCloses = aligned.tB.map((p) => p.c);
        const stockHighs = aligned.tA.map((p) => p.h);
        const stockLows = aligned.tA.map((p) => p.l);

        const rrg = GacetaRRG.calcRRG(stockCloses, benchCloses, PERIOD);
        const trail = GacetaRRG.lastValidPoints(rrg.rsRatio, rrg.rsMomentum, TRAIL_LEN);

        // Proyección Monte Carlo + Hurst
        const projResult = GacetaProjection.projectRRG(
          stockCloses, benchCloses, PERIOD, PROJECTION_STEPS
        );
        // Filtrar NaN en proyección (puede pasar si la serie es justa)
        const projection = projResult.points.filter(
          (p) => isFinite(p.ratio) && isFinite(p.mom)
        );

        const target = GacetaAnalysis.priceTarget(stockHighs, stockLows, stockCloses);

        items.push({
          symbol: sym,
          color: GacetaChart.colorFor(i),
          trail,
          projection,
          target,
          hurst: projResult.H_ticker,
          rrgRaw: rrg,
          stockCloses,
          benchCloses,
        });
      }

      const stampText = formatStamp(data.fetchedAt);
      const modeLabel = state.mode === 'weekly' ? '10 semanas · semanal' : '10 días · diario';
      const payload = {
        items,
        stamp: stampText,
        modeLabel,
        benchmark: BENCHMARK,
        fetchedAt: data.fetchedAt,
      };
      state.payload = payload;

      // Renderizar
      GacetaChart.drawRRG(canvas, payload);
      renderLegend(payload);
      renderRotationTable(payload);
      updateStamp(stampText);

      // Disparar fundamentales en paralelo (no bloquea el RRG)
      fetchFundamentalsAsync(symbols);

      placeholder.hidden = true;
      btnDownload.disabled = false;
      btnShare.disabled = false;
      toast(`Cálculo completado · ${items.filter((i) => !i.error).length}/${items.length} tickers`);
    } catch (err) {
      console.error(err);
      placeholder.hidden = false;
      toast(`Error: ${err.message}`);
    } finally {
      loader.hidden = true;
      btnCalc.disabled = false;
      state.busy = false;
    }
  }

  async function fetchFundamentalsAsync(symbols) {
    try {
      const data = await GacetaData.fetchFundamentals(symbols);
      state.fundamentals = data;
      renderFundamentalsTable(data);
    } catch (err) {
      console.warn('Fundamentales fallaron:', err);
      fundTbody.innerHTML = `<tr class="empty-row"><td colspan="13">No se pudieron cargar los fundamentales: ${err.message}</td></tr>`;
    }
  }

  // ========== RENDERS ==========
  function renderLegend(payload) {
    legendEl.innerHTML = '';
    payload.items.forEach((item) => {
      if (item.error) return;
      const span = document.createElement('span');
      span.className = 'legend-item';
      span.innerHTML = `
        <span class="legend-swatch" style="background:${item.color}"></span>
        ${escapeHtml(item.symbol)}
      `;
      legendEl.appendChild(span);
    });
  }

  function renderRotationTable(payload) {
    if (!payload.items.length) {
      rotationTbody.innerHTML = `<tr class="empty-row"><td colspan="6">Sin datos.</td></tr>`;
      return;
    }
    rotationTbody.innerHTML = '';
    payload.items.forEach((item) => {
      const tr = document.createElement('tr');
      if (item.error) {
        tr.innerHTML = `
          <td class="ticker-cell">${escapeHtml(item.symbol)}</td>
          <td colspan="5"><span class="rot-neutral">— ${escapeHtml(item.error)}</span></td>`;
        rotationTbody.appendChild(tr);
        return;
      }
      const allPoints = item.trail;
      const cls = GacetaAnalysis.classifyRotation(allPoints);
      tr.innerHTML = `
        <td class="ticker-cell">${escapeHtml(item.symbol)}</td>
        <td>${quadPill(cls.start)}</td>
        <td>${quadPill(cls.end)}</td>
        <td class="num ${cls.dR >= 0 ? 'pos' : 'neg'}">${signed(cls.dR, 2)}</td>
        <td class="num ${cls.dM >= 0 ? 'pos' : 'neg'}">${signed(cls.dM, 2)}</td>
        <td>${categoryChip(cls.category)}</td>
      `;
      rotationTbody.appendChild(tr);
    });
  }

  function renderFundamentalsTable(data) {
    if (!data || !data.data || !data.data.length) {
      fundTbody.innerHTML = `<tr class="empty-row"><td colspan="13">Sin datos.</td></tr>`;
      return;
    }
    fundTbody.innerHTML = '';
    data.data.forEach((d) => {
      if (d.error) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="ticker-cell">${escapeHtml(d.symbol)}</td><td colspan="12"><span class="rot-neutral">— ${escapeHtml(d.error)}</span></td>`;
        fundTbody.appendChild(tr);
        return;
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="ticker-cell">${escapeHtml(d.symbol)}</td>
        <td>${escapeHtml(d.sector || '—')}</td>
        <td class="num">${fmtCap(d.marketCap)}</td>
        <td class="num">${fmtNum(d.trailingPE)}</td>
        <td class="num">${fmtNum(d.priceToBook)}</td>
        <td class="num">${fmtNum(d.eps)}</td>
        <td class="num ${signClass(d.operatingMargin)}">${fmtPct(d.operatingMargin)}</td>
        <td class="num ${signClass(d.roe)}">${fmtPct(d.roe)}</td>
        <td class="num ${signClass(d.revenueGrowth)}">${fmtPct(d.revenueGrowth)}</td>
        <td class="num">${fmtNum(d.debtToEquity, 1)}</td>
        <td class="num">${fmtPct(d.dividendYield)}</td>
        <td class="num">${fmtPriceTarget(d)}</td>
        <td class="num">${fmt52w(d)}</td>
      `;
      fundTbody.appendChild(tr);
    });
  }

  function quadPill(quad) {
    if (!quad) return '<span class="rot-neutral">—</span>';
    const labels = {
      leading: 'Leading',
      weakening: 'Weakening',
      improving: 'Improving',
      lagging: 'Lagging',
    };
    return `<span class="quad-pill quad-${quad}">${labels[quad] || quad}</span>`;
  }

  function categoryChip(cat) {
    if (cat === 'CONSERVADORA') return '<span class="rot-chip rot-conservadora">CONSERVADORA</span>';
    if (cat === 'AGRESIVA') return '<span class="rot-chip rot-agresiva">AGRESIVA</span>';
    if (cat === 'SALIDA') return '<span class="rot-chip rot-salida">SALIDA</span>';
    return '<span class="rot-neutral">—</span>';
  }

  function signed(v, dp = 2) {
    if (!isFinite(v)) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(dp);
  }

  function signClass(v) {
    if (!isFinite(v)) return '';
    return v >= 0 ? 'pos' : 'neg';
  }

  function fmtNum(v, dp = 2) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toFixed(dp);
  }

  function fmtPct(v) {
    if (v == null || !isFinite(v)) return '—';
    return (v * 100).toFixed(1) + '%';
  }

  function fmtCap(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e12) return (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    return v.toFixed(0);
  }

  function fmtPriceTarget(d) {
    if (d.targetMean == null) return '—';
    const cur = d.currentPrice;
    const tgt = d.targetMean;
    if (!cur) return '$' + tgt.toFixed(2);
    const pct = (tgt / cur - 1) * 100;
    return `$${tgt.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
  }

  function fmt52w(d) {
    if (d.week52Low == null || d.week52High == null) return '—';
    return `${d.week52Low.toFixed(2)}–${d.week52High.toFixed(2)}`;
  }

  // ========== UTILS ==========
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function formatStamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    // Hora Argentina (UTC-3)
    const fmt = new Intl.DateTimeFormat('es-AR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Argentina/Buenos_Aires',
    });
    return fmt.format(d).replace(',', ' ·') + ' ART';
  }

  function updateStamp(text) {
    if (text) stampValue.textContent = text;
    else if (state.payload?.stamp) stampValue.textContent = state.payload.stamp;
    else stampValue.textContent = '—';
    stampMode.textContent = state.mode === 'weekly' ? '10 semanas · semanal' : '10 días · diario';
  }

  function toast(msg, ms = 2400) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  // ========== DESCARGA / COMPARTIR ==========
  function generateBlobAsync() {
    return new Promise((resolve, reject) => {
      if (!canvas.toBlob) return reject(new Error('Canvas no soporta toBlob'));
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Blob nulo'));
        resolve(blob);
      }, 'image/png', 0.95);
    });
  }

  async function downloadPNG() {
    if (!state.payload) return;
    try {
      const blob = await generateBlobAsync();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gaceta-rrg-${state.mode}-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('PNG descargado.');
    } catch (err) {
      toast(`Error al descargar: ${err.message}`);
    }
  }

  async function shareChart() {
    if (!state.payload) return;
    try {
      const blob = await generateBlobAsync();
      const file = new File([blob], `gaceta-rrg.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Gaceta RRG',
          text: `Relative Rotation Graph · ${state.payload.modeLabel}`,
          files: [file],
        });
        toast('Compartido.');
      } else {
        // Fallback: copiar al portapapeles si está disponible
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
          toast('Imagen copiada al portapapeles.');
        } else {
          // Fallback final: descargar
          downloadPNG();
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') toast(`Error al compartir: ${err.message}`);
    }
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
