/*
 * bootstrap.js — red de seguridad de arranque + registro del Service Worker.
 *
 * Va primero en el <head> y es el único script sincrónico del shell.
 * Si un script posterior falla, mostramos un aviso visible en vez de dejar
 * la interfaz a medias o en blanco (evita la "pantalla blanca" silenciosa).
 *
 * Está fuera del bundle a propósito: debe correr aunque el resto de la app
 * no cargue, y debe ser el script que el CSP lista por hash.
 */
(function (global) {
  'use strict';

  global.__fulbitoErrorMostrado = false;

  global.__fulbitoMostrarError = function (detalle) {
    if (global.__fulbitoErrorMostrado) return;
    global.__fulbitoErrorMostrado = true;

    var pintar = function () {
      var el = document.createElement('div');
      el.setAttribute('role', 'alert');
      el.className = 'error-shell';

      var texto = document.createElement('span');
      texto.textContent = 'Algo falló al cargar Fulbito.' +
        (detalle ? ' Detalle: ' + detalle : '');

      var boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'error-shell-boton';
      boton.textContent = 'Recargar';
      // Vía addEventListener (no onclick inline) para no requerir
      // 'unsafe-inline' en la CSP.
      boton.addEventListener('click', function () { global.location.reload(); });

      el.appendChild(texto);
      el.appendChild(boton);
      (document.body || document.documentElement).appendChild(el);
    };

    if (document.body) pintar();
    else document.addEventListener('DOMContentLoaded', pintar);
  };

  global.addEventListener('error', function (e) {
    if (e && typeof e.message === 'string' && e.message) {
      global.__fulbitoMostrarError(e.message);
    }
  });

  global.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    if (r && r.name === 'AbortError') return;
    global.__fulbitoMostrarError((r && r.message) || '');
  });

  // El SW solo tiene sentido servido por HTTP(S): file:// lo rechaza.
  global.addEventListener('load', function () {
    if (!('serviceWorker' in navigator)) return;
    if (!global.location.protocol.startsWith('http')) return;
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  });
})(window);
