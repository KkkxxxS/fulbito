// ============ ANIMACIONES MODERNAS (ANIME.JS) ============
function animarEntradaBento() {
  if (typeof anime === 'undefined') return;
  const tl = anime.timeline({
    easing: 'cubicBezier(0.23, 1, 0.32, 1)',
  });

  tl.add({
    targets: '.bento-item',
    opacity: [0, 1],
    translateY: [25, 0],
    filter: ['blur(8px)', 'blur(0px)'],
    delay: anime.stagger(100),
    duration: 800,
  });
}

function animarContador(id, valorFinal) {
  if (typeof anime === 'undefined') return;
  const el = document.getElementById(id);
  if (!el) return;

  anime({
    targets: { val: 0 },
    val: valorFinal,
    round: 1,
    easing: 'easeOutExpo',
    duration: 1500,
    update: function() {
      el.textContent = Math.ceil(this.targets[0].val);
    }
  });
}

// Ejecutar animación de entrada al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(animarEntradaBento, 200);
});

// Wrapper para cambiarVista para re-trigger animaciones en Inicio
const wrapCambiarVista = () => {
  const original = window.cambiarVista;
  if (!original) return;
  window.cambiarVista = function(vista, force) {
    original(vista, force);
    if (vista === 'inicio') {
      setTimeout(animarEntradaBento, 100);
    }
  };
};
wrapCambiarVista();
