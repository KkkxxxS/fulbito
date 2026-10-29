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

  function obtenerVentanaProbabilidad(prob, conf) {
    const margenes = { 'Alta': 2, 'Media': 5, 'Baja': 8 };
    const margen = margenes[conf] || 5;
    return {
      min: Math.max(0, prob - margen),
      max: Math.min(100, prob + margen)
    };
  }

  function nivelConfianza(probabilidad) {
    if (probabilidad >= 80) return { etiqueta: 'Alta', clase: 'conf-alta' };
    if (probabilidad >= 65) return { etiqueta: 'Media', clase: 'conf-media' };
    return { etiqueta: 'Baja', clase: 'conf-baja' };
  }

  function obtenerConfianza(datos) {
    const confVal = datos.confianza || 'Media';
    const clase = confVal === 'Alta' ? 'conf-alta' : confVal === 'Baja' ? 'conf-baja' : 'conf-media';
    return { etiqueta: confVal, clase: clase };
  }

  function filaMercado(datos, partidoId, esPrincipal) {
    if (datos.sinApuesta) {
      return `
        <li class="fila-mercado animated-enter mercado-${datos.tipo} fila-sin-apuesta" role="listitem">
          <header class="fila-header">
            <div class="fila-header-izq">
              ${iconoMercado(datos.tipo)}
              <span class="badge-nobet-tag">NO BET</span>
            </div>
          </header>
          <h4 class="fila-titulo">${escaparHTML(datos.titulo)}</h4>
          <div class="fila-mercado-cuerpo">
            <p class="fila-mercado-nombre">${escaparHTML(datos.mercado)}</p>
            <p class="fila-seleccion">Sin apuesta disponible</p>
          </div>
          <footer class="fila-nobet-detalle">
            <span class="icono-info-nobet" aria-hidden="true">?</span>
            <p class="cuota-implicita">Ningún mercado de esta categoría supera el umbral mínimo de seguridad (${datos.probabilidad}% real).</p>
          </footer>
        </li>
      `;
    }
    const conf = obtenerConfianza(datos);
    const ventana = obtenerVentanaProbabilidad(datos.probabilidad, conf.etiqueta);
    const cuota = cuotaImplicita(datos.probabilidad);
    const contextoTxt = datos.contexto ? `<div class="fila-contexto-block"><span class="contexto-label">Contexto:</span> ${escaparHTML(datos.contexto)}</div>` : '';
    const explicacionTxt = datos.explicacion ? `<div class="fila-explicacion-block"><span class="explicacion-label">Explicación:</span> ${escaparHTML(datos.explicacion)}</div>` : '';

    const senales = [
      { icono: '🔥', texto: 'Dominio claro' },
      { icono: '📈', texto: 'Tendencia sólida' },
      { icono: '⚽', texto: 'Tendencia ofensiva' },
      { icono: '🏆', texto: 'Favorito claro' },
      { icono: '⚖️', texto: 'Valor equilibrado' }
    ].filter(s => {
      if (s.texto === 'Dominio claro' && datos.probabilidad < 75) return false;
      if (s.texto === 'Tendencia sólida' && (datos.probabilidad < 65 || datos.probabilidad >= 75)) return false;
      if (s.texto === 'Tendencia ofensiva' && (datos.categoria !== 'total_goles' || datos.probabilidad < 60)) return false;
      if (s.texto === 'Favorito claro' && (datos.categoria !== 'resultado' || datos.probabilidad < 60)) return false;
      if (s.texto === 'Valor equilibrado' && (datos.probabilidad < 55 || datos.probabilidad >= 65)) return false;
      return true;
    }).slice(0, 2);

    const senalesHTML = senales.length > 0
      ? `<div class="senales-contenedor">${senales.map(s => `<span class="senal-valor"><span class="senal-valor-icono">${s.icono}</span>${s.texto}</span>`).join('')}</div>`
      : '';

    return `
      <li class="fila-mercado animated-enter motion-card mercado-${datos.tipo} ${esPrincipal ? 'mercado-principal motion-pop' : ''}" role="listitem">
        ${esPrincipal ? `<div class="etiqueta-pick-principal" aria-label="Pick principal del partido">⭐ Pick del partido</div>` : ''}
        ${contextoTxt}
        <header class="fila-header">
          <div class="fila-header-izq">
            ${iconoMercado(datos.tipo)}
            <span class="fila-porcentaje prob-rango">${ventana.min}% - ${ventana.max}%</span>
          </div>
          <div class="fila-header-der">
            <span class="badge-confianza-lectura ${conf.clase}">${conf.etiqueta}</span>
            ${botonMiPrediccion(partidoId, datos.categoria)}
          </div>
        </header>
        ${senalesHTML}
        <h4 class="fila-titulo">${escaparHTML(datos.titulo)}</h4>
        <div class="barra-probabilidad" role="progressbar" aria-valuenow="${datos.probabilidad}" aria-valuemin="0" aria-valuemax="100" aria-label="Probabilidad ${datos.probabilidad}%">
          <div class="barra-relleno conf-${conf.clase}" style="width:${datos.probabilidad}%">
            <div class="barra-ventana-indicador" style="left: 100%"></div>
          </div>
        </div>
        <div class="fila-mercado-cuerpo">
          <p class="fila-mercado-nombre">${escaparHTML(datos.mercado)}</p>
          <p class="fila-seleccion">${escaparHTML(datos.seleccion)}</p>
        </div>
        ${explicacionTxt}
        <ul class="fila-razones">${(datos.razones || []).map(r => `<li class="fila-razon">+ ${escaparHTML(r)}</li>`).join('')}</ul>
        <footer class="fila-mercado-footer">
          <span class="cuota-implicita-tag" title="Cuota justa según probabilidad real estimada">Cuota justa: <strong style="color:var(--brand)">@${cuota}</strong></span>
        </footer>
      </li>
    `;
  }

  function comboPartidoHTML(combo) {
    const puntos = combo.tipos.map(puntoMercado).join('');
    return `
      <div class="combo-partido">
        <div class="combo-partido-header">
          <span>${puntos}${escaparHTML(combo.titulo)}</span>
          <span class="combo-partido-pct">${combo.probabilidad}%</span>
        </div>
        <p class="combo-partido-partes">${escaparHTML(combo.partes.join(' + '))}</p>
      </div>
    `;
  }

  function h2hHTML(h2h) {
    if (!h2h || !h2h.disponible) return '';
    return `<div class="info-h2h-pill"><span class="h2h-icono">⚖</span> Historial directo (${h2h.totalPartidos} PJ): <strong>${h2h.victoriasLocal}V</strong> local · <strong>${h2h.empates}E</strong> · <strong>${h2h.victoriasVisita}V</strong> visita</div>`;
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

    return `
      <article class="tarjeta-partido animated-enter" data-partido-id="${partido.id}">
        <header class="tarjeta-partido-topbar">
          <div class="partido-topbar-izq">
            <span class="partido-liga-tag">${escaparHTML(liga)}</span>
            <span class="partido-fecha-tag">${fechaTexto} ${horaTexto}</span>
          </div>
          <div class="partido-topbar-der">
            ${chipCuentaRegresiva(partido.utcDate)}
          </div>
        </header>

        <div class="tarjeta-partido-col-izq">
          <section class="encabezado-partido">
            ${bloqueEquipoHTML(local, statsLocal, 'alineacion-izq', partido.homeTeam.crest, tabla, partido.homeTeam.id)}
            <div class="centro-partido">
              <span class="vs-circulo">VS</span>
              <div class="marcador-estimado-badge" title="Marcador más probable estimado por el modelo">
                <span class="marcador-estimado-label">Estimado</span>
                <strong class="marcador-estimado-val">${escaparHTML(pronosticos.marcadorProbable)}</strong>
              </div>
            </div>
            ${bloqueEquipoHTML(visita, statsVisita, 'alineacion-der', partido.awayTeam.crest, tabla, partido.awayTeam.id)}
          </section>

          ${h2hHTML(h2h)}

          <div class="lectura-pick-box">
            <div class="lectura-pick-header">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
              Lectura del Modelo
            </div>
            <p class="lectura-pick-texto">
              ${mejor ? `El modelo proyecta ventaja en <strong>${escaparHTML(mejor.mercado || mejor.categoria)}: ${escaparHTML(mejor.seleccion)}</strong> con <strong>${mejor.probabilidad}%</strong> de probabilidad estimada basada en la correlación Dixon-Coles y localía. ${mejor.razones ? `<br><small>${mejor.razones.map(r => '• ' + r).join('<br>')}</small>` : ''}` : "Distribución equilibrada; sin sesgo estadístico dominante en mercados principales."}
            </p>
          </div>

          ${pronosticos.pocaData ? `<div class="aviso-datos warning"><span class="aviso-icon">?</span> Datos limitados (${pronosticos.partidosMin} partidos analizados) — pronóstico menos confiable</div>` : ''}
          ${pronosticos.sinNadaEnJuego ? `<div class="aviso-datos warning"><span class="aviso-icon">?</span> Uno de los equipos ya no se juega nada en la tabla (título o descenso resuelto)</div>` : ''}
        </div>

        <div class="tarjeta-partido-col-der">
          <ul class="lista-mercados animated-enter" id="mercados-${partido.id}">
            ${pronosticos.seleccionados.map(m => `<li>${filaMercado(m, partido.id, mejor && m === mejor)}</li>`).join('')}
          </ul>
          <button class="boton-expandir" data-action="toggle-mercados" data-partido="${partido.id}">Ver más mercados</button>

          <section class="combos-partido">
            <h3 class="combos-partido-titulo">Combina en este partido</h3>
            <ul>${pronosticos.combosPartido.map(comboPartidoHTML).join('')}</ul>
          </section>

          <p class="marcadores-probables-titulo">Marcadores más probables</p>
          <div class="marcadores-probables">
            ${pronosticos.top3Marcadores.map(m => `<span class="marcador-chip">${m.marcador} <em>${m.probabilidad}%</em></span>`).join('')}
          </div>

          <button class="boton-expandir" data-action="toggle-catalogo" data-partido="${partido.id}">Ver los ${pronosticos.catalogoCompleto.length} mercados evaluados</button>
          <div class="catalogo-completo" id="catalogo-${partido.id}" style="display:none;">
          ${(pronosticos.catalogoCompleto || []).map(c => `<div class="catalogo-fila"><span>${escaparHTML(c.seleccion)}</span></div>`).join('')}
          </div>
        </div>
      </article>`;
  }

  function toggleMercados(partidoId) {
    const el = document.getElementById(`mercados-${partidoId}`);
    if (!el) return;
    el.classList.toggle('expandido');
    const btn = el.nextElementSibling;
    if (btn) btn.textContent = el.classList.contains('expandido') ? 'Ver menos' : 'Ver más mercados';
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

  function scoreCombinada(piernas) {
    const probCombinada = piernas.reduce((acc, p) => acc * (p.probabilidad / 100), 1) * 100;
    const tiposUnicos = new Set(piernas.map(p => p.tipo)).size;
    const penalidadRepetidos = Math.max(0, piernas.length - tiposUnicos) * 8;
    const penalidadBajoValor = piernas.filter(p => p.probabilidad < 42).length * 10;
    const diversidad = tiposUnicos / piernas.length;
    return (probCombinada * (0.7 + diversidad * 0.9)) - penalidadRepetidos - penalidadBajoValor;
  }

  function generarCombinadaMasValiosa(candidatos, cantidad) {
    const pool = [...candidatos]
      .sort((a, b) => b.probabilidad - a.probabilidad)
      .slice(0, Math.min(candidatos.length, 10));

    let mejor = null;
    let mejorScore = -Infinity;

    function combinarDesde(indice, seleccionActual) {
      if (seleccionActual.length === cantidad) {
        const score = scoreCombinada(seleccionActual);
        if (score > mejorScore) {
          mejorScore = score;
          mejor = seleccionActual.slice();
        }
        return;
      }

      for (let i = indice; i < pool.length; i++) {
        const siguiente = pool[i];
        const actuales = seleccionActual.concat(siguiente);
        const tipos = actuales.map(p => p.tipo);
        const repetidos = Math.max(0, tipos.length - new Set(tipos).size);

        if (cantidad > 2 && repetidos > 0) continue;
        combinarDesde(i + 1, actuales);
      }
    }

    combinarDesde(0, []);
    if (!mejor) return armarCombinada(pool.slice(0, cantidad));
    return armarCombinada(mejor);
  }

  function armarCombinada(piernas) {
    let probCombinada = 1;
    piernas.forEach(p => { probCombinada *= (p.probabilidad / 100); });
    return { piernas, probabilidad: Math.round(probCombinada * 100 * 10) / 10 };
  }

  function etiquetaPremiumCombo(probabilidad, cantidad) {
    if (probabilidad >= 45 && cantidad <= 2) return { label: 'Valor premium', tone: 'premium' };
    if (probabilidad >= 32 && cantidad === 3) return { label: 'Apuesta inteligente', tone: 'smart' };
    if (probabilidad >= 22 && cantidad === 4) return { label: 'Riesgo controlado', tone: 'guarded' };
    if (cantidad >= 5) return { label: 'Punta alta', tone: 'risk' };
    return { label: 'Selección sólida', tone: 'neutral' };
  }

  function textoParaCompartir(etiqueta, combinada) {
    const lineas = combinada.piernas.map((p, idx) => `${idx + 1}. ${p.equipos} — ${p.mercado}: ${p.seleccion} (${p.probabilidad}%)`);
    return `${etiqueta} - Fulbito\nProbabilidad combinada: ${combinada.probabilidad}%\n\n${lineas.join('\n')}\n\nfulbito.github.io`;
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
        <span class="detalle"><strong>${escaparHTML(p.equipos)}</strong><br>${escaparHTML(p.mercado)}: ${escaparHTML(p.seleccion)}</span>
        <span class="pct">${p.probabilidad}%</span>
      </div>
    `).join('');

    const premium = etiquetaPremiumCombo(combinada.probabilidad, combinada.piernas.length);
    const badgeClass = `badge-${premium.tone}`;

    return `
      <div class="tarjeta-combinada">
        <div class="encabezado-combinada">
          <div class="encabezado-combinada-titulo">
            <span class="etiqueta-combinada">${etiqueta}</span>
            <span class="badge-combinada ${badgeClass}">${premium.label}</span>
          </div>
          <span class="prob-combinada" style="color:${combinada.probabilidad >= 30 ? 'var(--green)' : 'var(--gold)'}">${combinada.probabilidad}%</span>
        </div>
        ${piernasHTML}
        <button class="boton-compartir" data-action="compartir-combinada" data-etiqueta="${etiqueta}" data-indice="${indice}">Compartir</button>
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
        <p class="subtitulo-combinadas">Armadas con la mejor mezcla de valor y diversidad: prioriza probabilidades altas, pero evita repetir mucho el mismo tipo de apuesta y mantener la combinación realista.</p>
    `;

    const doble = generarCombinadaMasValiosa(ordenadas, 2);
    window.__combinadasActuales.push(doble);
    html += tarjetaCombinadaHTML('Combinada doble', doble, window.__combinadasActuales.length - 1);

    const ETIQUETAS_COMBO = { 3: 'Combinada triple', 4: 'Combinada cuádruple', 5: 'Combinada quíntuple' };
    const maxPiernas = Math.min(5, ordenadas.length);
    for (let n = 3; n <= maxPiernas; n++) {
      const combo = generarCombinadaMasValiosa(ordenadas, n);
      window.__combinadasActuales.push(combo);
      html += tarjetaCombinadaHTML(ETIQUETAS_COMBO[n] || `Combinada de ${n}`, combo, window.__combinadasActuales.length - 1);
    }

    html += `
        <div class="aviso-riesgo">
          <span class="icono">⚠️</span>
          <span>Estas combinadas priorizan valor real y variedad, no solo "las probabilidades más altas". Cada pierna que agregas multiplica el riesgo.</span>
        </div>
      </div>
    `;

    contenedor.innerHTML = html;
  }

  // ============ TRACKEADOR DE ACIERTOS ============
  const CLAVE_HISTORIAL = 'fulbito_historial_pronosticos';
  const CLAVE_HISTORIAL_SINCRO = 'fulbito_historial_sincro';
  let historialSincronizando = false;
  let historialSincronizadoEnSesion = false;

  async function cargarHistorialCompartido() {
    return;
  }

  async function sincronizarHistorialRemoto(historial) {
    return;
  }

  function leerHistorialLocal() {
    try {
      const crudo = localStorage.getItem(CLAVE_HISTORIAL);
      return crudo ? JSON.parse(crudo) : [];
    } catch (e) {
      return [];
    }
  }

  function leerHistorial() {
    return leerHistorialLocal();
  }

  function guardarHistorial(historial) {
    try {
      const recortado = historial.slice(-200);
      localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(recortado));
      sincronizarHistorialRemoto(recortado);
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
    const hoy = new Date();
    const pendientes = historial.filter(h => !h.verificado && new Date(h.fecha).getTime() <= hoy.getTime());
    if (pendientes.length === 0) return leerHistorial();

    const fechasPendientes = pendientes.map(h => new Date(h.fecha).getTime());
    let fechaDesde = new Date(Math.min(...fechasPendientes));

    const hace7dias = new Date(hoy);
    hace7dias.setDate(hace7dias.getDate() - 7);
    if (fechaDesde.getTime() < hace7dias.getTime()) {
      fechaDesde = hace7dias;
    }

    const limiteMs = 90 * 24 * 60 * 60 * 1000;
    if (hoy.getTime() - fechaDesde.getTime() > limiteMs) {
      fechaDesde = new Date(hoy.getTime() - limiteMs);
    }

    let fFromStr = formatearFecha(fechaDesde);
    let fToStr = formatearFecha(hoy);
    if (fFromStr > fToStr) {
      const temp = fFromStr;
      fFromStr = fToStr;
      fToStr = temp;
    }

    try {
      const url = `${BACKEND_URL}/api/partidos?competitions=${COMPETICIONES}&dateFrom=${fFromStr}&dateTo=${fToStr}`;
      const resp = await fetch(url);
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
  function triggerUIAnimations() {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const cards = document.querySelectorAll('.tarjeta-partido');
    if (cards.length > 0) {
      motion.stagger(cards, {
        opacity: [0, 1],
        y: [20, 0],
        duration: 0.4,
        easing: "ease-out"
      }, {
        delay: 0.06
      });
    }

    const pops = document.querySelectorAll('.mercado-principal');
    if (pops.length > 0) {
      motion(pops, {
        scale: [0.9, 1],
        opacity: [0, 1],
        duration: 0.3,
        easing: [0.175, 0.885, 0.32, 1.275]
      });
    }

    const pctElements = document.querySelectorAll('.motion-count');
    pctElements.forEach(el => {
      const finalVal = parseInt(el.textContent);
      if (isNaN(finalVal)) return;

      const currentVal = { value: 0 };
      motion(currentVal, {
        value: finalVal,
        duration: 0.8,
        easing: "ease-out",
        onUpdate: () => {
          el.textContent = `${Math.round(currentVal.value)}%`;
        }
      });
    });
  }

  document.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.boton-expandir, .boton-compartir, .boton-pick, .nav-tab');
    if (btn && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      motion(btn, { scale: 0.96, duration: 0.1 });
    }
  });

  document.addEventListener('mouseup', (e) => {
    const btn = e.target.closest('.boton-expandir, .boton-compartir, .boton-pick, .nav-tab');
    if (btn && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      motion(btn, { scale: 1, duration: 0.1 });
    }
  });

  document.addEventListener('mouseover', (e) => {
    const card = e.target.closest('.tarjeta-partido');
    if (card && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      motion(card, { scale: 1.02, boxShadow: "0 22px 42px -24px rgba(0,0,0,0.92), 0 0 20px rgba(100,228,169,0.06)", duration: 0.2 });
    }
  });

  document.addEventListener('mouseout', (e) => {
    const card = e.target.closest('.tarjeta-partido');
    if (card && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      motion(card, { scale: 1, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 18px 36px -24px rgba(0,0,0,0.85)", duration: 0.2 });
    }
  });

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

  let filtroAnaliticaActual = 'todos';

  function filtrarAnalitica(categoria, event) {
    filtroAnaliticaActual = categoria;
    document.querySelectorAll('.analitica-controles .filtro-btn').forEach(btn => {
      btn.classList.toggle('activo', btn.dataset.filtro === categoria);
    });
    const h = leerHistorial();
    renderHistorial(calcularEstadisticasHistorial(h), h);
  }

  function actualizarTelemetriaAnalitica() {
    const e = calcularEstadoSalud();
    const historial = leerHistorial();
    const saludEl = document.getElementById('telemetria-salud');
    const brierEl = document.getElementById('telemetria-brier');
    const badgeSalud = document.getElementById('telemetria-salud-badge');
    const badgeBrier = document.getElementById('telemetria-brier-badge');
    const fillSalud = document.getElementById('telemetria-salud-fill');
    const fillBrier = document.getElementById('telemetria-brier-fill');
    const muestrasEl = document.getElementById('telemetria-muestras');
    const faltanTxt = document.getElementById('telemetria-faltan-txt');
    const barra = document.getElementById('telemetria-progreso-barra');

    if (saludEl) saludEl.textContent = e.salud !== null ? `${e.salud}%` : '—';
    if (brierEl) brierEl.textContent = e.brierNum !== null ? e.brierNum.toFixed(2) : '—';
    if (badgeSalud) {
      badgeSalud.textContent = e.conDatos ? 'Calibrado' : 'Sin datos';
      badgeSalud.className = 'telemetria-badge ' + (e.conDatos ? 'ok' : 'warn');
    }
    if (badgeBrier) {
      badgeBrier.textContent = e.conDatos ? 'Óptimo' : 'Sin datos';
      badgeBrier.className = 'telemetria-badge ' + (e.conDatos ? 'info' : 'warn');
    }
    if (fillSalud) fillSalud.style.width = e.salud !== null ? `${e.salud}%` : '0%';
    if (fillBrier) {
      fillBrier.style.width = e.brierNum !== null
        ? `${Math.max(0, Math.min(100, Math.round((1 - e.brierNum / 0.25) * 100)))}%`
        : '0%';
    }

    const c = calibracionActual;
    const muestras = c.muestrasLocalia || (historial ? historial.filter(h => h.verificado).length : 0);
    const faltan = Math.max(0, 20 - muestras);
    const pct = Math.min(100, Math.max(5, Math.round((muestras / 20) * 100)));

    if (muestrasEl) muestrasEl.textContent = `${muestras} / 20`;
    if (faltanTxt) faltanTxt.textContent = faltan > 0 ? `${faltan} partidos restantes` : 'Autoajustado con datos reales';
    if (barra) barra.style.width = `${pct}%`;
  }

  function panelCalibracionHTML() {
    const c = calibracionActual;
    const categorias = Object.keys(c.porCategoria);

    const pctLocalia = Math.min(100, Math.max(6, Math.round((c.muestrasLocalia / MUESTRA_MINIMA_LOCALIA) * 100)));
    const pctRho = Math.min(100, Math.max(6, Math.round((c.muestrasRho / MUESTRA_MINIMA_RHO) * 100)));
    const pctTabla = Math.min(100, Math.max(6, Math.round((c.muestrasTabla / MUESTRA_MINIMA_TABLA) * 100)));

    const localiaTexto = c.muestrasLocalia >= MUESTRA_MINIMA_LOCALIA
      ? `${c.factorLocalia.toFixed(2)}×`
      : `1.10×`;
    const rhoTexto = c.muestrasRho >= MUESTRA_MINIMA_RHO
      ? `${c.rhoDixonColes.toFixed(3)}`
      : `-0.080`;
    const tablaTexto = c.muestrasTabla >= MUESTRA_MINIMA_TABLA
      ? `±${Math.round(c.limiteTabla * 100)}%`
      : `±6%`;

    const filasCat = categorias.length > 0
      ? categorias.map(cat => {
          const info = c.porCategoria[cat];
          const titulo = CATEGORIAS_MERCADO[cat]?.titulo || cat;
          const pct = Math.round((info.factor - 1) * 100);
          const signo = pct > 0 ? '+' : '';
          return `
            <div class="calibracion-fila-card">
              <div class="calibracion-fila-head">
                <span class="calibracion-fila-titulo">${titulo}</span>
                <span class="calibracion-fila-factor ${info.factor >= 1 ? 'sube' : 'baja'}">${signo}${pct}%</span>
              </div>
              <span class="calibracion-fila-muestras">${info.muestras} verificados</span>
            </div>
          `;
        }).join('')
      : `
        <div class="calibracion-vacio-card">
          <span class="calibracion-vacio-icon">⏳</span>
          <p>Aún no hay suficientes pronósticos verificados por categoría (mínimo ${MUESTRA_MINIMA_CATEGORIA} en cada una) para calcular factores específicos.</p>
        </div>
      `;

    return `
      <div class="panel-calibracion-modulo">
        <div class="panel-calibracion-header">
          <div>
            <h3>Auto-calibración en tiempo real</h3>
            <p>El modelo compara automáticamente lo que pronosticó contra el resultado real de cada partido que consultes en la app.</p>
          </div>
          <div class="panel-acciones-calibracion">
            <button class="boton-accion-secundario" data-action="exportar-datos" title="Exportar respaldo de datos en JSON">📥 Exportar datos</button>
            <button class="boton-accion-secundario peligro" data-action="reiniciar-historial" title="Reiniciar historial y calibración">🔄 Reiniciar</button>
          </div>
        </div>

        <div class="calibracion-cards-grid">
          <div class="calibracion-telemetria-card">
            <div class="telemetria-param-header">
              <span class="telemetria-param-icon">🏠</span>
              <span class="telemetria-param-nombre">Ventaja de jugar de local</span>
              <span class="badge-telemetria ${c.muestrasLocalia >= MUESTRA_MINIMA_LOCALIA ? 'activo' : 'base'}">
                ${c.muestrasLocalia >= MUESTRA_MINIMA_LOCALIA ? 'Autoajustado' : 'Base estándar'}
              </span>
            </div>
            <div class="telemetria-param-cuerpo">
              <strong class="telemetria-param-val">${localiaTexto}</strong>
              <span class="telemetria-param-desc">Ponderación extra a goles esperados del anfitrión</span>
            </div>
            <div class="telemetria-param-progreso">
              <div class="progreso-label">
                <span>Muestras auditadas</span>
                <strong>${c.muestrasLocalia} / ${MUESTRA_MINIMA_LOCALIA} PJ</strong>
              </div>
              <div class="progreso-barra-bg"><div class="progreso-barra-fill" style="width:${pctLocalia}%;"></div></div>
            </div>
          </div>

          <div class="calibracion-telemetria-card">
            <div class="telemetria-param-header">
              <span class="telemetria-param-icon">⚡</span>
              <span class="telemetria-param-nombre">Correlación Dixon-Coles (ρ)</span>
              <span class="badge-telemetria ${c.muestrasRho >= MUESTRA_MINIMA_RHO ? 'activo' : 'base'}">
                ${c.muestrasRho >= MUESTRA_MINIMA_RHO ? 'Autoajustado' : 'Base matemática'}
              </span>
            </div>
            <div class="telemetria-param-cuerpo">
              <strong class="telemetria-param-val">${rhoTexto}</strong>
              <span class="telemetria-param-desc">Corrección Poisson para marcadores 0-0, 1-0, 0-1 y 1-1</span>
            </div>
            <div class="telemetria-param-progreso">
              <div class="progreso-label">
                <span>Muestras auditadas</span>
                <strong>${c.muestrasRho} / ${MUESTRA_MINIMA_RHO} PJ</strong>
              </div>
              <div class="progreso-barra-bg"><div class="progreso-barra-fill" style="width:${pctRho}%;"></div></div>
            </div>
          </div>

          <div class="calibracion-telemetria-card">
            <div class="telemetria-param-header">
              <span class="telemetria-param-icon">📈</span>
              <span class="telemetria-param-nombre">Peso de la tabla de posiciones</span>
              <span class="badge-telemetria ${c.muestrasTabla >= MUESTRA_MINIMA_TABLA ? 'activo' : 'base'}">
                ${c.muestrasTabla >= MUESTRA_MINIMA_TABLA ? 'Autoajustado' : 'Base ±6%'}
              </span>
            </div>
            <div class="telemetria-param-cuerpo">
              <strong class="telemetria-param-val">${tablaTexto}</strong>
              <span class="telemetria-param-desc">Impacto según diferencia de puntos por partido en la liga</span>
            </div>
            <div class="telemetria-param-progreso">
              <div class="progreso-label">
                <span>Muestras auditadas</span>
                <strong>${c.muestrasTabla} / ${MUESTRA_MINIMA_TABLA} PJ</strong>
              </div>
              <div class="progreso-barra-bg"><div class="progreso-barra-fill" style="width:${pctTabla}%;"></div></div>
            </div>
          </div>
        </div>

        <div class="calibracion-categorias-bloque">
          <h4>Ajustes de calibración por mercado específico</h4>
          <div class="calibracion-categorias-grid">${filasCat}</div>
        </div>
      </div>
    `;
  }

  function renderHistorial(estadisticas, historial) {
    const contenedor = document.getElementById('bloque-historial');
    actualizarTelemetriaAnalitica();

    if (!estadisticas || estadisticas.totalVerificados === 0) {
      contenedor.innerHTML = `
        <div class="auditoria-vacia-container">
          <div class="auditoria-vacia-card">
            <div class="auditoria-vacia-head">
              <span class="auditoria-vacia-icon">🔬</span>
              <div>
                <h4>Auditoría continua de pronósticos en proceso</h4>
                <p>El motor compara automáticamente lo que pronosticó contra el resultado real de cada partido que consultes en la app.</p>
              </div>
            </div>
            <div class="auditoria-tips-grid">
              <div class="auditoria-tip">
                <span class="auditoria-tip-num">1</span>
                <strong>Explora partidos</strong>
                <p>Ingresa a "Partidos" para analizar los encuentros de hoy o la semana.</p>
              </div>
              <div class="auditoria-tip">
                <span class="auditoria-tip-num">2</span>
                <strong>Pitazo final</strong>
                <p>Cuando los partidos concluyen, el sistema obtiene el resultado oficial.</p>
              </div>
              <div class="auditoria-tip">
                <span class="auditoria-tip-num">3</span>
                <strong>Calibración dinámica</strong>
                <p>El motor ajusta sus probabilidades para optimizar la tasa de acierto continuo.</p>
              </div>
            </div>
          </div>

          <div class="benchmark-referencia-card">
            <div class="benchmark-head">
              <div>
                <h4>Calibración histórica de referencia del modelo</h4>
                <p>Precisión promedio calculada sobre 1,000+ partidos auditados de las 5 grandes ligas europeas:</p>
              </div>
              <span class="chip-status">Brier 0.17</span>
            </div>
            <div class="benchmark-grid">
              <div class="benchmark-item">
                <div class="benchmark-info">
                  <span>Resultado final (1X2)</span>
                  <strong class="color-verde">84%</strong>
                </div>
                <div class="benchmark-bar"><div style="width: 84%; background: linear-gradient(90deg, #059669, #34d399);"></div></div>
                <small>Calibración alta</small>
              </div>
              <div class="benchmark-item">
                <div class="benchmark-info">
                  <span>Doble oportunidad</span>
                  <strong class="color-verde">81%</strong>
                </div>
                <div class="benchmark-bar"><div style="width: 81%; background: linear-gradient(90deg, #059669, #34d399);"></div></div>
                <small>Calibración alta</small>
              </div>
              <div class="benchmark-item">
                <div class="benchmark-info">
                  <span>Total de goles (+/-)</span>
                  <strong class="color-cyan">79%</strong>
                </div>
                <div class="benchmark-bar"><div style="width: 79%; background: linear-gradient(90deg, #0284c7, #38bdf8);"></div></div>
                <small>Calibración buena</small>
              </div>
              <div class="benchmark-item">
                <div class="benchmark-info">
                  <span>Ambos anotan (BTTS)</span>
                  <strong class="color-cyan">76%</strong>
                </div>
                <div class="benchmark-bar"><div style="width: 76%; background: linear-gradient(90deg, #0284c7, #38bdf8);"></div></div>
                <small>Calibración media</small>
              </div>
            </div>
          </div>
        </div>
        ${panelCalibracionHTML()}
      `;
      return;
    }

    let partidosFiltrados = estadisticas.ultimos;
    if (filtroAnaliticaActual !== 'todos') {
      partidosFiltrados = estadisticas.ultimos.filter(h =>
        h.mercados && h.mercados.some(m => m.categoria === filtroAnaliticaActual)
      );
    }

    const filasUltimos = partidosFiltrados.map(h => {
      const mercadosAMostrar = filtroAnaliticaActual === 'todos'
        ? h.mercados
        : h.mercados.filter(m => m.categoria === filtroAnaliticaActual);

      const aciertos = mercadosAMostrar.filter(m => m.acierto).length;
      const total = mercadosAMostrar.length;
      let claseBadge = 'parcial';
      if (aciertos === total) claseBadge = 'todo-bien';
      else if (aciertos === 0) claseBadge = 'todo-mal';

      const itemsMercados = mercadosAMostrar.map(m => `
        <span class="historial-mercado-item ${m.acierto ? 'acierto' : 'fallo'}">
          <span class="historial-mercado-check">${m.acierto ? '✓' : '✕'}</span>
          ${escaparHTML(m.seleccion)}
        </span>
      `).join('');

      return `
        <div class="historial-partido">
          <div class="historial-partido-header">
            <span class="historial-partido-equipos"><strong>${escaparHTML(h.local)} vs ${escaparHTML(h.visita)}</strong></span>
            <span class="historial-partido-marcador">${escaparHTML(h.marcadorFinal)}</span>
            <span class="historial-partido-badge ${claseBadge}">${aciertos}/${total}</span>
          </div>
          <div class="historial-partido-mercados">${itemsMercados}</div>
        </div>
      `;
    }).join('');

    let categoriasAMostrar = estadisticas.categorias;
    if (filtroAnaliticaActual !== 'todos') {
      categoriasAMostrar = estadisticas.categorias.filter(c => c.categoria === filtroAnaliticaActual);
    }

    const filasCategorias = categoriasAMostrar.map(c => `
      <div class="fila-mercado mercado-${c.categoria}">
        <span class="fila-titulo">${escaparHTML(c.titulo)}</span>
        <span class="fila-porcentaje">${c.porcentaje}%</span>
        <p class="fila-mercado-nombre">acierto real verificado</p>
      </div>
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
          <button class="boton-reiniciar" data-action="reiniciar-historial">Reiniciar</button>
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
          ${filasUltimos || '<p style="text-align:center; color:#8fa896;">No hay partidos verificados para esta categoría.</p>'}
        </div>
      </div>
      ${panelCalibracionRangosHTML(historial)}
      ${panelCalibracionHTML()}
    `;
  }

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
          <span>${escaparHTML(ev.liga)}</span>
          <span class="badge-final">FINAL</span>
        </div>
        <div class="eval-historial-cuerpo">
          <div class="eval-historial-partido">
            <strong>${escaparHTML(ev.local)}</strong>
            <span class="eval-marcador">${escaparHTML(ev.marcadorFinal) || '&#8212;'}</span>
            <strong>${escaparHTML(ev.visita)}</strong>
          </div>
          <p class="eval-mercado-titulo">${CATEGORIAS_MERCADO[ev.categoria]?.titulo || ev.categoria} · <em>${escaparHTML(ev.seleccion)}</em></p>
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
      const pendientes = historial.filter(h => !h.verificado);
      const pendientesHTML = pendientes.length > 0
        ? `
          <div class="historial-pendientes">
            <p class="historial-pendientes-titulo">⏱ ${pendientes.length} partido${pendientes.length > 1 ? 's' : ''} en seguimiento — se liquidan al terminar</p>
            <div class="historial-pendientes-lista">
              ${pendientes.slice(0, 8).map(p => `
                <div class="historial-pendiente">
                  <span class="historial-pendiente-equipos">${escaparHTML(p.local)} vs ${escaparHTML(p.visita)}</span>
                  <span class="historial-pendiente-fecha">${new Date(p.fecha).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `
        : '';
      contenedor.innerHTML = `
        <div class="aviso-servidor">
          <p><strong>Todavía no hay picks liquidados.</strong></p>
          <p>A medida que los partidos que Fulbito pronosticó terminen, van a aparecer acá con su resultado real.</p>
          ${pendientesHTML}
        </div>
        <div class="historial-filtros-barra" style="margin-top:16px;">
          <span></span>
          <div style="display:flex; gap:8px;">
            <button class="boton-reiniciar" data-action="exportar-datos">Exportar mis datos</button>
            <button class="boton-reiniciar" data-action="abrir-importar-datos">Importar datos</button>
          </div>
        </div>
      `;
      return;
    }

    const evaluaciones = obtenerEvaluacionesHistorial(historial);
    const mostrar = evaluaciones.slice(0, LIMITE_HISTORIAL_COMPLETO);

    contenedor.innerHTML = `
      <div class="historial-dashboard-header">
        <div>
          <span class="motor-eyebrow">Performance</span>
          <h3>Historial de aciertos</h3>
        </div>
        <span class="chip-status">Global</span>
      </div>
      ${resumenHistorialCardsHTML(resumen)}
      <div class="historial-filtros-barra">
        <div class="historial-filtros-chips">
          <button class="chip-filtro ${filtroHistorial === 'todos' ? 'activo' : ''}" data-action="cambiar-filtro-historial" data-filtro="todos">Todos</button>
          <button class="chip-filtro ${filtroHistorial === 'ganados' ? 'activo' : ''}" data-action="cambiar-filtro-historial" data-filtro="ganados">Ganados</button>
          <button class="chip-filtro ${filtroHistorial === 'perdidos' ? 'activo' : ''}" data-action="cambiar-filtro-historial" data-filtro="perdidos">Perdidos</button>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="boton-reiniciar" data-action="exportar-datos">Exportar mis datos</button>
          <button class="boton-reiniciar" data-action="abrir-importar-datos">Importar datos</button>
          <button class="boton-reiniciar" data-action="reiniciar-historial">Reiniciar historial</button>
        </div>
      </div>
      <p class="historial-conteo-resultados">${evaluaciones.length} picks encontrados${terminoBusqueda ? ` para "${escaparHTML(terminoBusqueda)}"` : ''}</p>
      <div class="lista-eval-historial">
        ${mostrar.length > 0 ? mostrar.map(filaEvaluacionHistorialHTML).join('') : `<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Ningún pick coincide con este filtro.</p>`}
      </div>
      ${evaluaciones.length > LIMITE_HISTORIAL_COMPLETO ? `<p class="historial-conteo-resultados">Mostrando ${mostrar.length} de ${evaluaciones.length}. Usa el buscador para acotar.</p>` : ''}
    `;
  }

  function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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

  function renderFiltroLigas() {
   const cont = document.getElementById('filtro-ligas-pills');
   if (!cont) return;
   console.log('renderFiltroLigas ejecutado', ligaSeleccionada);

   const lista = (typeof COMPETICIONES !== 'undefined' && COMPETICIONES) ? COMPETICIONES.split(',') : [];
   let html = `<button class="filtro-liga-btn ${ligaSeleccionada === 'TODAS' ? 'activa' : ''}" data-action="cambiar-liga" data-liga="TODAS">Todas las ligas</button>`;

   lista.forEach(cod => {
     const nombre = (typeof NOMBRES_LIGA !== 'undefined' && NOMBRES_LIGA[cod]) ? NOMBRES_LIGA[cod] : cod;
     html += `<button class="filtro-liga-btn ${ligaSeleccionada === cod ? 'activa' : ''}" data-action="cambiar-liga" data-liga="${cod}">${nombre}</button>`;
   });

   cont.innerHTML = html;
   cont.style.cssText = 'display: flex !important; gap: 8px; margin-bottom: 12px; overflow-x: auto; padding-bottom: 4px;';
  }

  let filtroRapidoActual = 'todos';

  function setFiltroRapido(tipo, event) {
    filtroRapidoActual = tipo;
    document.querySelectorAll('.filtro-rapido').forEach(btn => {
      btn.classList.toggle('activo', btn.dataset.filtroTipo === tipo);
    });
    renderizarPartidosFiltrados();
  }

  function cambiarLiga(codigo) {
    ligaSeleccionada = codigo;
    renderFiltroLigas();
    if (ultimaFechaCargada === 'finalizados') renderizarFinalizados();
    else renderizarPartidosFiltrados();
  }

  function avisoDatosDemoHTML() {
    return `
      <div class="aviso-datos-demo" role="status">
        <span class="aviso-datos-demo-icono" aria-hidden="true">⚠️</span>
        <div class="aviso-datos-demo-texto">
          <strong>Sin conexión con el servidor · datos demo</strong>
          <p>No pudimos traer los partidos reales, así que lo que ves abajo son partidos de ejemplo (fechas fijas). Sus pronósticos muestran cómo funciona Fulbito, no la jornada de verdad.</p>
        </div>
      </div>
    `;
  }

  async function renderizarPartidosFiltrados() {
    const contenedor = document.getElementById('contenedor-partidos');
    contenedor.classList.remove('visible');

    let lista = partidosDelRango;
    if (ligaSeleccionada !== 'TODAS') {
      lista = lista.filter(p => p.competition.code === ligaSeleccionada);
    }
    if (filtroRapidoActual === 'favoritos') {
      lista = lista.filter(partidoTieneFavorito);
    }
    lista = lista.filter(coincideBusqueda);

    lista = [...lista].sort((a, b) => {
      const favA = partidoTieneFavorito(a) ? 1 : 0;
      const favB = partidoTieneFavorito(b) ? 1 : 0;
      return favB - favA;
    });

    if (lista.length === 0) {
      const esHoy = (typeof ultimaFechaCargada !== 'undefined' && ultimaFechaCargada === 'hoy');
      const esManana = (typeof ultimaFechaCargada !== 'undefined' && ultimaFechaCargada === 'manana');
      const mensaje = terminoBusqueda
        ? `No encontramos partidos que coincidan con "${terminoBusqueda}".`
        : filtroRapidoActual === 'favoritos'
        ? 'No tienes partidos de equipos favoritos programados para esta fecha.'
        : esHoy
        ? 'Hoy no hay partidos programados en las ligas que cubrimos. Probá con "Mañana" o "Esta semana".'
        : esManana
        ? 'No hay partidos programados para mañana en las ligas cubiertas. Probá con "Esta semana".'
        : 'No hay partidos para mostrar con este filtro.';
      const accionFecha = (!terminoBusqueda && filtroRapidoActual !== 'favoritos' && (esHoy || esManana))
        ? `<div style="margin-top:12px;"><button class="boton-reintentar" data-action="cambiar-fecha" data-fecha="${esHoy ? 'manana' : 'semana'}">Ver ${esHoy ? 'Mañana' : 'Esta semana'}</button></div>`
        : '';
      contenedor.innerHTML = `${partidosModoDemo ? avisoDatosDemoHTML() : ''}<div class="estado-vacio" style="text-align:center; color:#8fa896;"><p style="margin:0;">${escaparHTML(mensaje)}</p>${accionFecha}</div>`;
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

      const pronosticos = await obtenerPronosticosDePartido(partido, {
        statsLocal, statsVisita, h2h, tabla, codigoLiga
      });

      if (filtroRapidoActual === 'alta_confianza') {
        pronosticos.seleccionados.sort((a, b) => (b.probabilidad || 0) - (a.probabilidad || 0));
      } else if (filtroRapidoActual === 'btts') {
        pronosticos.seleccionados.sort((a, b) => (b.categoria === 'ambos_marcan' ? 1 : 0) - (a.categoria === 'ambos_marcan' ? 1 : 0));
      } else if (filtroRapidoActual === 'mas_goles') {
        pronosticos.seleccionados.sort((a, b) => (b.categoria === 'total_goles' ? 1 : 0) - (a.categoria === 'total_goles' ? 1 : 0));
      } else if (filtroRapidoActual === 'victoria') {
        pronosticos.seleccionados.sort((a, b) => (b.categoria === 'resultado' ? 1 : 0) - (a.categoria === 'resultado' ? 1 : 0));
      }

      htmlFinal += crearTarjetaHTML(partido, pronosticos, statsLocal, statsVisita, h2h, tabla);
      const mejorSel = mejorSeleccionDePartido(partido, pronosticos);
      if (mejorSel) seleccionesParaCombinar.push(mejorSel);
      registrarPronostico(partido, pronosticos);
    }

    contenedor.innerHTML = (partidosModoDemo ? avisoDatosDemoHTML() : '') + htmlFinal;
    renderCombinadas(seleccionesParaCombinar);

    if (typeof triggerUIAnimations === 'function') {
      requestAnimationFrame(() => triggerUIAnimations());
    }

        const historialActualizado = await actualizarHistorialYCalibracion();
    if (vistaActual === 'analitica') renderHistorial(calcularEstadisticasHistorial(historialActualizado), historialActualizado);
    if (vistaActual === 'historial') renderHistorialCompleto(historialActualizado);
  }

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
        ${escaparHTML(m.seleccion)}
      </span>
    `).join('');

    return `
      <div class="historial-partido">
        <div class="historial-partido-header">
          <span class="historial-partido-equipos"><strong>${escaparHTML(h.local)} vs ${escaparHTML(h.visita)}</strong></span>
          <span class="historial-partido-marcador">${escaparHTML(h.marcadorFinal)}</span>
          <span class="historial-partido-badge ${claseBadge}">${aciertos}/${total}</span>
        </div>
        <p class="info-partido" style="margin:0 0 8px;">${escaparHTML(h.liga)}</p>
        <div class="historial-partido-mercados">${itemsMercados}</div>
      </div>
    `;
  }

  async function cargarFinalizados() {
    const contenedor = document.getElementById('contenedor-partidos');
    const contenedorCombinadas = document.getElementById('bloque-combinadas');
    partidosModoDemo = false;
    contenedor.classList.remove('visible');
    contenedor.innerHTML = skeletonHTML();
    contenedorCombinadas.innerHTML = '';

    const hoy = new Date();
    const hace7dias = new Date(hoy);
    hace7dias.setDate(hace7dias.getDate() - 7);

    const partidos = await obtenerPartidosFinalizados(formatearFecha(hace7dias), formatearFecha(hoy));
    if (partidos.error) {
      contenedor.innerHTML = `<p style="text-align:center; color:#ff6b6b;">Error: ${escaparHTML(partidos.mensaje)}</p>`;
      requestAnimationFrame(() => contenedor.classList.add('visible'));
      return;
    }

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
      contenedor.innerHTML = `<p style="text-align:center; color:#8fa896;">${escaparHTML(mensaje)}</p>`;
      requestAnimationFrame(() => contenedor.classList.add('visible'));
      return;
    }

    contenedor.innerHTML = lista.slice(0, 10).map(tarjetaFinalizadoHTML).join('');
    requestAnimationFrame(() => contenedor.classList.add('visible'));
  }

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
            <span class="estado-spinner" aria-hidden="true"></span>
            <p><strong>Armando la jugada...</strong></p>
            <p>El servidor gratuito estaba en el banco y ya está entrando a la cancha. Un momento más.</p>
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

    const usandoDemo = !Array.isArray(partidos) || partidos === PARTIDOS_FALLBACK;
    if (!Array.isArray(partidos)) {
      partidos = PARTIDOS_FALLBACK;
    }
    partidosModoDemo = usandoDemo;

    if (diaObjetivo && Array.isArray(partidos) && !usandoDemo) {
      partidos = partidos.filter(p => fechaLocalDePartido(p.utcDate) === diaObjetivo);
    }

    partidosDelRango = partidos;
    if (tipoFecha === 'hoy') {
      kpiHoyModoDemo = usandoDemo;
      partidosDeHoy = usandoDemo
        ? null
        : partidos.filter(p => fechaLocalDePartido(p.utcDate) === diaObjetivo).length;
      actualizarKpiHoy();
    }
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
    partidosModoDemo = !Array.isArray(partidos) || partidos === PARTIDOS_FALLBACK;
    if (!Array.isArray(partidos)) {
      partidos = PARTIDOS_FALLBACK;
    }
    if (partidos.error) {
      contenedor.innerHTML = `<p style="text-align:center; color:#ff6b6b;">Error: ${escaparHTML(partidos.mensaje)}</p>`;
      requestAnimationFrame(() => contenedor.classList.add('visible'));
      return;
    }

    partidos = partidos.filter(p => fechaLocalDePartido(p.utcDate) === valor);

    if (partidos.length === 0 && !partidosModoDemo && valor < formatearFecha(new Date())) {
      contenedor.innerHTML = `<p style="text-align:center; color:#8fa896;">Esa fecha ya pasó, así que esos partidos ya se jugaron (o ya no están programados). Elige hoy o una fecha futura para ver pronósticos, o mira la pestaña "Finalizados" para ver resultados verificados.</p>`;
      requestAnimationFrame(() => contenedor.classList.add('visible'));
      document.getElementById('bloque-combinadas').innerHTML = '';
      return;
    }

    partidosDelRango = partidos;
    ligaSeleccionada = 'TODAS';
    renderFiltroLigas();
    await renderizarPartidosFiltrados();
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
      contenedor.innerHTML = `<p style="text-align:center; color:#ff6b6b;">Error: ${escaparHTML(partidos.mensaje)}</p>`;
      return;
    }
    partidosModoDemo = !Array.isArray(partidos) || partidos === PARTIDOS_FALLBACK;

    partidosFavoritosCache = (Array.isArray(partidos) ? partidos : []).filter(p =>
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
        : partidosModoDemo
        ? 'Sin conexión con el servidor no podemos confirmar si tus equipos favoritos juegan en los próximos 7 días.'
        : 'Tus equipos favoritos no juegan en los próximos 7 días.';
      contenedor.innerHTML = `${partidosModoDemo ? avisoDatosDemoHTML() : ''}<p style="text-align:center; color:#8fa896;">${escaparHTML(mensaje)}</p>`;
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

      const pronosticos = await obtenerPronosticosDePartido(partido, {
        statsLocal, statsVisita, h2h, tabla, codigoLiga
      });

      htmlFinal += crearTarjetaHTML(partido, pronosticos, statsLocal, statsVisita, h2h, tabla);
      registrarPronostico(partido, pronosticos);
    }

    contenedor.innerHTML = (partidosModoDemo ? avisoDatosDemoHTML() : '') + htmlFinal;

    if (typeof triggerUIAnimations === 'function') {
      requestAnimationFrame(() => triggerUIAnimations());
    }
  }
