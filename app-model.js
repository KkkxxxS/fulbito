
  // ============ CONFIGURACION ============
  const BACKEND_URL = "https://fulbito-forh.onrender.com";
  const COMPETICIONES = "PL,PD,BL1,SA,FL1,CL,DED,ELC,BSA,PPL";
  const NOMBRES_LIGA = {
    PL: "Premier League", PD: "La Liga", BL1: "Bundesliga",
    SA: "Serie A", FL1: "Ligue 1", CL: "Champions League",
    DED: "Eredivisie", ELC: "Championship", BSA: "Brasileirão",
    PPL: "Primeira Liga"
  };

  let ligaSeleccionada = 'TODAS';
  let partidosDelRango = [];

  // ============ VISTAS (app shell) ============
  let vistaActual = 'pronosticos';
  let favoritosCargadosAlMenosUnaVez = false;
  let filtroHistorial = 'todos';

  function cambiarVista(vista, actualizarHash = true) {
    const vistaReal = vista;
    vistaActual = vistaReal;

    document.querySelectorAll('.vista').forEach(sec => sec.classList.remove('vista-activa'));
    const vistaNode = document.getElementById(`vista-${vistaReal}`);
    if (vistaNode) vistaNode.classList.add('vista-activa');

    document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.toggle('activa', btn.dataset.vista === vistaReal));

    const buscador = document.getElementById('input-busqueda');
    buscador.style.display = (vistaReal === 'mispredicciones') ? 'none' : '';
    buscador.placeholder = vistaReal === 'favoritos' ? 'Buscar en tus favoritos…' : (vistaReal === 'analitica' || vistaReal === 'historial') ? 'Buscar equipo o liga en el historial…' : 'Buscar equipo o liga…';

    cerrarMenuMovil();
    if (actualizarHash) history.replaceState(null, '', `#${vistaReal}`);
    window.scrollTo({ top: document.querySelector('main').offsetTop - 10, behavior: 'smooth' });

    if (vistaReal === 'inicio') {
      actualizarHistorialYCalibracion().then(() => actualizarDashboardPersonal());
    } else if (vistaReal === 'favoritos') {
      cargarFavoritos();
    } else if (vistaReal === 'analitica') {
      actualizarHistorialYCalibracion().then(h => renderHistorial(calcularEstadisticasHistorial(h), h));
    } else if (vistaReal === 'historial') {
      actualizarHistorialYCalibracion().then(h => renderHistorialCompleto(h));
    } else if (vistaReal === 'mispredicciones') {
      actualizarHistorialYCalibracion().then(() => renderMisPredicciones());
    }
  }

  function toggleMenuMovil() {
    document.getElementById('app-nav').classList.toggle('menu-abierto');
  }
  function cerrarMenuMovil() {
    document.getElementById('app-nav').classList.remove('menu-abierto');
  }

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
    badge.style.display = n > 0 ? 'inline-flex' : 'none';
    badge.textContent = n;
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

  // ============ CALCULAR NIVEL DE CONFIANZA ============
  function calcularNivelConfianza(probabilidad) {
    if (!probabilidad) return { nivel: 'baja', label: 'Baja', color: '#ff8d8d' };
    if (probabilidad >= 70) return { nivel: 'alta', label: 'Alta', color: '#64e4a9' };
    if (probabilidad >= 55) return { nivel: 'media', label: 'Media', color: '#f2c474' };
    return { nivel: 'baja', label: 'Baja', color: '#ff8d8d' };
  }

  function badgeNivelConfianza(probabilidad) {
    const conf = calcularNivelConfianza(probabilidad);
    return `<span class="nivel-confianza ${conf.nivel}"><span class="indicador-confianza"></span> ${conf.label}</span>`;
  }

  // ============ ACTUALIZAR DASHBOARD PERSONAL ============
  function actualizarDashboardPersonal() {
    const historial = leerHistorial();
    const miasPredicciones = leerMisPredicciones();
    
    // Calcular stats de mis predicciones
    let miasVerificadas = [];
    let miasAciertos = 0;
    let miasSumaProb = 0;
    let miasPendientes = 0;
    
    miasPredicciones.forEach(pick => {
      const h = historial.find(x => x.partidoId === pick.partidoId);
      if (h && h.verificado) {
        const mercado = h.mercados.find(m => m.categoria === pick.categoria);
        if (mercado) {
          miasVerificadas.push(mercado);
          miasSumaProb += mercado.probabilidad;
          if (mercado.acierto) miasAciertos++;
        }
      } else {
        miasPendientes++;
      }
    });
    
    // Actualizar elementos del dashboard
    const dashTusPicks = document.getElementById('dash-tus-picks');
    if (dashTusPicks) {
      dashTusPicks.textContent = miasPredicciones.length;
      document.getElementById('dash-tus-picks-desc').textContent = miasPendientes > 0 
        ? `${miasPendientes} sin verificar`
        : 'Todos verificados';
      
      if (miasVerificadas.length > 0) {
        const tuPrecision = Math.round((miasAciertos / miasVerificadas.length) * 100);
        const tuConfianza = Math.round(miasSumaProb / miasVerificadas.length);
        document.getElementById('dash-tu-precision').textContent = tuPrecision + '%';
        document.getElementById('dash-tu-precision-desc').textContent = `${miasAciertos}/${miasVerificadas.length} acertadas`;
        document.getElementById('dash-tu-confianza').textContent = tuConfianza + '%';
      }
    }
  }

  // ============ FILTRO AVANZADO HISTORIAL ============
  let filtrosActuales = {
    resultado: 'todos',
    mercado: 'todos-mercados',
    confianza: 'todas',
    periodo: 'mes'
  };

  function filtrarHistorial(tipo, valor) {
    filtrosActuales[tipo] = valor;
    actualizarHistorialYCalibracion().then(h => renderHistorialCompleto(h));
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
    badge.style.display = pendientes.length > 0 ? 'inline-flex' : 'none';
    badge.textContent = pendientes.length;
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
    if (vistaActual === 'inicio') actualizarDashboardPersonal();
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

  async function fetchConTiempo(url, opciones = {}) {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 20000);
    try {
      return await fetch(url, { ...opciones, signal: controlador.signal });
    } finally {
      clearTimeout(temporizador);
    }
  }

  function formatearFecha(date) {
    const anio = date.getFullYear();
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const dia = String(date.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
  }

  function fechaLocalDePartido(utcDateStr) {
    return formatearFecha(new Date(utcDateStr));
  }

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
      const resp = await fetchConTiempo(url);
      const datos = await resp.json();

      if (datos.error || datos.errorCode) {
        console.error("Respuesta con error de la API:", datos);
        return { error: true, mensaje: datos.message || datos.error || "Error desconocido de la API" };
      }

      const partidos = (datos.matches || []).filter(p => p.status === 'SCHEDULED' || p.status === 'TIMED');
      cache[claveCache] = partidos;
      guardarCachePersistente(claveCache, partidos);
      return partidos;
    } catch (e) {
      console.error("Error trayendo partidos", e);
      return { error: true, mensaje: e.message };
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
      const resp = await fetchConTiempo(url);
      const datos = await resp.json();

      if (datos.error || datos.errorCode) {
        return { error: true, mensaje: datos.message || datos.error || "Error desconocido de la API" };
      }

      const partidos = (datos.matches || []).filter(p => p.status === 'FINISHED');
      cache[claveCache] = partidos;
      guardarCachePersistente(claveCache, partidos);
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
      const resp = await fetchConTiempo(url);
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

  const PERFIL_LIGA = {
    PL: { goles: 1.04, localia: 1.05, perfil: 'alto' },
    PD: { goles: 0.96, localia: 1.04, perfil: 'equilibrado' },
    BL1: { goles: 1.07, localia: 1.06, perfil: 'alto' },
    SA: { goles: 0.94, localia: 1.03, perfil: 'equilibrado' },
    FL1: { goles: 0.98, localia: 1.02, perfil: 'equilibrado' },
    CL: { goles: 1.02, localia: 1.07, perfil: 'alto' },
    DED: { goles: 1.12, localia: 1.08, perfil: 'alto' },
    ELC: { goles: 0.92, localia: 1.01, perfil: 'bajo' },
    BSA: { goles: 0.9, localia: 1.04, perfil: 'bajo' },
    PPL: { goles: 0.95, localia: 1.03, perfil: 'equilibrado' },
    DEFAULT: { goles: 1, localia: 1.03, perfil: 'equilibrado' }
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function perfilLiga(codigoLiga) {
    return PERFIL_LIGA[codigoLiga] ?? PERFIL_LIGA.DEFAULT;
  }

  function perfilEquipo(tabla, teamId) {
    const info = tabla?.mapa?.[teamId];
    if (!info) return { ataque: 1, defensa: 1, fuerza: 1 };

    const promedioAtaque = tabla.promedioLigaGolesFavor || 1.4;
    const promedioDefensa = tabla.promedioLigaGolesContra || 1.2;
    const ataque = info.golesFavorPorPartido ? info.golesFavorPorPartido / promedioAtaque : 1;
    const defensa = info.golesContraPorPartido ? info.golesContraPorPartido / promedioDefensa : 1;
    const fuerza = info.puntosPorPartido && tabla.promedioLiga ? info.puntosPorPartido / tabla.promedioLiga : 1;

    return {
      ataque: clamp(ataque, 0.75, 1.5),
      defensa: clamp(defensa, 0.75, 1.5),
      fuerza: clamp(fuerza, 0.8, 1.3)
    };
  }

  function perfilPartido(statsLocal, statsVisita, h2h, tabla, idLocal, idVisita) {
    const localPerfil = perfilEquipo(tabla, idLocal);
    const visitaPerfil = perfilEquipo(tabla, idVisita);

    let tipo = 'equilibrado';
    let fuerzaLocal = 1;
    let fuerzaVisita = 1;

    if (localPerfil.fuerza > 1.12 && visitaPerfil.fuerza < 0.96) {
      tipo = 'clase';
      fuerzaLocal *= 1.04;
      fuerzaVisita *= 0.97;
    } else if (localPerfil.fuerza < 0.9 && visitaPerfil.fuerza > 1.1) {
      tipo = 'sorpresa';
      fuerzaLocal *= 0.97;
      fuerzaVisita *= 1.04;
    }

    if (h2h?.disponible && h2h.totalPartidos >= 6) {
      const sesgo = (h2h.victoriasLocal - h2h.victoriasVisita) / h2h.totalPartidos;
      if (Math.abs(sesgo) > 0.18) {
        tipo = 'derbi';
        fuerzaLocal *= 1 + Math.max(-0.04, Math.min(0.04, sesgo * 0.25));
        fuerzaVisita *= 1 - Math.max(-0.04, Math.min(0.04, sesgo * 0.25));
      }
    }

    const tendenciaLocal = statsLocal?.tendencia?.direccion === 'subiendo' ? 1.03 : statsLocal?.tendencia?.direccion === 'bajando' ? 0.97 : 1;
    const tendenciaVisita = statsVisita?.tendencia?.direccion === 'subiendo' ? 1.03 : statsVisita?.tendencia?.direccion === 'bajando' ? 0.97 : 1;
    fuerzaLocal *= tendenciaLocal;
    fuerzaVisita *= tendenciaVisita;

    return { tipo, fuerzaLocal: clamp(fuerzaLocal, 0.9, 1.18), fuerzaVisita: clamp(fuerzaVisita, 0.9, 1.18) };
  }

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
    const resp = await fetchConTiempo(url);
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
      const resp = await fetchConTiempo(url);
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
    const perfilLigaActual = perfilLiga(codigoLiga);
    const perfilPartida = perfilPartido(statsLocal, statsVisita, h2h, tabla, idLocal, idVisita);
    const perfilLocal = perfilEquipo(tabla, idLocal);
    const perfilVisita = perfilEquipo(tabla, idVisita);

    let ajustePerfilLocal = 1;
    let ajustePerfilVisita = 1;

    ajustePerfilLocal *= perfilLigaActual.localia;
    ajustePerfilVisita *= perfilLigaActual.localia;
    ajustePerfilLocal *= perfilLigaActual.goles;
    ajustePerfilVisita *= perfilLigaActual.goles * 0.98;

    const ajusteCalidadLocal = 1 + 0.09 * (perfilLocal.ataque - perfilVisita.defensa);
    const ajusteCalidadVisita = 1 + 0.09 * (perfilVisita.ataque - perfilLocal.defensa);
    ajustePerfilLocal *= ajusteCalidadLocal;
    ajustePerfilVisita *= ajusteCalidadVisita;

    ajustePerfilLocal *= perfilPartida.fuerzaLocal;
    ajustePerfilVisita *= perfilPartida.fuerzaVisita;

    if (perfilPartida.tipo === 'clase') {
      ajustePerfilLocal *= 1.05;
      ajustePerfilVisita *= 0.97;
    } else if (perfilPartida.tipo === 'sorpresa') {
      ajustePerfilLocal *= 0.96;
      ajustePerfilVisita *= 1.04;
    } else if (perfilPartida.tipo === 'derbi') {
      ajustePerfilLocal *= 1.04;
      ajustePerfilVisita *= 1.03;
    }

    lambdaLocal *= factorLocaliaUsado * ajustePerfilLocal;
    lambdaVisita *= factorLocaliaUsado * ajustePerfilVisita;

    const factorLigaUsado = calibracionActual.porLiga?.[codigoLiga]?.factor || 1;
    const factorLigaAjustado = Math.max(0.9, Math.min(1.1, factorLigaUsado * perfilLigaActual.goles));
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

