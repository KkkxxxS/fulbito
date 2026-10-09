// ============================================
// auth.js — sesión opcional de Fulbito (sin dependencias externas)
// Guárdalo después de app-model.js: usa BACKEND_URL allí definido.
// El flujo anónimo localStorage sigue funcionando; esto es un complemento
// que permite conservar el historial personal entre dispositivos/navegadores.
// ============================================
(function () {
  if (typeof window === 'undefined') return;

  const CLAVE_TOKEN = 'fulbito_auth_token';
  const CLAVE_USUARIO = 'fulbito_auth_usuario';

  // BACKEND_URL viene de app-model.js; fallback si ese script no cargó aún.
  function backend() {
    return (typeof BACKEND_URL !== 'undefined' && BACKEND_URL) || 'https://fulbito-forh.onrender.com';
  }

  function guardarSesion(usuario, token) {
    try {
      localStorage.setItem(CLAVE_TOKEN, token);
      localStorage.setItem(CLAVE_USUARIO, usuario);
    } catch (e) {}
    aplicarSesionUI();
  }

  function limpiarSesion() {
    try {
      localStorage.removeItem(CLAVE_TOKEN);
      localStorage.removeItem(CLAVE_USUARIO);
    } catch (e) {}
    aplicarSesionUI();
  }

  function obtenerToken() {
    try { return localStorage.getItem(CLAVE_TOKEN) || ''; } catch (e) { return ''; }
  }

  function obtenerUsuario() {
    try { return localStorage.getItem(CLAVE_USUARIO) || ''; } catch (e) { return ''; }
  }

  function estaAutenticado() { return !!obtenerToken(); }

  async function verificarSesion() {
    const token = obtenerToken();
    if (!token) return null;
    try {
      const r = await fetch(backend() + '/api/auth/me', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!r.ok) { if (r.status === 401) limpiarSesion(); return null; }
      const datos = await r.json();
      // Renovar el guardado local por si el username tiene casing distinto.
      if (datos.usuario) localStorage.setItem(CLAVE_USUARIO, datos.usuario);
      return datos;
    } catch (e) { return null; }
  }

  async function registrar(usuario, password) {
    const r = await fetch(backend() + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password })
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.message || datos.error || 'Error al registrarse');
    guardarSesion(datos.usuario, datos.token);
    return datos;
  }

  async function iniciarSesion(usuario, password) {
    const r = await fetch(backend() + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password })
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.message || datos.error || 'Error al iniciar sesión');
    guardarSesion(datos.usuario, datos.token);
    return datos;
  }

  function cerrarSesion() {
    const token = obtenerToken();
    if (token) {
      fetch(backend() + '/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token }
      }).catch(() => {});
    }
    limpiarSesion();
  }

  function mezclarHistoriales(local, nube) {
    const porId = new Map();
    (local || []).forEach(h => { porId.set(h.partidoId, h); });
    (nube || []).forEach(h => {
      const existente = porId.get(h.partidoId);
      if (!existente) { porId.set(h.partidoId, h); return; }
      // Conservamos el verificado (si alguno lo está, queda verificado).
      const ganador = (h.verificado && !existente.verificado) ? h
        : (existente.verificado && !h.verificado) ? existente
        : (h.verificado ? h : existente);
      porId.set(h.partidoId, ganador);
    });
    return Array.from(porId.values()).slice(-200).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  }

  async function cargarHistorialNube() {
    const token = obtenerToken();
    if (!token) return null;
    const r = await fetch(backend() + '/api/mi-historial', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) return null;
    const datos = await r.json();
    return Array.isArray(datos.historial) ? datos.historial : [];
  }

  async function guardarHistorialNube(historial) {
    const token = obtenerToken();
    if (!token) return null;
    const r = await fetch(backend() + '/api/mi-historial', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ historial: (historial || []).slice(-200) })
    });
    if (!r.ok) throw new Error('No se pudo guardar en la nube');
    return r.json();
  }

  async function sincronizarConNube() {
    if (!estaAutenticado()) return null;
    try {
      const local = typeof leerHistorialLocal === 'function' ? leerHistorialLocal() : [];
      const nube = (await cargarHistorialNube()) || [];
      const mezclado = mezclarHistoriales(local, nube);
      // Persistir el mezclado en ambos lados.
      if (typeof guardarHistorial === 'function') guardarHistorial(mezclado);
      else try { localStorage.setItem('fulbito_historial_pronosticos', JSON.stringify(mezclado)); } catch (e) {}
      if (mezclado.length === 0) return mezclado;
      // Si el local aportó entradas que la nube no tenía (o viceversa), subimos el mezclado.
      const localIds = new Set((local || []).map(h => h.partidoId));
      const nubeIds = new Set((nube || []).map(h => h.partidoId));
      const hayNuevas = mezclado.some(h => !localIds.has(h.partidoId) || !nubeIds.has(h.partidoId));
      if (hayNuevas) await guardarHistorialNube(mezclado).catch(() => {});
      return mezclado;
    } catch (e) { return null; }
  }

  function aplicarSesionUI() {
    const ses = estaAutenticado();
    const usuario = ses ? obtenerUsuario() : '';
    const nombreEl = document.getElementById('perfil-nombre');
    const avatarEl = document.getElementById('perfil-avatar');
    const heroEl = document.getElementById('hero-saludo');
    const botonAuth = document.getElementById('btn-auth');
    const wrapAuth = document.getElementById('perfil-auth-panel');
    if (nombreEl) nombreEl.textContent = ses ? usuario : 'Usuario';
    if (avatarEl) avatarEl.textContent = ses ? usuario.slice(0, 1).toUpperCase() : 'U';
    if (heroEl) heroEl.textContent = ses ? `Hola, ${usuario}` : 'Hola, Usuario';
    if (botonAuth) {
      botonAuth.textContent = ses ? 'Cerrar sesión' : 'Cuenta';
      botonAuth.title = ses ? `Cerrar sesión de ${usuario}` : 'Iniciar sesión o crear cuenta';
      botonAuth.setAttribute('aria-label', ses ? `Sesión de ${usuario}` : 'Iniciar sesión o crear cuenta');
    }
    if (wrapAuth) wrapAuth.style.display = ses ? 'none' : '';
    const infoSesion = document.getElementById('auth-info-sesion');
    if (infoSesion) {
      if (ses) {
        infoSesion.innerHTML = `Conectado como <strong style="color:var(--text);">${escaparHTML(usuario)}</strong>.<br><button class="dash-perfil-item" type="button" onclick="cerrarSesionFulbito()" style="margin-top:6px;">Cerrar sesión</button>`;
      } else {
        infoSesion.innerHTML = `<button class="dash-perfil-item" type="button" role="menuitem" onclick="abrirModalAuth()">Iniciar sesión / Crear cuenta</button>`;
      }
    }
  }

  function escaparHTML(valor) {
    if (valor == null) return '';
    return String(valor).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function setModoAuth(modo) {
    const form = document.getElementById('form-auth');
    const pass = document.getElementById('auth-password');
    const login = document.getElementById('tab-login');
    const reg = document.getElementById('tab-register');
    if (form) form.dataset.modo = modo;
    if (pass) pass.autocomplete = modo === 'register' ? 'new-password' : 'current-password';
    const on = 'flex:1; background:rgba(100,228,169,0.18); border:1px solid rgba(100,228,169,0.35); color:#64e4a9; padding:10px 14px; border-radius:var(--radius-sm); font-weight:700; cursor:pointer;';
    const off = 'flex:1; background:rgba(255,255,255,0.06); border:1px solid var(--line); color:var(--text); padding:10px 14px; border-radius:var(--radius-sm); font-weight:700; cursor:pointer;';
    if (login) login.style.cssText = modo === 'login' ? on : off;
    if (reg) reg.style.cssText = modo === 'register' ? on : off;
  }

  function abrirModalAuth() {
    const m = document.getElementById('modal-auth');
    if (m) { m.style.display = 'flex'; m.classList.add('activo'); document.body.style.overflow = 'hidden'; }
    setModoAuth('login');
  }
  function cerrarModalAuth() {
    const m = document.getElementById('modal-auth');
    if (m) { m.style.display = 'none'; m.classList.remove('activo'); document.body.style.overflow = ''; }
    const f = document.getElementById('form-auth');
    if (f) f.reset();
    const msg = document.getElementById('auth-mensaje');
    if (msg) msg.textContent = '';
  }
  async function enviarAuth(event, modo) {
    event.preventDefault();
    const form = event.target;
    const usuario = (form.elements.usuario && form.elements.usuario.value || '').trim().toLowerCase();
    const password = form.elements.password && form.elements.password.value || '';
    const msg = document.getElementById('auth-mensaje');
    if (msg) msg.textContent = '';
    if (!usuario || !password) { if (msg) msg.textContent = 'Completá usuario y contraseña.'; return; }
    if (usuario.length < 3 || password.length < 8) { if (msg) msg.textContent = 'Usuario ≥ 3; contraseña ≥ 8 caracteres.'; return; }
    const btn = form.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.dataset.texto = btn.textContent; btn.textContent = '…'; }
    try {
      if (modo === 'register') await registrar(usuario, password);
      else await iniciarSesion(usuario, password);
      cerrarModalAuth();
      const mezcla = await sincronizarConNube();
      if (typeof actualizarKPIsHome === 'function') actualizarKPIsHome();
      if (typeof actualizarContadorMisPredicciones === 'function') actualizarContadorMisPredicciones();
      aplicarSesionUI();
      if (mezcla && window.__fulbitoMostrarError === undefined) {
        // feedback mínimo post-login
        try {
          const nota = document.createElement('div');
          nota.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;background:rgba(100,228,169,0.16);border:1px solid rgba(100,228,169,0.35);color:#d6ffe8;padding:10px 14px;border-radius:12px;font:14px/1.4 system-ui;';
          nota.textContent = 'Sesión iniciada. Tu historial personal se sincronizó con la nube.';
          document.body.appendChild(nota); setTimeout(() => nota.remove(), 3200);
        } catch (e) {}
      }
    } catch (e) {
      if (msg) msg.textContent = e.message || 'Error.';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.texto || 'Entrar'; }
    }
  }

  window.guardarSesionFulbito = guardarSesion;
  window.estaAutenticado = estaAutenticado;
  window.obtenerUsuarioFulbito = obtenerUsuario;
  window.sincronizarConNube = sincronizarConNube;
  window.cargarHistorialNube = cargarHistorialNube;
  window.guardarHistorialNube = guardarHistorialNube;
  window.cerrarSesionFulbito = cerrarSesion;
  window.abrirModalAuth = abrirModalAuth;
  window.cerrarModalAuth = cerrarModalAuth;
  window.enviarAuth = enviarAuth;
  window.obtenerTokenFulbito = obtenerToken;
  window.setModoAuth = setModoAuth;

  // Envolver guardarHistorial para reflejar en la nube cuando hay sesión.
  function instalarGanchoHistorial() {
    if (typeof window.guardarHistorial !== 'function') return false;
    if (window.guardarHistorial.__conNube) return true;
    const original = window.guardarHistorial;
    function envuelta(historial) {
      original(historial);
      if (!estaAutenticado()) return;
      guardarHistorialNube(historial).catch(() => {});
    }
    envuelta.__conNube = true;
    window.guardarHistorial = envuelta;
    return true;
  }

  function iniciar() {
    aplicarSesionUI();
    document.querySelectorAll('[data-modo-auth]').forEach(b => {
      b.addEventListener('click', () => setModoAuth(b.getAttribute('data-modo-auth')));
    });
    const form = document.getElementById('form-auth');
    if (form && !form.dataset.modo) form.dataset.modo = 'login';
    if (estaAutenticado()) {
      verificarSesion().then(s => {
        if (!s) { aplicarSesionUI(); return; }
        aplicarSesionUI();
        sincronizarConNube().then(() => {
          if (typeof actualizarKPIsHome === 'function') actualizarKPIsHome();
          if (typeof actualizarContadorMisPredicciones === 'function') actualizarContadorMisPredicciones();
        });
      });
    }
    instalarGanchoHistorial();
    // Reintento del gancho si app-ui aún no cargó.
    if (!instalarGanchoHistorial()) {
      setTimeout(instalGanchoHistorial, 600);
      setTimeout(instalGanchoHistorial, 1800);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    setTimeout(iniciar, 0);
  }
})();
