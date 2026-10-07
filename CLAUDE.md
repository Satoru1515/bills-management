# CLAUDE.md — convenciones del proyecto

Proyecto: **Bills Management / Gastos por Correo**. Dueño: Satoru. Lee `PLAN.md` para saber qué sigue y `PROGRESS.md` para saber qué pasó.

## Stack
- Next.js 15 (App Router, `src/`), TypeScript estricto, Tailwind.
- Supabase: Postgres, Auth (Google), RLS. Cliente con `@supabase/ssr`.
- Tests: Vitest. Lint: ESLint + Prettier.
- Móvil: PWA + Capacitor (Android primero).

## Reglas de trabajo para la rutina automática
1. Una tarea del plan por corrida. Leer PLAN.md, tomar la primera `- [ ]` de la fase activa.
2. Antes de tocar código: `git status` limpio y estar en la rama de la fase (`fase/N-nombre`). Si no existe, crearla desde `main` actualizado.
3. Al terminar: `npm run lint && npm run typecheck && npm test` deben pasar. Si algo falla y no se arregla en la misma corrida, no marcar la tarea; anotar en PROGRESS.md.
4. Commit con Conventional Commits en inglés: `feat(parsers): add APAP parser`, `chore: scaffold next app`, `docs: ...`, `test: ...`. Un commit por tarea.
5. Marcar la tarea `- [x]` en PLAN.md y añadir una línea en PROGRESS.md (fecha, tarea, commit, notas). Esos dos cambios van en el mismo commit.
6. Push de la rama si hay remoto `origin`. Al cerrar una fase: PR contra `main` (con `gh pr create` si está disponible; si no, push y dejar en PROGRESS.md el enlace de comparación para que Satoru lo abra). Nunca mezclar PRs: eso lo hace Satoru.
7. No instalar nada global, no tocar archivos fuera de este repo, no borrar nada que no haya creado la misma corrida. Nunca escribir secretos reales en el repo.
8. Si falta una decisión o credencial, marcar `- [~]` con la pregunta concreta y seguir con otra tarea.

## Código
- Inglés para código, nombres, commits y README. Español para PLAN.md, PROGRESS.md y docs internos.
- Parsers puros: `(raw: RawEmail) => ParsedEmail | null`. Sin red, sin fechas del sistema. Todo testeado con fixtures en `__fixtures__/`.
- Fechas en ISO 8601 con offset `-04:00` (hora de República Dominicana, sin horario de verano). Campo `mes` = `YYYY-MM`.
- Montos como `number` en la app y `numeric(12,2)` en la base de datos. Moneda `DOP` | `USD`.
- `gmail_message_id` es la clave de deduplicación (único por usuario). Al re-sincronizar nunca pisar `categoria` ni `ignorar` que el usuario haya editado.
- Nunca guardar balances disponibles ni números de cuenta completos. Solo los últimos 4 dígitos de la tarjeta.

## Variables de entorno (`.env.example`)
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ENCRYPTION_KEY (32 bytes base64), CRON_SECRET, NEXT_PUBLIC_APP_URL.

## Remitentes que se leen
- `alertas@scotiabank.com`
- `no-reply@apap.com.do`
- `notificaciones@bsc.com.do`
- `service@intl.paypal.com` (asunto contiene "Receipt")
