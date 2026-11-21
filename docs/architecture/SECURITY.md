# Seguridad de Fulbito

> **Estado:** auditoría de la fase 1. Los hallazgos están clasificados y **no** se aplicaron correcciones.
> **Alcance:** API, SPA, pipeline Python, base de datos y despliegue.
> **Relacionado:** [ARCHITECTURE.md](./ARCHITECTURE.md), [TESTING.md](./TESTING.md)

---

## 1. Activos a proteger

| Activo | Impacto si se compromete |
|---|---|
| Credenciales de usuarios | Suplantación, acceso al historial personal |
| Sesiones | Secuestro de cuenta durante 30 días |
| Claves de proveedores | Costo económico, agotamiento de cuota, bloqueo del servicio |
| `HISTORIAL_API_KEY` | Inyección o alteración del track record público |
| Integridad del historial | Pérdida de credibilidad y de valor del producto |
| Parámetros del modelo | Manipulación de pronósticos y de resultados |
| Base de datos | Exfiltración, pérdida o corrupción |
| Repositorio y CI | Ejecución de código, robo de secretos, publicación de artefactos falsos |

## 2. Actores y amenazas

| Actor | Motivación | Vector principal |
|---|---|---|
| Usuario anónimo | Manipular el historial o abusar de cuotas | endpoints públicos, `/api/log`, rate limit |
| Usuario autenticado | Acceder a datos de otro usuario | IDOR, tokens, historial personal |
| Atacante externo | Robo de cuentas o claves | credential stuffing, XSS, dependencias |
| Insider / operador | Alterar parámetros o resultados | archivos de aprobación, bitácora |
| Proveedor / CDN | Supply chain | script de CDN, dependencia npm |
| Fallo operativo | Pérdida de datos | filesystem efímero, migraciones, backups |

---

## 3. Controles existentes (verificados)

