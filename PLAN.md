# PLAN — Bills Management (Gastos por Correo)

App web (Next.js + Supabase) que lee las notificaciones de consumo de tarjeta que llegan a Gmail, las convierte en transacciones y muestra un panel de gastos por mes, categoría, banco y tarjeta. Empaquetada para móvil con Capacitor.

## Cómo usar este plan (para la rutina automática)

- Las fases van en orden. Cada tarea es un checkbox `- [ ]`. Se trabaja **una tarea por corrida** y se marca `- [x]` al terminar.
- Cada fase vive en su rama `fase/N-nombre`. Al cerrar la última tarea de la fase se abre un PR contra `main` y se marca la fase como `[PR abierto]`. La siguiente fase arranca desde `main` **solo cuando el PR anterior esté mezclado**; si no, se anota en PROGRESS.md y se espera.
- Si una tarea no se puede completar (falta una credencial, una decisión de Satoru, red bloqueada), se marca `- [~]` con una nota y se pasa a la siguiente que no dependa de ella.
- Decisiones de diseño y convenciones: ver `CLAUDE.md`. Formato de los correos y reglas de categorías: ver `docs/parsing-spec.md`.

## Fase 0 — Scaffold  (rama `fase/0-scaffold`) [PR abierto]

- [x] Crear proyecto Next.js 15 (App Router, TypeScript, Tailwind, ESLint) en la raíz del repo con `npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes`. Si la red está bloqueada, anotarlo y parar.
- [x] Añadir Prettier, Vitest (+ `@testing-library/react`) y scripts `test`, `lint`, `format`, `typecheck` en package.json. `npm run typecheck` = `tsc --noEmit`.
- [x] `.env.example` con todas las variables que usará la app (ver CLAUDE.md) y `.gitignore` que excluya `.env*.local`.
- [x] README.md en inglés: qué hace, stack, cómo correr local, variables de entorno, estructura de carpetas.
- [x] Verificar que `npm run lint`, `npm run typecheck` y `npm test` pasan en limpio. Cerrar fase: PR.

## Fase 1 — Dominio y parsers  (rama `fase/1-parsers`) [PR abierto]

