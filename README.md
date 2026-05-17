# Gaceta+ · Relative Rotation Graph

Aplicación web para [La Gaceta Mercantil](https://lagacetamercantil.com) que renderiza un **Relative Rotation Graph (RRG)** sobre los ADR argentinos más operados, con proyección probabilística a 3 ruedas, análisis técnico de precio objetivo, clasificación de rotación y fundamentales — desplegable en Netlify.

---

## Características

| # | Funcionalidad | Implementación |
|---|---|---|
| 1 | 8 tickers + 10 días de historial | Inputs auto-uppercase, longitud de trayecto = 10 |
| 2 | Etiqueta con ticker + precio objetivo técnico | SMA20 + ATR(14)×3, atenuado por RSI |
| 3 | Proyección de 3 ruedas en blanco | Monte Carlo (500 paths) + exponente de Hurst (R/S) |
| 4 | Compartir / descargar imagen | `navigator.share` con fallback a clipboard y descarga PNG |
| 5 | Centro del gráfico = SPY | Benchmark fijo en (100, 100) |
| 6 | Auto-ejecución 13hs y 19hs ART | Netlify Scheduled Function (cron `0 16,22 * * 1-5`) |
| 7 | Botón "CALCULAR AHORA" | Trigger manual del pipeline completo |
| 8 | Modo 10 semanas | Toggle daily/weekly que cambia `interval=1wk` en Yahoo |
| 9 | Tabla de rotación (CONSERVADORA / AGRESIVA / SALIDA) | Comparación de cuadrante inicial vs. final del trayecto |
| 10 | Análisis fundamental | Yahoo `quoteSummary` (P/E, P/B, ROE, márgenes, target analistas) |

---

## Estructura

```
gaceta-rrg/
├─ netlify.toml                 # build, redirects, scheduled function, headers
├─ package.json                 # dependencia @netlify/functions
├─ netlify/functions/
│  ├─ quotes.js                 # proxy Yahoo chart/v8 (CORS-free)
│  ├─ fundamentals.js           # proxy Yahoo quoteSummary
│  └─ scheduled-calc.js         # cron pre-warmer
└─ public/
   ├─ index.html                # 3 pestañas: Gráfico / Rotación / Fundamentales
   ├─ css/styles.css            # paleta editorial Gaceta (crema/tinta/oro)
   └─ js/
      ├─ data.js                # wrappers fetch
      ├─ rrg.js                 # JdK RS-Ratio + RS-Momentum
      ├─ projection.js          # Hurst R/S + Monte Carlo fBm
      ├─ analysis.js            # SMA, ATR, RSI, clasificación
      ├─ chart.js               # renderer canvas
      └─ app.js                 # orquestación + UI
```

---

## Despliegue en Netlify

### Opción A · GitHub (recomendado)

1. Subí el repo a GitHub:
   ```bash
   cd gaceta-rrg
   git init && git add . && git commit -m "init"
   gh repo create gaceta-rrg --public --source=. --push
   ```
2. En [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import from Git** → seleccionar `gaceta-rrg`.
3. Netlify detecta `netlify.toml` automáticamente. Click **Deploy**.

### Opción B · Netlify CLI

```bash
npm install -g netlify-cli
cd gaceta-rrg
netlify login
netlify init      # crear nuevo sitio
netlify deploy --prod
```

> **Nota:** Netlify Drop (arrastrar carpeta) **no** funciona acá porque hay Functions. Necesitás Git o CLI.

---

## Configuración de horarios

El cron en `netlify.toml` está en **UTC**:

```toml
[functions."scheduled-calc"]
  schedule = "0 16,22 * * 1-5"
```

| ART (UTC-3) | UTC | Días |
|---|---|---|
| 13:00 | 16:00 | Lun–Vie |
| 19:00 | 22:00 | Lun–Vie |

Para cambiar la zona o los horarios, editar el campo `schedule`.

> **Importante sobre DST:** Argentina **no** observa horario de verano desde 2009, así que el offset UTC-3 es estable todo el año. Si Anthropic publica nuevamente DST, habría que revisar.

---

## Matemática

**RS-Ratio (JdK):**
```
RS = Close_ticker / Close_SPY
RS-Ratio = 100 · RS / SMA(RS, 14)
```

**RS-Momentum:**
```
RS-Momentum = 100 · RS-Ratio / SMA(RS-Ratio, 14)
```

**Exponente de Hurst (R/S analysis):**
- Tamaños de chunk: 10, 20, 40, 80
- Regresión lineal de `log(R/S)` vs `log(n)` → pendiente = H
- H ≈ 0.5 → random walk · H > 0.5 → persistente · H < 0.5 → anti-persistente

**Proyección Monte Carlo (fBm-like):**
```
Δlog(P)_k = μ + σ · √(k^(2H) - (k-1)^(2H)) · z,  z ~ N(0,1)
```
500 paths simulados para ticker **y** SPY; se recalculan RS-Ratio y RS-Momentum sobre la serie extendida y se toma la media de los 3 puntos futuros.

**Precio objetivo técnico:**
```
target = Close + sign(Close - SMA20) · ATR(14) · 3
```
Atenuado a ×1.5 si RSI > 70 (sobrecompra) o RSI < 30 (sobreventa).

---

## Rotación

| Categoría | Trayecto | Interpretación |
|---|---|---|
| **CONSERVADORA** | improving → leading | Tendencia consolidada, riesgo bajo |
| **AGRESIVA** | lagging → improving | Reversión temprana, riesgo alto/reward |
| **SALIDA** | leading → weakening | Pérdida de momentum, considerar reducir |

---

## Limitaciones conocidas

- Yahoo Finance puede limitar el rate si hay muchas requests; el proxy cachea 3 minutos.
- Tickers con menos de 30 sesiones de historial muestran fila de error en las tablas.
- La proyección es estadística, **no** predictiva. El intervalo de confianza está implícito en la varianza de los 500 paths pero no se grafica.
- Netlify Free Tier: 125k invocaciones de funciones/mes — más que suficiente.

---

## Licencia y créditos

Producto interno de La Gaceta Mercantil. Datos: Yahoo Finance. Diseño tipográfico inspirado en la tradición editorial de la casa.
