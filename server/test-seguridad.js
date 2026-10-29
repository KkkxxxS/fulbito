/**
 * Tests de las utilidades de seguridad de auth (server/seguridad.js).
 *
 * Ejecutar: npm run test:seguridad
 *
 * No necesita PostgreSQL ni levantar el servidor: trabaja sobre las funciones
 * puras (limitador, comparación en tiempo constante, validación de contraseña,
 * cabeceras y middleware de límite de intentos).
 */
const {
  PASSWORD_MIN,
  PASSWORD_MAX,
  crearLimitador,
  compararSeguro,
  ipDe,
  validarPassword,
  aplicarNoCache,
  limitarAuth
} = require('./seguridad');

let fallos = 0;
function check(nombre, condicion, detalle) {
  if (condicion) {
    console.log(`  [OK ] ${nombre}`);
  } else {
    console.log(`  [FALLA] ${nombre}${detalle ? ` — ${detalle}` : ''}`);
    fallos++;
  }
}

function resMock() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(clave, valor) {
      this.headers[String(clave).toLowerCase()] = valor;
    },
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function reqMock({ ip = '127.0.0.1', usuario } = {}) {
  return {
    ip,
    headers: {},
    body: usuario === undefined ? {} : { usuario }
  };
}

function testLimitador() {
  console.log('\n— Limitador de ventana fija —');
  let ahora = 1_000_000;
  const limitador = crearLimitador({ max: 3, ventanaMs: 60_000, ahora: () => ahora });

  const a1 = limitador('ip-a');
  const a2 = limitador('ip-a');
  const a3 = limitador('ip-a');
  check('permite los primeros intentos', a1.permitido && a2.permitido && a3.permitido);
  check('descuenta el cupo restante', a1.restantes === 2 && a2.restantes === 1 && a3.restantes === 0,
    `${a1.restantes},${a2.restantes},${a3.restantes}`);

  const a4 = limitador('ip-a');
  check('bloquea al superar el máximo', !a4.permitido);
  check('expone retryAfter en segundos', a4.retryAfterSegundos === 60, String(a4.retryAfterSegundos));
  check('expone el límite configurado', a4.limite === 3, String(a4.limite));

  const b1 = limitador('ip-b');
  check('las claves son independientes', b1.permitido && b1.restantes === 2);

  ahora += 59_000;
  const a5 = limitador('ip-a');
  check('sigue bloqueado antes de vencer la ventana', !a5.permitido);

  ahora += 1_000;
  const a6 = limitador('ip-a');
  check('vuelve a permitir al vencer la ventana', a6.permitido && a6.restantes === 2);

  limitador('ip-c');
  check('la limpieza oportunista descarta cubos vencidos', limitador.tamano() === 2,
    `tamano=${limitador.tamano()}`);

  limitador.reiniciar();
  check('reiniciar vacía todos los cubos', limitador.tamano() === 0);

  let lanzo = false;
  try { crearLimitador({ max: 0 }); } catch (e) { lanzo = true; }
  check('rechaza un máximo inválido', lanzo);
}

function testCompararSeguro() {
  console.log('\n— Comparación en tiempo constante —');
  check('iguales devuelve true', compararSeguro('abc123', 'abc123'));
  check('distintos devuelve false', !compararSeguro('abc123', 'abc124'));
  check('distinta longitud devuelve false', !compararSeguro('abc', 'abcd'));
  check('null y cadena vacía devuelve false', !compararSeguro(null, ''));
  check('null y null devuelve false', !compararSeguro(null, null));
}

function testPassword() {
  console.log('\n— Política de contraseña —');
  check('rechaza contraseña corta', validarPassword('a'.repeat(PASSWORD_MIN - 1)) !== null);
  check('acepta el mínimo', validarPassword('a'.repeat(PASSWORD_MIN)) === null);
  check('acepta 128 caracteres', validarPassword('a'.repeat(PASSWORD_MAX)) === null);
  check('rechaza más de 128 caracteres', validarPassword('a'.repeat(PASSWORD_MAX + 1)) !== null);
  check('rechaza undefined', validarPassword(undefined) !== null);
  check('el mensaje de mínimo menciona 8', /8/.test(validarPassword('corta')), validarPassword('corta'));
}

