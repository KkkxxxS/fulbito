// ============================================
// i18n de Fulbito (ES / EN)
// Traduce los elementos marcados con data-i18n del chrome estático.
// Los textos generados dinámicamente por el motor siguen en español.
// ============================================
(function () {
  const CLAVE_IDIOMA = 'fulbito_idioma';
  const IDIOMA_POR_DEFECTO = 'es';

  // Traducciones al inglés. Clave = valor de data-i18n.
  const DICCIONARIO = {
    en: {
      grupoPrincipal: 'MAIN',
      navInicio: 'Home',
      navPredicciones: 'Predictions',
      navLive: 'Live Center',
      navMisPredicciones: 'My predictions',
      grupoExplorar: 'EXPLORE',
      navCompeticiones: 'Competitions',
      navRanking: 'Ranking',
      navDobles: 'Combos',
      navBuscar: 'Search',
      navFavoritos: 'Favorites',
      navHistorial: 'History',

      pieSalud: 'Engine health',
      pieBrier: 'Brier',
      piePicks: 'Audited picks',
      pieNota: 'Poisson + Dixon-Coles. Auditable numbers, no promises.',

      eyebrow: 'Dashboard',
      sub: 'Poisson + Dixon-Coles · Auditable Brier.',
      kpiAciertos: 'Accuracy <span class="dash-tip" data-tip="% of markets hit over already settled picks vs the real result.">?</span>',
      kpiFavoritos: 'Your favorites <span class="dash-tip" data-tip="Teams you starred. Their matches are prioritized in Predictions.">?</span>',
      kpiFavoritosPie: 'matches',
      kpiHoy: 'Predictions today <span class="dash-tip" data-tip="Active engine recommendations for today (9 markets per match).">?</span>',
      kpiHoyChip: 'View',

      qc1Titulo: 'AI Predictions',
      qc1Desc: 'Matches analyzed by the engine.',
      qc2Titulo: 'Analytics',
      qc2Desc: 'Calibration and statistical models (Poisson + Dixon-Coles).',
      qc3Titulo: 'My predictions',
      qc3Desc: 'Your saved picks and odds.',
      qc4Titulo: 'Favorites',
      qc4Desc: 'Direct league tracking.',
      qc5Titulo: 'Transparency',
      qc5Desc: 'Public history and Brier Score audit.',

      liveEyebrow: 'Live Center',
      liveTitulo: "What's on today, in chronological order",
      liveSub: "Matches in play and upcoming today, with the engine's confidence. Auto-refreshes every 3 minutes.",

      compEyebrow: 'Competitions',
      compTitulo: 'Leagues covered by the engine',
      compSub: 'Tap a league to see its matches and predictions. Leagues with matches today come first.',

      rankEyebrow: 'Ranking',
      rankTitulo: 'Real performance by market and team',
      rankSub: 'Only settled picks vs the real result. No inflated averages.',
      rankMercados: 'Markets by accuracy',
      rankMercadosNota: 'Best to worst',
      rankEquipos: 'Teams with most picks',
      rankEquiposNota: 'Volume analyzed',

      doblesEyebrow: 'Combos',
      doblesTitulo: 'Combos built with real value',
      doblesSub: "Suggested doubles and multis from today's best picks. Each extra leg multiplies the risk.",
      doblesManual: 'Build manual combo',

      buscarPlaceholder: 'Search team or league…'
    }
  };

  function leerIdioma() {
    try {
      const guardado = localStorage.getItem(CLAVE_IDIOMA);
      return guardado === 'en' ? 'en' : IDIOMA_POR_DEFECTO;
    } catch (e) {
      return IDIOMA_POR_DEFECTO;
    }
  }

  function guardarIdioma(idioma) {
    try { localStorage.setItem(CLAVE_IDIOMA, idioma); } catch (e) {}
  }

  function aplicarIdioma(idioma) {
    const esIngles = idioma === 'en';
    document.documentElement.lang = esIngles ? 'en' : 'es-PE';
    if (document.body) document.body.dataset.idioma = idioma;

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const clave = el.getAttribute('data-i18n');
      // Guardamos el HTML original (español) para poder restaurarlo.
      if (el.dataset.i18nEs === undefined) el.dataset.i18nEs = el.innerHTML;
      const espanol = el.dataset.i18nEs;
      const traducido = esIngles ? DICCIONARIO.en[clave] : null;
      el.innerHTML = traducido != null ? traducido : espanol;
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const clave = el.getAttribute('data-i18n-placeholder');
      if (el.dataset.i18nPlaceholderEs === undefined) {
        el.dataset.i18nPlaceholderEs = el.getAttribute('placeholder') || '';
      }
      const espanol = el.dataset.i18nPlaceholderEs;
      const traducido = esIngles ? DICCIONARIO.en[clave] : null;
      el.setAttribute('placeholder', traducido != null ? traducido : espanol);
    });

    const indicador = document.getElementById('idioma-actual');
    if (indicador) indicador.textContent = esIngles ? 'EN' : 'ES';
  }

  function alternarIdioma() {
    const nuevo = leerIdioma() === 'en' ? 'es' : 'en';
    guardarIdioma(nuevo);
    aplicarIdioma(nuevo);
  }

  window.alternarIdioma = alternarIdioma;
  window.aplicarIdioma = aplicarIdioma;

  function iniciar() {
    aplicarIdioma(leerIdioma());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
