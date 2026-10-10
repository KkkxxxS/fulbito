// ============================================
// v-multideporte — render + selector de deporte para Fulbito
// Complementa app-ui.js / app-model.js sin tocarlos.
// ============================================
(function () {
  // ---------- Config ----------
  window.DEPORTE_ACTUAL = window.DEPORTE_ACTUAL || 'futbol';
  const OPTIONS = {
    futbol: { titulo: 'Fútbol' },
    basquet: { sport: 'basketball_nba', regions: 'us', markets: 'h2h', titulo: 'Básquet NBA' },
    tenis:   { sport: 'tennis_atp_shanghai_masters', regions: 'us', markets: 'h2h', titulo: 'Tenis ATP' },
    voley:   { sport: 'volleyball', regions: 'us', markets: 'h2h', titulo: 'Vóley' },
  };

  function backendUrl() {
    return (typeof BACKEND_URL !== 'undefined' && BACKEND_URL) || 'https://fulbito-forh.onrender.com';
  }

  function escaparHTML(valor) {
    if (valor == null) return '';
    return String(valor).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function promedioCuota(bookmakers) {
    if (!bookmakers || !bookmakers.length) return null;
    const outs = bookmakers.flatMap(b => b.markets?.[0]?.outcomes || []);
    // promedio decimal por nombre es secundario; usamos primer bookie
    return bookmakers[0].markets?.[0]?.outcomes || [];
  }

  // ---------- API ----------
  async function cargarOdds(deporteKey) {
    const opt = OPTIONS[deporteKey];
    if (!opt || !opt.sport) return [];
    const url = `${backendUrl()}/api/odds/${opt.sport}?regions=${opt.regions}&markets=${opt.markets}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('No se pudo cargar ' + deporteKey);
    return r.json();
  }

  // ---------- Render ----------
  function tarjetaOddsHTML(partido) {
    const outs = promedioCuota(partido.bookmakers);
    const local = escaparHTML(partido.home_team);
    const visita = escaparHTML(partido.away_team);
    const cuotas = outs.map(o => `<span class="hist-odds">${escaparHTML(o.name)} @ ${o.price}</span>`).join(' ');
    const fecha = new Date(partido.commence_time).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
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
        <div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:8px; font-size:0.82rem;">${cuotas || '<em>Sin cuotas</em>'}</div>
        <div style="margin-top:8px; color:var(--text-muted); font-size:0.78rem;">${partido.bookmakers?.length || 0} bookies • Valor vs cuota justa (próximamente)</div>
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
      const data = await cargarOdds(deporteKey);
      if (!Array.isArray(data) || !data.length) {
        cont.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Sin partidos ahora. Probá con otra disciplina.</p>';
        return;
      }
      if (resumen) resumen.innerHTML = `<span class="chip chip--live">${data.length} partidos</span>`;
      cont.innerHTML = data.map(tarjetaOddsHTML).join('');
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
})();
