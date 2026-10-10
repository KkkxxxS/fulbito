// ============================================
// v-multideporte — render + selector de deporte para Fulbito
// Complementa app-ui.js / app-model.js sin tocarlos.
// ============================================
(function () {
  // ---------- Config ----------
  window.DEPORTE_ACTUAL = window.DEPORTE_ACTUAL || 'futbol';
  const OPTIONS = {
    futbol: { titulo: 'Fútbol' },
    basquet: { sport: 'basketball_nba', regions: 'us', markets: 'h2h,spreads,totals', titulo: 'Básquet NBA', prediccion: 'basquet' },
    tenis:   { sport: 'tenis', regions: 'us', markets: 'h2h', titulo: 'Tenis ATP / WTA', prediccion: 'tenis' },
    voley:   { sport: 'volleyball', regions: 'us', markets: 'h2h', titulo: 'Vóley', prediccion: null },
  };

  function backendUrl() {
    return (typeof BACKEND_URL !== 'undefined' && BACKEND_URL) || 'https://fulbito-forh.onrender.com';
  }

  function escaparHTML(valor) {
    if (valor == null) return '';
    return String(valor).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function normalizarNombre(n) {
    return String(n || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  }

  // ---------- API ----------
  async function cargarOdds(deporteKey) {
    const opt = OPTIONS[deporteKey];
    if (!opt || !opt.sport) return [];
    const url = `${backendUrl()}/api/odds/${opt.sport}?regions=${opt.regions}&markets=${opt.markets}`;
    const r = await fetch(url);
    if (!r.ok) {
      const datos = await r.json().catch(() => ({}));
      if (r.status === 503 && datos.error === 'sin_cobertura') {
        return { sinCobertura: true, mensaje: datos.mensaje, detalle: datos.detalle };
      }
      throw new Error(datos.mensaje || 'No se pudo cargar ' + deporteKey);
    }
    return r.json();
  }

  async function cargarPredicciones(deporteKey) {
    const opt = OPTIONS[deporteKey];
    if (!opt || !opt.prediccion) return null;
    const r = await fetch(`${backendUrl()}/api/predicciones/${opt.prediccion}`);
    if (!r.ok) return null;
    return r.json();
  }

  // ---------- Render ----------
  function marketTag(key, label) {
    const mapa = { h2h: 'Ganador', spreads: 'Hándicap', totals: 'Total (Over/Under)' };
    return `<span style="font-size:0.72rem; background:var(--bg-raised); border:1px solid var(--line); color:var(--text-muted); padding:2px 8px; border-radius:999px;">${escaparHTML(label || mapa[key] || key)}</span>`;
  }

  function barraProb(pct) {
    return `<div style="height:6px; border-radius:999px; background:var(--bg-raised); overflow:hidden; flex:1;">
      <div style="height:100%; width:${pct}%; background:linear-gradient(90deg,#3ddc97,#64e4a9); border-radius:999px;"></div>
    </div>`;
  }

  function bloquePrediccion(pred) {
    if (!pred) return '';
    const m = pred.modelo;
    const valor = pred.valor;
    const extras = [];
    if (pred.extras && pred.extras.sets) {
      extras.push(`Sets: 2-0 ${pred.extras.sets['2-0']}% · 2-1 ${pred.extras.sets['2-1']}% · 0-2 ${pred.extras.sets['0-2']}% · 1-2 ${pred.extras.sets['1-2']}%`);
    }
    if (pred.extras && pred.extras.spread) {
      extras.push(`Spread ${pred.extras.spread.linea > 0 ? '+' : ''}${pred.extras.spread.linea} (cubre local ${pred.extras.spread.probLocalCubre}%)`);
    }
    if (pred.extras && pred.extras.total) {
      extras.push(`Total ${pred.extras.total.linea} pts`);
    }
    return `
      <div style="margin-top:8px; border-top:1px dashed var(--line); padding-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:8px;">
          <span style="font-size:0.7rem; font-weight:800; letter-spacing:0.05em; color:#3ddc97;">FULBITO IA</span>
          <span style="font-size:0.72rem; color:var(--text-muted);">Confianza ${escaparHTML(pred.confianza)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; font-size:0.82rem;">
          <span style="min-width:90px; font-weight:700;">${escaparHTML(pred.local)}</span>
          ${barraProb(m.local.probabilidad)}
          <span style="font-weight:800; color:#64e4a9;">${m.local.probabilidad}%</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; font-size:0.82rem; margin-top:4px;">
          <span style="min-width:90px; font-weight:700;">${escaparHTML(pred.visita)}</span>
          ${barraProb(m.visita.probabilidad)}
          <span style="font-weight:800; color:#64e4a9;">${m.visita.probabilidad}%</span>
        </div>
        <div style="margin-top:6px; font-size:0.76rem; color:var(--text-muted); display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
          <span>Cuota justa: ${m.local.cuotaJusta} / ${m.visita.cuotaJusta}</span>
          ${valor ? (valor.esValor
            ? `<span style="background:rgba(100,228,169,0.14); border:1px solid rgba(100,228,169,0.4); color:#64e4a9; font-weight:800; padding:2px 8px; border-radius:999px;">VALOR ${valor.nombre} @${valor.cuota} (+${valor.ev}%)</span>`
            : `<span>Mejor valor: ${escaparHTML(valor.nombre)} @${valor.cuota} (${valor.ev > 0 ? '+' : ''}${valor.ev}%)</span>`)
          : '<span>Sin valor claro</span>'}
        </div>
        ${extras.length ? `<div style="margin-top:4px; font-size:0.74rem; color:var(--text-muted);">${extras.map(escaparHTML).join(' · ')}</div>` : ''}
      </div>`;
  }

  function tarjetaOddsHTML(partido, predicciones) {
    const local = escaparHTML(partido.home_team);
    const visita = escaparHTML(partido.away_team);
    const fecha = new Date(partido.commence_time).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const bookie = (partido.bookmakers && partido.bookmakers[0]) || null;
    const markets = bookie ? bookie.markets : [];
    let bloquesMarkets = '';
    if (markets.length) {
      bloquesMarkets = markets.map(m => {
        const label = ({ h2h: 'Ganador', spreads: 'Hándicap', totals: 'Total' }[m.key] || m.key);
        return `<div style="margin-top:8px; background:var(--bg-raised); border:1px solid var(--line); border-radius:var(--radius-sm); padding:8px 10px; display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
          ${marketTag(m.key, label)}
          <div style="display:flex; flex-wrap:wrap; gap:6px;">${(m.outcomes || []).map(o => `<span style="background:rgba(100,228,169,0.12); border:1px solid rgba(100,228,169,0.25); color:#64e4a9; padding:3px 8px; border-radius:999px; font-size:0.8rem; font-weight:700;">${escaparHTML(o.name)}${o.point != null ? ` ${o.point > 0 ? '+' : ''}${o.point}` : ''} @ ${o.price}</span>`).join(' ')}</div>
        </div>`;
      }).join('');
    } else {
      bloquesMarkets = '<em style="font-size:0.82rem; color:var(--text-muted);">Sin cuotas para este mercado</em>';
    }
    const pred = predicciones
      ? predicciones.find(p => normalizarNombre(p.local) === normalizarNombre(partido.home_team) && normalizarNombre(p.visita) === normalizarNombre(partido.away_team))
      : null;
    return `
      <div class="tarjeta-partido">
        <div class="tarjeta-partido-topbar">
          <span class="partido-liga-tag">${escaparHTML(partido.sport_title || '')}</span>
          <span class="partido-fecha-tag">${escaparHTML(fecha)}</span>
        </div>
        <div class="encabezado-partido" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <span class="equipo">${local}</span>
          <span class="vs-circulo">VS</span>
          <span class="equipo">${visita}</span>
        </div>
        ${bloquePrediccion(pred)}
        ${bloquesMarkets}
        <div style="margin-top:8px; color:var(--text-muted); font-size:0.78rem;">${partido.bookmakers?.length || 0} bookies • Modelo Elo + consenso de mercado</div>
      </div>
    `;
  }

  async function renderDeporte(deporteKey) {
    const cont = document.getElementById(
      deporteKey === 'basquet' ? 'contenedor-basquet' :
      deporteKey === 'tenis'   ? 'contenedor-tenis' :
      deporteKey === 'voley'   ? 'contenedor-voley' : null
    );
    const resumen = document.getElementById('basquet-resumen');
    if (!cont) return;
    cont.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Cargando…</p>';
    if (resumen) resumen.innerHTML = '';
    try {
      const [data, predicciones] = await Promise.all([
        cargarOdds(deporteKey),
        cargarPredicciones(deporteKey)
      ]);
      if (data && data.sinCobertura) {
        cont.innerHTML = `
          <div class="tarjeta-partido" style="text-align:center; padding:24px;">
            <div style="font-size:2rem;">🏐</div>
            <p style="font-weight:700;">${escaparHTML(data.mensaje || 'Cobertura en implementación')}</p>
            <p style="font-size:0.82rem; color:var(--text-muted);">${escaparHTML(data.detalle || 'La fuente de datos de vóley se está conectando. Pronto tendrás cuotas y predicciones.')}</p>
          </div>`;
        return;
      }
      if (!Array.isArray(data) || !data.length) {
        cont.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Sin partidos ahora. Probá con otra disciplina.</p>';
        return;
      }
      if (resumen) resumen.innerHTML = `<span class="chip chip--live">${data.length} partidos</span>` +
        (predicciones && predicciones.partidosEntrenamiento > 0 ? `<span class="chip">Elo entrenado con ${predicciones.partidosEntrenamiento} resultados</span>` : '');
      cont.innerHTML = data.map(p => tarjetaOddsHTML(p, predicciones && predicciones.partidos)).join('');
    } catch (e) {
      cont.innerHTML = `<p style="text-align:center; color:#ff6b6b;">Error al cargar ${escaparHTML(deporteKey)}: ${escaparHTML(e.message || 'desconocido')}</p>`;
    }
  }

  // ---------- Selector ----------
  window.cambiarDeporte = function (key) {
    window.DEPORTE_ACTUAL = key;
    document.querySelectorAll('#selector-deporte [data-deporte]').forEach(b => {
      const on = b.getAttribute('data-deporte') === key;
      b.classList.toggle('activa', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (key === 'todos') {
      // Muestra todas las vistas apiladas: para MVP, solo volvemos a fútbol y cargamos pronósticos
      if (typeof cambiarVista === 'function') cambiarVista('pronosticos');
      return;
    }
    if (key === 'futbol') {
      if (typeof cambiarVista === 'function') cambiarVista('pronosticos');
      return;
    }
    if (typeof cambiarVista === 'function') cambiarVista(key);
    renderDeporte(key);
  };

  // Hookear cambiarVista para auto-cargar datos al entrar a una vista multideporte
  const orig = window.cambiarVista;
  if (typeof orig === 'function') {
    window.cambiarVista = function (vista) {
      // Siempre llamar al original primero (si ya está definido en este punto)
      try { return orig.apply(this, arguments); } finally {
        if (['basquet','tenis','voley'].includes(vista)) {
          // Diferir un tick para que la sección sea visible
          setTimeout(() => renderDeporte(vista), 0);
        }
      }
    };
  } else {
    // Si app-ui aún no cargó, reintenta hookear más tarde
    setTimeout(() => {
      const o2 = window.cambiarVista;
      if (typeof o2 === 'function' && o2 !== window.cambiarVista) {
        const prev = o2;
        window.cambiarVista = function (vista) {
          try { return prev.apply(this, arguments); } finally {
            if (['basquet','tenis','voley'].includes(vista)) setTimeout(() => renderDeporte(vista), 0);
          }
        };
      }
    }, 800);
  }

  // Exponer para depuración
  window.renderDeporte = renderDeporte;
  window.cargarOdds = cargarOdds;
  window.cargarPredicciones = cargarPredicciones;
})();