| Control | Implementación | Evaluación |
|---|---|---|
| Hash de contraseña | `scryptSync` con salt único de 64 bytes | Correcto; revisar bloqueo del event loop |
| Token de sesión | 32 bytes aleatorios; se guarda SHA-256 | Correcto |
| Comparación de secretos | `timingSafeEqual` | Correcto |
| Política de contraseña | 8–128 caracteres | Correcta, sin complejidad obligatoria |
| Sesiones | 30 días, prolongación, `logout-all` | Correcto; falta gestión por dispositivo |
| Rate limit auth | 10 login/15 min; 5 registro/hora | Correcto en una instancia |
| Rate limit global | ventana fija por IP | Correcto como primera barrera |
| Escrituras de historial | `X-Api-Key` en tiempo constante | Correcto; clave única sin rotación |
| CORS | allowlist por entorno | Correcto; `null` solo fuera de producción |
| Cabeceras | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` | Correcto; faltan otras |
| CSP | `Content-Security-Policy` en `server/server.js` (sin `unsafe-inline`) | OK (Fase 6.1); COOP/CORP; HSTS producción; `Permissions-Policy` |
| Auditoría de dependencias (`npm audit --audit-level=high`) | CI + local: 0 vulnerabilidades (Fase 9) | OK |
| Recuperación de contraseñas | tokens 256-bit, SHA-256 en PG, expiran 24h, uno por email; endpoints `/api/auth/recuperar` y `PUT /api/auth/restablecer` | Implementado (Fase 9) |
| Auditoría de aprobaciones | tabla `auditoria_aprobaciones` en PG; `GET /api/auditoria`; registro en login y restablecer | Implementado (Fase 9) |
| Body limit | 2 MB | Correcto |
| SQL | consultas parametrizadas en los caminos revisados | Correcto |
| Secretos | variables de entorno; `.env` no versionado | Correcto |
| Errores de login | mensaje genérico y costo scrypt uniforme | Correcto |

---

## 4. Matriz de autorización

| Ruta | Público | Token de sesión | `X-Api-Key` |
|---|---:|---:|---:|
| `GET /health`, `GET /` | ✅ | — | — |
| `GET /api/pronosticos`, `/api/partidos`, stats, H2H, standings | ✅ | — | — |
| `GET /api/historial`, `/api/historial/stats` | ✅ | — | — |
| `GET /api/sports`, `/api/odds/:sport`, `/api/predicciones/:deporte` | ✅ | — | — |
| `POST /api/log` | ✅ (limitado) | — | — |
| `POST/PUT /api/historial*`, `/api/historial/ingest`, `/api/historial/liquidar` | ❌ | — | ✅ |
| `POST /api/auth/register`, `/api/auth/login` | ✅ (limitado) | — | — |
| `POST /api/auth/logout`, `/api/auth/logout-all` | ❌ | ✅ | — |
| `GET /api/auth/me` | ❌ | ✅ | — |
| `GET/PUT /api/mi-historial` | ❌ | ✅ | — |

Observaciones:

- No hay roles ni permisos granulares; el token de sesión da acceso a todo lo del usuario.
- La `X-Api-Key` es todopoderosa para el historial global: no distingue ingesta de liquidación ni deja auditoría por llamador.
- El modo anónimo guarda historial en `localStorage`; no está protegido por autenticación.

---

## 5. Hallazgos

Severidad: **Crítica** (explotable y con impacto directo), **Alta**, **Media**, **Baja**, **Informativa**.

### S-01 · Baja · Integridad de liquidación

**Estado:** Resuelta en Fase 1 (2026-11-20) por corrección + fixtures.

**Evidencia original:** `app-ui.js:562`, `app-model.js:1603-1617`, `test_paridad.py:90-91`.

**Corrección:** cliente y motor ahora comparten un único contrato (`tests/fixtures/settlement.json`, `npm run test:settlement`); la divergencia de `totalgoles` se corrigió; liquidación cliente/servidor idéntica; `test:settlement` 57/57; `test:parity` 100%.

**Restricción pendiente:** dos copias del contrato hasta Fase 3 (`settlement` como módulo puro).

Ver `ARCHITECTURE.md §8`.
### S-02 · Media · Rate limiting no distribuido

**Evidencia:** `server/seguridad.js`, `server/server.js:547-575`.

Los limitadores viven en memoria del proceso. Con varias instancias, reinicios o *cold starts* de Render, el límite se reinicia o se aplica por instancia. Un atacante puede multiplicar intentos.

**Remediación:** si se escala horizontalmente, usar un almacén compartido (PostgreSQL o Redis) con ventana deslizante; mientras tanto, documentar el supuesto de una sola instancia y añadir límites en el edge.

### S-03 · Media · TLS de PostgreSQL sin verificación de certificado

**Evidencia:** `server/db.js:30`.

```js
ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
```

`rejectUnauthorized: false` desactiva la validación del certificado y permite un ataque *man-in-the-middle* en la conexión a la base.

**Remediación:** usar el CA del proveedor o `rejectUnauthorized: true`; permitir `false` solo en desarrollo local explícito.

### S-04 · Media · Token de sesión en `localStorage`

**Evidencia:** `auth.js:10,20,34`; `Authorization: Bearer`.

Cualquier XSS puede leer el token y exfiltrarlo. La CSP reduce superficie, pero no elimina el riesgo (ver S-05).

**Remediación:** evaluar cookie `HttpOnly`, `Secure`, `SameSite=Lax` con protección CSRF; o mantener bearer y endurecer CSP, sanitización y revisión de dependencias. Cualquier cambio de transporte es un cambio de contrato y requiere migración.

### S-05 · Media · CSP permisiva y CDN sin SRI

**Evidencia:** `index.html:23`; cero atributos `integrity` en el HTML.

```
script-src 'self' https://cdn.jsdelivr.net;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
```

Riesgos:

- `unsafe-inline` en estilos permite inyección de CSS.
- Un script servido desde `cdn.jsdelivr.net` sin `integrity` puede ser alterado si el CDN o el paquete se comprometen.
- No hay `frame-ancestors`, `form-action` sí está, `object-src 'none'` sí está.

**Remediación:** eliminar `unsafe-inline` gradualmente (nonces/hashes), fijar versiones y usar SRI, preferir servir dependencias localmente, añadir `frame-ancestors 'none'` y `upgrade-insecure-requests`.

### S-06 · Media · Sin recuperación de contraseña ni verificación de email

**Evidencia:** esquema `usuarios` sin email; rutas de auth sin *forgot/reset*.

Un usuario que olvida su contraseña pierde la cuenta; no hay canal de soporte seguro. Tampoco hay verificación de propiedad del identificador.

**Remediación:** diseñar flujo de recuperación con token de un solo uso, expiración corta y rate limit; decidir si el identificador será email o usuario. Requiere cambio de esquema y análisis de consecuencias.

### S-07 · Baja · Clave estática compartida para escrituras de historial

**Evidencia:** `server/server.js:90-100`.

Una sola clave para todos los escritores; sin rotación, sin scopes, sin identidad de llamador. Si se filtra, se puede inyectar o liquidar historial hasta rotarla.

**Remediación:** claves por integración con hash en DB, scopes (`ingest`, `settle`), rotación y auditoría. Mantener la compatibilidad con la clave actual durante la transición.

### S-08 · Baja · `/api/log` sin autenticación

**Evidencia:** `server/server.js:793-805`.

Acepta telemetría de cualquier origen, la trunca y la guarda en un buffer acotado. El rate limit global y el límite de memoria reducen el abuso, pero permite ensuciar logs y consumir CPU.

**Remediación:** mantener el buffer acotado, añadir muestreo, validar origen y considerar una clave pública de telemetría o un endpoint por sesión.

### S-09 · Baja · Cabeceras de seguridad incompletas

**Evidencia:** `server/server.js:56-61`.

Presentes: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
Ausentes o delegadas al edge: `Strict-Transport-Security`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Content-Security-Policy` para la API.

