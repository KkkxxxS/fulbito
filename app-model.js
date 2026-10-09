  // ============ CONFIGURACION ============
  const BACKEND_URL = "https://fulbito-forh.onrender.com";
  const COMPETICIONES = "PL,PD,BL1,SA,FL1,CL,DED,ELC,BSA,PPL";

  // Escapa texto que proviene de fuentes externas (API, localStorage) antes de
  // insertarlo en HTML. Evita inyección de markup/XSS en los innerHTML.
  function escaparHTML(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Toda llamada de red del frontend lleva un límite de tiempo: así la UI nunca
  // se queda en "Cargando..." para siempre si el backend (Render free) no responde.
  (function () {
    if (typeof window === 'undefined' || !window.fetch) return;
    const TIMEOUT_MS = 15000;
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = function (recurso, opciones) {
      if (typeof AbortController === 'undefined') return fetchOriginal(recurso, opciones);
      const opts = opciones ? Object.assign({}, opciones) : {};
      if (opts.signal) return fetchOriginal(recurso, opts);
      const controlador = new AbortController();
      const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);
      opts.signal = controlador.signal;
      return fetchOriginal(recurso, opts).finally(() => clearTimeout(temporizador));
    };
  })();

  // Reporte best-effort de errores no capturados al backend (telemetría simple,
  // sin datos personales). Se limita a unos pocos por sesión para no hacer spam.
  (function () {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    let reportes = 0;
    function reportarErrorCliente(detalle, origen) {
      if (reportes >= 5) return;
      reportes++;
      try {
        window.fetch(BACKEND_URL + '/api/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mensaje: String(detalle || '').slice(0, 500),
            origen: origen,
            url: (window.location && window.location.href) || '',
            agente: (typeof navigator !== 'undefined' && navigator.userAgent) || ''
          })
        }).catch(() => {});
      } catch (e) { /* la telemetría nunca debe romper la app */ }
    }
    window.addEventListener('error', function (e) {
      if (e && typeof e.message === 'string' && e.message) reportarErrorCliente(e.message, 'error');
    });
    window.addEventListener('unhandledrejection', function (e) {
      const r = e && e.reason;
      if (r && r.name === 'AbortError') return;
      reportarErrorCliente((r && r.message) || 'promise', 'unhandledrejection');
    });
  })();

  /**
   * GlowCard Implementation
   * Updates CSS custom properties based on mouse position relative to the card.
   */
  function initGlowCards() {
    const cards = document.querySelectorAll('.dash-kpi, .dash-quick-card');

    cards.forEach(card => {
      card.classList.add('glow-card');

      card.addEventListener('pointermove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        requestAnimationFrame(() => {
          card.style.setProperty('--glow-x', `${x}%`);
          card.style.setProperty('--glow-y', `${y}%`);
        });
      });
    });
  }

  const NOMBRES_LIGA = {
    PL: "Premier League", PD: "La Liga", BL1: "Bundesliga",
    SA: "Serie A", FL1: "Ligue 1", CL: "Champions League",
    DED: "Eredivisie", ELC: "Championship", BSA: "Brasileirão",
    PPL: "Primeira Liga"
  };

  let ligaSeleccionada = 'TODAS';
  let partidosDelRango = [];
  // KPI "Predicciones hoy": null = aún sin cargar; Number = partidos con fecha local de hoy.
  let partidosDeHoy = null;
  // El backend no respondió: lo que se ve en pantalla son datos demo, no la jornada real.
  let kpiHoyModoDemo = false;
  // Lo mismo para las listas: si el backend está caído, las tarjetas son PARTIDOS_FALLBACK
  // y hay que avisarlo arriba de la lista (el número del KPI solo no alcanza).
  let partidosModoDemo = false;

  function actualizarKpiHoy() {
    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    if (kpiHoyModoDemo) {
      // Sin servidor no podemos afirmar cuántos partidos hay hoy: no inventamos el número.
      setTxt('kpi-hoy', '—');
      setTxt('kpi-hoy-pie', 'Sin conexión con el servidor · datos demo');
    } else if (partidosDeHoy === null) {
      setTxt('kpi-hoy', '…');
      setTxt('kpi-hoy-pie', 'Cargando la jornada de hoy…');
    } else if (partidosDeHoy === 0) {
      setTxt('kpi-hoy', '0');
      setTxt('kpi-hoy-pie', 'No hay partidos programados para hoy');
    } else {
      setTxt('kpi-hoy', String(partidosDeHoy));
      setTxt('kpi-hoy-pie', partidosDeHoy === 1
        ? 'partido con pronóstico hoy · 9 mercados'
        : 'partidos con pronóstico hoy · 9 mercados');
    }
  }

  // ============ SALUDO DINÁMICO SEGÚN LA HORA LOCAL DEL USUARIO ============
  // Saludo genérico por hora (mañana / tarde / noche) + nombre opcional desde
  // localStorage ('userName'). Sin nombre guardado queda "Usuario".
  function aplicarSaludoDinamico() {
    const hora = new Date().getHours();
    let saludo;
    if (hora >= 5 && hora < 12) saludo = 'Buenos días';
    else if (hora >= 12 && hora < 19) saludo = 'Buenas tardes';
    else saludo = 'Buenas noches';

    // Nombre del usuario: es opcional y sale de localStorage (no hay cuentas
    // ni planes). Si no hay nada guardado, queda el genérico "Usuario".
    let nombre = 'Usuario';
    try {
      const guardado = (localStorage.getItem('userName') || '').trim();
      if (guardado) nombre = guardado;
    } catch (e) { /* localStorage bloqueado: usamos el genérico */ }

    const el = document.getElementById('hero-saludo');
    if (el) el.textContent = `${saludo}, ${nombre}`;

    // El chip de perfil muestra solo avatar + nombre (sin badge de plan).
    const nombrePerfil = document.getElementById('perfil-nombre');
    if (nombrePerfil) nombrePerfil.textContent = nombre;
    const avatarPerfil = document.getElementById('perfil-avatar');
    if (avatarPerfil) avatarPerfil.textContent = nombre.charAt(0).toUpperCase();
  }
  aplicarSaludoDinamico();
  initGlowCards();

  // ============ VISTAS (app shell) ============
  let vistaActual = 'inicio';
  let favoritosCargadosAlMenosUnaVez = false;
  let filtroHistorial = 'todos';

  function cambiarVista(vista, actualizarHash = true) {
    vistaActual = vista;
    document.body.classList.toggle('home-mode', vista === 'inicio');

    document.querySelectorAll('.vista').forEach(sec => sec.classList.remove('vista-activa'));
    const vistaNode = document.getElementById(`vista-${vista}`);
    if (vistaNode) vistaNode.classList.add('vista-activa');

    document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.toggle('activa', btn.dataset.vista === vista));

    const buscador = document.getElementById('input-busqueda');
    if (buscador) {
      buscador.style.display = (vista === 'mispredicciones') ? 'none' : '';
      buscador.placeholder = vista === 'favoritos' ? 'Buscar en tus favoritos…' : (vista === 'analitica' || vista === 'historial') ? 'Buscar equipo o liga en el historial…' : 'Buscar equipo o liga…';
    }

    cerrarMenuMovil();
    if (actualizarHash) history.replaceState(null, '', `#${vista}`);
    window.scrollTo({ top: document.querySelector('main').offsetTop - 10, behavior: 'smooth' });

    if (vista === 'favoritos') {
      cargarFavoritos();
     } else if (vista === 'analitica') {
      // Re-asegurar sync con backend antes de mostrar, así si el usuario
      // borró caché y abre "Analítica" ve su historial completo.
      cargarHistorialCompartido().finally(() =>
        actualizarHistorialYCalibracion().then(h => renderHistorial(calcularEstadisticasHistorial(h), h))
      );
    } else if (vista === 'historial') {
      cargarHistorialCompartido().finally(() =>
        actualizarHistorialYCalibracion().then(h => renderHistorialCompleto(h))
      );
    } else if (vista === 'mispredicciones') {
      cargarHistorialCompartido().finally(() =>
        actualizarHistorialYCalibracion().then(() => renderMisPredicciones())
      );
    } else if (vista === 'inicio') {
      // También en inicio: refrescar desde backend para que los KPIs reflejen
      // lo último aunque hayas limpiado caché.
      cargarHistorialCompartido().finally(() =>
        actualizarHistorialYCalibracion().then(() => actualizarKPIsHome())
      );
    }

    // Control visibilidad FAB Armar Combinada (solo visible en vista pronosticos)
    const fabCombinada = document.getElementById('btn-fab-combinada');
    if (fabCombinada) {
      if (vista === 'pronosticos') {
        fabCombinada.style.display = 'inline-flex';
      } else {
        fabCombinada.style.display = 'none';
      }
    }
  }

  function toggleMenuMovil() {
    const nav = document.getElementById('app-nav');
    if (nav) nav.classList.toggle('menu-abierto');
  }
  function cerrarMenuMovil() {
    const nav = document.getElementById('app-nav');
    if (nav) nav.classList.remove('menu-abierto');
  }

