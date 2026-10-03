  // ============ INICIALIZACION ============
  const inputFechaPersonalizada = document.getElementById('input-fecha-personalizada');
  if (inputFechaPersonalizada) inputFechaPersonalizada.min = formatearFecha(new Date());

  // Renderizado inmediato de ligas al cargar el DOM (antes de cualquier fetch)
  if (typeof renderFiltroLigas === 'function') {
    renderFiltroLigas();
  }

  cargarHistorialCompartido().finally(() => actualizarKPIsHome());
  actualizarContadorFavoritos();
  actualizarContadorMisPredicciones();
  actualizarKPIsHome();
  cargarPartidos('hoy');

  const hashInicial = window.location.hash.replace('#', '');
  if (hashInicial === 'inicio') {
    cambiarVista('inicio', false);
  } else if (['favoritos', 'analitica', 'mispredicciones', 'historial', 'pronosticos'].includes(hashInicial)) {
    cambiarVista(hashInicial, false);
  } else {
    history.replaceState(null, '', '#inicio');
    cambiarVista('inicio', false);
  }

  // Auto-actualizacion cada 3 minutos, solo si la pestaña esta visible
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      if (vistaActual === 'pronosticos') cargarPartidos(ultimaFechaCargada === 'otra' ? 'hoy' : ultimaFechaCargada);
      else if (vistaActual === 'favoritos') cargarFavoritos();
      else if (vistaActual === 'mispredicciones') actualizarHistorialYCalibracion().then(() => renderMisPredicciones());
      else if (vistaActual === 'historial') actualizarHistorialYCalibracion().then(h => renderHistorialCompleto(h));
    }
    actualizarKPIsHome();
  }, 3 * 60 * 1000);
  // ==========================================
  // LOGICA: MODAL ARMAR COMBINADA MANUAL (PARTE 1)
  // ==========================================
  let combinadaManualPicks = [];

  window.abrirModalArmarCombinada = async function() {
    let modal = document.getElementById('modal-armar-combinada');
    if (modal) {
      // Asegurar que esté adjunto directamente a document.body para evitar conflictos de transform/scroll de ancestros
      if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
      }
      modal.style.display = 'flex';
      modal.classList.add('activo');
    }
    document.body.style.overflow = 'hidden';
    await renderizarContenidoModalCombinada();
    actualizarResumenCombinadaManual();
  };

  window.cerrarModalArmarCombinada = function() {
    const modal = document.getElementById('modal-armar-combinada');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('activo');
    }
    document.body.style.overflow = '';
  };

  async function obtenerPronosticosDePartidoSeguro(partido) {
    const codigoLiga = partido.competition ? partido.competition.code : 'PL';
    try {
      const respPron = await fetch('pronosticos.json');
      if (respPron.ok) {
        const datos = await respPron.json();
        if (datos && datos.pronosticos && datos.pronosticos[partido.id]) {
          return datos.pronosticos[partido.id].pronosticos;
        }
      }
    } catch(e) {}

    try {
      const [h2h, tabla] = await Promise.all([
        obtenerHeadToHead(partido.id),
        obtenerTabla(codigoLiga)
      ]);
      const [statsLocal, statsVisita] = await Promise.all([
        obtenerStatsEquipo(partido.homeTeam.id, codigoLiga, tabla),
        obtenerStatsEquipo(partido.awayTeam.id, codigoLiga, tabla)
      ]);
      return generarPronosticos(
        statsLocal, statsVisita, partido.homeTeam.name, partido.awayTeam.name,
        h2h, tabla, partido.homeTeam.id, partido.awayTeam.id, codigoLiga
      );
    } catch (e) {
      return null;
    }
  }


  async function renderizarContenidoModalCombinada() {
    console.log('DEBUG: función iniciada');
    const body = document.getElementById('modal-combinada-body');
    if (!body) {
      console.log('DEBUG: #modal-combinada-body NO existe en el DOM');
      return;
    }
    console.log('DEBUG: #modal-combinada-body existe correctamente');
    body.innerHTML = '<p style="text-align:center; color:var(--text); padding:20px;">Cargando partidos y mercados disponibles...</p>';

    let partidos = (typeof partidosDelRango !== 'undefined' && partidosDelRango && partidosDelRango.length > 0)
      ? partidosDelRango
      : [];

    console.log('DEBUG: partidos disponibles', partidos);

    if (partidos.length === 0) {
      body.innerHTML = '<p style="text-align:center; color:var(--text); padding:20px;">No hay partidos cargados en este momento. Por favor espera a que carguen los partidos de la fecha.</p>';
      return;
    }

    const partidosPorLiga = {};
    for (const p of partidos) {
      const ligaCode = p.competition ? p.competition.code : 'OTRAS';
      if (!partidosPorLiga[ligaCode]) partidosPorLiga[ligaCode] = [];
      partidosPorLiga[ligaCode].push(p);
    }

    const ligasOrdenadas = Object.keys(partidosPorLiga).sort((a, b) => {
      const nombreA = (typeof NOMBRES_LIGA !== 'undefined' && NOMBRES_LIGA[a]) || a;
      const nombreB = (typeof NOMBRES_LIGA !== 'undefined' && NOMBRES_LIGA[b]) || b;
      return nombreA.localeCompare(nombreB);
    });

    let html = '';
    for (const ligaCode of ligasOrdenadas) {
      const nombreLiga = (typeof NOMBRES_LIGA !== 'undefined' && NOMBRES_LIGA[ligaCode]) || ligaCode;
      const listaPartidos = partidosPorLiga[ligaCode];

      html += `
        <div class="acordeon-liga" style="border:1px solid var(--card-border); border-radius:var(--radius-md); overflow:hidden; background:var(--card); box-shadow:var(--shadow-card); transition:all 0.2s ease;">
          <div class="acordeon-liga-header" onclick="toggleAcordeonLiga('${ligaCode}')" style="padding:14px 18px; background:linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)); cursor:pointer; display:flex; justify-content:space-between; align-items:center; user-select:none; font-weight:700; color:var(--text); border-bottom:1px solid var(--line);" onmouseover="this.style.background='rgba(123,225,200,0.06)'" onmouseout="this.style.background='linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:1.1rem;">🏆</span>
              <span style="font-size:0.95rem; letter-spacing:0.02em;">${nombreLiga}</span>
              <span style="font-size:0.75rem; padding:2px 8px; border-radius:999px; background:rgba(100,228,169,0.12); color:var(--green); font-family:var(--font-mono);">${listaPartidos.length} partidos</span>
            </div>
            <span id="acordeon-arrow-${ligaCode}" style="font-size:0.75rem; color:var(--text-muted); transition:transform 0.2s ease;">▼</span>
          </div>
          <div id="acordeon-content-${ligaCode}" class="acordeon-liga-content" style="padding:16px; display:flex; flex-direction:column; gap:14px; background:var(--bg-raised);">
      `;

      for (const partido of listaPartidos) {
        const local = partido.homeTeam.name;
        const visita = partido.awayTeam.name;
        const horaStr = partido.utcDate ? new Date(partido.utcDate).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';
        const pronosticos = await obtenerPronosticosDePartidoSeguro(partido);

        html += `
          <div class="partido-combinada-card" style="background:var(--card); border:1px solid var(--card-border); border-radius:var(--radius-md); padding:14px 16px; box-shadow:0 4px 16px -6px rgba(0,0,0,0.4); transition:all 0.18s ease;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid var(--line);">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:0.95rem;">⚽</span>
                <strong style="color:var(--text); font-size:0.92rem; font-family:var(--font-display);">${local} <span style="color:var(--text-muted); font-weight:400; font-size:0.85rem;">vs</span> ${visita}</strong>
              </div>
              <span style="font-size:0.78rem; color:var(--text-muted); font-family:var(--font-mono); background:rgba(255,255,255,0.03); padding:3px 8px; border-radius:999px; border:1px solid var(--line);">${horaStr}</span>
            </div>
            
            <div id="aviso-conflicto-${partido.id}" style="display:none; background:rgba(234,179,8,0.12); border:1px solid rgba(234,179,8,0.28); color:#facc15; font-size:0.78rem; padding:8px 12px; border-radius:var(--radius-sm); margin-bottom:10px; display:flex; align-items:center; gap:8px;">
              <span>⚠️</span>
              <span>Has seleccionado más de una opción del mismo tipo para este partido.</span>
            </div>

            <div class="mercados-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:8px;">
        `;

        if (pronosticos && pronosticos.seleccionados && pronosticos.seleccionados.length > 0) {
          pronosticos.seleccionados.forEach(mercado => {
            const pickId = `pick-${partido.id}-${encodeURIComponent(mercado.seleccion)}`;
            const isChecked = combinadaManualPicks.some(p => p.id === pickId);
            const prob = mercado.probabilidad || 50;
            const cuota = prob > 0 ? (1 / (prob / 100)).toFixed(2) : '1.00';
            const cat = mercado.categoria || 'otro';

            html += `
              <label style="display:flex; align-items:center; justify-content:space-between; gap:6px; background:var(--bg-raised); border:1px solid var(--line); border-radius:var(--radius-sm); padding:6px 10px; font-size:0.8rem; cursor:pointer; user-select:none;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <input type="checkbox" id="${pickId}" ${isChecked ? 'checked' : ''} onchange="togglePickCombinadaManual('${pickId}', ${partido.id}, '${local.replace(/'/g, "\\'")} vs ${visita.replace(/'/g, "\\'")}', '${ligaCode}', '${mercado.seleccion.replace(/'/g, "\\'")}', '${cat}', ${prob}, ${cuota})" style="cursor:pointer; accent-color:var(--green);">
                  <span style="color:var(--text);">${mercado.seleccion}</span>
                </div>
                <div style="display:flex; gap:6px; font-size:0.75rem;">
                  <span style="color:var(--green); font-weight:600;">${prob}%</span>
                  <span style="color:var(--brand); font-weight:600;">x${cuota}</span>
                </div>
              </label>
            `;
          });
        } else {
          html += `<p style="font-size:0.8rem; color:var(--text-muted); grid-column: 1/-1;">Mercados no disponibles</p>`;
        }

        html += `
            </div>
          </div>
        `;
      }

      html += `
          </div>
        </div>
      `;
    }

    body.innerHTML = html;
    console.log('DEBUG: HTML insertado', body.innerHTML.length);
    verificarAvisosConflicto();
  }


  window.toggleAcordeonLiga = function(ligaCode) {
    const cont = document.getElementById(`acordeon-content-${ligaCode}`);
    const arrow = document.getElementById(`acordeon-arrow-${ligaCode}`);
    if (!cont) return;
    if (cont.style.display === 'none') {
      cont.style.display = 'flex';
      if (arrow) arrow.textContent = '▼';
    } else {
      cont.style.display = 'none';
      if (arrow) arrow.textContent = '▶';
    }
  };

  window.togglePickCombinadaManual = function(pickId, partidoId, partidoTxt, liga, seleccion, categoria, prob, cuota) {
    const idx = combinadaManualPicks.findIndex(p => p.id === pickId);
    if (idx >= 0) {
      combinadaManualPicks.splice(idx, 1);
    } else {
      combinadaManualPicks.push({
        id: pickId,
        partidoId,
        partidoTxt,
        liga,
        seleccion,
        categoria,
        probabilidad: Number(prob),
        cuota: Number(cuota)
      });
    }
    actualizarResumenCombinadaManual();
    verificarAvisosConflicto();
  };

  function verificarAvisosConflicto() {
    const picksPorPartido = {};
    combinadaManualPicks.forEach(p => {
      if (!picksPorPartido[p.partidoId]) picksPorPartido[p.partidoId] = [];
      picksPorPartido[p.partidoId].push(p);
    });

    document.querySelectorAll('[id^="aviso-conflicto-"]').forEach(el => el.style.display = 'none');

    Object.keys(picksPorPartido).forEach(partidoId => {
      const picks = picksPorPartido[partidoId];
      const categorias = picks.map(p => p.categoria);
      const repetida = categorias.some((c, i) => categorias.indexOf(c) !== i);
      const aviso = document.getElementById(`aviso-conflicto-${partidoId}`);
      if (aviso) {
        aviso.style.display = repetida ? 'block' : 'none';
      }
    });
  }

  function actualizarResumenCombinadaManual() {
    const countEl = document.getElementById('comb-count-picks');
    const probEl = document.getElementById('comb-prob-total');
    const cuotaEl = document.getElementById('comb-cuota-total');

    const totalPicks = combinadaManualPicks.length;
    if (countEl) countEl.textContent = totalPicks;

    if (totalPicks === 0) {
      if (probEl) { probEl.textContent = '0%'; probEl.style.color = 'var(--text-muted)'; }
      if (cuotaEl) { cuotaEl.textContent = '1.00'; }
      return;
    }

    let probAcumulada = combinadaManualPicks.reduce((acc, p) => acc * (p.probabilidad / 100), 1) * 100;
    probAcumulada = Math.round(probAcumulada * 10) / 10;

    let cuotaTotal = combinadaManualPicks.reduce((acc, p) => acc * p.cuota, 1);
    cuotaTotal = Math.round(cuotaTotal * 100) / 100;

    if (probEl) {
      probEl.textContent = `${probAcumulada}%`;
      if (probAcumulada >= 50) probEl.style.color = 'var(--green)';
      else if (probAcumulada >= 25) probEl.style.color = '#eab308';
      else probEl.style.color = '#ef4444';
    }

    if (cuotaEl) {
      cuotaEl.textContent = cuotaTotal.toFixed(2);
    }
  }

  window.limpiarCombinadaManual = function() {
    combinadaManualPicks = [];
    document.querySelectorAll('#modal-combinada-body input[type="checkbox"]').forEach(cb => cb.checked = false);
    actualizarResumenCombinadaManual();
    verificarAvisosConflicto();
  };

  window.quitarPickDeCombinada = function(pickId) {
    const idx = combinadaManualPicks.findIndex(p => p.id === pickId);
    if (idx >= 0) {
      combinadaManualPicks.splice(idx, 1);
      const cb = document.getElementById(pickId);
      if (cb) cb.checked = false;
      actualizarResumenCombinadaManual();
      verificarAvisosConflicto();
      confirmarCombinadaManual();
    }
  };


  // Renderer compartido del resumen de combinada (lo usan el modal manual y el asistido del FAB).
  // opts.permitirQuitar: muestra el botón × para sacar un pick (solo modal manual).
  function renderResumenCombinadaHTML(picks, opts) {
    const opciones = opts || {};
    if (!picks || picks.length === 0) return '';

    let probTotal = picks.reduce((acc, p) => acc * (p.probabilidad / 100), 1) * 100;
    probTotal = Math.round(probTotal * 10) / 10;
    let cuotaTotal = picks.reduce((acc, p) => acc * p.cuota, 1);
    cuotaTotal = Math.round(cuotaTotal * 100) / 100;

    let colorProb = '#22c55e';
    if (probTotal < 25) colorProb = '#ef4444';
    else if (probTotal < 50) colorProb = '#eab308';

    const itemsHTML = picks.map(p => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:var(--bg-raised); border:1px solid var(--line); border-radius:var(--radius-sm);">
        <div>
          <div style="font-weight:600; color:var(--text); font-size:0.88rem;">${p.partidoTxt}</div>
          <div style="font-size:0.8rem; color:var(--text-muted);">${p.seleccion}</div>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="color:var(--green); font-weight:700; font-size:0.85rem;">${p.probabilidad}%</span>
          <span style="color:var(--brand); font-weight:700; font-size:0.85rem;">x${p.cuota.toFixed(2)}</span>
          ${opciones.permitirQuitar ? `<button onclick="quitarPickDeCombinada('${p.id}')" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1.1rem; padding:0 4px;" title="Quitar">&times;</button>` : ''}
        </div>
      </div>
    `).join('');

    return `
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${itemsHTML}
      </div>

      <div style="background:var(--bg-raised); border:1px solid var(--card-border); border-radius:var(--radius-md); padding:16px; display:flex; justify-content:space-around; align-items:center; text-align:center;">
        <div>
          <div style="font-size:0.8rem; color:var(--text-muted);">Picks Seleccionados</div>
          <div style="font-size:1.4rem; font-weight:700; color:var(--text);">${picks.length}</div>
        </div>
        <div style="border-left:1px solid var(--line); height:32px;"></div>
        <div>
          <div style="font-size:0.8rem; color:var(--text-muted);">Probabilidad Total</div>
          <div style="font-size:1.4rem; font-weight:700; color:${colorProb};">${probTotal}%</div>
        </div>
        <div style="border-left:1px solid var(--line); height:32px;"></div>
        <div>
          <div style="font-size:0.8rem; color:var(--text-muted);">Cuota Estimada</div>
          <div style="font-size:1.4rem; font-weight:700; color:var(--brand);">x${cuotaTotal.toFixed(2)}</div>
        </div>
      </div>

      <div style="background:rgba(100,228,169,0.08); border:1px solid rgba(100,228,169,0.2); padding:12px 16px; border-radius:var(--radius-sm); font-size:0.82rem; color:var(--text); line-height:1.4;">
        💡 <strong>Nota sobre el riesgo:</strong> Agregar más selecciones multiplica la cuota final y el potencial retorno, pero cada pick extra reduce la probabilidad acumulada de acertar todas las condiciones juntas.
      </div>
    `;
  }

  window.confirmarCombinadaManual = function() {
    if (combinadaManualPicks.length === 0) {
      alert('Por favor, selecciona al menos 1 pick para armar tu combinada.');
      return;
    }
    const body = document.getElementById('modal-combinada-body');
    if (!body) return;
    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4 style="margin:0; font-size:1.1rem; color:var(--text);">Resumen de tu Combinada</h4>
          <button onclick="renderizarContenidoModalCombinada()" style="background:rgba(255,255,255,0.06); border:1px solid var(--line); color:var(--text); padding:6px 12px; border-radius:var(--radius-sm); font-size:0.8rem; cursor:pointer;">← Volver a editar</button>
        </div>
        ${renderResumenCombinadaHTML(combinadaManualPicks, { permitirQuitar: true })}
      </div>
    `;
  };
  window.compartirCombinadaDePicks = function(picks) {
    if (!picks || picks.length === 0) {
      alert('Selecciona al menos 1 pick para compartir tu combinada.');
      return;
    }
    let probTotal = Math.round(picks.reduce((acc, p) => acc * (p.probabilidad / 100), 1) * 1000) / 10;
    let cuotaTotal = Math.round(picks.reduce((acc, p) => acc * p.cuota, 1) * 100) / 100;
    let texto = `⚽ Mi Combinada de Fulbito (${picks.length} picks):\n` +
      picks.map(p => `• ${p.partidoTxt}: ${p.seleccion} (Cuota x${p.cuota.toFixed(2)}, ${p.probabilidad}%)`).join('\n') +
      `\n\nCuota Total: x${cuotaTotal} | Probabilidad: ${probTotal}%\nArmado en Fulbito App`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(() => {
        alert('¡Combinada copiada al portapapeles! Ya puedes compartirla.');
      }).catch(() => {
        prompt('Copia tu combinada:', texto);
      });
    } else {
      prompt('Copia tu combinada:', texto);
    }
  };

  window.compartirCombinadaManual = function() {
    compartirCombinadaDePicks(combinadaManualPicks);
  };

  window.guardarCombinadaDePicks = function(picks) {
    if (!picks || picks.length === 0) {
      alert('Selecciona al menos 1 pick para guardar tu combinada.');
      return false;
    }
    try {
      const guardadas = JSON.parse(localStorage.getItem('fulbito_combinadas_guardadas') || '[]');
      const nuevaComb = {
        id: 'comb_' + Date.now(),
        fecha: new Date().toISOString(),
        picks: picks,
        totalPicks: picks.length,
        probabilidad: Math.round(picks.reduce((acc, p) => acc * (p.probabilidad / 100), 1) * 1000) / 10,
        cuota: Math.round(picks.reduce((acc, p) => acc * p.cuota, 1) * 100) / 100
      };
      guardadas.unshift(nuevaComb);
      localStorage.setItem('fulbito_combinadas_guardadas', JSON.stringify(guardadas));
      alert('¡Combinada guardada con éxito!');
      return true;
    } catch(e) {
      alert('Error al guardar la combinada.');
      return false;
    }
  };

  window.guardarCombinadaGuardada = function() {
    if (guardarCombinadaDePicks(combinadaManualPicks)) cerrarModalArmarCombinada();
  };

  // ==========================================
  // LOGICA: COMBINADA ASISTIDA DEL FAB (2 PASOS)
  // Paso 1: selección de partidos (usa partidosDelRango → respeta el filtro de fecha activo).
  // Paso 2: perfil de riesgo. "Con más valor" queda deshabilitado: requiere cuotas reales de
  //         casas de apuestas para calcular valor esperado (pendiente como tarea aparte).
  // Reutiliza del modal manual: obtenerPronosticosDePartidoSeguro, el esquema de pick y
  // renderResumenCombinadaHTML / compartirCombinadaDePicks / guardarCombinadaDePicks.
  // ==========================================
  const PERFILES_COMBINADA_ASISTIDA = [
    { id: 'seguras', icono: '🛡️', nombre: 'Seguras', seleccionable: true, descripcion: 'El mercado de mayor probabilidad del modelo en cada partido (doble oportunidad, +1.5 goles, etc.).' },
    { id: 'valor', icono: '💎', nombre: 'Con más valor', seleccionable: false, badge: 'Próximamente 🔒', descripcion: 'Requiere cuotas reales de casas de apuestas para calcular el valor esperado. En evaluación como tarea aparte.' },
    { id: 'sonadoras', icono: '🚀', nombre: 'Soñadoras', seleccionable: true, descripcion: 'El mercado más atrevido de cada partido: menor probabilidad y mayor cuota justa (marcador exacto, hándicaps agresivos).' }
  ];

  let combinadaAsistidaPartidos = new Set();   // ids de partidos seleccionados en el paso 1
  let combinadaAsistidaPerfil = null;          // id del perfil elegido en el paso 2
  let combinadaAsistidaPicks = [];             // picks armados (mismo esquema que el modal manual)
  let asistidaPronosticosCache = {};           // cache de pronósticos por partido durante la sesión del modal
  let asistidaPartidosPorLiga = {};            // { ligaCode: [partidos] } del último render del paso 1

  window.abrirCombinadaAsistida = async function() {
    const modal = document.getElementById('modal-combinada-asistida');
    if (modal) {
      if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
      }
      modal.style.display = 'flex';
      modal.classList.add('activo');
    }
    document.body.style.overflow = 'hidden';
    // Estado fresco en cada apertura: los picks se derivan del perfil, rearmarlos no cuesta nada.
    combinadaAsistidaPartidos = new Set();
    combinadaAsistidaPerfil = null;
    combinadaAsistidaPicks = [];
    asistidaPronosticosCache = {};
    await renderAsistidaPaso1();
  };

  window.cerrarCombinadaAsistida = function() {
    const modal = document.getElementById('modal-combinada-asistida');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('activo');
    }
    document.body.style.overflow = '';
  };

  window.abrirModalManualDesdeAsistida = function() {
    cerrarCombinadaAsistida();
    abrirModalArmarCombinada();
  };

  async function obtenerPronosticosAsistida(partido) {
    const clave = String(partido.id);
    if (asistidaPronosticosCache[clave] !== undefined) return asistidaPronosticosCache[clave];
    const pronosticos = await obtenerPronosticosDePartidoSeguro(partido);
    asistidaPronosticosCache[clave] = pronosticos || null;
    return asistidaPronosticosCache[clave];
  }

  function actualizarStepperAsistida(paso) {
    const s1 = document.getElementById('asistida-step-1');
    const s2 = document.getElementById('asistida-step-2');
    if (!s1 || !s2) return;
    if (paso === 1) {
      s1.innerHTML = '<strong style="color:var(--brand);">1 · Partidos</strong>';
      s2.innerHTML = '<span style="color:var(--text-muted);">2 · Perfil</span>';
    } else if (paso === 2) {
      s1.innerHTML = '<span style="color:var(--green);">✓ Partidos</span>';
      s2.innerHTML = '<strong style="color:var(--brand);">2 · Perfil</strong>';
    } else {
      s1.innerHTML = '<span style="color:var(--green);">✓ Partidos</span>';
      s2.innerHTML = '<span style="color:var(--green);">✓ Perfil</span>';
    }
  }

  window.toggleAcordeonAsistida = function(ligaCode) {
    const cont = document.getElementById(`acordeon-asistida-content-${ligaCode}`);
    const arrow = document.getElementById(`acordeon-asistida-arrow-${ligaCode}`);
    if (!cont) return;
    if (cont.style.display === 'none') {
      cont.style.display = 'flex';
      if (arrow) arrow.textContent = '▼';
    } else {
      cont.style.display = 'none';
      if (arrow) arrow.textContent = '▶';
    }
  };

  window.togglePartidoAsistida = function(partidoId, ligaCode) {
    const clave = String(partidoId);
    if (combinadaAsistidaPartidos.has(clave)) {
      combinadaAsistidaPartidos.delete(clave);
    } else {
      combinadaAsistidaPartidos.add(clave);
    }
    actualizarContadoresAsistidaPaso1(ligaCode);
  };

  function contarSeleccionadosDeLiga(ligaCode) {
    const lista = asistidaPartidosPorLiga[ligaCode] || [];
    return lista.filter(p => combinadaAsistidaPartidos.has(String(p.id))).length;
  }

  function actualizarContadoresAsistidaPaso1(ligaCambiada) {
    const contador = document.getElementById('asistida-contador');
    if (contador) {
      const n = combinadaAsistidaPartidos.size;
      contador.textContent = n === 1 ? '1 partido seleccionado' : `${n} partidos seleccionados`;
    }
    const hint = document.getElementById('asistida-hint');
    if (hint) hint.style.display = combinadaAsistidaPartidos.size < 2 ? 'block' : 'none';
    const btn = document.getElementById('btn-asistida-continuar');
    if (btn) {
      const habilitado = combinadaAsistidaPartidos.size >= 2;
      btn.disabled = !habilitado;
      btn.style.opacity = habilitado ? '1' : '0.45';
      btn.style.cursor = habilitado ? 'pointer' : 'not-allowed';
    }
    if (ligaCambiada) {
      const chip = document.getElementById(`asistida-liga-count-${ligaCambiada}`);
      if (chip) {
        const total = (asistidaPartidosPorLiga[ligaCambiada] || []).length;
        chip.textContent = `${contarSeleccionadosDeLiga(ligaCambiada)}/${total} sel.`;
      }
    }
  }

  function renderFooterAsistidaPaso1() {
    const footer = document.getElementById('asistida-footer');
    if (!footer) return;
    footer.innerHTML = `
      <div style="flex:1; min-width:200px;">
        <strong id="asistida-contador" style="color:var(--text); font-size:0.9rem;">0 partidos seleccionados</strong>
        <div id="asistida-hint" style="display:block; font-size:0.75rem; color:var(--gold); margin-top:2px;">Elegí al menos 2 partidos para armar tu combinada.</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button onclick="cerrarCombinadaAsistida()" style="background:rgba(255,255,255,0.06); border:1px solid var(--line); color:var(--text); padding:8px 14px; border-radius:var(--radius-sm); font-weight:600; font-size:0.85rem; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">Cancelar</button>
        <button id="btn-asistida-continuar" onclick="irAPasoPerfil()" disabled style="background:linear-gradient(135deg, var(--green), var(--brand)); color:#07120d; border:none; padding:10px 20px; border-radius:var(--radius-sm); font-weight:800; font-size:0.9rem; box-shadow:0 4px 16px -4px rgba(100,228,169,0.6); transition:all 0.2s; opacity:0.45; cursor:not-allowed;" onmouseover="if(!this.disabled) this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='translateY(0)'">Continuar →</button>
      </div>
    `;
  }

  async function renderAsistidaPaso1() {
    actualizarStepperAsistida(1);
    const body = document.getElementById('asistida-body');
    if (!body) return;
    body.innerHTML = '<p style="text-align:center; color:var(--text); padding:20px;">Cargando partidos disponibles...</p>';
    renderFooterAsistidaPaso1();

    const partidos = (typeof partidosDelRango !== 'undefined' && partidosDelRango && partidosDelRango.length > 0)
      ? partidosDelRango
      : [];

    if (partidos.length === 0) {
      body.innerHTML = `
        <p style="text-align:center; color:var(--text); padding:20px;">No hay partidos cargados en este momento. Espera a que carguen los partidos de la fecha activa (Hoy / Mañana / Esta semana) y vuelve a abrir el asistente.</p>
        <button onclick="abrirModalManualDesdeAsistida()" style="align-self:center; background:rgba(255,255,255,0.06); border:1px solid var(--line); color:var(--text); padding:6px 12px; border-radius:var(--radius-sm); font-size:0.8rem; cursor:pointer;">Prefiero elegir los mercados a mano →</button>
      `;
      return;
    }

    // Agrupar por liga (mismo criterio que el modal manual)
    const partidosPorLiga = {};
    for (const p of partidos) {
      const ligaCode = p.competition ? p.competition.code : 'OTRAS';
      if (!partidosPorLiga[ligaCode]) partidosPorLiga[ligaCode] = [];
      partidosPorLiga[ligaCode].push(p);
    }
    asistidaPartidosPorLiga = partidosPorLiga;

    const ligasOrdenadas = Object.keys(partidosPorLiga).sort((a, b) => {
      const nombreA = (typeof NOMBRES_LIGA !== 'undefined' && NOMBRES_LIGA[a]) || a;
      const nombreB = (typeof NOMBRES_LIGA !== 'undefined' && NOMBRES_LIGA[b]) || b;
      return nombreA.localeCompare(nombreB);
    });

    let html = `
      <div style="display:flex; justify-content:flex-end;">
        <button onclick="abrirModalManualDesdeAsistida()" style="background:none; border:none; color:var(--text-muted); font-size:0.75rem; cursor:pointer; text-decoration:underline; padding:0;" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-muted)'">Prefiero elegir los mercados a mano →</button>
      </div>
    `;

    for (const ligaCode of ligasOrdenadas) {
      const nombreLiga = (typeof NOMBRES_LIGA !== 'undefined' && NOMBRES_LIGA[ligaCode]) || ligaCode;
      const listaPartidos = partidosPorLiga[ligaCode];
      const selLiga = contarSeleccionadosDeLiga(ligaCode);

      html += `
        <div class="acordeon-liga" style="border:1px solid var(--card-border); border-radius:var(--radius-md); overflow:hidden; background:var(--card); box-shadow:var(--shadow-card); transition:all 0.2s ease;">
          <div class="acordeon-liga-header" onclick="toggleAcordeonAsistida('${ligaCode}')" style="padding:14px 18px; background:linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)); cursor:pointer; display:flex; justify-content:space-between; align-items:center; user-select:none; font-weight:700; color:var(--text); border-bottom:1px solid var(--line);" onmouseover="this.style.background='rgba(123,225,200,0.06)'" onmouseout="this.style.background='linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <span style="font-size:1.1rem;">🏆</span>
              <span style="font-size:0.95rem; letter-spacing:0.02em;">${nombreLiga}</span>
              <span style="font-size:0.75rem; padding:2px 8px; border-radius:999px; background:rgba(100,228,169,0.12); color:var(--green); font-family:var(--font-mono);">${listaPartidos.length} partidos</span>
              <span id="asistida-liga-count-${ligaCode}" style="font-size:0.75rem; padding:2px 8px; border-radius:999px; background:rgba(123,225,200,0.10); color:var(--brand); font-family:var(--font-mono);">${selLiga}/${listaPartidos.length} sel.</span>
            </div>
            <span id="acordeon-asistida-arrow-${ligaCode}" style="font-size:0.75rem; color:var(--text-muted); transition:transform 0.2s ease;">▼</span>
          </div>
          <div id="acordeon-asistida-content-${ligaCode}" class="acordeon-liga-content" style="padding:16px; display:flex; flex-direction:column; gap:12px; background:var(--bg-raised);">
      `;

      for (const partido of listaPartidos) {
        const local = partido.homeTeam.name;
        const visita = partido.awayTeam.name;
        const horaStr = partido.utcDate ? new Date(partido.utcDate).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';
        const pronosticos = await obtenerPronosticosAsistida(partido);
        const disponible = !!(pronosticos && pronosticos.seleccionados && pronosticos.seleccionados.length > 0);
        const checked = combinadaAsistidaPartidos.has(String(partido.id)) ? 'checked' : '';
        const disabled = disponible ? '' : 'disabled';

        html += `
          <label for="asistida-partido-${partido.id}" style="display:flex; align-items:center; justify-content:space-between; gap:10px; background:var(--card); border:1px solid var(--card-border); border-radius:var(--radius-md); padding:12px 16px; ${disponible ? '' : 'opacity:0.55;'} cursor:${disponible ? 'pointer' : 'not-allowed'}; transition:all 0.18s ease;">
            <div style="display:flex; align-items:center; gap:10px;">
              <input type="checkbox" id="asistida-partido-${partido.id}" ${checked} ${disabled} onchange="togglePartidoAsistida('${partido.id}', '${ligaCode}')" style="width:18px; height:18px; flex-shrink:0; cursor:${disponible ? 'pointer' : 'not-allowed'}; accent-color:var(--green);">
              <div>
                <div style="font-weight:600; color:var(--text); font-size:0.92rem; font-family:var(--font-display);">${local} <span style="color:var(--text-muted); font-weight:400; font-size:0.85rem;">vs</span> ${visita}</div>
                ${disponible ? '' : '<div style="font-size:0.75rem; color:#facc15; margin-top:2px;">Pronósticos no disponibles para este partido</div>'}
              </div>
            </div>
            <span style="font-size:0.78rem; color:var(--text-muted); font-family:var(--font-mono); background:rgba(255,255,255,0.03); padding:3px 8px; border-radius:999px; border:1px solid var(--line); flex-shrink:0;">${horaStr}</span>
          </label>
        `;
      }

      html += `
          </div>
        </div>
      `;
    }

    body.innerHTML = html;
    actualizarContadoresAsistidaPaso1();
  }

  // ---------- PASO 2: PERFIL DE RIESGO ----------
  window.irAPasoPerfil = function() {
    if (combinadaAsistidaPartidos.size < 2) return;
    renderAsistidaPaso2();
  };

  window.volverAPasoPartidos = function() {
    renderAsistidaPaso1();
  };

  function obtenerElegidosAsistida() {
    const elegidos = [];
    Object.keys(asistidaPartidosPorLiga).forEach(ligaCode => {
      (asistidaPartidosPorLiga[ligaCode] || []).forEach(p => {
        if (combinadaAsistidaPartidos.has(String(p.id))) elegidos.push(p);
      });
    });
    return elegidos;
  }

  function renderAsistidaPaso2() {
    actualizarStepperAsistida(2);
    const body = document.getElementById('asistida-body');
    const footer = document.getElementById('asistida-footer');
    if (!body || !footer) return;

    const elegidos = obtenerElegidosAsistida();
    const nombres = elegidos.map(p => `${p.homeTeam.name} vs ${p.awayTeam.name}`).join(' · ');

    const tarjetas = PERFILES_COMBINADA_ASISTIDA.map(perfil => {
      const seleccionado = combinadaAsistidaPerfil === perfil.id;
      const estiloCard = seleccionado
        ? 'border:1px solid var(--brand); background:rgba(123,225,200,0.07);'
        : 'border:1px solid var(--card-border); background:var(--bg-raised);';
      const cursor = perfil.seleccionable ? 'cursor:pointer;' : 'cursor:not-allowed; opacity:0.6;';
      const radio = seleccionado
        ? '<span style="width:18px; height:18px; border-radius:50%; border:2px solid var(--brand); display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;"><span style="width:9px; height:9px; border-radius:50%; background:var(--brand);"></span></span>'
        : '<span style="width:18px; height:18px; border-radius:50%; border:2px solid var(--line); display:inline-block; flex-shrink:0;"></span>';
      const badge = perfil.badge ? `<span style="font-size:0.68rem; padding:2px 8px; border-radius:999px; background:rgba(148,163,184,0.15); color:var(--text-muted); border:1px dashed rgba(148,163,184,0.35);">${perfil.badge}</span>` : '';
      const click = perfil.seleccionable ? `onclick="elegirPerfilAsistida('${perfil.id}')"` : '';
      return `
        <div data-perfil="${perfil.id}" ${click} style="display:flex; align-items:flex-start; gap:12px; padding:14px 16px; border-radius:var(--radius-md); ${estiloCard} ${cursor} transition:all 0.18s ease; user-select:none;">
          <span style="font-size:1.3rem; line-height:1;">${perfil.icono}</span>
          <div style="flex:1;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <strong style="color:var(--text); font-size:0.95rem; font-family:var(--font-display);">${perfil.nombre}</strong>
              ${badge}
            </div>
            <p style="margin:4px 0 0; font-size:0.8rem; color:var(--text-muted); line-height:1.45;">${perfil.descripcion}</p>
          </div>
          ${radio}
        </div>
      `;
    }).join('');

    const perfilElegido = PERFILES_COMBINADA_ASISTIDA.find(p => p.id === combinadaAsistidaPerfil);
    footer.innerHTML = `
      <div style="flex:1; min-width:200px; font-size:0.8rem; color:var(--text-muted);">
        ${perfilElegido ? `Perfil elegido: <strong style="color:var(--text);">${perfilElegido.nombre}</strong>` : 'Elegí un perfil para continuar.'}
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button onclick="volverAPasoPartidos()" style="background:rgba(255,255,255,0.06); border:1px solid var(--line); color:var(--text); padding:8px 14px; border-radius:var(--radius-sm); font-weight:600; font-size:0.85rem; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">← Volver</button>
        <button id="btn-asistida-armar" onclick="armarCombinadaAsistida()" ${perfilElegido ? '' : 'disabled'} style="background:linear-gradient(135deg, var(--green), var(--brand)); color:#07120d; border:none; padding:10px 20px; border-radius:var(--radius-sm); font-weight:800; font-size:0.9rem; box-shadow:0 4px 16px -4px rgba(100,228,169,0.6); transition:all 0.2s; ${perfilElegido ? '' : 'opacity:0.45; cursor:not-allowed;'}" onmouseover="if(!this.disabled) this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='translateY(0)'">Armar combinada ✨</button>
      </div>
    `;

    body.innerHTML = `
      <button onclick="volverAPasoPartidos()" style="align-self:flex-start; background:none; border:none; color:var(--text-muted); font-size:0.8rem; cursor:pointer; padding:0;" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-muted)'">← Cambiar partidos</button>
      <div style="background:var(--bg-raised); border:1px solid var(--line); border-radius:var(--radius-md); padding:12px 16px; font-size:0.85rem; color:var(--text); line-height:1.5;">
        <strong style="color:var(--text);">Tus ${elegidos.length} partidos:</strong>
        <span style="color:var(--text-muted);">${nombres}</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:12px;">
        <p style="margin:0; font-size:0.9rem; color:var(--text); font-weight:600;">¿Qué tan arriesgada la querés?</p>
        ${tarjetas}
      </div>
    `;
  }

  window.elegirPerfilAsistida = function(perfilId) {
    const perfil = PERFILES_COMBINADA_ASISTIDA.find(p => p.id === perfilId);
    if (!perfil || !perfil.seleccionable) return;
    combinadaAsistidaPerfil = perfilId;
    renderAsistidaPaso2();
  };

  // ---------- ARMADO Y RESUMEN ----------
  function elegirMercadoSegunPerfil(pronosticos, perfilId) {
    if (!pronosticos || !pronosticos.seleccionados || pronosticos.seleccionados.length === 0) return null;
    const lista = pronosticos.seleccionados;
    if (perfilId === 'seguras') {
      // Mayor probabilidad del modelo; si todos están marcados "sin apuesta", usa el mejor igual.
      const apostables = lista.filter(m => !m.sinApuesta);
      const pool = apostables.length > 0 ? apostables : lista;
      return pool.reduce((a, b) => (Number(b.probabilidad) > Number(a.probabilidad) ? b : a));
    }
    if (perfilId === 'sonadoras') {
      // Menor probabilidad = mayor cuota justa (1 / prob).
      return lista.reduce((a, b) => (Number(b.probabilidad) < Number(a.probabilidad) ? b : a));
    }
    return null; // 'valor': requiere cuotas reales de casas de apuestas (tarea aparte)
  }

  window.armarCombinadaAsistida = function() {
    if (!combinadaAsistidaPerfil) return;
    const elegidos = obtenerElegidosAsistida();

    const picks = [];
    const sinMercado = [];
    for (const partido of elegidos) {
      const pronosticos = asistidaPronosticosCache[String(partido.id)];
      const mercado = elegirMercadoSegunPerfil(pronosticos, combinadaAsistidaPerfil);
      if (!mercado) {
        sinMercado.push(partido);
        continue;
      }
      const prob = Number(mercado.probabilidad) || 50;
      const cuota = prob > 0 ? Number((1 / (prob / 100)).toFixed(2)) : 1.00;
      picks.push({
        id: `pick-${partido.id}-${encodeURIComponent(mercado.seleccion)}`,
        partidoId: partido.id,
        partidoTxt: `${partido.homeTeam.name} vs ${partido.awayTeam.name}`,
        liga: partido.competition ? partido.competition.code : 'OTRAS',
        seleccion: mercado.seleccion,
        categoria: mercado.categoria || 'otro',
        probabilidad: prob,
        cuota: cuota
      });
    }

    combinadaAsistidaPicks = picks;
    renderAsistidaResumen(sinMercado);
  };

  window.cambiarPerfilResumenAsistida = function(perfilId) {
    if (perfilId === combinadaAsistidaPerfil) return;
    const perfil = PERFILES_COMBINADA_ASISTIDA.find(p => p.id === perfilId);
    if (!perfil || !perfil.seleccionable) return;
    combinadaAsistidaPerfil = perfilId;
    armarCombinadaAsistida();
  };

  function renderAsistidaResumen(sinMercado) {
    actualizarStepperAsistida(3);
    const body = document.getElementById('asistida-body');
    const footer = document.getElementById('asistida-footer');
    if (!body || !footer) return;

    const chipsPerfil = PERFILES_COMBINADA_ASISTIDA
      .filter(p => p.seleccionable)
      .map(p => {
        const activo = combinadaAsistidaPerfil === p.id;
        return `<button onclick="cambiarPerfilResumenAsistida('${p.id}')" style="background:${activo ? 'rgba(123,225,200,0.18)' : 'rgba(255,255,255,0.06)'}; border:1px solid ${activo ? 'var(--brand)' : 'var(--line)'}; color:${activo ? 'var(--brand)' : 'var(--text-muted)'}; padding:5px 12px; border-radius:999px; font-size:0.75rem; font-weight:700; cursor:pointer; transition:all 0.2s;">${p.icono} ${p.nombre}</button>`;
      })
      .join('');

    let avisoSinMercado = '';
    if (sinMercado && sinMercado.length > 0) {
      avisoSinMercado = `
        <div style="background:rgba(234,179,8,0.12); border:1px solid rgba(234,179,8,0.28); color:#facc15; font-size:0.78rem; padding:8px 12px; border-radius:var(--radius-sm); line-height:1.4;">
          ⚠️ ${sinMercado.length === 1 ? '1 partido quedó fuera' : sinMercado.length + ' partidos quedaron fuera'} porque no tienen mercados disponibles: ${sinMercado.map(p => `${p.homeTeam.name} vs ${p.awayTeam.name}`).join(' · ')}.
        </div>
      `;
    }

    const encabezado = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <h4 style="margin:0; font-size:1.1rem; color:var(--text);">Resumen de tu Combinada</h4>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <span style="font-size:0.75rem; color:var(--text-muted);">Ver como:</span>
          ${chipsPerfil}
        </div>
      </div>
      <div style="display:flex; gap:14px; flex-wrap:wrap;">
        <button onclick="volverAPasoPartidos()" style="background:none; border:none; color:var(--text-muted); font-size:0.8rem; cursor:pointer; padding:0; text-decoration:underline;" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-muted)'">← Cambiar partidos</button>
        <button onclick="renderAsistidaPaso2()" style="background:none; border:none; color:var(--text-muted); font-size:0.8rem; cursor:pointer; padding:0; text-decoration:underline;" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-muted)'">← Cambiar perfil</button>
      </div>
      ${avisoSinMercado}
    `;

    if (combinadaAsistidaPicks.length === 0) {
      body.innerHTML = `
        ${encabezado}
        <p style="text-align:center; color:var(--text); padding:20px;">No se pudo armar la combinada: los partidos seleccionados no tienen mercados disponibles.</p>
      `;
      footer.innerHTML = `
        <div></div>
        <div style="display:flex; gap:8px;">
          <button onclick="volverAPasoPartidos()" style="background:rgba(255,255,255,0.06); border:1px solid var(--line); color:var(--text); padding:8px 14px; border-radius:var(--radius-sm); font-weight:600; font-size:0.85rem; cursor:pointer;">← Volver</button>
        </div>
      `;
      return;
    }

    body.innerHTML = `
      ${encabezado}
      ${renderResumenCombinadaHTML(combinadaAsistidaPicks, { permitirQuitar: false })}
    `;

    const probFoot = Math.round(combinadaAsistidaPicks.reduce((acc, p) => acc * (p.probabilidad / 100), 1) * 1000) / 10;
    const cuotaFoot = (Math.round(combinadaAsistidaPicks.reduce((acc, p) => acc * p.cuota, 1) * 100) / 100).toFixed(2);
    footer.innerHTML = `
      <div style="font-size:0.85rem; color:var(--text-muted);">
        <strong style="color:var(--text);">Picks:</strong> ${combinadaAsistidaPicks.length} ·
        <strong style="color:var(--text);">Prob.:</strong> ${probFoot}% ·
        <strong style="color:var(--text);">Cuota:</strong> x${cuotaFoot}
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <button onclick="compartirCombinadaDePicks(combinadaAsistidaPicks)" style="background:rgba(123,225,200,0.15); color:var(--brand); border:1px solid rgba(123,225,200,0.3); padding:8px 14px; border-radius:var(--radius-sm); font-weight:600; font-size:0.85rem; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(123,225,200,0.25)'" onmouseout="this.style.background='rgba(123,225,200,0.15)'">Compartir</button>
        <button onclick="guardarCombinadaAsistida()" style="background:rgba(242,196,116,0.15); color:var(--gold); border:1px solid rgba(242,196,116,0.3); padding:8px 14px; border-radius:var(--radius-sm); font-weight:600; font-size:0.85rem; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(242,196,116,0.25)'" onmouseout="this.style.background='rgba(242,196,116,0.15)'">Guardar</button>
        <button onclick="cerrarCombinadaAsistida()" style="background:rgba(255,255,255,0.06); border:1px solid var(--line); color:var(--text); padding:8px 14px; border-radius:var(--radius-sm); font-weight:600; font-size:0.85rem; cursor:pointer; transition:all 0.2s;">Cerrar</button>
      </div>
    `;
  }

  window.guardarCombinadaAsistida = function() {
    if (guardarCombinadaDePicks(combinadaAsistidaPicks)) cerrarCombinadaAsistida();
  };