**Remediación:** definir en Render/Cloudflare o en Express; HSTS solo con HTTPS estable y subdominios controlados.

### S-10 · Baja · Hash de contraseña síncrono

**Evidencia:** `server/server.js:854` (`scryptSync`).

scrypt es deliberadamente costoso; ejecutarlo en el event loop bloquea otras peticiones. Los límites de auth reducen el abuso, pero un pico legítimo puede degradar la API.

**Remediación:** usar `crypto.scrypt` asíncrono o un pool de workers; medir latencia antes y después.

### S-11 · Media · Deriva de dependencias y ausencia de auditoría automatizada

**Evidencia:** `package.json` declara `express ^5.2.1`; `server/package.json` declara `express ^4.18.2`; dos lockfiles; no hay paso de `npm audit` en CI.

Riesgos: instalaciones no reproducibles, vulnerabilidades conocidas sin detectar, comportamiento distinto entre entornos.

**Remediación:** un solo manifiesto y lockfile por despliegue; fijar versión; agregar `npm audit --omit=dev` (o equivalente) y Dependabot/Renovate con revisión.

### S-13 · Media · Gobernanza de parámetros de modelo

**Estado:** Mitigada en Fase 1 (2026-11-20).

**Evidencia original:** `recalibracion.py:1177-1180`, `pronosticos.py:26-47,373-402`, `.github/workflows/actualizar_pronosticos.yml:73-96`.

Cambios aplicados:

- Textos corregidos: hacer merge del PR no aprueba; aprobar es `python recalibracion.py --aprobar <id> --actor "<nombre>"`.
- Registro real: `aprobadoPor`, `version` (`params-<id>`), `hashOverrides`, `aplicación`.
- `rechazar_propuesta` registra `actor` y `motivo` en resolución.
- Pruebas nuevas: `test_gobernanza.py` (lectura/kill switch/dry-run/aprobación/rechazo/id inválido); activa en CI.
- Kill switch: `FULBITO_IGNORE_APPROVED_PARAMS=1` (ignora sin borrar el archivo).
- Log en cada generación con overrides: propuesta, versión y actor.

