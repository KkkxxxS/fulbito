// ============================================
// ANIMACIONES DINÁMICAS - PRONÓSTICOS Y DASHBOARD
// ============================================

// === CONTADOR ANIMADO ===
function animarContador(elemento, valorFinal, duracion = 1000, sufijo = '') {
  if (!elemento) return;
  const valorInicial = 0;
  const incremento = valorFinal / (duracion / 16);
  let valorActual = valorInicial;

  const actualizar = () => {
    valorActual += incremento;
    if (valorActual >= valorFinal) {
      elemento.textContent = valorFinal + sufijo;
    } else {
      elemento.textContent = Math.floor(valorActual) + sufijo;
      requestAnimationFrame(actualizar);
    }
  };
  requestAnimationFrame(actualizar);
}

// === ANIMAR BARRA DE PROBABILIDAD ===
function animarBarra(barra, porcentaje) {
  if (!barra) return;
  barra.style.setProperty('--target-width', porcentaje + '%');
  barra.style.width = '0%';
  barra.classList.add('animada');
  setTimeout(() => {
    barra.style.width = porcentaje + '%';
  }, 100);
}

// === ANIMAR GAUGE DE SALUD ===
function animarGauge(porcentaje) {
  const arco = document.getElementById('salud-gauge-arco');
  const texto = document.getElementById('salud-gauge-texto');
  const estado = document.getElementById('salud-gauge-estado');

  if (!arco || !texto) return;

  // Animar el arco
  arco.style.strokeDasharray = '0 100';
  setTimeout(() => {
    arco.style.strokeDasharray = porcentaje + ' 100';
  }, 100);

  // Animar el texto
  animarContador(texto, porcentaje, 1500, '%');

  // Actualizar estado
  if (estado) {
    if (porcentaje >= 80) {
      estado.textContent = 'EXCELENTE';
      estado.style.color = '#64e4a9';
    } else if (porcentaje >= 60) {
      estado.textContent = 'BUENO';
      estado.style.color = '#7be1c8';
    } else if (porcentaje >= 40) {
      estado.textContent = 'REGULAR';
      estado.style.color = '#f2c474';
    } else {
      estado.textContent = 'BAJO';
      estado.style.color = '#ff8d8d';
    }
  }
}

// === ANIMAR KPIs DEL DASHBOARD ===
function animarKPIs() {
  // KPI Aciertos
  const kpiAciertos = document.getElementById('kpi-aciertos');
  if (kpiAciertos && kpiAciertos.textContent !== '—') {
    const valor = parseInt(kpiAciertos.textContent) || 0;
    animarContador(kpiAciertos, valor, 1200, '%');
  }

  // KPI Favoritos
  const kpiFavoritos = document.getElementById('kpi-favoritos');
  if (kpiFavoritos && kpiFavoritos.textContent !== '0') {
    const valor = parseInt(kpiFavoritos.textContent) || 0;
    animarContador(kpiFavoritos, valor, 1000);
  }

  // KPI Predicciones Hoy
  const kpiHoy = document.getElementById('kpi-hoy');
  if (kpiHoy && kpiHoy.textContent !== '…') {
    const valor = parseInt(kpiHoy.textContent) || 0;
    animarContador(kpiHoy, valor, 1000);
  }
}

// === ANIMAR BARRA DE KPI ===
function animarBarraKPI(id, porcentaje) {
  const barra = document.getElementById(id);
  if (!barra) return;
  barra.style.width = '0%';
  setTimeout(() => {
    barra.style.width = porcentaje + '%';
  }, 200);
}

// === ANIMAR TARJETAS DE PARTIDOS AL CARGAR ===
function animarTarjetasPartidos() {
  const tarjetas = document.querySelectorAll('.tarjeta-partido');
  tarjetas.forEach((tarjeta, index) => {
    tarjeta.style.opacity = '0';
    tarjeta.style.transform = 'translateY(20px)';
    setTimeout(() => {
      tarjeta.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      tarjeta.style.opacity = '1';
      tarjeta.style.transform = 'translateY(0)';
    }, index * 100);
  });
}

// === ANIMAR BARRAS DE PROBABILIDAD DE MERCADOS ===
function animarBarrasMercados() {
  const barras = document.querySelectorAll('.barra-relleno');
  barras.forEach((barra, index) => {
    const ancho = barra.parentElement.style.width || '50%';
    barra.style.width = '0%';
    setTimeout(() => {
      barra.style.transition = 'width 1s cubic-bezier(0.2, 0.7, 0.2, 1)';
      barra.style.width = ancho;
    }, 300 + index * 100);
  });
}

// === ANIMAR BENTO GRID ===
function animarBentoGrid() {
  const items = document.querySelectorAll('.bento-item');
  items.forEach((item, index) => {
    item.style.opacity = '0';
    item.style.transform = 'scale(0.9)';
    setTimeout(() => {
      item.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      item.style.opacity = '1';
      item.style.transform = 'scale(1)';
    }, index * 80);
  });
}

