/*
 * events.js — despachador central de interacciones.
 *
 * Elimina los handlers `onclick`/`oninput`/`onsubmit`/`onchange`/`onerror`
 * inline, tanto del shell (index.html) como del HTML que los scripts
 * generan por innerHTML.
 *
 * Por qué: los handlers inline obligan a declarar `'unsafe-inline'` en la
 * CSP de scripts, que es justo lo que habilita la ejecución de XSS. Al
 * moverlos aquí la política puede endurecerse a `script-src 'self'`.
 *
 * Convención: `data-*` lleva los argumentos; si una función necesita el
 * `event`, el despachador se lo inyecta como último parámetro.
 */
(function (global) {
  'use strict';

  var doc = global.document;

  var acciones = {
    /* ---------- navegación ---------- */
    'cambiar-vista': function (el) { global.cambiarVista(el.dataset.vista); },
    'cambiar-deporte': function (el) { global.cambiarDeporte(el.dataset.deporte); },
    'cambiar-fecha': function (el, e) { global.cambiarFecha(el.dataset.fecha, e); },
    'filtrar-analitica': function (el, e) { global.filtrarAnalitica(el.dataset.categoria, e); },
    'mostrar-selector-fecha': function (el, e) { global.mostrarSelectorFecha(e); },
    'aplicar-fecha-personalizada': function () { global.aplicarFechaPersonalizada(); },
    'cambiar-liga': function (el) { global.cambiarLiga(el.dataset.liga); },
    'cambiar-filtro-historial': function (el) { global.cambiarFiltroHistorial(el.dataset.filtro); },

    /* ---------- UI ---------- */
    'alternar-perfil': function (el, e) { global.alternarPerfil(e); },
    'enfocar-buscador': function (el, e) { global.enfocarBuscador(e); },
    'alternar-idioma': function () { global.alternarIdioma(); },
    'toggle-menu-movil': function () { global.toggleMenuMovil(); },
    'toggle-sidebar-desktop': function () { global.toggleSidebarDesktop(); },
    'cerrar-menu-movil': function () { global.cerrarMenuMovil(); },
    'scroll-arriba': function () { global.scrollTo({ top: 0, behavior: 'smooth' }); },
    'recargar': function () { global.location.reload(); },
    'toggle-mercados': function (el) { global.toggleMercados(Number(el.dataset.partido)); },
    'toggle-catalogo': function (el) { global.toggleCatalogo(Number(el.dataset.partido)); },

    /* ---------- combinadas ---------- */
    'abrir-combinada-asistida': function () { global.abrirCombinadaAsistida(); },
    'cerrar-combinada-asistida': function () { global.cerrarCombinadaAsistida(); },
    'abrir-modal-combinada': function () { global.abrirModalArmarCombinada(); },
    'cerrar-modal-combinada': function () { global.cerrarModalArmarCombinada(); },
    'limpiar-combinada': function () { global.limpiarCombinadaManual(); },
    'compartir-combinada': function (el) {
      global.compartirCombinada(el, el.dataset.etiqueta, Number(el.dataset.indice));
    },
    'guardar-combinada': function () { global.guardarCombinadaGuardada(); },
    'confirmar-combinada': function () { global.confirmarCombinadaManual(); },
    'render-modal-combinada': function () { global.renderizarContenidoModalCombinada(); },
    'toggle-acordeon-liga': function (el) { global.toggleAcordeonLiga(el.dataset.liga); },
    'toggle-pick-combinada': function (el, e) {
      var d = el.dataset;
      global.togglePickCombinadaManual(
        d.pickId, Number(d.partidoId), d.partidoTxt, d.liga,
        d.seleccion, d.categoria, d.prob, d.cuota
      );
    },
    'quitar-pick-combinada': function (el) { global.quitarPickDeCombinada(el.dataset.pickId); },
    'abrir-modal-manual-desde-asistida': function () { global.abrirModalManualDesdeAsistida(); },
    'toggle-acordeon-asistida': function (el) { global.toggleAcordeonAsistida(el.dataset.liga); },
    'toggle-partido-asistida': function (el) {
      global.togglePartidoAsistida(Number(el.dataset.partido), el.dataset.liga);
    },
    'ir-a-paso-perfil': function () { global.irAPasoPerfil(); },
    'volver-a-paso-partidos': function () { global.volverAPasoPartidos(); },
    'armar-combinada-asistida': function () { global.armarCombinadaAsistida(); },
    'render-asistida-paso2': function () { global.renderAsistidaPaso2(); },
    'cambiar-perfil-asistida': function (el) { global.cambiarPerfilResumenAsistida(el.dataset.perfil); },
    'compartir-picks-asistida': function () { global.compartirCombinadaAsistida(); },
    'guardar-combinada-asistida': function () { global.guardarCombinadaAsistida(); },

    /* ---------- predicciones y favoritos ---------- */
    'toggle-mi-prediccion': function (el, e) {
      global.toggleMiPrediccion(Number(el.dataset.partido), el.dataset.categoria, e);
    },
    'quitar-mi-prediccion': function (el, e) {
      global.toggleMiPrediccion(Number(el.dataset.partido), el.dataset.categoria, e);
      global.renderMisPredicciones();
    },
    'toggle-favorito': function (el, e) {
      global.toggleFavorito(Number(el.dataset.team), e);
    },

    /* ---------- datos ---------- */
    'exportar-datos': function () { global.exportarDatos(); },
    'importar-datos': function (el, e) { global.importarDatos(e); },
    'abrir-importar-datos': function () {
      var input = doc.getElementById('input-importar-datos');
      if (input) input.click();
    },
    // El reset de historial se invoca desde 3 botones pero la función no
    // existía en el código original (botones muertos). Se preserva el
    // comportamiento previo: no-op si el global no está definido.
    'reiniciar-historial': function () {
      if (typeof global.reiniciarHistorial === 'function') global.reiniciarHistorial();
    },

    /* ---------- cuenta ---------- */
    'abrir-modal-auth': function () { global.abrirModalAuth && global.abrirModalAuth(); },
    'cerrar-modal-auth': function () { global.cerrarModalAuth(); },
    'cerrar-sesion': function () {
      if (typeof global.cerrarSesionFulbito === 'function') global.cerrarSesionFulbito();
    },
    'cerrar-todas-sesiones': function () {
      if (typeof global.cerrarTodasLasSesionesFulbito === 'function') {
        global.cerrarTodasLasSesionesFulbito().catch(function () {});
      }
    },
    'enviar-auth': function (el, e) { global.enviarAuth(e, el.dataset.modo || 'login'); },
    'auth-registro': function () {
      var form = doc.getElementById('form-auth');
      var pw = doc.getElementById('auth-password');
      if (pw) pw.autocomplete = 'new-password';
      if (form) {
        form.dataset.modo = 'register';
        form.requestSubmit();
      }
    },

    /* ---------- búsqueda ---------- */
    'buscar': function (el) {
      var mapa = {
        sidebar: 'onBuscar',
        dash: 'sincronizarBusquedaDashboard',
        integrado: 'onBuscarIntegrado'
      };
      var fn = global[mapa[el.dataset.origen]];
      if (typeof fn === 'function') fn(el.value);
    }
  };

  // Envoltorio del fallback de imágenes (antes `onerror="this.style.display='none'"`).
  // El evento `error` de recursos no burbujea, por eso se escucha en captura.
  function onErrorCaptura(e) {
    var t = e.target;
    if (t && t.dataset && t.dataset.imgFallback !== undefined && t.tagName === 'IMG') {
      t.style.display = 'none';
      t.hidden = true;
    }
  }

  function despachar(tipo, evento) {
    var el = evento.target && evento.target.closest
      ? evento.target.closest('[data-action]')
      : null;
    if (!el) return;

    // Los controles de formulario se disparan con `change`, no con `click`.
    if (tipo === 'click') {
      var tag = el.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      // Un control dentro de un <summary> no debe disparar además la acción.
      if (el.closest('summary')) return;
    }

    var fn = acciones[el.dataset.action];
    if (typeof fn !== 'function') return;

    if (tipo === 'keydown') {
      var activable = el.tagName === 'BUTTON' || el.tagName === 'A' ||
                      el.getAttribute('role') === 'button';
      if (!activable) return;
      if (evento.key !== 'Enter' && evento.key !== ' ') return;
    }

    // `preventDefault` evita el doble disparo (submit + click, etc.).
    if (tipo === 'click' || tipo === 'submit' || tipo === 'keydown') {
      evento.preventDefault();
    }
    fn(el, evento);
  }

  function montar() {
    document.addEventListener('click', function (e) { despachar('click', e); });
    document.addEventListener('submit', function (e) { despachar('submit', e); });
    document.addEventListener('change', function (e) { despachar('change', e); });
    document.addEventListener('input', function (e) { despachar('input', e); });
    document.addEventListener('keydown', function (e) { despachar('keydown', e); });
    // Captura: el evento error de <img> no llega a burbujear hasta document.
    document.addEventListener('error', onErrorCaptura, true);
  }

  // Exportado para que los tests inspeccionen el registro sin necesitar DOM.
  global.__fulbitoAcciones = acciones;
  global.__fulbitoMontarEventos = montar;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }
})(window);