// ============ HEADER: notificaciones/tema/idioma ocultos a propósito ============
// - Campana: requiere backend de alertas que no existe → se quitó del DOM.
// - Luna (tema): no hay CSS de tema claro en el repo y rediseñar la paleta
//   está fuera de alcance → se quitó del DOM.
// - ES/EN: no hay sistema i18n implementado (solo atributos data-i18n huérfanos)
//   → se quitó del DOM.
// Mientras exista un elemento con apariencia de botón debe responder al click.

  // ============ PERFIL (dropdown del header) ============
  // Antes solo existía el CSS (:focus-within) y en varios navegadores/toque
  // el click no enfocaba el botón, así que el panel nunca aparecía.
  function alternarPerfil(event) {
    if (event) event.stopPropagation();
    const wrap = document.querySelector('.dash-perfil-wrap');
    if (!wrap) return;
    const abierto = wrap.classList.toggle('abierta');
    const btn = document.getElementById('btn-perfil');
    if (btn) btn.setAttribute('aria-expanded', abierto ? 'true' : 'false');
  }

  function cerrarPerfil() {
    const wrap = document.querySelector('.dash-perfil-wrap');
    if (!wrap || !wrap.classList.contains('abierta')) return;
    wrap.classList.remove('abierta');
    const btn = document.getElementById('btn-perfil');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.dash-perfil-wrap');
    if (!wrap) return;
    // Clic afuera → cerrar. Clic en un ítem del menú → cerrar tras actuar.
    if (!wrap.contains(e.target) || e.target.closest('.dash-perfil-item')) cerrarPerfil();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarPerfil();
  });

  // ============ BUSQUEDA ============
  let terminoBusqueda = '';

  function onBuscar(valor) {
    terminoBusqueda = valor.trim().toLowerCase();
    if (vistaActual === 'pronosticos') {
      if (ultimaFechaCargada === 'finalizados') renderizarFinalizados();
      else renderizarPartidosFiltrados();
    }
    else if (vistaActual === 'favoritos') renderizarFavoritos();
    else if (vistaActual === 'analitica') { const h = leerHistorial(); renderHistorial(calcularEstadisticasHistorial(h), h); }
    else if (vistaActual === 'historial') { renderHistorialCompleto(leerHistorial()); }
  }

  // Los dos inputs del header/vista escriben en el MISMO estado de búsqueda.
  function sincronizarBusquedaDashboard(valor) {
    const sidebar = document.getElementById('input-busqueda');
    if (sidebar && sidebar.value !== valor) sidebar.value = valor;
    // En vistas sin listado, saltar a Pronosticos para que el filtro sea visible.
    if (!['pronosticos', 'favoritos', 'analitica', 'historial'].includes(vistaActual)) {
      cambiarVista('pronosticos');
    }
    onBuscar(valor);
  }

  function onBuscarIntegrado(valor) {
    const sidebar = document.getElementById('input-busqueda');
    if (sidebar && sidebar.value !== valor) sidebar.value = valor;
    onBuscar(valor);
  }

  function enfocarBuscador(event) {
    if (event) event.preventDefault();
    const candidatos = [document.getElementById('input-busqueda-dash'), document.getElementById('input-busqueda')];
    const visible = candidatos.find(el => el && el.offsetParent !== null);
    if (visible) visible.focus();
  }

  function coincideBusqueda(partido) {
    if (!terminoBusqueda) return true;
    const texto = `${partido.homeTeam.name} ${partido.awayTeam.name} ${partido.competition.name}`.toLowerCase();
    return texto.includes(terminoBusqueda);
  }

  function coincideBusquedaTexto(local, visita, liga) {
    if (!terminoBusqueda) return true;
    return `${local} ${visita} ${liga}`.toLowerCase().includes(terminoBusqueda);
  }

  // ============ FAVORITOS DE EQUIPOS ============
  const CLAVE_FAVORITOS = 'fulbito_equipos_favoritos';

  function leerFavoritos() {
    try {
      const crudo = localStorage.getItem(CLAVE_FAVORITOS);
      return crudo ? JSON.parse(crudo) : [];
    } catch (e) {
      return [];
    }
  }

  function esFavorito(teamId) {
    return leerFavoritos().includes(teamId);
  }

  function actualizarContadorFavoritos() {
    const n = leerFavoritos().length;
    const badge = document.getElementById('contador-favoritos');
    if (badge) {
      badge.style.display = n > 0 ? 'inline-flex' : 'none';
      badge.textContent = n;
    }
  }

  // ============ SALUD DEL MOTOR: ESTADO ÚNICO (fuente de verdad) ============
  // UNA sola función calcula el estado y UNA sola lo pinta en todos los
  // lugares: KPI superior, sidebar, sección "Salud del motor Fulbito" y
  // telemetría de Analítica. Fuente única: leerHistorial(), que tras
  // cargarHistorialCompartido() refleja el pool verificado del servidor
  // (la misma fuente que audita recalibracion.py). Con 0 partidos verificados,
  // TODOS los lugares muestran "Sin datos todavía" — nunca números inventados.
  function calcularEstadoSalud() {
    const historial = leerHistorial();
    let stats = null, brier = null;
    try { stats = calcularEstadisticasHistorial(historial); } catch (e) { stats = null; }
    try { brier = calcularBrierScore(historial); } catch (e) { brier = null; }
    const conDatos = !!(stats && stats.totalVerificados > 0);
    const brierNum = (brier && typeof brier.brier === 'number') ? brier.brier : null;
    const pct = conDatos ? stats.general : null;
    const salud = conDatos
      ? (brierNum !== null ? Math.max(0, Math.min(100, Math.round(100 - (brierNum * 90)))) : pct)
      : null;
    return {
      conDatos, salud, pct, brierNum,
      totalVerificados: conDatos ? stats.totalVerificados : 0,
      stats: conDatos ? stats : null
    };
  }

  function pintarSaludMotor(e) {
    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    const setWidth = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = pct; };
    const setAttr = (id, attr, val) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, val); };
    const setChip = (id, vacio) => { const el = document.getElementById(id); if (el) el.classList.toggle('neutral', vacio); };
    const chipSalud = e.salud === null ? 'Sin datos' : (e.salud >= 80 ? 'Óptimo' : e.salud >= 60 ? 'Estable' : 'En revisión');
    const brierTxt = e.brierNum !== null ? e.brierNum.toFixed(2) : '—';

    // Aciertos (la "Salud del motor" vive solo en sidebar + sección inferior)
    setTxt('kpi-aciertos', e.pct !== null ? `${e.pct}%` : '—');
    setTxt('kpi-aciertos-chip', e.conDatos ? 'Histórico' : 'Sin datos'); setChip('kpi-aciertos-chip', !e.conDatos);
    setTxt('kpi-verificados', e.conDatos ? `${e.totalVerificados} verificados` : 'Sin datos todavía');
    setWidth('kpi-aciertos-barra', e.pct !== null ? `${e.pct}%` : '0%');

    // Sidebar (referencia rápida)
    setTxt('sidebar-salud', e.salud !== null ? `${e.salud}%` : '—');
    setWidth('sidebar-salud-barra', e.salud !== null ? `${e.salud}%` : '0%');
    setTxt('sidebar-brier', brierTxt);
    setTxt('sidebar-picks', String(e.totalVerificados));

    // Sección "Salud del motor Fulbito" (detalle expandido)
    setTxt('salud-gauge-texto', e.salud !== null ? `${e.salud}%` : '—');
    setTxt('salud-gauge-estado', e.conDatos ? chipSalud.toUpperCase() : 'SIN DATOS');
    setAttr('salud-gauge-arco', 'stroke-dasharray', e.salud !== null ? `${e.salud} 100` : '0 100');
    setTxt('salud-stat-brier', `Brier ${brierTxt}`);
    setTxt('salud-stat-picks', `${e.totalVerificados} picks`);
    const gaugeNota = document.getElementById('salud-gauge-nota');
    if (gaugeNota) gaugeNota.style.display = e.conDatos ? 'none' : '';
    const lista = document.getElementById('salud-mercados-lista');
    if (lista) {
      if (e.stats && e.stats.categorias.length) {
        lista.innerHTML = e.stats.categorias.map(c => {
          const nivel = c.porcentaje >= 80 ? 'alto' : c.porcentaje >= 60 ? 'bueno' : 'media';
          const nivelTxt = nivel === 'alto' ? 'Alta' : nivel === 'bueno' ? 'Media' : 'Baja';
          return `<div class="health-mercado-item">
            <span class="health-mercado-nombre">${c.titulo}<span class="health-mercado-nivel ${nivel}">${nivelTxt}</span></span>
            <div class="health-barra"><div style="width:${Math.min(100, c.porcentaje)}%"></div></div>
            <span class="health-mercado-valor">${c.porcentaje}%</span>
          </div>`;
        }).join('');
      } else {
        lista.innerHTML = '<p class="health-sub" style="margin:0;">Sin mercados verificados todavía.</p>';
      }
    }
  }

  function actualizarKPIsHome() {
    pintarSaludMotor(calcularEstadoSalud());
    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    actualizarKpiHoy();

    // Favoritos: el número vive en el KPI "Tus favoritos" (tarjeta del inicio)
    let nFav = 0;
    try { nFav = leerFavoritos().length; } catch (e) { nFav = 0; }
    setTxt('kpi-favoritos', String(nFav));
  }

  function toggleFavorito(teamId, event) {
    event.stopPropagation();
    let favoritos = leerFavoritos();
    if (favoritos.includes(teamId)) {
      favoritos = favoritos.filter(id => id !== teamId);
    } else {
      favoritos.push(teamId);
    }
    try {
      localStorage.setItem(CLAVE_FAVORITOS, JSON.stringify(favoritos));
    } catch (e) {}
    actualizarContadorFavoritos();
    if (vistaActual === 'pronosticos') renderizarPartidosFiltrados();
    if (vistaActual === 'favoritos') cargarFavoritos();
  }

  function partidoTieneFavorito(partido) {
    const favoritos = leerFavoritos();
    return favoritos.includes(partido.homeTeam.id) || favoritos.includes(partido.awayTeam.id);
  }

  // ============ MIS PREDICCIONES (picks que el usuario marca a mano) ============
  const CLAVE_MIS_PREDICCIONES = 'fulbito_mis_predicciones';

  function leerMisPredicciones() {
    try {
      const crudo = localStorage.getItem(CLAVE_MIS_PREDICCIONES);
      return crudo ? JSON.parse(crudo) : [];
    } catch (e) {
      return [];
    }
  }

  function guardarMisPredicciones(lista) {
    try {
      localStorage.setItem(CLAVE_MIS_PREDICCIONES, JSON.stringify(lista));
    } catch (e) {}
  }

  function esMiPrediccion(partidoId, categoria) {
    return leerMisPredicciones().some(p => p.partidoId === partidoId && p.categoria === categoria);
  }

  function actualizarContadorMisPredicciones() {
    const historial = leerHistorial();
    const mias = leerMisPredicciones();
    const pendientes = mias.filter(p => {
      const h = historial.find(x => x.partidoId === p.partidoId);
      return !h || !h.verificado;
    });
    const badge = document.getElementById('contador-mispredicciones');
    if (badge) {
      badge.style.display = pendientes.length > 0 ? 'inline-flex' : 'none';
      badge.textContent = pendientes.length;
    }
  }

  function toggleMiPrediccion(partidoId, categoria, event) {
    event.stopPropagation();
    let mias = leerMisPredicciones();
    if (mias.some(p => p.partidoId === partidoId && p.categoria === categoria)) {
      mias = mias.filter(p => !(p.partidoId === partidoId && p.categoria === categoria));
    } else {
      mias.push({ partidoId, categoria, guardadoEn: Date.now() });
    }
    guardarMisPredicciones(mias);
    actualizarContadorMisPredicciones();

    const boton = event.currentTarget;
    if (boton) {
      const activa = mias.some(p => p.partidoId === partidoId && p.categoria === categoria);
      boton.classList.toggle('activa', activa);
      boton.title = activa ? 'Quitar de Mis Predicciones' : 'Marcar como mi predicción';
    }
    if (vistaActual === 'mispredicciones') renderMisPredicciones();
  }

  function botonMiPrediccion(partidoId, categoria) {
    const activa = esMiPrediccion(partidoId, categoria);
    return `<button class="boton-pick ${activa ? 'activa' : ''}" onclick="toggleMiPrediccion(${partidoId}, '${categoria}', event)" title="${activa ? 'Quitar de Mis Predicciones' : 'Marcar como mi predicción'}">📌</button>`;
  }

  function renderMisPredicciones() {
    const contenedor = document.getElementById('contenedor-mispredicciones');
    const mias = leerMisPredicciones();

    if (mias.length === 0) {
      contenedor.innerHTML = `
        <div class="aviso-servidor">
          <p><strong>Todavía no marcaste ninguna predicción.</strong></p>
          <p>Toca el pin 📌 en cualquier mercado, dentro de una tarjeta de partido en "Pronósticos" o "Favoritos", y va a aparecer acá.</p>
        </div>
      `;
      return;
    }

    const historial = leerHistorial();
    const entradas = mias.map(p => {
      const h = historial.find(x => x.partidoId === p.partidoId);
      const mercado = h ? h.mercados.find(m => m.categoria === p.categoria) : null;
      return { pick: p, historial: h, mercado };
    }).filter(e => e.mercado);

    entradas.sort((a, b) => (b.pick.guardadoEn || 0) - (a.pick.guardadoEn || 0));

    const pendientes = entradas.filter(e => !e.historial.verificado);
    const verificadas = entradas.filter(e => e.historial.verificado);

    let precisionHTML = '';
    if (verificadas.length > 0) {
      const aciertos = verificadas.filter(e => e.mercado.acierto).length;
      const pct = Math.round((aciertos / verificadas.length) * 100);
      precisionHTML = `
        <div class="precision-general">
          <span class="precision-general-num">${pct}%</span>
          <span class="precision-general-label">Tu precisión personal<br>(${aciertos}/${verificadas.length} predicciones marcadas por ti, ya verificadas)</span>
        </div>
      `;
    }

    const filaPick = (e, verificada) => {
      const h = e.historial, m = e.mercado;
      let badge = '';
      if (verificada) {
        badge = `<span class="historial-partido-badge ${m.acierto ? 'todo-bien' : 'todo-mal'}">${m.acierto ? '✓ Acertó' : '✕ Falló'}</span>`;
      } else {
        badge = `<span class="historial-partido-badge parcial">Pendiente</span>`;
      }
      return `
        <div class="historial-partido">
          <div class="historial-partido-header">
            <span class="historial-partido-equipos"><strong>${h.local} vs ${h.visita}</strong></span>
            ${verificada ? `<span class="historial-partido-marcador">${h.marcadorFinal}</span>` : ''}
            ${badge}
          </div>
          <div class="historial-partido-mercados">
            <span class="historial-mercado-item ${verificada ? (m.acierto ? 'acierto' : 'fallo') : ''}">
              ${CATEGORIAS_MERCADO[m.categoria]?.titulo || m.categoria}: <strong>${m.seleccion}</strong> (${m.probabilidad}%)
            </span>
          </div>
          <button class="boton-reiniciar" style="margin-top:10px;" onclick="toggleMiPrediccion(${h.partidoId}, '${m.categoria}', event); renderMisPredicciones();">Quitar</button>
        </div>
      `;
    };

    contenedor.innerHTML = `
      <div class="bloque-combinadas sin-borde-superior">
        ${precisionHTML}
        ${pendientes.length > 0 ? `
          <p class="combos-partido-titulo">Pendientes (${pendientes.length})</p>
          ${pendientes.map(e => filaPick(e, false)).join('')}
        ` : ''}
        ${verificadas.length > 0 ? `
          <p class="combos-partido-titulo" style="margin-top:18px;">Verificadas (${verificadas.length})</p>
          ${verificadas.map(e => filaPick(e, true)).join('')}
        ` : ''}
      </div>
    `;
  }

  // ============ CACHE PERSISTENTE ENTRE VISITAS ============
  const DURACION_CACHE_MS = 5 * 60 * 1000;

  function leerCachePersistente(clave) {
    try {
      const crudo = localStorage.getItem(`fulbito_cache_${clave}`);
      if (!crudo) return null;
      const { valor, expira } = JSON.parse(crudo);
      if (Date.now() > expira) {
        localStorage.removeItem(`fulbito_cache_${clave}`);
        return null;
      }
      return valor;
    } catch (e) {
      return null;
    }
  }

  function guardarCachePersistente(clave, valor) {
    try {
      localStorage.setItem(`fulbito_cache_${clave}`, JSON.stringify({
        valor,
        expira: Date.now() + DURACION_CACHE_MS
      }));
    } catch (e) {}
  }

  const cache = {};

  function formatearFecha(date) {
    const anio = date.getFullYear();
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const dia = String(date.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
  }

  function fechaLocalDePartido(utcDateStr) {
    return formatearFecha(new Date(utcDateStr));
  }

  // Datos de respaldo para cuando el backend no responda
  const PARTIDOS_FALLBACK = [
    { homeTeam: { name: "Arsenal", id: 57 }, awayTeam: { name: "Liverpool", id: 40 }, competition: { name: "Premier League", code: "PL" }, utcDate: "2026-09-06T14:00:00Z", status: "SCHEDULED" },
    { homeTeam: { name: "Real Madrid", id: 86 }, awayTeam: { name: "Barcelona", id: 81 }, competition: { name: "La Liga", code: "PD" }, utcDate: "2026-09-06T18:30:00Z", status: "SCHEDULED" }
  ];

  async function obtenerPartidos(fechaInicio, fechaFin) {
    const claveCache = `matches-${fechaInicio}-${fechaFin}`;
    if (cache[claveCache]) return cache[claveCache];

    const persistente = leerCachePersistente(claveCache);
    if (persistente) {
      cache[claveCache] = persistente;
      return persistente;
    }

    try {
      const url = `${BACKEND_URL}/api/partidos?competitions=${COMPETICIONES}&dateFrom=${fechaInicio}&dateTo=${fechaFin}`;
      const resp = await fetch(url);
      const datos = await resp.json();

      if (datos.error || datos.errorCode) {
        console.error("Respuesta con error de la API:", datos);
        return PARTIDOS_FALLBACK;
      }

      const partidos = (datos.matches || []).filter(p => p.status === 'SCHEDULED' || p.status === 'TIMED');
      cache[claveCache] = partidos;
      // No persistir listas vacías: un [] cacheado haría que "Mañana" parezca
      // permanentemente vacío aunque el backend ya tenga partidos.
      if (partidos.length > 0) guardarCachePersistente(claveCache, partidos);
      return partidos;
    } catch (e) {
      console.warn("Error trayendo partidos de la API, usando respaldo local:", e);
      return PARTIDOS_FALLBACK;
    }
  }

  async function obtenerPartidosFinalizados(fechaInicio, fechaFin) {
    const claveCache = `finalizados-${fechaInicio}-${fechaFin}`;
    if (cache[claveCache]) return cache[claveCache];

    const persistente = leerCachePersistente(claveCache);
    if (persistente) {
      cache[claveCache] = persistente;
      return persistente;
    }

    try {
      const url = `${BACKEND_URL}/api/partidos?competitions=${COMPETICIONES}&dateFrom=${fechaInicio}&dateTo=${fechaFin}`;
      const resp = await fetch(url);
      const datos = await resp.json();

      if (datos.error || datos.errorCode) {
        return { error: true, mensaje: datos.message || datos.error || "Error desconocido de la API" };
      }

      const partidos = (datos.matches || []).filter(p => p.status === 'FINISHED');
      cache[claveCache] = partidos;
      if (partidos.length > 0) guardarCachePersistente(claveCache, partidos);
      return partidos;
    } catch (e) {
      console.error("Error trayendo partidos finalizados", e);
      return { error: true, mensaje: e.message };
    }
  }

  // ============ TABLA DE POSICIONES ============
  async function obtenerTabla(codigoLiga) {
    const claveCache = `standings-${codigoLiga}`;
    if (cache[claveCache]) return cache[claveCache];

    const persistente = leerCachePersistente(claveCache);
    if (persistente) {
      cache[claveCache] = persistente;
      return persistente;
    }

    try {
      const url = `${BACKEND_URL}/api/liga/${codigoLiga}/standings`;
      const resp = await fetch(url);
      const datos = await resp.json();
      const tabla = datos.standings?.find(s => s.type === 'TOTAL')?.table || [];
      const tablaHome = datos.standings?.find(s => s.type === 'HOME')?.table || [];
      const tablaAway = datos.standings?.find(s => s.type === 'AWAY')?.table || [];

      function procesarContexto(tablaContexto) {
        let sumaFavor = 0, sumaContra = 0, sumaPartidos = 0;
        const mapaContexto = {};
        tablaContexto.forEach(fila => {
          const tieneGoles = typeof fila.goalsFor === 'number' && typeof fila.goalsAgainst === 'number' && fila.playedGames > 0;
          if (tieneGoles) {
            sumaFavor += fila.goalsFor;
            sumaContra += fila.goalsAgainst;
            sumaPartidos += fila.playedGames;
            mapaContexto[fila.team.id] = {
              golesFavorPorPartido: fila.goalsFor / fila.playedGames,
              golesContraPorPartido: fila.goalsAgainst / fila.playedGames,
              partidosJugados: fila.playedGames
            };
          }
        });
        return {
          mapa: mapaContexto,
          promedioGolesFavor: sumaPartidos > 0 ? sumaFavor / sumaPartidos : null,
          promedioGolesContra: sumaPartidos > 0 ? sumaContra / sumaPartidos : null
        };
      }
      const contextoLocal = procesarContexto(tablaHome);
      const contextoVisita = procesarContexto(tablaAway);

      const mapa = {};
      let sumaPuntosPorPartido = 0;
      let sumaGolesFavor = 0, sumaGolesContra = 0, sumaPartidosParaGoles = 0;
      let hayDatosGoles = true;

      tabla.forEach(fila => {
        const ppp = fila.playedGames > 0 ? fila.points / fila.playedGames : 1;
        sumaPuntosPorPartido += ppp;

        const tieneGoles = typeof fila.goalsFor === 'number' && typeof fila.goalsAgainst === 'number' && fila.playedGames > 0;
        if (tieneGoles) {
          sumaGolesFavor += fila.goalsFor;
          sumaGolesContra += fila.goalsAgainst;
          sumaPartidosParaGoles += fila.playedGames;
        } else {
          hayDatosGoles = false;
        }

        mapa[fila.team.id] = {
          posicion: fila.position,
          puntosPorPartido: ppp,
          totalEquipos: tabla.length,
          partidosJugados: fila.playedGames || 0,
          golesFavorPorPartido: tieneGoles ? fila.goalsFor / fila.playedGames : null,
          golesContraPorPartido: tieneGoles ? fila.goalsAgainst / fila.playedGames : null
        };
      });

      const promedioLigaPuntos = tabla.length > 0 ? sumaPuntosPorPartido / tabla.length : 1.3;
      const promedioLigaGolesFavor = (hayDatosGoles && sumaPartidosParaGoles > 0) ? sumaGolesFavor / sumaPartidosParaGoles : null;
      const promedioLigaGolesContra = (hayDatosGoles && sumaPartidosParaGoles > 0) ? sumaGolesContra / sumaPartidosParaGoles : null;

      const resultado = { mapa, promedioLiga: promedioLigaPuntos, promedioLigaGolesFavor, promedioLigaGolesContra, contextoLocal, contextoVisita };
      cache[claveCache] = resultado;
      guardarCachePersistente(claveCache, resultado);
      return resultado;
    } catch (e) {
      console.warn("No se pudo obtener la tabla de posiciones", e);
      const vacio = { mapa: {}, promedioLiga: 1.3, promedioLigaGolesFavor: null, promedioLigaGolesContra: null, contextoLocal: { mapa: {}, promedioGolesFavor: null, promedioGolesContra: null }, contextoVisita: { mapa: {}, promedioGolesFavor: null, promedioGolesContra: null } };
      return vacio;
    }
  }

  // La amplitud del ajuste por tabla de posiciones se auto-calibra
  // (ver recalcularCalibracionTabla), comparando qué tan bien predice la
  // posición en la tabla el resultado real de tus partidos verificados.
  function factorTabla(tabla, teamId) {
    const info = tabla.mapa[teamId];
    if (!info || !tabla.promedioLiga) return 1;
    const ratio = info.puntosPorPartido / tabla.promedioLiga;
    const limite = calibracionActual.limiteTabla ?? LIMITE_TABLA_BASE;
    const desviacion = ratio - 1;
    return 1 + Math.max(-limite, Math.min(limite, desviacion));
  }

  // ============ FUERZA DE ATAQUE / DEFENSA RELATIVA A LA LIGA (temporada completa) ============
  // Complementa el promedio de partidos recientes: compara los goles reales de
  // cada equipo en la tabla de posiciones contra el promedio real de la liga esta
  // temporada (no un numero fijo), igual que hacen los modelos Dixon-Coles serios.
  function shrinkageHaciaUno(valor, partidosJugados) {
    const peso = Math.min(partidosJugados / PARTIDOS_CONFIANZA_PLENA, 1);
    return valor * peso + 1 * (1 - peso);
  }

  function fuerzaAtaqueDefensa(tabla, teamId) {
    const info = tabla.mapa[teamId];
    if (!info || !tabla.promedioLigaGolesFavor || !tabla.promedioLigaGolesContra || info.golesFavorPorPartido === null) {
      return { ataque: 1, defensa: 1 };
    }
    let ataque = info.golesFavorPorPartido / tabla.promedioLigaGolesFavor;
    let defensa = info.golesContraPorPartido / tabla.promedioLigaGolesContra;
    ataque = shrinkageHaciaUno(ataque, info.partidosJugados);
    defensa = shrinkageHaciaUno(defensa, info.partidosJugados);
    ataque = Math.max(0.5, Math.min(1.8, ataque));
    defensa = Math.max(0.5, Math.min(1.8, defensa));
    return { ataque, defensa };
  }

  // ============ "SIN NADA EN JUEGO" (titulo o descenso ya resueltos) ============
  // Heuristica: cerca del final de temporada (pocas fechas restantes), si un
  // equipo ya no puede alcanzar (ni ser alcanzado por) al rival mas cercano que
  // define su suerte -titulo o descenso- el partido pesa menos para el modelo:
  // suele haber mas rotacion, mas relajo o, al reves, mas urgencia irregular del
  // rival. En ambos casos, la señal historica (goles, tabla) es menos confiable.
  function construirRankingTabla(tabla) {
    return Object.entries(tabla.mapa)
      .map(([id, info]) => ({ id: Number(id), ...info }))
      .filter(f => f.posicion)
      .sort((a, b) => a.posicion - b.posicion);
  }

  function equipoSinNadaEnJuego(tabla, teamId) {
    const info = tabla.mapa[teamId];
    if (!info || !info.partidosJugados || !info.totalEquipos) return false;

    const ranking = construirRankingTabla(tabla);
    const totalEquipos = info.totalEquipos;
    if (totalEquipos < 10) return false;

    const partidosTotalesTemporada = (totalEquipos - 1) * 2;
    const restantes = Math.max(0, partidosTotalesTemporada - info.partidosJugados);
    if (restantes === 0 || restantes > 6) return false;

    const puntosEquipo = Math.round(info.puntosPorPartido * info.partidosJugados);
    const margenMax = restantes * 3;

    if (info.posicion === 1) {
      const segundo = ranking.find(r => r.posicion === 2);
      if (segundo) {
        const puntosSegundo = Math.round(segundo.puntosPorPartido * segundo.partidosJugados);
        if (puntosEquipo - puntosSegundo > margenMax) return true;
      }
    }

    const numDescenso = Math.max(1, Math.round(totalEquipos * 0.15));
    const posicionCorteDescenso = totalEquipos - numDescenso;
    if (info.posicion > posicionCorteDescenso) {
      const salvacion = ranking.find(r => r.posicion === posicionCorteDescenso);
      if (salvacion) {
        const puntosSalvacion = Math.round(salvacion.puntosPorPartido * salvacion.partidosJugados);
        if (puntosSalvacion - puntosEquipo > margenMax) return true;
      }
    }

    return false;
  }

  function badgePosicion(tabla, teamId) {
    const info = tabla.mapa[teamId];
    if (!info) return '';
    return `<span class="badge-posicion">#${info.posicion}</span>`;
  }

  // ============ PROMEDIO DE GOLES POR LIGA ============
  const PROMEDIO_GOLES_POR_LIGA = {
    PL: 1.45, PD: 1.35, BL1: 1.55, SA: 1.30, FL1: 1.40, CL: 1.40,
    DED: 1.60, ELC: 1.30, BSA: 1.25, PPL: 1.35, DEFAULT: 1.40
  };

  function promedioLiga(codigoLiga) {
    return PROMEDIO_GOLES_POR_LIGA[codigoLiga] ?? PROMEDIO_GOLES_POR_LIGA.DEFAULT;
  }

  // ============ CONFIABILIDAD DE LA DATA (shrinkage bayesiano) ============
  const PARTIDOS_CONFIANZA_PLENA = 10;
  const PARTIDOS_MINIMOS_CONFIABLES = 5;

  function aplicarShrinkage(valor, partidosJugados, promedioLigaEquipo) {
    const peso = Math.min(partidosJugados / PARTIDOS_CONFIANZA_PLENA, 1);
    return valor * peso + promedioLigaEquipo * (1 - peso);
  }

  // ============ PONDERACION POR RECENCIA (por dias reales, no por orden de lista) ============
  function pesosRecenciaPorFecha(registros, fechaReferencia = new Date()) {
    const VIDA_MEDIA_DIAS = 45; // a los 45 dias el peso de un partido cae a la mitad
    return registros.map(r => {
      const dias = Math.max(0, (fechaReferencia - new Date(r.fecha)) / (1000 * 60 * 60 * 24));
      return Math.pow(0.5, dias / VIDA_MEDIA_DIAS);
    });
  }

  // ============ AJUSTE POR FUERZA DEL RIVAL (opponent-adjusted goals) ============
  function factorFuerzaRival(tabla, rivalId, ladoRival) {
    const info = tabla.mapa[rivalId];
    if (!info) return 1;
    if (ladoRival === 'defensa') {
      if (info.golesContraPorPartido === null || !tabla.promedioLigaGolesContra) return 1;
      // el rival concede menos que el promedio -> anotarle vale mas
      const ratio = tabla.promedioLigaGolesContra / Math.max(info.golesContraPorPartido, 0.15);
      return Math.max(0.65, Math.min(1.5, ratio));
    } else {
      if (info.golesFavorPorPartido === null || !tabla.promedioLigaGolesFavor) return 1;
      // el rival ataca mas que el promedio -> que te haga un gol pesa menos en tu contra
      const ratio = tabla.promedioLigaGolesFavor / Math.max(info.golesFavorPorPartido, 0.15);
      return Math.max(0.65, Math.min(1.5, ratio));
    }
  }

  function golAjustado(golCrudo, factor) {
    // mezcla 50/50 con el gol crudo para no sobre-corregir con muestras chicas
    return golCrudo * (0.5 + 0.5 * factor);
  }

  function promedioPonderado(valores, pesos) {
    if (valores.length === 0) return 0;
    let sumaValores = 0, sumaPesos = 0;
    for (let i = 0; i < valores.length; i++) {
      sumaValores += valores[i] * pesos[i];
      sumaPesos += pesos[i];
    }
    return sumaPesos > 0 ? sumaValores / sumaPesos : 0;
  }

  // ============ RACHA / TENDENCIA RECIENTE ============
  function calcularTendencia(partidosOrdenados, teamId) {
    if (partidosOrdenados.length < 4) return { direccion: 'neutral', racha: [] };

    const puntosPorPartido = partidosOrdenados.map(p => {
      const esLocal = p.homeTeam.id === teamId;
      const golesEquipo = (esLocal ? p.score.fullTime.home : p.score.fullTime.away) ?? 0;
      const golesRival = (esLocal ? p.score.fullTime.away : p.score.fullTime.home) ?? 0;
      if (golesEquipo > golesRival) return { pts: 3, r: 'G' };
      if (golesEquipo === golesRival) return { pts: 1, r: 'E' };
      return { pts: 0, r: 'P' };
    });

    const mitad = Math.floor(puntosPorPartido.length / 2);
    const recientes = puntosPorPartido.slice(0, mitad);
    const antiguos = puntosPorPartido.slice(mitad);

    const promRecientes = recientes.reduce((a, b) => a + b.pts, 0) / recientes.length;
    const promAntiguos = antiguos.reduce((a, b) => a + b.pts, 0) / antiguos.length;

    let direccion = 'neutral';
    if (promRecientes - promAntiguos >= 0.5) direccion = 'subiendo';
    else if (promAntiguos - promRecientes >= 0.5) direccion = 'bajando';

    const racha = puntosPorPartido.slice(0, 5).reverse().map(x => x.r);

    return { direccion, racha };
  }

  function factorTendencia(direccion) {
    if (direccion === 'subiendo') return 1.03;
    if (direccion === 'bajando') return 0.97;
    return 1;
  }

  function factorDescanso(dias) {
    if (dias === null || dias === undefined) return 1;
    if (dias <= 3) return 0.99;   // poco descanso -> pequeña penalización
    if (dias >= 8) return 1.01;   // bien descansado -> leve impulso
    return 1;
  }

  async function obtenerStatsEquipo(teamId, codigoLiga, tabla) {
    const claveCache = `stats-${teamId}`;
    if (cache[claveCache]) return cache[claveCache];

    const persistente = leerCachePersistente(claveCache);
    if (persistente) {
      cache[claveCache] = persistente;
      return persistente;
    }

    try {
      const url = `${BACKEND_URL}/api/equipo/${teamId}/stats`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Stats equipo no disponibles (HTTP ' + resp.status + ')');
      const datos = await resp.json();
      const partidos = datos.matches || [];

      const partidosOrdenados = [...partidos].sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));

      const diasDescansoUltimoPartido = partidosOrdenados.length > 0
        ? (Date.now() - new Date(partidosOrdenados[0].utcDate)) / (1000 * 60 * 60 * 24)
        : null;

      let victorias = 0, empates = 0, derrotas = 0;
      const registrosTodos = [], registrosLocal = [], registrosVisita = [];

      partidosOrdenados.forEach(p => {
        const esLocal = p.homeTeam.id === teamId;
        const rivalId = esLocal ? p.awayTeam.id : p.homeTeam.id;
        const golesEquipoCrudo = (esLocal ? p.score.fullTime.home : p.score.fullTime.away) ?? 0;
        const golesRivalCrudo = (esLocal ? p.score.fullTime.away : p.score.fullTime.home) ?? 0;

        if (golesEquipoCrudo > golesRivalCrudo) victorias++;
        else if (golesEquipoCrudo === golesRivalCrudo) empates++;
        else derrotas++;

        // Un gol contra una defensa solida vale mas; un gol recibido de un ataque
        // flojo pesa mas en contra tuya. Sin tabla disponible, factor neutro (1).
        const fDefensaRival = tabla ? factorFuerzaRival(tabla, rivalId, 'defensa') : 1;
        const fAtaqueRival = tabla ? factorFuerzaRival(tabla, rivalId, 'ataque') : 1;

        const registro = {
          favor: golAjustado(golesEquipoCrudo, fDefensaRival),
          contra: golAjustado(golesRivalCrudo, fAtaqueRival),
          fecha: p.utcDate
        };
        registrosTodos.push(registro);
        (esLocal ? registrosLocal : registrosVisita).push(registro);
      });

      const cantidad = partidosOrdenados.length || 1;
      const pesosTodos = pesosRecenciaPorFecha(registrosTodos);
      const pesosLocal = pesosRecenciaPorFecha(registrosLocal);
      const pesosVisita = pesosRecenciaPorFecha(registrosVisita);

      const promTodosFavor = promedioPonderado(registrosTodos.map(r => r.favor), pesosTodos);
      const promTodosContra = promedioPonderado(registrosTodos.map(r => r.contra), pesosTodos);

      const promLocalFavorCrudo = registrosLocal.length > 0 ? promedioPonderado(registrosLocal.map(r => r.favor), pesosLocal) : promTodosFavor;
      const promLocalContraCrudo = registrosLocal.length > 0 ? promedioPonderado(registrosLocal.map(r => r.contra), pesosLocal) : promTodosContra;
      const promVisitaFavorCrudo = registrosVisita.length > 0 ? promedioPonderado(registrosVisita.map(r => r.favor), pesosVisita) : promTodosFavor;
      const promVisitaContraCrudo = registrosVisita.length > 0 ? promedioPonderado(registrosVisita.map(r => r.contra), pesosVisita) : promTodosContra;

      const promLigaVal = promedioLiga(codigoLiga);
      const promLocalFavor = aplicarShrinkage(promLocalFavorCrudo, registrosLocal.length, promLigaVal);
      const promLocalContra = aplicarShrinkage(promLocalContraCrudo, registrosLocal.length, promLigaVal);
      const promVisitaFavor = aplicarShrinkage(promVisitaFavorCrudo, registrosVisita.length, promLigaVal);
      const promVisitaContra = aplicarShrinkage(promVisitaContraCrudo, registrosVisita.length, promLigaVal);

      const tendencia = calcularTendencia(partidosOrdenados, teamId);

      const stats = {
        promedioGolesFavor: promTodosFavor,
        promedioGolesContra: promTodosContra,
        puntosPromedio: (victorias * 3 + empates) / cantidad,
        partidosJugados: partidosOrdenados.length,
        local: { golesFavor: promLocalFavor, golesContra: promLocalContra },
        visita: { golesFavor: promVisitaFavor, golesContra: promVisitaContra },
        tendencia,
        diasDescansoUltimoPartido
      };

      cache[claveCache] = stats;
      guardarCachePersistente(claveCache, stats);
      return stats;
    } catch (e) {
      console.error("Error trayendo stats equipo", teamId, e);
      const fallback = { golesFavor: 1, golesContra: 1 };
      return { promedioGolesFavor: 1, promedioGolesContra: 1, puntosPromedio: 1, partidosJugados: 0, local: fallback, visita: fallback, tendencia: { direccion: 'neutral', racha: [] } };
    }
  }

  async function obtenerHeadToHead(partidoId) {
    const claveCache = `h2h-${partidoId}`;
    if (cache[claveCache]) return cache[claveCache];

    try {
      const url = `${BACKEND_URL}/api/partido/${partidoId}/h2h`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('H2H no disponible (HTTP ' + resp.status + ')');
      const datos = await resp.json();

      const h2h = datos.head2head;
      if (!h2h || !h2h.numberOfMatches) {
        const vacio = { disponible: false };
        cache[claveCache] = vacio;
        return vacio;
      }

      const resultado = {
        disponible: true,
        totalPartidos: h2h.numberOfMatches,
        victoriasLocal: h2h.homeTeam?.wins ?? 0,
        empates: h2h.homeTeam?.draws ?? 0,
        victoriasVisita: h2h.awayTeam?.wins ?? 0
      };

      cache[claveCache] = resultado;
      return resultado;
    } catch (e) {
      console.warn("H2H no disponible", e);
      const vacio = { disponible: false };
      cache[claveCache] = vacio;
      return vacio;
    }
  }

  // ============ MODELO DE POISSON ============
  function factorial(n) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function poisson(k, lambda) {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
  }

  const RHO_DIXON_COLES = -0.06;

  function tauDixonColes(golesLocal, golesVisita, lambdaLocal, lambdaVisita, rho) {
    if (golesLocal === 0 && golesVisita === 0) return 1 - (lambdaLocal * lambdaVisita * rho);
    if (golesLocal === 0 && golesVisita === 1) return 1 + (lambdaLocal * rho);
    if (golesLocal === 1 && golesVisita === 0) return 1 + (lambdaVisita * rho);
    if (golesLocal === 1 && golesVisita === 1) return 1 - rho;
    return 1;
  }

 function matrizMarcadores(lambdaLocal, lambdaVisita, maxGoles = 8, rho = RHO_DIXON_COLES) {
  const matriz = [];
  let sumaTotal = 0;
  for (let i = 0; i <= maxGoles; i++) {
    matriz[i] = [];
    for (let j = 0; j <= maxGoles; j++) {
      const base = poisson(i, lambdaLocal) * poisson(j, lambdaVisita);
      const ajustado = base * tauDixonColes(i, j, lambdaLocal, lambdaVisita, rho);
      matriz[i][j] = ajustado;
      sumaTotal += ajustado;
    }
  }
  for (let i = 0; i <= maxGoles; i++) {
    for (let j = 0; j <= maxGoles; j++) {
      matriz[i][j] = matriz[i][j] / sumaTotal;
    }
  }
  return matriz;
}

  const FACTOR_LOCALIA_BASE = 1.04; // localía realista: los promedios por equipo ya capturan casi toda la ventaja de local; el ajuste extra debe ser leve y no amplificar el ruido

  // ============ AUTO-CALIBRACION (usa tu propio historial de aciertos) ============
  const CLAVE_CALIBRACION = 'fulbito_calibracion';
  const MUESTRA_MINIMA_LOCALIA = 20;
  const MUESTRA_MINIMA_CATEGORIA = 15;
  const MUESTRA_MINIMA_LIGA = 8;
  const LIMITES_FACTOR_LOCALIA = [1.0, 1.25];
  const LIMITES_FACTOR_CATEGORIA = [0.75, 1.25];
  const LIMITES_FACTOR_LIGA = [0.85, 1.18];
  const MUESTRA_MINIMA_RHO = 40;
  const LIMITES_RHO = [-0.20, 0.05];
  const LIMITE_TABLA_BASE = 0.06;
  const LIMITES_LIMITE_TABLA = [0.03, 0.12];
  const MUESTRA_MINIMA_TABLA = 25;

  function calibracionPorDefecto() {
  return { factorLocalia: FACTOR_LOCALIA_BASE, muestrasLocalia: 0, rhoDixonColes: RHO_DIXON_COLES, muestrasRho: 0, limiteTabla: LIMITE_TABLA_BASE, muestrasTabla: 0, porCategoria: {}, porLiga: {}, actualizadoEn: null };
}

  function leerCalibracion() {
    try {
      const crudo = localStorage.getItem(CLAVE_CALIBRACION);
      return crudo ? JSON.parse(crudo) : calibracionPorDefecto();
    } catch (e) {
      return calibracionPorDefecto();
    }
  }

  function guardarCalibracion(calibracion) {
    try {
      localStorage.setItem(CLAVE_CALIBRACION, JSON.stringify(calibracion));
    } catch (e) {}
  }

  let calibracionActual = leerCalibracion();

  function recalcularCalibracionRho(verificados) {
    const conParametros = verificados.filter(h => h.parametrosModelo && h.marcadorFinal);
    let sumaBoostReal = 0, sumaBoostEsperado = 0, n = 0;

    conParametros.forEach(h => {
      const [gl, gv] = h.marcadorFinal.split('-').map(Number);
      const esBoost = (gl === 0 && gv === 0) || (gl === 1 && gv === 1);
      const esReduce = (gl === 1 && gv === 0) || (gl === 0 && gv === 1);
      if (!esBoost && !esReduce) return;

      const { lambdaLocal, lambdaVisita, rhoDixonColes } = h.parametrosModelo;
      const rho = rhoDixonColes ?? RHO_DIXON_COLES;
      const pBoost = poisson(0, lambdaLocal) * poisson(0, lambdaVisita) * (1 - lambdaLocal * lambdaVisita * rho)
        + poisson(1, lambdaLocal) * poisson(1, lambdaVisita) * (1 - rho);
      const pReduce = poisson(0, lambdaLocal) * poisson(1, lambdaVisita) * (1 + lambdaLocal * rho)
        + poisson(1, lambdaLocal) * poisson(0, lambdaVisita) * (1 + lambdaVisita * rho);
      const total = pBoost + pReduce;

      n++;
      sumaBoostReal += esBoost ? 1 : 0;
      sumaBoostEsperado += total > 0 ? (pBoost / total) : 0.5;
    });

    if (n < MUESTRA_MINIMA_RHO) return null;

    const diferencia = (sumaBoostReal / n) - (sumaBoostEsperado / n);
    let nuevoRho = (calibracionActual.rhoDixonColes ?? RHO_DIXON_COLES) - diferencia * 0.3;
    nuevoRho = Math.max(LIMITES_RHO[0], Math.min(LIMITES_RHO[1], nuevoRho));
    return { rho: Math.round(nuevoRho * 1000) / 1000, muestras: n };
  }

  // Compara, en partidos verificados donde la tabla de posiciones claramente
  // favorecía a un lado, si ese lado terminó ganando de verdad. Si el acierto
  // de dirección se aleja bastante de 50% (el azar), la señal de la tabla es
  // confiable y ampliamos el límite; si está cerca de 50%, lo reducimos.
  function recalcularCalibracionTabla(verificados) {
    const conParametros = verificados.filter(h => h.parametrosModelo?.tablaInfo && h.marcadorFinal);
    let aciertosDireccion = 0, totalConSenal = 0;

    conParametros.forEach(h => {
      const { fLocal, fVisita } = h.parametrosModelo.tablaInfo;
      const desviacion = fLocal - fVisita;
      if (Math.abs(desviacion) < 0.015) return;

      const [gl, gv] = h.marcadorFinal.split('-').map(Number);
      if (gl === gv) return;

      totalConSenal++;
      const favoreceLocal = desviacion > 0;
      const ganoLocal = gl > gv;
      if (favoreceLocal === ganoLocal) aciertosDireccion++;
    });

    if (totalConSenal < MUESTRA_MINIMA_TABLA) return null;

    const tasaAcierto = aciertosDireccion / totalConSenal;
    const señal = (tasaAcierto - 0.5) * 2;
    let nuevoLimite = LIMITE_TABLA_BASE * (1 + señal * 1.5);
    nuevoLimite = Math.max(LIMITES_LIMITE_TABLA[0], Math.min(LIMITES_LIMITE_TABLA[1], nuevoLimite));
    return { limite: Math.round(nuevoLimite * 1000) / 1000, muestras: totalConSenal };
  }

  function recalcularCalibracion() {
    const verificados = leerHistorial().filter(h => h.verificado && h.marcadorFinal && h.parametrosModelo);
    const calibracion = calibracionPorDefecto();

    if (verificados.length >= MUESTRA_MINIMA_LOCALIA) {
      let sumaDifReal = 0, sumaDifModeloNeutral = 0, sumaLambdaLocalNeutral = 0;
      verificados.forEach(h => {
        const [gl, gv] = h.marcadorFinal.split('-').map(Number);
        const factorUsado = h.parametrosModelo.factorLocalia || FACTOR_LOCALIA_BASE;
        const lambdaLocalNeutral = h.parametrosModelo.lambdaLocal / factorUsado;
        sumaDifReal += (gl - gv);
        sumaDifModeloNeutral += (lambdaLocalNeutral - h.parametrosModelo.lambdaVisita);
        sumaLambdaLocalNeutral += lambdaLocalNeutral;
      });
      const n = verificados.length;
      const ventajaLocaliaReal = (sumaDifReal / n) - (sumaDifModeloNeutral / n);
      const lambdaLocalNeutralProm = Math.max(sumaLambdaLocalNeutral / n, 0.5);
      let factorSugerido = 1 + (ventajaLocaliaReal / lambdaLocalNeutralProm);
      factorSugerido = Math.max(LIMITES_FACTOR_LOCALIA[0], Math.min(LIMITES_FACTOR_LOCALIA[1], factorSugerido));
      calibracion.factorLocalia = Math.round(factorSugerido * 1000) / 1000;
      calibracion.muestrasLocalia = n;
    }

    const acumulado = {};
    const acumuladoLiga = {};
    verificados.forEach(h => {
      const liga = h.codigoLiga || 'DEFAULT';
      if (!acumuladoLiga[liga]) acumuladoLiga[liga] = { sumaPredicha: 0, aciertos: 0, total: 0 };

      h.mercados.forEach(m => {
        if (!acumulado[m.categoria]) acumulado[m.categoria] = { sumaPredicha: 0, aciertos: 0, total: 0 };
        acumulado[m.categoria].sumaPredicha += m.probabilidad / 100;
        acumulado[m.categoria].total++;
        if (m.acierto) acumulado[m.categoria].aciertos++;

        acumuladoLiga[liga].sumaPredicha += m.probabilidad / 100;
        acumuladoLiga[liga].total++;
        if (m.acierto) acumuladoLiga[liga].aciertos++;
      });
    });
    Object.keys(acumulado).forEach(cat => {
      const d = acumulado[cat];
      if (d.total < MUESTRA_MINIMA_CATEGORIA) return;
      const predichoProm = d.sumaPredicha / d.total;
      const realProm = d.aciertos / d.total;
      if (predichoProm <= 0) return;
      let factor = realProm / predichoProm;
      factor = Math.max(LIMITES_FACTOR_CATEGORIA[0], Math.min(LIMITES_FACTOR_CATEGORIA[1], factor));
      calibracion.porCategoria[cat] = { factor: Math.round(factor * 1000) / 1000, muestras: d.total };
    });

    Object.keys(acumuladoLiga).forEach(liga => {
      const d = acumuladoLiga[liga];
      if (d.total < MUESTRA_MINIMA_LIGA) return;
      const predichoProm = d.sumaPredicha / d.total;
      const realProm = d.aciertos / d.total;
      if (predichoProm <= 0) return;
      let factor = realProm / predichoProm;
      factor = Math.max(LIMITES_FACTOR_LIGA[0], Math.min(LIMITES_FACTOR_LIGA[1], factor));
      calibracion.porLiga[liga] = { factor: Math.round(factor * 1000) / 1000, muestras: d.total };
    });

    const resultadoRho = recalcularCalibracionRho(verificados);
    if (resultadoRho) {
      calibracion.rhoDixonColes = resultadoRho.rho;
      calibracion.muestrasRho = resultadoRho.muestras;
    }

    const resultadoTabla = recalcularCalibracionTabla(verificados);
    if (resultadoTabla) {
      calibracion.limiteTabla = resultadoTabla.limite;
      calibracion.muestrasTabla = resultadoTabla.muestras;
    }

    calibracion.actualizadoEn = Date.now();
    guardarCalibracion(calibracion);
    calibracionActual = calibracion;
    return calibracion;
  }

  async function actualizarHistorialYCalibracion() {
    const historial = await actualizarHistorialConResultados();
    recalcularCalibracion();
    actualizarContadorMisPredicciones();
    return historial;
  }

  function factorH2H(h2h, esLocal) {
    if (!h2h || !h2h.disponible || h2h.totalPartidos < 5) return 1;

    const total = h2h.totalPartidos;
    const dominioLocal = (h2h.victoriasLocal - h2h.victoriasVisita) / total;
    const ajusteMax = 0.04;
    const ajuste = Math.max(-ajusteMax, Math.min(ajusteMax, dominioLocal * ajusteMax * 2));

    return esLocal ? (1 + ajuste) : (1 - ajuste);
  }

  // ============ BANCO DE MERCADOS (dinamico por partido) ============
  const CATEGORIAS_MERCADO = {
    resultado:   { titulo: 'Resultado',        mercado: '1X2' },
    doble:       { titulo: 'Doble Opción',     mercado: 'Doble oportunidad' },
    totalgoles:  { titulo: 'Total de Goles',   mercado: 'Total de goles' },
    btts:        { titulo: 'Ambos Anotan',     mercado: 'Ambos equipos anotan' },
    equipomarca: { titulo: 'Equipo Marca',     mercado: 'Equipo marca' },
    handicap:    { titulo: 'Hándicap',         mercado: 'Hándicap asiático' },
    marcador:    { titulo: 'Marcador Exacto',  mercado: 'Resultado exacto' }
  };

  function sumaMatriz(matriz, maxGoles, condicion) {
    let s = 0;
    for (let i = 0; i <= maxGoles; i++) {
      for (let j = 0; j <= maxGoles; j++) {
        if (condicion(i, j)) s += matriz[i][j];
      }
    }
    return s;
  }

  function verificarMercado(categoria, parametros, golesLocal, golesVisita) {
    switch (categoria) {
      case 'resultado':
        if (parametros.lado === 'local') return golesLocal > golesVisita;
        if (parametros.lado === 'visita') return golesVisita > golesLocal;
        return golesLocal === golesVisita;
      case 'doble':
        if (parametros.lado === '1X') return golesLocal >= golesVisita;
        if (parametros.lado === 'X2') return golesVisita >= golesLocal;
        return golesLocal !== golesVisita;
      case 'totalgoles': {
        const total = golesLocal + golesVisita;
        return parametros.direccion === 'menos' ? total < parametros.linea : total > parametros.linea;
      }
      case 'btts': {
        const ambos = golesLocal >= 1 && golesVisita >= 1;
        return parametros.si ? ambos : !ambos;
      }
      case 'equipomarca':
        return parametros.lado === 'local' ? golesLocal >= 1 : golesVisita >= 1;
      case 'handicap': {
        const margen = parametros.lado === 'local' ? (golesLocal - golesVisita) : (golesVisita - golesLocal);
        return margen >= parametros.valor;
      }
      case 'marcador':
        return golesLocal === parametros.gl && golesVisita === parametros.gv;
      default:
        return false;
    }
  }

  function generarCandidatosMercado(matriz, maxGoles, nombreLocal, nombreVisita) {
    const candidatos = [];

    const pLocal = sumaMatriz(matriz, maxGoles, (i, j) => i > j);
    const pEmpate = sumaMatriz(matriz, maxGoles, (i, j) => i === j);
    const pVisita = sumaMatriz(matriz, maxGoles, (i, j) => i < j);

    candidatos.push({ categoria: 'resultado', parametros: { lado: 'local' }, seleccion: `Gana ${nombreLocal}`, probabilidad: pLocal });
    candidatos.push({ categoria: 'resultado', parametros: { lado: 'empate' }, seleccion: `Empate`, probabilidad: pEmpate });
    candidatos.push({ categoria: 'resultado', parametros: { lado: 'visita' }, seleccion: `Gana ${nombreVisita}`, probabilidad: pVisita });

    candidatos.push({ categoria: 'doble', parametros: { lado: '1X' }, seleccion: `${nombreLocal} o Empate (1X)`, probabilidad: pLocal + pEmpate });
    candidatos.push({ categoria: 'doble', parametros: { lado: 'X2' }, seleccion: `${nombreVisita} o Empate (X2)`, probabilidad: pVisita + pEmpate });
    candidatos.push({ categoria: 'doble', parametros: { lado: '12' }, seleccion: `${nombreLocal} o ${nombreVisita} (12)`, probabilidad: pLocal + pVisita });

    [1.5, 2.5, 3.5].forEach(linea => {
      const pMenos = sumaMatriz(matriz, maxGoles, (i, j) => (i + j) < linea);
      const pMas = sumaMatriz(matriz, maxGoles, (i, j) => (i + j) > linea);
      candidatos.push({ categoria: 'totalgoles', parametros: { linea, direccion: 'menos' }, seleccion: `Menos de ${linea} goles`, probabilidad: pMenos });
      candidatos.push({ categoria: 'totalgoles', parametros: { linea, direccion: 'mas' }, seleccion: `Más de ${linea} goles`, probabilidad: pMas });
    });

    const pBttsSi = sumaMatriz(matriz, maxGoles, (i, j) => i >= 1 && j >= 1);
    candidatos.push({ categoria: 'btts', parametros: { si: true }, seleccion: `Ambos anotan: Sí`, probabilidad: pBttsSi });
    candidatos.push({ categoria: 'btts', parametros: { si: false }, seleccion: `Ambos anotan: No`, probabilidad: 1 - pBttsSi });

    const pLocalMarca = sumaMatriz(matriz, maxGoles, (i) => i >= 1);
    const pVisitaMarca = sumaMatriz(matriz, maxGoles, (i, j) => j >= 1);
    candidatos.push({ categoria: 'equipomarca', parametros: { lado: 'local' }, seleccion: `${nombreLocal} marca`, probabilidad: pLocalMarca });
    candidatos.push({ categoria: 'equipomarca', parametros: { lado: 'visita' }, seleccion: `${nombreVisita} marca`, probabilidad: pVisitaMarca });

    const favoritoLocal = pLocal >= pVisita;
    const nombreFavorito = favoritoLocal ? nombreLocal : nombreVisita;
    const ladoFavorito = favoritoLocal ? 'local' : 'visita';
    const pHandicap1 = sumaMatriz(matriz, maxGoles, (i, j) => (favoritoLocal ? (i - j) : (j - i)) >= 2);
    const pHandicap2 = sumaMatriz(matriz, maxGoles, (i, j) => (favoritoLocal ? (i - j) : (j - i)) >= 3);
    candidatos.push({ categoria: 'handicap', parametros: { lado: ladoFavorito, valor: 2 }, seleccion: `${nombreFavorito} -1 (gana por 2+)`, probabilidad: pHandicap1 });
    candidatos.push({ categoria: 'handicap', parametros: { lado: ladoFavorito, valor: 3 }, seleccion: `${nombreFavorito} -2 (gana por 3+)`, probabilidad: pHandicap2 });

    let celdas = [];
    for (let i = 0; i <= maxGoles; i++) {
      for (let j = 0; j <= maxGoles; j++) {
        celdas.push({ i, j, p: matriz[i][j] });
      }
    }
    celdas.sort((a, b) => b.p - a.p);
    const marcadorTop = celdas[0];
    const top3Marcadores = celdas.slice(0, 3).map(c => ({ marcador: `${c.i}-${c.j}`, probabilidad: Math.round(c.p * 100) }));

    candidatos.push({ categoria: 'marcador', parametros: { gl: marcadorTop.i, gv: marcadorTop.j }, seleccion: `${marcadorTop.i}-${marcadorTop.j}`, probabilidad: marcadorTop.p });

    return {
      candidatos,
      marcadorProbable: `${marcadorTop.i}-${marcadorTop.j}`,
      probMarcador: marcadorTop.p,
      top3Marcadores,
      favoritoLocal,
      nombreFavorito
    };
  }

  // En vez de un ajuste fijo por categoría, comparamos cada par de mercados de la
  // misma familia según qué tan parejo/desigual está ESE partido. Así el mercado que
  // se muestra realmente varía según el partido, no siempre gana el mismo por defecto.
  function seleccionarMercados(candidatos, cantidad) {
    const seleccionados = [];

    // --- Familia "ganador": Resultado directo vs Doble Oportunidad ---
    const mejorResultado = candidatos
      .filter(c => c.categoria === 'resultado')
      .sort((a, b) => b.probabilidad - a.probabilidad)[0];
    const mejorDoble = candidatos
      .filter(c => c.categoria === 'doble')
      .sort((a, b) => b.probabilidad - a.probabilidad)[0];

    if (mejorResultado && mejorDoble) {
      const relacionada = mejorResultado.parametros.lado === 'local' ? '1X'
        : mejorResultado.parametros.lado === 'visita' ? 'X2' : null;
      const dobleRelacionada = relacionada
        ? candidatos.find(c => c.categoria === 'doble' && c.parametros.lado === relacionada)
        : null;
      // Si el resultado directo se acerca bastante a su doble oportunidad relacionada,
      // hay un favorito claro -> mostramos el resultado directo (más informativo).
      // Si no, el partido está parejo -> tiene más sentido la doble oportunidad.
      const ratio = dobleRelacionada ? mejorResultado.probabilidad / dobleRelacionada.probabilidad : 0;
      seleccionados.push(ratio >= 0.62 ? mejorResultado : mejorDoble);
    } else {
      seleccionados.push(mejorResultado || mejorDoble);
    }

    // --- Familia "goles": Total de Goles vs Ambos Anotan ---
    const mejorGoles = candidatos
      .filter(c => c.categoria === 'totalgoles' || c.categoria === 'btts')
      .map(c => ({ c, score: c.probabilidad + (c.categoria === 'btts' ? -0.03 : 0) }))
      .sort((a, b) => b.score - a.score)[0];
    if (mejorGoles) seleccionados.push(mejorGoles.c);

    // --- Familia "goleador": Equipo Marca vs Hándicap ---
    const mejorHandicap = candidatos
      .filter(c => c.categoria === 'handicap')
      .sort((a, b) => b.probabilidad - a.probabilidad)[0];
    const mejorEquipoMarca = candidatos
      .filter(c => c.categoria === 'equipomarca')
      .sort((a, b) => b.probabilidad - a.probabilidad)[0];
    if (mejorHandicap && mejorEquipoMarca) {
      // Si el favorito tiene una probabilidad decente de ganar por 2+, ese dato es
      // más interesante que "el equipo marca" (que casi siempre es altísimo igual).
      seleccionados.push(mejorHandicap.probabilidad >= 0.32 ? mejorHandicap : mejorEquipoMarca);
    } else {
      seleccionados.push(mejorHandicap || mejorEquipoMarca);
    }

    // --- Marcador exacto: ya varía solo según el partido ---
    const mejorMarcador = candidatos.filter(c => c.categoria === 'marcador')[0];
    if (mejorMarcador) seleccionados.push(mejorMarcador);

    if (seleccionados.length < cantidad) {
      const usadas = new Set(seleccionados.map(c => c.categoria));
      const ordenados = [...candidatos].sort((a, b) => b.probabilidad - a.probabilidad);
      for (const c of ordenados) {
        if (usadas.has(c.categoria)) continue;
        usadas.add(c.categoria);
        seleccionados.push(c);
        if (seleccionados.length >= cantidad) break;
      }
    }
    return seleccionados.slice(0, cantidad);
  }

  function razonesParaMercado(m, ctx) {
    const razones = [];
    const favoreceLocal = m.seleccion.includes(ctx.nombreLocal) && !m.seleccion.includes(ctx.nombreVisita);
    const favoreceVisita = m.seleccion.includes(ctx.nombreVisita) && !m.seleccion.includes(ctx.nombreLocal);

    if (favoreceLocal) {
      razones.push(`${ctx.nombreLocal} promedia ${ctx.statsLocal.local.golesFavor.toFixed(1)} goles a favor jugando de local.`);
      if (ctx.statsLocal.tendencia.direccion === 'subiendo') razones.push(`${ctx.nombreLocal} viene en alza en sus últimos partidos.`);
    } else if (favoreceVisita) {
      razones.push(`${ctx.nombreVisita} promedia ${ctx.statsVisita.visita.golesFavor.toFixed(1)} goles a favor jugando de visita.`);
      if (ctx.statsVisita.tendencia.direccion === 'subiendo') razones.push(`${ctx.nombreVisita} viene en alza en sus últimos partidos.`);
    }

    const fLocal = factorTabla(ctx.tabla, ctx.idLocal);
    const fVisita = factorTabla(ctx.tabla, ctx.idVisita);
    if (Math.abs(fLocal - 1) > 0.05 || Math.abs(fVisita - 1) > 0.05) {
      const mejorUbicado = fLocal > fVisita ? ctx.nombreLocal : ctx.nombreVisita;
      razones.push(`${mejorUbicado} está mejor ubicado en la tabla de posiciones.`);
    }

    if (ctx.h2h && ctx.h2h.disponible && ctx.h2h.totalPartidos >= 3) {
      if (ctx.h2h.victoriasLocal > ctx.h2h.victoriasVisita) razones.push(`El historial directo favorece a ${ctx.nombreLocal} (${ctx.h2h.victoriasLocal}V-${ctx.h2h.empates}E-${ctx.h2h.victoriasVisita}V).`);
      else if (ctx.h2h.victoriasVisita > ctx.h2h.victoriasLocal) razones.push(`El historial directo favorece a ${ctx.nombreVisita} (${ctx.h2h.victoriasVisita}V-${ctx.h2h.empates}E-${ctx.h2h.victoriasLocal}V).`);
    }

    if (razones.length === 0) razones.push(`Calculado con el modelo estadístico (Poisson + Dixon-Coles) según los datos disponibles.`);
    return razones.slice(0, 2);
  }

  function generarPronosticos(statsLocal, statsVisita, nombreLocal, nombreVisita, h2h, tabla, idLocal, idVisita, codigoLiga) {
  // Mejora: ajustar pesos por recencia y calibración
    let lambdaLocal = (statsLocal.local.golesFavor + statsVisita.visita.golesContra) / 2;
    let lambdaVisita = (statsVisita.visita.golesFavor + statsLocal.local.golesContra) / 2;
    const lambdaLocalBase = lambdaLocal;
    const lambdaVisitaBase = lambdaVisita;

    // Segundo estimador: fuerza de ataque/defensa de temporada completa (tabla de
    // posiciones, goles reales), como correccion moderada sobre el estimador de
    // partidos recientes de arriba. Raiz cuadrada para que sea un ajuste, no una
    // duplicacion de la señal.
    const fuerzaLocal = fuerzaAtaqueDefensa(tabla, idLocal);
    const fuerzaVisita = fuerzaAtaqueDefensa(tabla, idVisita);
    lambdaLocal *= Math.sqrt(fuerzaLocal.ataque * fuerzaVisita.defensa);
    lambdaVisita *= Math.sqrt(fuerzaVisita.ataque * fuerzaLocal.defensa);

    lambdaLocal *= factorTendencia(statsLocal.tendencia.direccion);
    lambdaVisita *= factorTendencia(statsVisita.tendencia.direccion);

    lambdaLocal *= factorDescanso(statsLocal.diasDescansoUltimoPartido);
    lambdaVisita *= factorDescanso(statsVisita.diasDescansoUltimoPartido);

    const factorLocaliaUsado = calibracionActual.factorLocalia || FACTOR_LOCALIA_BASE;
    lambdaLocal *= factorLocaliaUsado;

    const factorLigaUsado = calibracionActual.porLiga?.[codigoLiga]?.factor || 1;
    const factorLigaAjustado = Math.max(0.9, Math.min(1.1, factorLigaUsado));
    lambdaLocal *= factorLigaAjustado;
    lambdaVisita *= factorLigaAjustado;

    lambdaLocal *= factorH2H(h2h, true);
    lambdaVisita *= factorH2H(h2h, false);

    const fTablaLocal = factorTabla(tabla, idLocal);
    const fTablaVisita = factorTabla(tabla, idVisita);
    lambdaLocal *= fTablaLocal;
    lambdaVisita *= fTablaVisita;

    // Partidos donde uno de los dos equipos ya no se juega nada (titulo o descenso
    // matematicamente resuelto, a falta de pocas fechas): el modelo confia menos y
    // regresa los lambdas un poco hacia el promedio de la liga, ademas de exigir
    // mas probabilidad para mostrar un mercado como apostable (ver UMBRAL abajo).
    const sinNadaLocal = equipoSinNadaEnJuego(tabla, idLocal);
    const sinNadaVisita = equipoSinNadaEnJuego(tabla, idVisita);
    const partidoSinNadaEnJuego = sinNadaLocal || sinNadaVisita;
    if (partidoSinNadaEnJuego) {
      const promLigaGoles = promedioLiga(codigoLiga);
      lambdaLocal = lambdaLocal * 0.85 + promLigaGoles * 0.15;
      lambdaVisita = lambdaVisita * 0.85 + promLigaGoles * 0.15;
    }

    // Poca data del equipo (menos de PARTIDOS_MINIMOS_CONFIABLES partidos) -> el
    // modelo confía menos y regresa el lambda hacia el promedio de la liga, en
    // proporción a cuántos partidos hay disponibles (shrinkage bayesiano). Antes
    // esto solo se mostraba como aviso visual; ahora también afecta el cálculo.
    const partidosMinTemprano = Math.min(statsLocal.partidosJugados ?? 0, statsVisita.partidosJugados ?? 0);
    if (partidosMinTemprano < PARTIDOS_MINIMOS_CONFIABLES) {
      const promLigaGolesShrink = promedioLiga(codigoLiga);
      const pesoConfianza = Math.max(0.35, partidosMinTemprano / PARTIDOS_MINIMOS_CONFIABLES);
      lambdaLocal = lambdaLocal * pesoConfianza + promLigaGolesShrink * (1 - pesoConfianza);
      lambdaVisita = lambdaVisita * pesoConfianza + promLigaGolesShrink * (1 - pesoConfianza);
    }

    // Límite de deriva: varios ajustes pequeños se suman y pueden inflar el modelo.
    // En lugar de dejar que cada factor multiplique el volumen del partido, se
    // mezcla parcialmente con la base para conservar la señal real sin exagerarla.
    const LIMITE_DRIFT_LAMBDA = 0.28;
    lambdaLocal = Math.max(lambdaLocalBase * (1 - LIMITE_DRIFT_LAMBDA), Math.min(lambdaLocalBase * (1 + LIMITE_DRIFT_LAMBDA), lambdaLocal));
    lambdaVisita = Math.max(lambdaVisitaBase * (1 - LIMITE_DRIFT_LAMBDA), Math.min(lambdaVisitaBase * (1 + LIMITE_DRIFT_LAMBDA), lambdaVisita));

    const fuerzaBlend = partidoSinNadaEnJuego ? 0.52 : (partidosMinTemprano < PARTIDOS_MINIMOS_CONFIABLES ? 0.45 : 0.28);
    lambdaLocal = lambdaLocalBase * (1 - fuerzaBlend) + lambdaLocal * fuerzaBlend;
    lambdaVisita = lambdaVisitaBase * (1 - fuerzaBlend) + lambdaVisita * fuerzaBlend;

    lambdaLocal = Math.max(lambdaLocal, 0.3);
    lambdaVisita = Math.max(lambdaVisita, 0.3);

    const rhoUsado = calibracionActual.rhoDixonColes ?? RHO_DIXON_COLES;
    const matriz = matrizMarcadores(lambdaLocal, lambdaVisita, 8, rhoUsado);
    const maxGoles = matriz.length - 1;

    const { candidatos, marcadorProbable, probMarcador, top3Marcadores, favoritoLocal, nombreFavorito } =
      generarCandidatosMercado(matriz, maxGoles, nombreLocal, nombreVisita);

    const seleccionados = seleccionarMercados(candidatos, 4);
    const UMBRAL_MINIMO_MERCADO = partidoSinNadaEnJuego ? 0.62 : 0.55;
    const contextoRazones = { statsLocal, statsVisita, tabla, h2h, idLocal, idVisita, nombreLocal, nombreVisita };
    seleccionados.forEach(m => {
      m.tipo = m.categoria;
      m.titulo = CATEGORIAS_MERCADO[m.categoria].titulo;
      m.mercado = CATEGORIAS_MERCADO[m.categoria].mercado;
      m.razones = razonesParaMercado(m, contextoRazones);
    });

    const pares = [];
    for (let a = 0; a < seleccionados.length; a++) {
      for (let b = a + 1; b < seleccionados.length; b++) {
        const m1 = seleccionados[a], m2 = seleccionados[b];
        const pConjunta = sumaMatriz(matriz, maxGoles, (i, j) =>
          verificarMercado(m1.categoria, m1.parametros, i, j) &&
          verificarMercado(m2.categoria, m2.parametros, i, j)
        );
        pares.push({
          tipos: [m1.categoria, m2.categoria],
          partes: [m1.seleccion, m2.seleccion],
          probabilidad: Math.round(pConjunta * 100)
        });
      }
    }
    pares.sort((a, b) => b.probabilidad - a.probabilidad);
    const combosPartido = pares.slice(0, 2).map((p, idx) => ({
      titulo: idx === 0 ? 'Combinada segura' : 'Combinada extra',
      tipos: p.tipos, partes: p.partes, probabilidad: p.probabilidad
    }));

    const partidosMin = Math.min(statsLocal.partidosJugados ?? 0, statsVisita.partidosJugados ?? 0);
    const pocaData = partidosMin < PARTIDOS_MINIMOS_CONFIABLES;

    seleccionados.forEach(m => { m.sinApuesta = m.probabilidad < UMBRAL_MINIMO_MERCADO; });

    seleccionados.forEach(m => {
      const ajuste = calibracionActual.porCategoria[m.categoria]?.factor || 1;
      const suavizado = m.probabilidad < 0.5 ? 0.96 : 0.92;
      m.probabilidad = Math.min(0.92, Math.max(0.08, m.probabilidad * ajuste * suavizado));
    });
    seleccionados.forEach(m => { m.probabilidad = Math.round(m.probabilidad * 100); });

    const catalogoCompleto = candidatos
      .map(c => ({ seleccion: c.seleccion, probabilidad: Math.round(c.probabilidad * 100) }))
      .sort((a, b) => b.probabilidad - a.probabilidad);

    return {
      seleccionados,
      marcadorProbable, probMarcador: Math.round(probMarcador * 100),
      top3Marcadores, catalogoCompleto,
      combosPartido, partidosMin, pocaData,
      favoritoLocal, nombreFavorito,
      sinNadaEnJuego: partidoSinNadaEnJuego,
      parametrosModelo: {
        lambdaLocal: Math.round(lambdaLocal * 1000) / 1000,
        lambdaVisita: Math.round(lambdaVisita * 1000) / 1000,
        rhoDixonColes: rhoUsado,
        factorLocalia: factorLocaliaUsado,
        factorLiga: factorLigaUsado,
        tablaInfo: { fLocal: Math.round(fTablaLocal * 1000) / 1000, fVisita: Math.round(fTablaVisita * 1000) / 1000 }
      }
    };
  }

  // ============ MOTOR CANÓNICO (pronosticos.json oficial, con fallback JS) ============
  // El artefacto `pronosticos.json` se publica diariamente por el pipeline Python
  // (08:00 UTC) y es exactamente lo que la recalibración mide. Consumirlo primero
  // alinea lo que ve el usuario con lo que se evalúa; el cálculo client-side queda
  // solo como fallback offline o cuando el partido no está en el artefacto.
  let pronosticosOficialesCache = null;
  let pronosticosOficialesPromesa = null;
  let pronosticosOficialesCargadosEn = 0;
  const TTL_PRONOSTICOS_OFICIALES = 60 * 60 * 1000;

  function cargarPronosticosOficiales() {
    const ahora = Date.now();
    if (pronosticosOficialesCache && ahora - pronosticosOficialesCargadosEn < TTL_PRONOSTICOS_OFICIALES) {
      return Promise.resolve(pronosticosOficialesCache);
    }
    if (pronosticosOficialesPromesa) return pronosticosOficialesPromesa;
    pronosticosOficialesPromesa = fetch('pronosticos.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(datos => {
        pronosticosOficialesCache = datos;
        pronosticosOficialesCargadosEn = Date.now();
        return datos;
      })
      .catch(() => {
        pronosticosOficialesCache = null;
        pronosticosOficialesCargadosEn = 0;
        return null;
      })
      .finally(() => { pronosticosOficialesPromesa = null; });
    return pronosticosOficialesPromesa;
  }

  function normalizarPronosticosOficial(oficial) {
    const seleccionados = (oficial.seleccionados || []).map(m => ({
      ...m,
      tipo: m.categoria,
      titulo: (CATEGORIAS_MERCADO[m.categoria] || {}).titulo || m.seleccion,
      mercado: (CATEGORIAS_MERCADO[m.categoria] || {}).mercado || m.seleccion,
      razones: m.explicacion ? [m.explicacion] : []
    }));
    return {
      seleccionados,
      marcadorProbable: oficial.marcadorProbable || '—',
      probMarcador: oficial.probMarcador || 0,
      top3Marcadores: oficial.top3Marcadores || [],
      catalogoCompleto: oficial.catalogoCompleto || [],
      combosPartido: oficial.combosPartido || [],
      partidosMin: oficial.partidosMin ?? 0,
      pocaData: !!oficial.pocaData,
      sinNadaEnJuego: !!oficial.sinNadaEnJuego,
      favoritoLocal: !!oficial.favoritoLocal,
      nombreFavorito: oficial.nombreFavorito || null,
      parametrosModelo: oficial.parametrosModelo || null
    };
  }

  // Devuelve los pronósticos de un partido: oficial (Python) si existe en el
  // artefacto, o calculados client-side (JS) en caso contrario. `ctx` trae el
  // insumo ya cargado (stats/h2h/tabla) por si hace falta el fallback.
  async function obtenerPronosticosDePartido(partido, ctx) {
    try {
      const datos = await cargarPronosticosOficiales();
      const oficial = datos && datos.pronosticos
        ? datos.pronosticos[String(partido.id)]
        : null;
      if (oficial && oficial.pronosticos && Array.isArray(oficial.pronosticos.seleccionados) && oficial.pronosticos.seleccionados.length > 0) {
        const pronosticos = normalizarPronosticosOficial(oficial.pronosticos);
        pronosticos.fuente = 'oficial';
        return pronosticos;
      }
    } catch (e) {
      // Si el artefacto no se puede leer, caemos al motor client-side.
    }
    const pronosticos = generarPronosticos(
      ctx.statsLocal, ctx.statsVisita, partido.homeTeam.name, partido.awayTeam.name,
      ctx.h2h, ctx.tabla, partido.homeTeam.id, partido.awayTeam.id, ctx.codigoLiga
    );
    pronosticos.fuente = 'js';
    return pronosticos;
  }

  // ============ ICONOS POR MERCADO ============
  const ICONOS_MERCADO = {
    resultado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/></svg>',
    doble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
    totalgoles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10"/><path d="M12 20V4"/><path d="M20 20v-6"/></svg>',
    btts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7 3 11l4 4"/><path d="M3 11h12"/><path d="m17 17 4-4-4-4"/><path d="M21 13H9"/></svg>',
    equipomarca: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5 15 9l7 1-5.2 4.9L18.2 22 12 18.3 5.8 22l1.4-7.1L2 10l7-1 3-6.5Z"/></svg>',
    handicap: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>',
    marcador: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>'
  };

  function iconoMercado(tipo) {
    return `<span class="fila-icono">${ICONOS_MERCADO[tipo] || ''}</span>`;
  }

  function puntoMercado(tipo) {
    return `<span class="punto-mercado punto-${tipo}"></span>`;
  }

  function iconoTendencia(direccion) {
    if (direccion === 'subiendo') return '<span class="tendencia tendencia-sube" title="En alza">▲</span>';
    if (direccion === 'bajando') return '<span class="tendencia tendencia-baja" title="En caída">▼</span>';
    return '<span class="tendencia tendencia-neutral" title="Estable">■</span>';
  }

  function rachaHTML(racha) {
    if (!racha || racha.length === 0) return '';
    return racha.map(r => `<span class="racha-punto racha-${r}">${r}</span>`).join('');
  }

  function estrellaFavorito(teamId) {
    const activa = esFavorito(teamId);
    return `<button class="estrella-favorito ${activa ? 'activa' : ''}" onclick="toggleFavorito(${teamId}, event)" title="${activa ? 'Quitar de favoritos' : 'Marcar como favorito'}">${activa ? '★' : '☆'}</button>`;
  }

  function bloqueEquipoHTML(nombre, stats, alineacion, escudoUrl, tabla, teamId) {
    const escudo = escudoUrl ? `<img class="escudo" src="${escaparHTML(escudoUrl)}" alt="" onerror="this.style.display='none'">` : '';
    return `
      <div class="equipo-info ${alineacion}">
        ${escudo}
        <div class="equipo-nombre-tend">
          <span class="equipo">${escaparHTML(nombre)}</span>
          ${iconoTendencia(stats.tendencia.direccion)}
          ${badgePosicion(tabla, teamId)}
          ${estrellaFavorito(teamId)}
        </div>
        <div class="racha-visual">${rachaHTML(stats.tendencia.racha)}</div>
      </div>
    `;
  }

  function cuotaImplicita(probabilidad) {
    if (!probabilidad || probabilidad <= 0) return '—';
    return (100 / probabilidad).toFixed(2);
  }