// === ANIMAR DASHBOARD CARDS ===
function animarDashboardCards() {
  const cards = document.querySelectorAll('.dashboard-card');
  cards.forEach((card, index) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    setTimeout(() => {
      card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, index * 100);
  });
}

// === ANIMAR HEALTH CARDS ===
function animarHealthCards() {
  const cards = document.querySelectorAll('.health-card');
  cards.forEach((card, index) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    setTimeout(() => {
      card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, index * 150);
  });
}

// === ANIMAR TELEMETRIA CARDS ===
function animarTelemetriaCards() {
  const cards = document.querySelectorAll('.telemetria-card');
  cards.forEach((card, index) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    setTimeout(() => {
      card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, index * 100);
  });
}

// === ANIMAR HISTORIAL PARTIDOS ===
function animarHistorialPartidos() {
  const partidos = document.querySelectorAll('.historial-partido');
  partidos.forEach((partido, index) => {
    partido.style.opacity = '0';
    partido.style.transform = 'translateX(-20px)';
    setTimeout(() => {
      partido.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      partido.style.opacity = '1';
      partido.style.transform = 'translateX(0)';
    }, index * 80);
  });
}

// === ANIMAR COMBINADAS ===
function animarCombinadas() {
  const tarjetas = document.querySelectorAll('.tarjeta-combinada');
  tarjetas.forEach((tarjeta, index) => {
    tarjeta.style.opacity = '0';
    tarjeta.style.transform = 'translateY(20px)';
    setTimeout(() => {
      tarjeta.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      tarjeta.style.opacity = '1';
      tarjeta.style.transform = 'translateY(0)';
    }, index * 100);
  });
}

// === ANIMAR NAV TABS ===
function animarNavTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach((tab, index) => {
    tab.style.opacity = '0';
    tab.style.transform = 'translateX(-10px)';
    setTimeout(() => {
      tab.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      tab.style.opacity = '1';
      tab.style.transform = 'translateX(0)';
    }, index * 50);
  });
}

// === ANIMAR PESTAÑAS DE FECHA ===
function animarPestanasFecha() {
  const pestanas = document.querySelectorAll('.pestaña');
  pestanas.forEach((pestana, index) => {
    pestana.style.opacity = '0';
    pestana.style.transform = 'translateY(-10px)';
    setTimeout(() => {
      pestana.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      pestana.style.opacity = '1';
      pestana.style.transform = 'translateY(0)';
    }, index * 50);
  });
}

// === ANIMAR FILTROS DE LIGAS ===
function animarFiltrosLigas() {
  const filtros = document.querySelectorAll('.filtro-liga-btn');
  filtros.forEach((filtro, index) => {
    filtro.style.opacity = '0';
    filtro.style.transform = 'translateX(-10px)';
    setTimeout(() => {
      filtro.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      filtro.style.opacity = '1';
      filtro.style.transform = 'translateX(0)';
    }, index * 30);
  });
}

// === INICIALIZAR ANIMACIONES AL CARGAR ===
document.addEventListener('DOMContentLoaded', () => {
  // Animar elementos del dashboard
  setTimeout(() => {
    animarBentoGrid();
    animarKPIs();
    animarDashboardCards();
    animarHealthCards();
  }, 100);

  // Animar elementos de pronósticos
  setTimeout(() => {
    animarPestanasFecha();
    animarFiltrosLigas();
  }, 200);

  // Animar tarjetas de partidos cuando se carguen
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.addedNodes.length > 0) {
        setTimeout(() => {
          animarTarjetasPartidos();
          animarBarrasMercados();
        }, 100);
      }
    });
  });

  const contenedorPartidos = document.getElementById('contenedor-partidos');
  if (contenedorPartidos) {
    observer.observe(contenedorPartidos, { childList: true });
  }
});

// === ANIMAR AL CAMBIAR DE VISTA ===
const cambiarVistaOriginal = window.cambiarVista;
window.cambiarVista = function(vista) {
  if (cambiarVistaOriginal) {
    cambiarVistaOriginal(vista);
  }

  // Animar elementos de la nueva vista
  setTimeout(() => {
    switch(vista) {
      case 'inicio':
        animarBentoGrid();
        animarKPIs();
        animarDashboardCards();
        animarHealthCards();
        break;
      case 'pronosticos':
        animarPestanasFecha();
        animarFiltrosLigas();
        animarTarjetasPartidos();
        animarBarrasMercados();
        break;
      case 'analitica':
        animarTelemetriaCards();
        animarHistorialPartidos();
        break;
      case 'historial':
        animarHistorialPartidos();
        break;
      case 'dobles':
        animarCombinadas();
        break;
      case 'live':
        animarTarjetasPartidos();
        break;
      case 'favoritos':
      case 'mispredicciones':
        animarTarjetasPartidos();
        break;
    }
  }, 100);
};