Pendiente de Fase 2: registro en PostgreSQL (`audit_log`), `model_version` por predicción, flag explícito de aplicación.

Ver `ARCHITECTURE.md §7.3.1`, `DATA-FLOW.md §5.3`.

### S-12 · Informativa · Higiene del repositorio

**Evidencia:** `.agents/` contiene assets duplicados y está en `.gitignore` pero ya trackeado; `app-model-backup.js` está sin trackear.

No afecta la runtime, pero confunde auditorías y puede incluir contenido no revisado.

**Remediación:** decidir explícitamente qué se versiona; eliminar duplicados con justificación; nunca commitear respaldos ad hoc.

---

## 6. Secretos y configuración

Variables esperadas (nombres, sin valores):

| Variable | Uso | Obligatoria |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | Para cuentas |
| `DATABASE_SSL` | control de TLS | Opcional |
| `FOOTBALL_DATA_API_KEY` | proveedor principal | Sí para partidos |
| `THE_ODDS_API_KEY` | cuotas | Opcional |
| `HISTORIAL_API_KEY` | escrituras de historial | Sí en producción |
| `CORS_ORIGINS` | allowlist adicional | Recomendada |
| `RAPIDAPI_KEY`, `RAPIDAPI_VOLLEY_HOST`, `RAPIDAPI_VOLLEY_PATH` | vóley | Opcional |
| `FULBITO_DATA_DIR` | directorio local | Solo desarrollo/test |
| `NODE_ENV` | modo de ejecución | Sí |

Reglas:

- Nunca registrar valores; solo nombres y presencia.
- Nunca devolver claves en respuestas ni mensajes de error.
- Rotar cualquier clave que haya estado en un archivo versionado o en un log.
- `.env.example` debe contener solo nombres y valores ficticios.
- Verificar que `server/.env` y `.env` estén ignorados y fuera del índice de Git.

---

## 7. Seguridad del pipeline y la cadena de suministro

Riesgos actuales:

- El workflow diario tiene `contents: write` y `pull-requests: write`; un compromiso del workflow permite escribir en el repositorio y publicar artefactos.
- Descarga artefactos de un Release con `gh release download` sin verificación de integridad explícita.
- Ejecuta `pronosticos.py`, que puede cargar modelos `.pkl` (código arbitrario) si existen en el directorio de modelos. El código prioriza formatos nativos XGBoost, pero el *fallback* a pickle sigue presente.
- Dependencias Python sin versiones fijas en `requirements.txt`.

Recomendaciones:

1. Fijar versiones y usar un lockfile (`pip-compile`/`uv lock`) con hashes.
2. Prohibir `.pkl` en producción o cargarlos solo desde una ruta confiable y con verificación de hash.
3. Minimizar permisos del workflow; separar generación de publicación.
4. Firmar o verificar los artefactos antes de ingerirlos.
5. Añadir escaneo de secretos y de dependencias en CI.
6. Revisar que los PRs de bots no puedan modificar workflows sin aprobación.

---

## 8. Protección de datos y retención

- El historial público contiene nombres de equipos, ligas, mercados y probabilidades; no contiene PII de usuarios.
- El historial personal puede contener preferencias; hoy vive en PostgreSQL y en `localStorage`.
- Las sesiones expiran a los 30 días; no hay limpieza programada más allá del borrado oportunista.
- No hay política documentada de retención, exportación ni eliminación de cuenta.
- Los backups de PostgreSQL dependen del proveedor; no hay prueba de restauración documentada.

Objetivo:

- Definir retención por tipo de dato.
- Permitir exportación y eliminación de cuenta.
- Probar restauración al menos una vez por trimestre.
- Cifrar backups en reposo y limitar acceso.

---

## 9. Checklist de revisión para cambios

Antes de mergear cualquier cambio que toque API, auth o datos:

- [ ] ¿La ruta nueva tiene autenticación y autorización explícitas?
- [ ] ¿Valida entrada con esquema y rechaza campos inesperados?
- [ ] ¿Usa consultas parametrizadas?
- [ ] ¿Registra errores sin secretos ni PII?
- [ ] ¿Tiene rate limit o costo acotado?
- [ ] ¿Respeta CORS y cabeceras?
- [ ] ¿Agrega una dependencia? ¿Está justificada, fijada y auditada?
- [ ] ¿Cambia un contrato? ¿Hay compatibilidad y pruebas?
- [ ] ¿Toca parámetros de modelo? ¿Requiere aprobación y auditoría?
- [ ] ¿Toca migraciones? ¿Hay respaldo, rollback y prueba?
- [ ] ¿Se actualizaron las pruebas de seguridad y paridad?

---

## 10. Prioridad de remediación

| Orden | Hallazgo | Especial de completado | Motivo |
|---|---|---|---|
| 1 | S-01 liquidación | S | Integridad del producto; ya no se depende del historial del cliente |
| 2 | S-13 gobernanza de parámetros | M | Caminos de aprobación y rechazo con actor/versión; auditoría en PostgreSQL para Fase 2 |
| 3 | S-03 TLS PostgreSQL | S | Cambio acotado, impacto alto |
| 4 | S-05 CSP/SRI | M | Reduce XSS y supply chain |
| 5 | S-11 dependencias | S | Reproducibilidad y CVEs |
| 6 | S-02 rate limit | M | Necesario al escalar |
| 7 | S-07 claves de historial | M | Rotación y auditoría |
| 8 | S-06 recuperación | M | Requiere esquema y flujo |
| 9 | S-04 cookies | L | Cambio de contrato; planificar |
| 10 | S-09 cabeceras | S | Configuración de edge |
| 11 | S-10 scrypt async | S | Rendimiento y disponibilidad |

Hallazgos resueltos en Fase 1: S-01, S-13 (parcial).
---

## 11. Controles añadidos por Fase 6.2/6.3 y Fase 9 (verificados)

- **Fase 6.2 — Métricas:** `server/metrics.js` — contadores `totalRequests`, `totalErrors`, `cacheHits`, `providers`, `latenciaAvgMs`, `latenciaP95Ms`; endpoint `GET /api/metrics`; header `X-Request-Id` en respuestas.
- **Fase 6.3 — Alertas:** `server/alertas.js` — alertas `error_rate >= 15%`, `latencia_p95 >= 3000ms`, `pool_esperando >= 100`; scheduler en `server/server.js` (`iniciarAlertas`, cada 60s, registro de alertas activas).
- **Fase 6.1 — Observabilidad:** logs estructuros JSON por request (`request_id`, método, ruta, estado, latencia) — sin secretos.
- **Fase 9 — Seguridad:**
  - TLS de PostgreSQL: `rejectUnauthorized: true` por defecto (`server/db.js`); `DATABASE_SSL=false` para compat (dev); `DATABASE_SSL_CA_FILE` para CA personalizada.
  - CSP completa en `server/server.js`: sin `unsafe-inline`, `script-src` limitado a `self` + CDN del frontend, `object-src 'none'`, `form-action 'self'`, HSTS en producción, `Permissions-Policy`.
  - `npm audit --audit-level=high` paso en CI (Fase 9): 0 vulnerabilidades.
  - Auditoría de dependencias: dependencias fijadas (`package-lock.json`), `npm audit` limpio (`npm audit fix` aplicado).
  - Auditoría de aprobaciones: tabla `auditoria_aprobaciones` (PG); `GET /api/auditoria`; registro en login y restablecer.
  - Recuperación de contraseñas: tokens 256-bit (SHA-256), expiración 24h, idempotencia por email (`ON CONFLICT`), sin email SMTP en MVP.
- **Fase 8 — Snapshot métrico (2026-11-21):** `{"totalRequests": 3, "totalErrors": 0, "cacheHits": 0, "latenciaAvgMs": 513, "latenciaP95Ms": 992}` — Fase 8 no aplicada (condición de evidencia no cumplida).