function testIP() {
  console.log('\n— Extracción de IP —');
  const conXff = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } };
  check('usa x-forwarded-for si no hay req.ip', ipDe(conXff) === '203.0.113.9', ipDe(conXff));

  const conProxy = reqMock();
  conProxy.ip = '198.51.100.20';
  conProxy.headers['x-forwarded-for'] = '203.0.113.9';
  check('prioriza req.ip (trust proxy) sobre XFF', ipDe(conProxy) === '198.51.100.20', ipDe(conProxy));

  const conMapeo = reqMock();
  conMapeo.ip = '::ffff:198.51.100.7';
  check('normaliza IPv4 mapeada', ipDe(conMapeo) === '198.51.100.7', ipDe(conMapeo));

  check('sin datos devuelve desconocida', ipDe({ headers: {} }) === 'desconocida', ipDe({ headers: {} }));
}

function testNoCache() {
  console.log('\n— Cabeceras de no-cache —');
  const res = resMock();
  aplicarNoCache(res);
  check('Cache-Control impide almacenar', /no-store/.test(res.headers['cache-control']),
    res.headers['cache-control']);
  check('Pragma no-cache presente', res.headers.pragma === 'no-cache', res.headers.pragma);
}

function testMiddleware() {
  console.log('\n— Middleware limitarAuth —');
  let ahora = 5_000_000;
  const limitador = crearLimitador({ max: 2, ventanaMs: 60_000, ahora: () => ahora });
  const middleware = limitarAuth(limitador, { incluirUsuario: true });

  const ejecutar = (req) => {
    const res = resMock();
    let siguiente = false;
    middleware(req, res, () => { siguiente = true; });
    return { res, siguiente };
  };

  const u1 = ejecutar(reqMock({ ip: '1.1.1.1', usuario: 'ana' }));
  const u2 = ejecutar(reqMock({ ip: '1.1.1.1', usuario: 'ana' }));
  const u3 = ejecutar(reqMock({ ip: '1.1.1.1', usuario: 'ana' }));
  check('permite hasta el máximo', u1.siguiente && u2.siguiente);
  check('bloquea con 429 al superarlo', !u3.siguiente && u3.res.statusCode === 429);
  check('incluye Retry-After', Number(u3.res.headers['retry-after']) > 0,
    u3.res.headers['retry-after']);
  check('incluye cabeceras X-RateLimit', u3.res.headers['x-ratelimit-limit'] === '2' &&
    u3.res.headers['x-ratelimit-remaining'] === '0');

  const otra = ejecutar(reqMock({ ip: '1.1.1.1', usuario: 'beto' }));
  check('otro usuario de la misma IP no queda bloqueado', otra.siguiente);

  // Sin `incluirUsuario` la clave es solo IP: útil para registro.
  const porIP = limitarAuth(crearLimitador({ max: 1, ventanaMs: 60_000, ahora: () => ahora }));
  const r1 = ejecutarCon(porIP, reqMock({ ip: '2.2.2.2', usuario: 'ana' }));
  const r2 = ejecutarCon(porIP, reqMock({ ip: '2.2.2.2', usuario: 'beto' }));
  check('el límite por IP agrupa usuarios distintos', r1.siguiente && !r2.siguiente && r2.res.statusCode === 429);

  ahora += 60_000;
  const despues = ejecutar(reqMock({ ip: '1.1.1.1', usuario: 'ana' }));
  check('el bloqueo se libera al vencer la ventana', despues.siguiente);
}

function ejecutarCon(middleware, req) {
  const res = resMock();
  let siguiente = false;
  middleware(req, res, () => { siguiente = true; });
  return { res, siguiente };
}

function main() {
  console.log('=== TEST DE SEGURIDAD DE AUTH ===');
  testLimitador();
  testCompararSeguro();
  testPassword();
  testIP();
  testNoCache();
  testMiddleware();
  console.log(`\n=== RESULTADO: ${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : 'HAY FALLOS'} ===`);
  process.exit(fallos === 0 ? 0 : 1);
}

main();
