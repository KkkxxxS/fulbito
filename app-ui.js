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
    const escudo = escudoUrl ? `<img class="escudo" src="${escudoUrl}" alt="" onerror="this.style.display='none'">` : '';
    return `
      <div class="equipo-info ${alineacion}">
        ${escudo}
        <div class="equipo-nombre-tend">
          <span class="equipo">${nombre}</span>
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

  // ============ CUENTA REGRESIVA AL KICKOFF ============
  function tiempoHastaPartido(utcDateStr) {
    const ahora = Date.now();
    const inicio = new Date(utcDateStr).getTime();
    const minutos = Math.round((inicio - ahora) / 60000);
    if (minutos <= 0) return { texto: 'Comenzando', urgente: true };
    if (minutos < 60) return { texto: `Empieza en ${minutos} min`, urgente: minutos <= 30 };
    const horas = Math.floor(minutos / 60);
    if (horas < 24) {
      const min = minutos % 60;
      return { texto: `Empieza en ${horas} h${min > 0 ? ' ' + min + ' min' : ''}`, urgente: false };
    }
    const dias = Math.floor(horas / 24);
    return { texto: `Empieza en ${dias} día${dias > 1 ? 's' : ''}`, urgente: false };
  }

  function chipCuentaRegresiva(utcDateStr) {
    const t = tiempoHastaPartido(utcDateStr);
    return `<span class="chip-cuenta-regresiva ${t.urgente ? 'urgente' : ''}">${t.urgente ? '🔴' : '⏱'} ${t.texto}</span>`;
  }

  function filaMercado(datos, partidoId, esPrincipal) {
    if (datos.sinApuesta) {
      return `
        <div class="fila-mercado mercado-${datos.tipo} fila-sin-apuesta">
          <div class="fila-header">
            ${iconoMercado(datos.tipo)}
            <span class="fila-porcentaje-nobet">NO BET</span>
          </div>
          <span class="fila-titulo">${datos.titulo}</span>
          <p class="fila-mercado-nombre">${datos.mercado}</p>
          <p class="fila-seleccion">Sin apuesta</p>
          <p class="cuota-implicita">Ningún mercado de esta categoría supera el umbral mínimo (${datos.probabilidad}% real).</p>
        </div>
      `;
    }
    return `
      <div class="fila-mercado mercado-${datos.tipo} ${esPrincipal ? 'mercado-principal' : ''}">
        ${esPrincipal ? `<span class="etiqueta-pick-principal">Pick del partido</span>` : ''}
        <div class="fila-header">
          ${iconoMercado(datos.tipo)}
          <span class="fila-porcentaje">${datos.probabilidad}%</span>
          ${botonMiPrediccion(partidoId, datos.categoria)}
        </div>
        <span class="fila-titulo">${datos.titulo}</span>
        <div class="barra-probabilidad">
          <div class="barra-relleno" style="width:${datos.probabilidad}%"></div>
        </div>
        <p class="fila-mercado-nombre">${datos.mercado}</p>
        <p class="fila-seleccion">${datos.seleccion}</p>
        <div class="fila-razones">${(datos.razones || []).map(r => `<p class="fila-razon">+ ${r}</p>`).join('')}</div>
        <p class="cuota-implicita">Cuota justa: ${cuotaImplicita(datos.probabilidad)}</p>
      </div>
    `;
  }

  function comboPartidoHTML(combo) {
    const puntos = combo.tipos.map(puntoMercado).join('');
    return `
      <div class="combo-partido">
        <div class="combo-partido-header">
          <span>${puntos}${combo.titulo}</span>
          <span class="combo-partido-pct">${combo.probabilidad}%</span>
        </div>
        <p class="combo-partido-partes">${combo.partes.join(' + ')}</p>
      </div>
    `;
  }

  function h2hHTML(h2h) {
    if (!h2h || !h2h.disponible) return '';
    return `<p class="info-h2h">Historial directo (${h2h.totalPartidos} partidos): ${h2h.victoriasLocal}V local · ${h2h.empates}E · ${h2h.victoriasVisita}V visita</p>`;
  }

  function crearTarjetaHTML(partido, pronosticos, statsLocal, statsVisita, h2h, tabla) {
    const local = partido.homeTeam.name;
    const visita = partido.awayTeam.name;
    const liga = partido.competition.name;
    const fecha = new Date(partido.utcDate);
    const fechaTexto = fecha.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
    const horaTexto = fecha.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

    const candidatosApostables = pronosticos.seleccionados.filter(m => !m.sinApuesta);
    const mejor = candidatosApostables.length > 0
      ? candidatosApostables.reduce((a, b) => (b.probabilidad > a.probabilidad ? b : a))
      : null;
    const calidadDatos = pronosticos.pocaData
      ? { texto: 'Datos limitados', clase: 'limitada' }
      : h2h?.disponible
        ? { texto: 'Datos completos', clase: 'alta' }
        : { texto: 'Datos estándar', clase: 'media' };

    return `
      <div class="tarjeta-partido" data-partido-id="${partido.id}">
        <div class="encabezado-partido">
          ${bloqueEquipoHTML(local, statsLocal, 'alineacion-izq', partido.homeTeam.crest, tabla, partido.homeTeam.id)}
          <span class="vs">VS</span>
          ${bloqueEquipoHTML(visita, statsVisita, 'alineacion-der', partido.awayTeam.crest, tabla, partido.awayTeam.id)}
        </div>
        <div class="info-partido-fila">
          <p class="info-partido">${liga} · ${fechaTexto}, ${horaTexto} · marcador probable <strong>${pronosticos.marcadorProbable}</strong></p>
          ${chipCuentaRegresiva(partido.utcDate)}
           <span class="calidad-datos ${calidadDatos.clase}"><span class="calidad-datos-punto"></span>${calidadDatos.texto}</span>
        </div>
        ${h2hHTML(h2h)}
        ${pronosticos.pocaData ? `<p class="aviso-datos">⚠ Datos limitados (${pronosticos.partidosMin} partidos analizados) · pronóstico menos confiable</p>` : ''}
        ${pronosticos.sinNadaEnJuego ? `<p class="aviso-datos">⚠ Uno de los equipos ya no se juega nada en la tabla (título o descenso resuelto) · pronóstico menos confiable</p>` : ''}

        <div class="lista-mercados" id="mercados-${partido.id}">
          ${pronosticos.seleccionados.map(m => filaMercado(m, partido.id, mejor && m === mejor)).join('')}
        </div>
        <button class="boton-expandir" onclick="toggleMercados(${partido.id})">Ver más mercados</button>

        <div class="combos-partido">
          <p class="combos-partido-titulo">Combina en este partido</p>
          ${pronosticos.combosPartido.map(comboPartidoHTML).join('')}
        </div>

        <p class="marcadores-probables-titulo">Marcadores más probables</p>
        <div class="marcadores-probables">
          ${pronosticos.top3Marcadores.map(m => `<span class="marcador-chip">${m.marcador} <em>${m.probabilidad}%</em></span>`).join('')}
        </div>

        <button class="boton-expandir" onclick="toggleCatalogo(${partido.id})">Ver los ${pronosticos.catalogoCompleto.length} mercados evaluados</button>
        <div class="catalogo-completo" id="catalogo-${partido.id}" style="display:none;">
          ${pronosticos.catalogoCompleto.map(c => `<div class="catalogo-fila"><span>${c.seleccion}</span><span>${c.probabilidad}%</span></div>`).join('')}
        </div>
      </div>
    `;
  }

  function toggleMercados(partidoId) {
    const el = document.getElementById(`mercados-${partidoId}`);
    if (!el) return;
    el.classList.toggle('expandido');
    const btn = el.nextElementSibling;
    btn.textContent = el.classList.contains('expandido') ? 'Ver menos' : 'Ver más mercados';
  }

  function toggleCatalogo(partidoId) {
    const el = document.getElementById(`catalogo-${partidoId}`);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  function mejorSeleccionDePartido(partido, pronosticos) {
    const validos = pronosticos.seleccionados.filter(op => !op.sinApuesta);
    if (validos.length === 0) return null;
    let mejor = validos[0];
    validos.forEach(op => { if (op.probabilidad > mejor.probabilidad) mejor = op; });
    return {
      equipos: `${partido.homeTeam.name} vs ${partido.awayTeam.name}`,
      tipo: mejor.categoria, mercado: mejor.mercado, seleccion: mejor.seleccion, probabilidad: mejor.probabilidad
    };
  }

  function armarCombinada(piernas) {
    let probCombinada = 1;
    piernas.forEach(p => { probCombinada *= (p.probabilidad / 100); });
    return { piernas, probabilidad: Math.round(probCombinada * 100 * 10) / 10 };
  }

  function textoParaCompartir(etiqueta, combinada) {
    const lineas = combinada.piernas.map((p, idx) => `${idx + 1}. ${p.equipos} — ${p.mercado}: ${p.seleccion} (${p.probabilidad}%)`);
    return `${etiqueta} - Fulbito\nProbabilidad combinada: ${combinada.probabilidad}%\n\n${lineas.join('\n')}\n\nhttps://kkkxxxs.github.io/fulbito/`;
  }

  async function compartirCombinada(boton, etiqueta, indice) {
    const combinada = window.__combinadasActuales?.[indice];
    if (!combinada) return;
    const texto = textoParaCompartir(etiqueta, combinada);

    if (navigator.share) {
      try {
        await navigator.share({ text: texto });
        return;
      } catch (e) { /* el usuario cancelo, no hacemos nada */ }
    }

    try {
      await navigator.clipboard.writeText(texto);
      const original = boton.textContent;
      boton.textContent = 'Copiado ✓';
      setTimeout(() => { boton.textContent = original; }, 1800);
    } catch (e) {
      console.warn("No se pudo copiar", e);
    }
  }

  function tarjetaCombinadaHTML(etiqueta, combinada, indice) {
    const piernasHTML = combinada.piernas.map((p, idx) => `
      <div class="pierna-combinada">
        <span class="num">${idx + 1}</span>
        ${puntoMercado(p.tipo)}
        <span class="detalle"><strong>${p.equipos}</strong><br>${p.mercado}: ${p.seleccion}</span>
        <span class="pct">${p.probabilidad}%</span>
      </div>
    `).join('');

    return `
      <div class="tarjeta-combinada">
        <div class="encabezado-combinada">
          <span class="etiqueta-combinada">${etiqueta}</span>
          <span class="prob-combinada" style="color:${combinada.probabilidad >= 30 ? 'var(--green)' : 'var(--gold)'}">${combinada.probabilidad}%</span>
        </div>
        ${piernasHTML}
        <button class="boton-compartir" onclick="compartirCombinada(this, '${etiqueta}', ${indice})">Compartir</button>
      </div>
    `;
  }

  function renderCombinadas(listaSelecciones) {
    const contenedor = document.getElementById('bloque-combinadas');
    if (listaSelecciones.length < 2) {
      contenedor.innerHTML = '';
      window.__combinadasActuales = [];
      return;
    }

    const ordenadas = [...listaSelecciones].sort((a, b) => b.probabilidad - a.probabilidad);
    window.__combinadasActuales = [];

    let html = `
      <div class="bloque-combinadas">
        <h3>Combinadas sugeridas</h3>
        <p class="subtitulo-combinadas">Armadas con la selección más probable de cada partido cargado. La probabilidad mostrada es la combinada real (multiplica cada pierna), no una cuota.</p>
    `;

    const doble = armarCombinada(ordenadas.slice(0, 2));
    window.__combinadasActuales.push(doble);
    html += tarjetaCombinadaHTML('Combinada doble', doble, window.__combinadasActuales.length - 1);

    const ETIQUETAS_COMBO = { 3: 'Combinada triple', 4: 'Combinada cuádruple', 5: 'Combinada quíntuple' };
    const maxPiernas = Math.min(5, ordenadas.length);
    for (let n = 3; n <= maxPiernas; n++) {
      const combo = armarCombinada(ordenadas.slice(0, n));
      window.__combinadasActuales.push(combo);
      html += tarjetaCombinadaHTML(ETIQUETAS_COMBO[n] || `Combinada de ${n}`, combo, window.__combinadasActuales.length - 1);
    }

    html += `
        <div class="aviso-riesgo">
          <span class="icono">⚠️</span>
          <span>Cada pierna que agregas multiplica el riesgo: todas tienen que acertar para ganar la combinada. Apuesta solo lo que estás dispuesto a perder.</span>
        </div>
      </div>
    `;

    contenedor.innerHTML = html;
  }

  // ============ TRACKEADOR DE ACIERTOS ============
  const CLAVE_HISTORIAL = 'fulbito_historial_pronosticos';

  function leerHistorial() {
    try {
      const crudo = localStorage.getItem(CLAVE_HISTORIAL);
      return crudo ? JSON.parse(crudo) : [];
    } catch (e) {
      return [];
    }
  }

  function guardarHistorial(historial) {
    try {
      const recortado = historial.slice(-200);
      localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(recortado));
    } catch (e) {}
  }

  function registrarPronostico(partido, pronosticos) {
    const historial = leerHistorial();
    const yaExiste = historial.some(h => h.partidoId === partido.id);
    if (yaExiste) return;

    historial.push({
      partidoId: partido.id, local: partido.homeTeam.name, visita: partido.awayTeam.name,
      fecha: partido.utcDate, liga: partido.competition.name,
      mercados: pronosticos.seleccionados.map(m => ({
        categoria: m.categoria, parametros: m.parametros,
        seleccion: m.seleccion, probabilidad: m.probabilidad
      })),
      favoritoLocal: pronosticos.favoritoLocal, nombreFavorito: pronosticos.nombreFavorito,
      parametrosModelo: pronosticos.parametrosModelo,
      verificado: false
    });

    guardarHistorial(historial);
  }

  function evaluarMercadosPronostico(mercados, marcadorLocal, marcadorVisita) {
    return mercados.map(m => ({
      ...m,
      acierto: verificarMercado(m.categoria, m.parametros, marcadorLocal, marcadorVisita)
    }));
  }

  async function actualizarHistorialConResultados() {
    const historial = leerHistorial();
    const pendientes = historial.filter(h => !h.verificado);
    if (pendientes.length === 0) return leerHistorial();

    const hoy = new Date();
    const fechasPendientes = pendientes.map(h => new Date(h.fecha).getTime());
    let fechaDesde = new Date(Math.min(...fechasPendientes));
    const limiteMs = 90 * 24 * 60 * 60 * 1000;
    if (hoy.getTime() - fechaDesde.getTime() > limiteMs) {
      fechaDesde = new Date(hoy.getTime() - limiteMs);
    }

    try {
      const url = `${BACKEND_URL}/api/partidos?competitions=${COMPETICIONES}&dateFrom=${formatearFecha(fechaDesde)}&dateTo=${formatearFecha(hoy)}`;
      const resp = await fetchConTiempo(url);
      const datos = await resp.json();
      if (datos.error) { console.warn("Error de la API al verificar historial:", datos.mensaje); return leerHistorial(); }
      const finalizados = (datos.matches || []).filter(p => p.status === 'FINISHED');

      const mapaResultados = {};
      finalizados.forEach(p => { mapaResultados[p.id] = p; });

      let cambios = false;
      historial.forEach(registro => {
        if (registro.verificado) return;
        const partido = mapaResultados[registro.partidoId];
        if (!partido || !partido.score || partido.score.fullTime.home === null) return;

        const gl = partido.score.fullTime.home, gv = partido.score.fullTime.away;
        registro.mercados = evaluarMercadosPronostico(registro.mercados, gl, gv);
        registro.verificado = true;
        registro.marcadorFinal = `${gl}-${gv}`;
        cambios = true;
      });

      if (cambios) guardarHistorial(historial);
    } catch (e) {
      console.warn("No se pudo actualizar el historial con resultados", e);
    }

    return leerHistorial();
  }

  function calcularEstadisticasHistorial(historial) {
    const verificados = historial.filter(h => h.verificado);
    if (verificados.length === 0) return null;

    let totalAciertos = 0, totalEvaluaciones = 0;
    const porCategoria = {};

    verificados.forEach(h => {
      h.mercados.forEach(m => {
        totalEvaluaciones++;
        if (m.acierto) totalAciertos++;
        if (!porCategoria[m.categoria]) porCategoria[m.categoria] = { aciertos: 0, total: 0 };
        porCategoria[m.categoria].total++;
        if (m.acierto) porCategoria[m.categoria].aciertos++;
      });
    });

    const general = totalEvaluaciones > 0 ? Math.round((totalAciertos / totalEvaluaciones) * 100) : 0;

    const categorias = Object.keys(porCategoria)
      .map(cat => ({
        categoria: cat,
        titulo: CATEGORIAS_MERCADO[cat]?.titulo || cat,
        porcentaje: Math.round((porCategoria[cat].aciertos / porCategoria[cat].total) * 100)
      }))
      .sort((a, b) => b.porcentaje - a.porcentaje);

    return {
      totalVerificados: verificados.length, general, categorias,
      ultimos: verificados.slice(-8).reverse()
    };
  }
  function calcularBrierScore(historial) {
    const verificados = historial.filter(h => h.verificado);
    let sumaError = 0, total = 0;
    verificados.forEach(h => {
      h.mercados.forEach(m => {
        const p = m.probabilidad / 100;
        const resultado = m.acierto ? 1 : 0;
        sumaError += Math.pow(p - resultado, 2);
        total++;
      });
    });
    if (total === 0) return null;
    return { brier: Math.round((sumaError / total) * 1000) / 1000, total };
  }

  const MUESTRA_MINIMA_CALIBRACION_RANGO = 5;

  function calcularCalibracionRangos(historial) {
    const verificados = historial.filter(h => h.verificado);
    const buckets = [
      { min: 50, max: 60, label: '50-60%' },
      { min: 60, max: 70, label: '60-70%' },
      { min: 70, max: 80, label: '70-80%' },
      { min: 80, max: 90, label: '80-90%' },
      { min: 90, max: 101, label: '90-100%' }
    ];
    const datos = buckets.map(b => ({ ...b, total: 0, aciertos: 0, sumaProb: 0 }));

    verificados.forEach(h => {
      h.mercados.forEach(m => {
        const b = datos.find(d => m.probabilidad >= d.min && m.probabilidad < d.max);
        if (!b) return;
        b.total++;
        b.sumaProb += m.probabilidad;
        if (m.acierto) b.aciertos++;
      });
    });

    return datos
      .filter(d => d.total > 0)
      .map(d => ({
        label: d.label,
        muestras: d.total,
        predichoProm: Math.round(d.sumaProb / d.total),
        realPct: Math.round((d.aciertos / d.total) * 100)
      }));
  }

  function filaCalibracionRango(d) {
    const suficiente = d.muestras >= MUESTRA_MINIMA_CALIBRACION_RANGO;
    const diff = d.realPct - d.predichoProm;
    const claseDiff = Math.abs(diff) <= 8 ? 'bien' : (diff < 0 ? 'sobreestimado' : 'subestimado');
    return `
      <div class="calibracion-rango-fila ${!suficiente ? 'pocas-muestras' : ''}">
        <div class="calibracion-rango-header">
          <span class="calibracion-rango-label">${d.label}</span>
          <span class="calibracion-fila-muestras">${d.muestras} pronósticos</span>
        </div>
        <div class="calibracion-barra-item">
          <span class="calibracion-barra-etiqueta">Predicho (promedio)</span>
          <div class="calibracion-barra-fondo"><div class="calibracion-barra-relleno predicho" style="width:${d.predichoProm}%"></div></div>
          <span class="calibracion-barra-valor">${d.predichoProm}%</span>
        </div>
        <div class="calibracion-barra-item">
          <span class="calibracion-barra-etiqueta">Acertó de verdad</span>
          <div class="calibracion-barra-fondo"><div class="calibracion-barra-relleno real ${claseDiff}" style="width:${d.realPct}%"></div></div>
          <span class="calibracion-barra-valor">${d.realPct}%</span>
        </div>
        ${!suficiente ? `<p class="calibracion-vacio">Menos de ${MUESTRA_MINIMA_CALIBRACION_RANGO} muestras — dato aún poco confiable.</p>` : ''}
      </div>
    `;
  }

  function panelCalibracionRangosHTML(historial) {
    const datos = calcularCalibracionRangos(historial);
    if (datos.length === 0) {
      return `
        <div class="bloque-combinadas sin-borde-superior">
          <h3 style="font-size:1.4rem;">Calibración por rango de probabilidad</h3>
          <p class="subtitulo-combinadas">Todavía no hay suficientes pronósticos verificados para armar este análisis.</p>
        </div>
      `;
    }
    return `
      <div class="bloque-combinadas sin-borde-superior">
        <h3 style="font-size:1.4rem;">Calibración por rango de probabilidad</h3>
        <p class="subtitulo-combinadas">Un modelo bien calibrado debería acertar ~80% de las veces cuando dice "80%". Aquí comparamos lo que el modelo predijo contra lo que pasó de verdad, agrupado por rango de confianza.</p>
        ${datos.map(filaCalibracionRango).join('')}
      </div>
    `;
  }
  function reiniciarHistorial() {
    if (!confirm('¿Seguro que quieres borrar todo el historial de aciertos guardado en este navegador? Esta acción no se puede deshacer. También se reinicia la auto-calibración.')) return;
    try {
      localStorage.removeItem(CLAVE_HISTORIAL);
      localStorage.removeItem(CLAVE_CALIBRACION);
    } catch (e) {}
    calibracionActual = calibracionPorDefecto();
    renderHistorial(null);
    renderHistorialCompleto([]);
  }

  // ============ EXPORTAR / IMPORTAR DATOS (respaldo entre navegadores) ============
  const CLAVES_EXPORTABLES = [CLAVE_FAVORITOS, CLAVE_MIS_PREDICCIONES, CLAVE_HISTORIAL, CLAVE_CALIBRACION];

  function exportarDatos() {
    const datos = { __app: 'fulbito', __version: 1, __exportadoEn: new Date().toISOString() };
    CLAVES_EXPORTABLES.forEach(clave => {
      const valor = localStorage.getItem(clave);
      if (valor) {
        try { datos[clave] = JSON.parse(valor); } catch (e) {}
      }
    });

    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fulbito-backup-${formatearFecha(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importarDatos(event) {
    const archivo = event.target.files[0];
    if (!archivo) return;

    const lector = new FileReader();
    lector.onload = (e) => {
      try {
        const datos = JSON.parse(e.target.result);
        if (datos.__app !== 'fulbito') {
          alert('Ese archivo no parece un backup de Fulbito.');
          return;
        }
        const tieneAlgo = CLAVES_EXPORTABLES.some(clave => datos[clave] !== undefined);
        if (!tieneAlgo) {
          alert('Ese archivo no tiene datos reconocibles de Fulbito.');
          return;
        }
        if (!confirm('Esto va a reemplazar tus favoritos, mis predicciones, historial y calibración guardados en este navegador con los del archivo. ¿Continuar?')) return;

        CLAVES_EXPORTABLES.forEach(clave => {
          if (datos[clave] !== undefined) {
            localStorage.setItem(clave, JSON.stringify(datos[clave]));
          }
        });

        alert('Datos importados correctamente. La página se va a recargar.');
        location.reload();
      } catch (err) {
        alert('No se pudo leer ese archivo como backup de Fulbito.');
      }
    };
    lector.readAsText(archivo);
    event.target.value = '';
  }

  function panelCalibracionHTML() {
    const c = calibracionActual;
    const categorias = Object.keys(c.porCategoria);

    const filasCat = categorias.length > 0
      ? categorias.map(cat => {
          const info = c.porCategoria[cat];
          const titulo = CATEGORIAS_MERCADO[cat]?.titulo || cat;
          const pct = Math.round((info.factor - 1) * 100);
          const signo = pct > 0 ? '+' : '';
          return `
            <div class="calibracion-fila">
              <span class="calibracion-fila-titulo">${titulo}</span>
              <span class="calibracion-fila-factor ${info.factor >= 1 ? 'sube' : 'baja'}">${signo}${pct}%</span>
              <span class="calibracion-fila-muestras">${info.muestras} verificados</span>
            </div>
          `;
        }).join('')
      : `<p class="calibracion-vacio">Aún no hay suficientes pronósticos verificados por categoría (mínimo ${MUESTRA_MINIMA_CATEGORIA} cada una) para ajustarlas.</p>`;

    const localiaTexto = c.muestrasLocalia >= MUESTRA_MINIMA_LOCALIA
      ? `${c.factorLocalia.toFixed(2)}× <span class="calibracion-fila-muestras">(${c.muestrasLocalia} partidos, base 1.10×)</span>`
      : `1.10× por defecto <span class="calibracion-fila-muestras">(faltan ${MUESTRA_MINIMA_LOCALIA - c.muestrasLocalia} partidos verificados para autoajustar)</span>`;

    const rhoTexto = c.muestrasRho >= MUESTRA_MINIMA_RHO
      ? `${c.rhoDixonColes.toFixed(3)} <span class="calibracion-fila-muestras">(${c.muestrasRho} partidos, base -0.080)</span>`
      : `-0.080 por defecto <span class="calibracion-fila-muestras">(faltan ${MUESTRA_MINIMA_RHO - c.muestrasRho} partidos verificados para autoajustar)</span>`;

    const tablaTexto = c.muestrasTabla >= MUESTRA_MINIMA_TABLA
      ? `±${Math.round(c.limiteTabla * 100)}% <span class="calibracion-fila-muestras">(${c.muestrasTabla} partidos, base ±6%)</span>`
      : `±6% por defecto <span class="calibracion-fila-muestras">(faltan ${MUESTRA_MINIMA_TABLA - c.muestrasTabla} partidos verificados para autoajustar)</span>`;

    return `
      <div class="bloque-combinadas sin-borde-superior">
        <h3 style="font-size:1.4rem;">Auto-calibración</h3>
        <p class="subtitulo-combinadas">El modelo se corrige solo, comparando lo que predijo contra lo que realmente pasó en tus partidos ya verificados. Estos son los ajustes activos ahora mismo, sobre las probabilidades crudas del modelo:</p>
        <div class="calibracion-item">
          <span class="calibracion-item-titulo">Ventaja de jugar de local</span>
          <span class="calibracion-item-valor">${localiaTexto}</span>
        </div>
        <div class="calibracion-item">
          <span class="calibracion-item-titulo">Correlación marcadores bajos (ρ Dixon-Coles)</span>
          <span class="calibracion-item-valor">${rhoTexto}</span>
        </div>
        <div class="calibracion-item">
          <span class="calibracion-item-titulo">Peso de la tabla de posiciones</span>
          <span class="calibracion-item-valor">${tablaTexto}</span>
        </div>
        <div class="calibracion-categorias">${filasCat}</div>
      </div>
    `;
  }

    function renderHistorial(estadisticas, historial) {
    const contenedor = document.getElementById('bloque-historial');

    if (!estadisticas) {
      contenedor.innerHTML = `
        <div class="bloque-combinadas sin-borde-superior">
          <p class="subtitulo-combinadas">Todavía no hay partidos anteriores verificados en este navegador. A medida que uses la página y los partidos que viste terminen, aquí vas a ver qué tan bien acertó el modelo, con datos reales.</p>
        </div>
        ${panelCalibracionHTML()}
      `;
      return;
    }

    const filasUltimos = estadisticas.ultimos.map(h => {
      const aciertos = h.mercados.filter(m => m.acierto).length;
      const total = h.mercados.length;
      let claseBadge = 'parcial';
      if (aciertos === total) claseBadge = 'todo-bien';
      else if (aciertos === 0) claseBadge = 'todo-mal';

      const itemsMercados = h.mercados.map(m => `
        <span class="historial-mercado-item ${m.acierto ? 'acierto' : 'fallo'}">
          <span class="historial-mercado-check">${m.acierto ? '✓' : '✕'}</span>
          ${m.seleccion}
        </span>
      `).join('');

      return `
      <div class="historial-partido">
        <div class="historial-partido-header">
          <span class="historial-partido-equipos"><strong>${h.local} vs ${h.visita}</strong></span>
          <span class="historial-partido-marcador">${h.marcadorFinal}</span>
          <span class="historial-partido-badge ${claseBadge}">${aciertos}/${total}</span>
        </div>
        <div class="historial-partido-mercados">${itemsMercados}</div>
      </div>
    `;
    }).join('');

    const filasCategorias = estadisticas.categorias.map(c => `
      <div class="fila-mercado mercado-${c.categoria}"><span class="fila-titulo">${c.titulo}</span><span class="fila-porcentaje">${c.porcentaje}%</span><p class="fila-mercado-nombre">acierto real</p></div>
    `).join('');

    const brier = calcularBrierScore(historial);
    const brierHTML = brier ? `
      <div class="precision-general" style="margin-top:12px;">
        <span class="precision-general-num" style="color:var(--m-marcador);">${brier.brier}</span>
        <span class="precision-general-label">Brier Score<br>(0 = calibración perfecta, 0.25 = azar en mercados binarios; basado en ${brier.total} evaluaciones)</span>
      </div>
    ` : '';

    contenedor.innerHTML = `
      <div class="bloque-combinadas sin-borde-superior">
        <div class="historial-header">
          <p class="subtitulo-combinadas" style="margin:0;">Basado en ${estadisticas.totalVerificados} pronósticos ya verificados en este navegador.</p>
          <button class="boton-reiniciar" onclick="reiniciarHistorial()">Reiniciar</button>
        </div>

        <div class="precision-general">
          <span class="precision-general-num">${estadisticas.general}%</span>
          <span class="precision-general-label">Precisión general del modelo<br>(promedio de todos los mercados usados)</span>
        </div>
        ${brierHTML}

        <div class="lista-mercados expandido">
          ${filasCategorias}
        </div>

        <div class="tarjeta-combinada" style="margin-top:16px;">
          <div class="encabezado-combinada"><span class="etiqueta-combinada">Últimos verificados</span></div>
          ${filasUltimos}
        </div>
      </div>
      ${panelCalibracionRangosHTML(historial)}
      ${panelCalibracionHTML()}
    `;
  }

  // ============ HISTORIAL COMPLETO (vista "Historial", estilo tablero de picks liquidados) ============
  function calcularResumenHistorial(historial) {
    const verificados = historial.filter(h => h.verificado);
    let total = 0, aciertos = 0, sumaProb = 0;
    verificados.forEach(h => {
      h.mercados.forEach(m => {
        total++;
        sumaProb += m.probabilidad;
        if (m.acierto) aciertos++;
      });
    });
    const tasa = total > 0 ? Math.round((aciertos / total) * 100) : 0;
    const confianzaMedia = total > 0 ? Math.round(sumaProb / total) : 0;
    return { totalPicks: total, aciertos, perdidos: total - aciertos, tasa, confianzaMedia, partidosVerificados: verificados.length };
  }

  function resumenHistorialCardsHTML(r) {
    return `
      <div class="resumen-historial-grid">
        <div class="resumen-card">
          <span class="resumen-card-titulo">Picks liquidados</span>
          <span class="resumen-card-valor">${r.totalPicks}</span>
          <span class="resumen-card-sub">${r.aciertos} ganados · ${r.perdidos} perdidos</span>
        </div>
        <div class="resumen-card">
          <span class="resumen-card-titulo">Aciertos</span>
          <span class="resumen-card-valor color-verde">${r.aciertos}</span>
          <div class="resumen-card-barra"><div style="width:${r.tasa}%"></div></div>
        </div>
        <div class="resumen-card">
          <span class="resumen-card-titulo">Tasa de acierto</span>
          <span class="resumen-card-valor color-cyan">${r.tasa}%</span>
          <div class="resumen-card-barra"><div style="width:${r.tasa}%; background:var(--m-marcador);"></div></div>
        </div>
        <div class="resumen-card">
          <span class="resumen-card-titulo">Confianza media</span>
          <span class="resumen-card-valor color-gold">${r.confianzaMedia}%</span>
          <span class="resumen-card-sub">Promedio de todos los picks filtrados</span>
        </div>
      </div>
    `;
  }

  function cambiarFiltroHistorial(filtro) {
    filtroHistorial = filtro;
    renderHistorialCompleto(leerHistorial());
  }

  function obtenerEvaluacionesHistorial(historial) {
    const verificados = historial.filter(h => h.verificado);
    let evaluaciones = [];
    verificados.forEach(h => {
      h.mercados.forEach(m => {
        evaluaciones.push({
          ...m,
          local: h.local, visita: h.visita, liga: h.liga,
          marcadorFinal: h.marcadorFinal, fecha: h.fecha
        });
      });
    });

    if (filtroHistorial === 'ganados') evaluaciones = evaluaciones.filter(e => e.acierto);
    if (filtroHistorial === 'perdidos') evaluaciones = evaluaciones.filter(e => !e.acierto);
    if (terminoBusqueda) evaluaciones = evaluaciones.filter(e => coincideBusquedaTexto(e.local, e.visita, e.liga));

    evaluaciones.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    return evaluaciones;
  }

  function filaEvaluacionHistorialHTML(ev) {
    const gano = ev.acierto;
    return `
      <div class="eval-historial-fila">
        <div class="eval-historial-liga">
          <span>${ev.liga}</span>
          <span class="badge-final">FINAL</span>
        </div>
        <div class="eval-historial-cuerpo">
          <div class="eval-historial-partido">
            <strong>${ev.local}</strong>
            <span class="eval-marcador">${ev.marcadorFinal || '—'}</span>
            <strong>${ev.visita}</strong>
          </div>
          <p class="eval-mercado-titulo">${CATEGORIAS_MERCADO[ev.categoria]?.titulo || ev.categoria} · <em>${ev.seleccion}</em></p>
        </div>
        <div class="eval-historial-resultado">
          <span class="eval-icono ${gano ? 'ok' : 'no'}">${gano ? '✓' : '✕'}</span>
          <span class="eval-confianza">${ev.probabilidad}%</span>
        </div>
      </div>
    `;
  }

  const LIMITE_HISTORIAL_COMPLETO = 60;

  function renderHistorialCompleto(historial) {
    const contenedor = document.getElementById('bloque-historial-completo');
    if (!contenedor) return;

    const resumen = calcularResumenHistorial(historial);

    if (resumen.totalPicks === 0) {
      contenedor.innerHTML = `
        <div class="aviso-servidor">
          <p><strong>Todavía no hay picks liquidados en este navegador.</strong></p>
          <p>A medida que los partidos que Fulbito pronosticó terminen, van a aparecer acá con su resultado real.</p>
        </div>
        <div class="historial-filtros-barra" style="margin-top:16px;">
          <span></span>
          <div style="display:flex; gap:8px;">
            <button class="boton-reiniciar" onclick="exportarDatos()">Exportar mis datos</button>
            <button class="boton-reiniciar" onclick="document.getElementById('input-importar-datos').click()">Importar datos</button>
          </div>
        </div>
      `;
      return;
    }

    const evaluaciones = obtenerEvaluacionesHistorial(historial);
    const mostrar = evaluaciones.slice(0, LIMITE_HISTORIAL_COMPLETO);

    contenedor.innerHTML = `
      ${resumenHistorialCardsHTML(resumen)}
      <div class="historial-filtros-barra">
        <div class="historial-filtros-chips">
          <button class="chip-filtro ${filtroHistorial === 'todos' ? 'activo' : ''}" onclick="cambiarFiltroHistorial('todos')">Todos</button>
          <button class="chip-filtro ${filtroHistorial === 'ganados' ? 'activo' : ''}" onclick="cambiarFiltroHistorial('ganados')">Ganados</button>
          <button class="chip-filtro ${filtroHistorial === 'perdidos' ? 'activo' : ''}" onclick="cambiarFiltroHistorial('perdidos')">Perdidos</button>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="boton-reiniciar" onclick="exportarDatos()">Exportar mis datos</button>
          <button class="boton-reiniciar" onclick="document.getElementById('input-importar-datos').click()">Importar datos</button>
          <button class="boton-reiniciar" onclick="reiniciarHistorial()">Reiniciar historial</button>
        </div>
      </div>
      <p class="historial-conteo-resultados">${evaluaciones.length} picks encontrados${terminoBusqueda ? ` para "${terminoBusqueda}"` : ''}</p>
      <div class="lista-eval-historial">
        ${mostrar.length > 0 ? mostrar.map(filaEvaluacionHistorialHTML).join('') : `<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Ningún pick coincide con este filtro.</p>`}
      </div>
      ${evaluaciones.length > LIMITE_HISTORIAL_COMPLETO ? `<p class="historial-conteo-resultados">Mostrando ${mostrar.length} de ${evaluaciones.length}. Usa el buscador para acotar.</p>` : ''}
    `;
  }

  function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============ SKELETON LOADER ============
  function skeletonHTML() {
    let bloques = '';
    for (let i = 0; i < 2; i++) {
      bloques += `
        <div class="skeleton-tarjeta">
          <div class="skeleton-linea" style="height:24px; width:60%; margin:0 auto 20px;"></div>
          <div class="skeleton-linea" style="height:80px;"></div>
          <div class="skeleton-linea" style="height:80px;"></div>
        </div>
      `;
    }
    return bloques;
  }

  // ============ FILTRO POR LIGA ============
  function renderFiltroLigas() {
    const cont = document.getElementById('filtro-ligas');
    const codigos = COMPETICIONES.split(',');
    let html = `<button class="filtro-liga-btn ${ligaSeleccionada === 'TODAS' ? 'activa' : ''}" onclick="cambiarLiga('TODAS')">Todas</button>`;
    codigos.forEach(cod => {
      html += `<button class="filtro-liga-btn ${ligaSeleccionada === cod ? 'activa' : ''}" onclick="cambiarLiga('${cod}')">${NOMBRES_LIGA[cod] || cod}</button>`;
    });
    cont.innerHTML = html;
  }

  function cambiarLiga(codigo) {
    ligaSeleccionada = codigo;
    renderFiltroLigas();
    if (ultimaFechaCargada === 'finalizados') renderizarFinalizados();
    else renderizarPartidosFiltrados();
  }

  // ============ RENDER PRINCIPAL DE PARTIDOS ============
  async function renderizarPartidosFiltrados() {
    const contenedor = document.getElementById('contenedor-partidos');
    contenedor.classList.remove('visible');

    let lista = partidosDelRango;
    if (ligaSeleccionada !== 'TODAS') {
      lista = lista.filter(p => p.competition.code === ligaSeleccionada);
    }
    lista = lista.filter(coincideBusqueda);

    lista = [...lista].sort((a, b) => {
      const favA = partidoTieneFavorito(a) ? 1 : 0;
      const favB = partidoTieneFavorito(b) ? 1 : 0;
      return favB - favA;
    });

    if (lista.length === 0) {
      const mensaje = terminoBusqueda
        ? `No encontramos partidos que coincidan con "${terminoBusqueda}".`
        : 'No hay partidos para mostrar con este filtro.';
      contenedor.innerHTML = `<div class="estado-vacio"><strong>${mensaje}</strong><span>Prueba otra fecha, liga o término de búsqueda.</span></div>`;
      requestAnimationFrame(() => contenedor.classList.add('visible'));
      document.getElementById('bloque-combinadas').innerHTML = '';
      return;
    }

    lista = lista.slice(0, 5);
    contenedor.innerHTML = skeletonHTML();
    requestAnimationFrame(() => contenedor.classList.add('visible'));

    const seleccionesParaCombinar = [];
    let htmlFinal = '';

    for (let idx = 0; idx < lista.length; idx++) {
      const partido = lista[idx];
      if (idx > 0) await esperar(700);

      const codigoLiga = partido.competition.code;
      const [h2h, tabla] = await Promise.all([
       obtenerHeadToHead(partido.id),
       obtenerTabla(codigoLiga)
     ]);
      const [statsLocal, statsVisita] = await Promise.all([
        obtenerStatsEquipo(partido.homeTeam.id, codigoLiga, tabla),
        obtenerStatsEquipo(partido.awayTeam.id, codigoLiga, tabla)
      ]);

      const pronosticos = generarPronosticos(
        statsLocal, statsVisita, partido.homeTeam.name, partido.awayTeam.name,
        h2h, tabla, partido.homeTeam.id, partido.awayTeam.id, codigoLiga
      );

      htmlFinal += crearTarjetaHTML(partido, pronosticos, statsLocal, statsVisita, h2h, tabla);
      const mejorSel = mejorSeleccionDePartido(partido, pronosticos);
      if (mejorSel) seleccionesParaCombinar.push(mejorSel);
      registrarPronostico(partido, pronosticos);
    }

    contenedor.innerHTML = htmlFinal;
    renderCombinadas(seleccionesParaCombinar);

        const historialActualizado = await actualizarHistorialYCalibracion();
    if (vistaActual === 'analitica') renderHistorial(calcularEstadisticasHistorial(historialActualizado), historialActualizado);
    if (vistaActual === 'historial') renderHistorialCompleto(historialActualizado);
  }

  // ============ FINALIZADOS (pronostico vs resultado real, dentro de Pronosticos) ============
  let partidosFinalizadosCache = [];

  function tarjetaFinalizadoHTML(entrada) {
    const h = entrada;
    const aciertos = h.mercados.filter(m => m.acierto).length;
    const total = h.mercados.length;
    let claseBadge = 'parcial';
    if (aciertos === total) claseBadge = 'todo-bien';
    else if (aciertos === 0) claseBadge = 'todo-mal';

    const itemsMercados = h.mercados.map(m => `
      <span class="historial-mercado-item ${m.acierto ? 'acierto' : 'fallo'}">
        <span class="historial-mercado-check">${m.acierto ? '✓' : '✕'}</span>
        ${CATEGORIAS_MERCADO[m.categoria]?.titulo || m.categoria}: ${m.seleccion} (${m.probabilidad}%)
      </span>
    `).join('');

    return `
      <div class="historial-partido">
        <div class="historial-partido-header">
          <span class="historial-partido-equipos"><strong>${h.local} vs ${h.visita}</strong></span>
          <span class="historial-partido-marcador">${h.marcadorFinal}</span>
          <span class="historial-partido-badge ${claseBadge}">${aciertos}/${total}</span>
        </div>
        <p class="info-partido" style="margin:0 0 8px;">${h.liga}</p>
        <div class="historial-partido-mercados">${itemsMercados}</div>
      </div>
    `;
  }

  async function cargarFinalizados() {
    const contenedor = document.getElementById('contenedor-partidos');
    const contenedorCombinadas = document.getElementById('bloque-combinadas');
    contenedor.classList.remove('visible');
    contenedor.innerHTML = skeletonHTML();
    contenedorCombinadas.innerHTML = '';

    const hoy = new Date();
    const hace7dias = new Date(hoy);
    hace7dias.setDate(hace7dias.getDate() - 7);

    const partidos = await obtenerPartidosFinalizados(formatearFecha(hace7dias), formatearFecha(hoy));
    if (partidos.error) {
      contenedor.innerHTML = `<div class="estado-error"><strong>No pudimos cargar los finalizados</strong><span>${partidos.mensaje || 'Intenta nuevamente en unos segundos.'}</span><button class="boton-reintentar" onclick="cargarFinalizados()">Reintentar</button></div>`;
      requestAnimationFrame(() => contenedor.classList.add('visible'));
      return;
    }

    // Solo nos interesan los partidos que ya pronosticamos (aparecen en el historial local)
    const historial = await actualizarHistorialYCalibracion();
    const idsFinalizados = new Set(partidos.map(p => p.id));
    partidosFinalizadosCache = historial
      .filter(h => h.verificado && idsFinalizados.has(h.partidoId))
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    renderFiltroLigas();
    renderizarFinalizados();
  }

  function renderizarFinalizados() {
    const contenedor = document.getElementById('contenedor-partidos');
    contenedor.classList.remove('visible');

    let lista = partidosFinalizadosCache;
    if (ligaSeleccionada !== 'TODAS') {
      lista = lista.filter(h => NOMBRES_LIGA[ligaSeleccionada] === h.liga);
    }
    lista = lista.filter(h => coincideBusquedaTexto(h.local, h.visita, h.liga));

    if (lista.length === 0) {
      const mensaje = terminoBusqueda
        ? `No encontramos partidos finalizados que coincidan con "${terminoBusqueda}".`
        : 'Todavía no hay partidos finalizados y verificados en los últimos 7 días. A medida que veas partidos en "Hoy"/"Mañana" y esos terminen, van a aparecer acá con su resultado real.';
      contenedor.innerHTML = `<div class="estado-vacio"><strong>${mensaje}</strong><span>Prueba otra fecha, liga o término de búsqueda.</span></div>`;
      requestAnimationFrame(() => contenedor.classList.add('visible'));
      return;
    }

    contenedor.innerHTML = lista.slice(0, 10).map(tarjetaFinalizadoHTML).join('');
    requestAnimationFrame(() => contenedor.classList.add('visible'));
  }

  // ============ CARGA PRINCIPAL ============
  async function cargarPartidos(tipoFecha) {
    if (tipoFecha === 'finalizados') {
      await cargarFinalizados();
      return;
    }

    const contenedor = document.getElementById('contenedor-partidos');
    const contenedorCombinadas = document.getElementById('bloque-combinadas');
    contenedor.classList.remove('visible');
    contenedor.innerHTML = skeletonHTML();
    contenedorCombinadas.innerHTML = '';

    const avisoDespertar = setTimeout(() => {
      if (contenedor.querySelector('.skeleton-tarjeta')) {
        contenedor.innerHTML = `
          <div class="aviso-servidor aviso-servidor-carga">
            <span class="estado-spinner"></span>
            <p><strong>Armando la jugada...</strong></p>
            <p>El servidor está despertando y reuniendo datos recientes. Un momento más.</p>
          </div>
        `;
        requestAnimationFrame(() => contenedor.classList.add('visible'));
      }
    }, 4000);

    const hoy = new Date();
    let fechaInicio, fechaFin, diaObjetivo;

    if (tipoFecha === 'hoy') {
      diaObjetivo = formatearFecha(hoy);
      const finConsulta = new Date(hoy);
      finConsulta.setDate(finConsulta.getDate() + 1);
      fechaInicio = formatearFecha(hoy);
      fechaFin = formatearFecha(finConsulta);
    } else if (tipoFecha === 'manana') {
      const manana = new Date(hoy);
      manana.setDate(manana.getDate() + 1);
      diaObjetivo = formatearFecha(manana);
      const inicioConsulta = new Date(hoy);
      const finConsulta = new Date(manana);
      finConsulta.setDate(finConsulta.getDate() + 1);
      fechaInicio = formatearFecha(inicioConsulta);
      fechaFin = formatearFecha(finConsulta);
    } else if (tipoFecha === 'semana') {
      const finSemana = new Date(hoy);
      finSemana.setDate(finSemana.getDate() + 7);
      fechaInicio = formatearFecha(hoy);
      fechaFin = formatearFecha(finSemana);
    }

    let partidos = await obtenerPartidos(fechaInicio, fechaFin);
    clearTimeout(avisoDespertar);

    if (partidos.error) {
      contenedor.innerHTML = `<div class="estado-error"><strong>No pudimos cargar los partidos</strong><span>${partidos.mensaje || 'Intenta nuevamente en unos segundos.'}</span><button class="boton-reintentar" onclick="cargarPartidos('${tipoFecha}')">Reintentar</button></div>`;
      requestAnimationFrame(() => contenedor.classList.add('visible'));
      return;
    }

    if (diaObjetivo) {
      partidos = partidos.filter(p => fechaLocalDePartido(p.utcDate) === diaObjetivo);
    }

    partidosDelRango = partidos;
    const estadoDatos = document.getElementById('estado-datos');
    if (estadoDatos) estadoDatos.textContent = `${partidos.length} ${partidos.length === 1 ? 'partido disponible' : 'partidos disponibles'}`;
    ligaSeleccionada = 'TODAS';
    renderFiltroLigas();
    await renderizarPartidosFiltrados();
  }

  let ultimaFechaCargada = 'hoy';

  function cambiarFecha(tipo, event) {
    document.querySelectorAll('.pestaña').forEach(btn => btn.classList.remove('activa'));
    event.target.classList.add('activa');
    document.getElementById('selector-fecha-personalizada').style.display = 'none';
    ultimaFechaCargada = tipo;
    cargarPartidos(tipo);
  }

  function mostrarSelectorFecha(event) {
    document.querySelectorAll('.pestaña').forEach(btn => btn.classList.remove('activa'));
    event.target.classList.add('activa');
    const selector = document.getElementById('selector-fecha-personalizada');
    selector.style.display = selector.style.display === 'none' ? 'flex' : 'none';
  }

   async function aplicarFechaPersonalizada() {
    const valor = document.getElementById('input-fecha-personalizada').value;
    if (!valor) return;

    ultimaFechaCargada = 'otra';
    const contenedor = document.getElementById('contenedor-partidos');
    const contenedorCombinadas = document.getElementById('bloque-combinadas');
    contenedor.classList.remove('visible');
    contenedor.innerHTML = skeletonHTML();
    contenedorCombinadas.innerHTML = '';

    const fechaObjetivo = new Date(valor + 'T12:00:00');
    const inicioConsulta = new Date(fechaObjetivo);
    inicioConsulta.setDate(inicioConsulta.getDate() - 1);
    const finConsulta = new Date(fechaObjetivo);
    finConsulta.setDate(finConsulta.getDate() + 1);

    let partidos = await obtenerPartidos(formatearFecha(inicioConsulta), formatearFecha(finConsulta));
    if (partidos.error) {
      contenedor.innerHTML = `<div class="estado-error"><strong>No pudimos cargar tus favoritos</strong><span>${partidos.mensaje || 'Intenta nuevamente en unos segundos.'}</span><button class="boton-reintentar" onclick="cargarFavoritos()">Reintentar</button></div>`;
      requestAnimationFrame(() => contenedor.classList.add('visible'));
      return;
    }

    partidos = partidos.filter(p => fechaLocalDePartido(p.utcDate) === valor);

    if (partidos.length === 0 && valor < formatearFecha(new Date())) {
      contenedor.innerHTML = `<div class="estado-vacio"><strong>Esta fecha ya pasó</strong><span>Esos partidos ya se jugaron o ya no están programados. Elige una fecha futura o revisa “Finalizados” para ver resultados verificados.</span></div>`;
      requestAnimationFrame(() => contenedor.classList.add('visible'));
      document.getElementById('bloque-combinadas').innerHTML = '';
      return;
    }

    partidosDelRango = partidos;
    ligaSeleccionada = 'TODAS';
    renderFiltroLigas();
    await renderizarPartidosFiltrados();
  }
  // ============ VISTA DE FAVORITOS ============
  let partidosFavoritosCache = [];

  function tarjetaFavoritoVaciaHTML() {
    return `
      <div class="aviso-servidor">
        <p><strong>Aún no sigues ningún equipo.</strong></p>
        <p>Toca la estrella ☆ junto al nombre de un equipo, en cualquier partido de "Pronósticos", y va a aparecer aquí.</p>
      </div>
    `;
  }

  async function cargarFavoritos() {
    const contenedor = document.getElementById('contenedor-favoritos');
    const favoritos = leerFavoritos();

    if (favoritos.length === 0) {
      contenedor.innerHTML = tarjetaFavoritoVaciaHTML();
      return;
    }

    contenedor.innerHTML = skeletonHTML();

    const hoy = new Date();
    const fin = new Date(hoy);
    fin.setDate(fin.getDate() + 7);

    const partidos = await obtenerPartidos(formatearFecha(hoy), formatearFecha(fin));
    if (partidos.error) {
      contenedor.innerHTML = `<div class="estado-error"><strong>No pudimos cargar los favoritos</strong><span>${partidos.mensaje || 'Intenta nuevamente en unos segundos.'}</span><button class="boton-reintentar" onclick="cargarFavoritos()">Reintentar</button></div>`;
      return;
    }

    partidosFavoritosCache = partidos.filter(p =>
      favoritos.includes(p.homeTeam.id) || favoritos.includes(p.awayTeam.id)
    );

    await renderizarFavoritos();
  }

  async function renderizarFavoritos() {
    const contenedor = document.getElementById('contenedor-favoritos');
    const favoritos = leerFavoritos();

    if (favoritos.length === 0) {
      contenedor.innerHTML = tarjetaFavoritoVaciaHTML();
      return;
    }

    const lista = partidosFavoritosCache.filter(coincideBusqueda).slice(0, 8);

    if (lista.length === 0) {
      const mensaje = terminoBusqueda
        ? `Ninguno de tus favoritos coincide con "${terminoBusqueda}".`
        : 'Tus equipos favoritos no juegan en los próximos 7 días.';
      contenedor.innerHTML = `<div class="estado-vacio"><strong>${mensaje}</strong><span>Prueba otra búsqueda o revisa tus equipos favoritos.</span></div>`;
      return;
    }

    contenedor.innerHTML = skeletonHTML();

    let htmlFinal = '';
    for (let idx = 0; idx < lista.length; idx++) {
      const partido = lista[idx];
      if (idx > 0) await esperar(700);

      const codigoLiga = partido.competition.code;
      const [h2h, tabla] = await Promise.all([
        obtenerHeadToHead(partido.id),
        obtenerTabla(codigoLiga)
      ]);
      const [statsLocal, statsVisita] = await Promise.all([
        obtenerStatsEquipo(partido.homeTeam.id, codigoLiga, tabla),
        obtenerStatsEquipo(partido.awayTeam.id, codigoLiga, tabla)
      ]);

      const pronosticos = generarPronosticos(
        statsLocal, statsVisita, partido.homeTeam.name, partido.awayTeam.name,
        h2h, tabla, partido.homeTeam.id, partido.awayTeam.id, codigoLiga
      );

      htmlFinal += crearTarjetaHTML(partido, pronosticos, statsLocal, statsVisita, h2h, tabla);
      registrarPronostico(partido, pronosticos);
    }

    contenedor.innerHTML = htmlFinal;
  }

  // ============ INICIALIZACION ============
  const inputFechaPersonalizada = document.getElementById('input-fecha-personalizada');
  if (inputFechaPersonalizada) inputFechaPersonalizada.min = formatearFecha(new Date());

  actualizarContadorFavoritos();
  actualizarContadorMisPredicciones();
  cargarPartidos('hoy');

  const hashInicial = window.location.hash.replace('#', '');
  if (['favoritos', 'analitica', 'mispredicciones', 'historial'].includes(hashInicial)) {
    cambiarVista(hashInicial, false);
  }

  // Auto-actualizacion cada 3 minutos, solo si la pestaña esta visible
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      if (vistaActual === 'pronosticos') cargarPartidos(ultimaFechaCargada === 'otra' ? 'hoy' : ultimaFechaCargada);
      else if (vistaActual === 'favoritos') cargarFavoritos();
      else if (vistaActual === 'mispredicciones') actualizarHistorialYCalibracion().then(() => renderMisPredicciones());
      else if (vistaActual === 'historial') actualizarHistorialYCalibracion().then(h => renderHistorialCompleto(h));
    }
  }, 3 * 60 * 1000);

  // ============ SERVICE WORKER (PWA / offline básico) ============
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('No se pudo registrar el service worker', e));
    });
  }

