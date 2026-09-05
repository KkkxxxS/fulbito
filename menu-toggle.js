function inicializarCierreMenu() {
  const nav = document.querySelector('.app-nav');
  if (!nav) return;
  let toggle = document.querySelector('.app-nav-toggle');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.className = 'app-nav-toggle';
    toggle.setAttribute('aria-label', 'Menu');
    toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    document.body.appendChild(toggle);
  }
  const cerrar = () => nav.classList.remove('menu-abierto');
  toggle.addEventListener('click', () => nav.classList.toggle('menu-abierto'));
  document.addEventListener('click', (e) => {
    if (!nav.classList.contains('menu-abierto')) return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    cerrar();
  });
  nav.querySelectorAll('.app-nav-tab').forEach(tab => {
    tab.addEventListener('click', () => setTimeout(cerrar, 50));
  });
}