- [x] `src/lib/domain/types.ts`: tipos `Transaction`, `Bank`, `Currency`, `Category`, `ParsedEmail`, `RawEmail` (id, threadId, from, subject, date, snippet, body).
- [x] `src/lib/parsers/scotiabank.ts` + tests con fixtures en `src/lib/parsers/__fixtures__/`. Cubrir los 3 asuntos de consumo, "Pago de factura", y los que se ignoran (pagos recibidos, $0.10, billetera).
- [x] `src/lib/parsers/apap.ts` + tests (tabla Fecha/Hora/Moneda/Monto/Comercio/Estado; ignorar OTP y pagos).
- [x] `src/lib/parsers/bsc.ts` (Banco Santa Cruz) + tests (Monto RD$/US$, Lugar, Fecha y hora; ignorar transferencias y cashback).
- [x] `src/lib/parsers/paypal.ts` + tests (You paid X USD to Y, Transaction date, Visa-####).
- [x] `src/lib/parsers/index.ts`: `parseEmail(raw): ParsedEmail | null` que elige el parser por remitente. Test de integración con un correo de cada banco.
- [x] `src/lib/domain/categorize.ts`: reglas por palabra clave (ver parsing-spec) + tests. Debe ser fácil añadir reglas desde la base de datos más adelante.
- [x] `src/lib/domain/dedupe.ts`: colapsa los correos repetidos de Scotiabank (misma tarjeta, monto, moneda, comercio y hora ±2 min) + tests.
- [x] Cerrar fase: todo verde, PR.

## Fase 2 — Base de datos (Supabase)  (rama `fase/2-db`) [PR abierto]

- [x] `supabase/` con CLI inicializada y migración `0001_init.sql`: tablas `profiles`, `gmail_connections` (refresh token cifrado, email, last_history_id, last_sync_at), `transactions` (gmail_message_id único por usuario, fecha, mes, banco, tarjeta, monto numeric, moneda, comercio, categoria, ignorar bool, origen), `category_rules` (usuario, keyword, categoria), `sync_runs` (inicio, fin, nuevas, errores).
- [x] RLS: cada usuario solo ve y edita sus filas. Políticas + test manual documentado.
- [x] `src/lib/supabase/{client,server}.ts` con `@supabase/ssr`. Tipos generados (`npm run db:types`).
- [x] `src/lib/repo/transactions.ts`: `upsertMany`, `listByMonth`, `updateCategory`, `setIgnored`. Tests contra un mock.
- [x] Cerrar fase: PR.

## Fase 3 — Auth y permiso de Gmail  (rama `fase/3-auth`) [PR abierto]

- [x] Supabase Auth con Google, scope `https://www.googleapis.com/auth/gmail.readonly`, `access_type=offline`, `prompt=consent`. Guardar refresh token en `gmail_connections` cifrado con `ENCRYPTION_KEY` (AES-256-GCM, `src/lib/crypto.ts` + tests).
- [x] Páginas `/login` y callback. Middleware que protege `/app/*`.
- [x] `docs/google-cloud-setup.md`: paso a paso para crear el proyecto en Google Cloud, pantalla de consentimiento en modo Testing, usuarios de prueba, credenciales OAuth, URIs de redirección.
- [x] Cerrar fase: PR.

## Fase 4 — Sincronización con Gmail  (rama `fase/4-sync`) [PR abierto]

- [x] `src/lib/gmail/client.ts`: obtener access token desde el refresh token, `listMessages(query, after)`, `getMessage(id)` con cuerpo en texto plano (decodificar base64url, preferir text/plain, si no convertir HTML a texto).
- [x] `src/lib/sync/run.ts`: para el usuario, buscar desde `last_sync_at - 1 día` los 4 remitentes, parsear, categorizar, deduplicar, `upsertMany` (no pisar `categoria`/`ignorar` editados), registrar `sync_runs`.
- [x] `POST /api/sync` (autenticado) y botón "Actualizar ahora" en la UI. `GET /api/cron/sync` protegido con `CRON_SECRET` para Vercel Cron cada 15 min (`vercel.json`).
- [x] Tests del pipeline con fixtures (sin red).
- [x] Cerrar fase: PR.

## Fase 5 — Panel (UI)  (rama `fase/5-dashboard`) [PR abierto]

- [x] Layout `/app`: cabecera con selector de mes, tarjetas KPI (total del mes en RD$ con USD convertidos, en pesos, en dólares, promedio diario, variación vs mes anterior).
- [x] Barras por categoría (clic filtra) y resumen por banco/tarjeta. Diseño sobrio: tipografía con números tabulares, tema claro y oscuro.
- [x] Tabla de transacciones con búsqueda, filtro por banco y categoría; editar categoría en línea; botón ignorar/restaurar.
- [x] Ajustes: tasa USD→DOP (guardada en `profiles`), estado de la conexión Gmail, última sincronización, botón reconectar.
- [x] Responsive a 400px de ancho. Cerrar fase: PR.

## Fase 6 — PWA y móvil  (rama `fase/6-mobile`)

- [x] `manifest.webmanifest`, íconos, service worker básico (cache de assets, página offline). Instalable desde el navegador.
- [ ] Capacitor: `npx cap init`, `capacitor.config.ts` apuntando a la URL desplegada, proyecto Android generado (`android/` en el repo). Documentar cómo construir el APK.
- [ ] Login con Google dentro de Capacitor (abrir en navegador del sistema y volver por deep link). Documentar.
- [ ] Cerrar fase: PR.

## Fase 7 — Despliegue  (rama `fase/7-deploy`)

- [ ] `docs/deploy.md`: Vercel + Supabase, variables de entorno, cron, dominio.
- [ ] Checklist de seguridad: tokens cifrados, RLS activa, secretos fuera del repo, rate limit en `/api/sync`.
- [ ] Cerrar fase: PR. Proyecto listo para uso personal.

## Ideas para después (no tocar sin aprobación)

- Gmail Push (Pub/Sub) en lugar de polling.
- Reglas de categoría editables desde la UI.
- Más remitentes (BHD, Popular) cuando Satoru active sus alertas.
- Presupuestos por categoría y avisos.
