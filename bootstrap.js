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

  // Motion 11 expone el global `Motion` (mayúscula) como un objeto con
  // `animate`, `stagger`, etc. app-ui.js usa la API de Motion One:
  //   motion(objetivo, keyframesConOpciones)
  //   motion.stagger(objetivos, keyframesConOpciones, { delay })
  // Este puente traduce esas llamadas a `Motion.animate`, separando las
  // opciones que el código mezcla con los keyframes. Sin él, la app lanza
  // "motion is not defined" al animar tarjetas y contadores.
  var OPCIONES_DE_ANIMACION = {
    duration: true,
    easing: true,
    delay: true,
    endDelay: true,
    repeat: true,
    direction: true,
    onUpdate: true,
    onComplete: true,
    onPlay: true,
    onStop: true
  };

  function separarOpciones(keyframes) {
    var limpios = {};
    var opciones = {};
    for (var clave in keyframes) {
      if (!Object.prototype.hasOwnProperty.call(keyframes, clave)) continue;
      if (OPCIONES_DE_ANIMACION[clave]) {
        opciones[clave] = keyframes[clave];
      } else {
        limpios[clave] = keyframes[clave];
      }
    }
    return { keyframes: limpios, opciones: opciones };
  }

  function combinarOpciones(base, extra) {
    var resultado = {};
    var clave;
    for (clave in base) resultado[clave] = base[clave];
    if (extra) {
      for (clave in extra) resultado[clave] = extra[clave];
    }
    return resultado;
  }

  function sinMotor() {
    // Si el CDN de Motion no cargó, devolvemos un objeto inerte para que la
    // interfaz siga funcionando sin animaciones en vez de romperse.
    return { finished: Promise.resolve(), stop: function () {} };
  }

  global.motion = function (objetivo, keyframes, opciones) {
    var motor = global.Motion;
    if (!motor || typeof motor.animate !== 'function') return sinMotor();
    var partes = separarOpciones(keyframes || {});
    return motor.animate(objetivo, partes.keyframes, combinarOpciones(partes.opciones, opciones));
  };

  global.motion.stagger = function (objetivos, keyframes, opciones) {
    var motor = global.Motion;
    if (!motor || typeof motor.animate !== 'function') return sinMotor();
    var partes = separarOpciones(keyframes || {});
    var combinadas = combinarOpciones(partes.opciones, opciones);
    var espera = typeof combinadas.delay === 'number' ? combinadas.delay : 0;
    combinadas.delay = motor.stagger(espera);
    return motor.animate(objetivos, partes.keyframes, combinadas);
  };

  // Conservar el resto de utilidades de Motion (spring, inView, etc.) sin
  // pisar el puente que acabamos de definir.
  if (global.Motion) {
    for (var utilidad in global.Motion) {
      if (Object.prototype.hasOwnProperty.call(global.Motion, utilidad) && !(utilidad in global.motion)) {
        global.motion[utilidad] = global.Motion[utilidad];
      }
    }
  }

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
