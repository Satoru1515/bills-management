# Row Level Security (RLS)

Cada usuario solo ve y edita sus propias filas. Las políticas están en `supabase/migrations/0002_rls_policies.sql` (y `0003_sync_runs_server_only.sql`, que deja `sync_runs` en solo lectura para los usuarios, y `0004_import_queue.sql`, que crea `import_months` igual); la RLS se activa en `0001_init.sql`.

## Qué puede hacer cada rol

| Tabla | `authenticated` (usuario con sesión) | `anon` | `service_role` (servidor) |
|---|---|---|---|
| `profiles` | leer y editar el suyo (se crea solo al registrarse, se borra con el usuario) | nada | todo |
| `gmail_connections` | leer el suyo **sin** `refresh_token_encrypted`; crear, editar y borrar el suyo | nada (ni siquiera `select`) | todo |
| `transactions` | leer, crear, editar y borrar las suyas | nada | todo |
| `category_rules` | leer, crear, editar y borrar las suyas | nada | todo |
| `sync_runs` | solo leer las suyas (las crea y completa el servidor; así nadie puede falsear el historial que usa el límite de «Sync now») | nada | todo |
| `import_months` | solo leer la suya (la cola de meses de «Email history»; la llena y la trabaja el servidor) | nada | todo |

- Ninguna política permite cambiar `user_id` (o `id` en `profiles`) a otro usuario: el `with check` lo rechaza.
- El token cifrado de Gmail solo lo lee el servidor con la clave `service_role` (sincronización por cron) y lo descifra con `ENCRYPTION_KEY`. Desde el navegador, `select *` sobre `gmail_connections` da error de permisos: hay que pedir columnas concretas (`email, last_sync_at, …`).
- `service_role` se salta la RLS: esa clave (`SUPABASE_SERVICE_ROLE_KEY`) nunca va al cliente.

## Prueba automática

`src/test/rls.test.ts` aplica todas las migraciones en un Postgres en memoria (PGlite) con un stub del esquema `auth` de Supabase y comprueba cada fila de la tabla de arriba con dos usuarios. Corre con `npm test`.

## Prueba manual (Supabase real)

Hacerla una vez después de aplicar las migraciones al proyecto (local con `npx supabase start` o en la nube con `npx supabase db push`).

1. Crear dos usuarios de prueba en **Authentication → Users → Add user** (por ejemplo `ana@example.com` y `ben@example.com`). Comprobar en **Table Editor → profiles** que se creó una fila para cada uno.
2. Copiar los dos `id` (UUID) y, en **SQL Editor**, insertar datos para ambos (el editor corre como `postgres`, que se salta la RLS):

   ```sql
   insert into public.transactions
     (user_id, gmail_message_id, date, month, bank, card_last4, amount, currency, merchant)
   values
     ('<ID_ANA>', 'manual-test-1', now(), to_char(now(), 'YYYY-MM'), 'APAP', '5977', 920, 'DOP', 'PRUEBA ANA'),
     ('<ID_BEN>', 'manual-test-1', now(), to_char(now(), 'YYYY-MM'), 'APAP', '5977', 100, 'DOP', 'PRUEBA BEN');

   insert into public.gmail_connections (user_id, email, refresh_token_encrypted)
   values ('<ID_ANA>', 'ana@example.com', 'prueba'), ('<ID_BEN>', 'ben@example.com', 'prueba');
   ```

3. Hacerse pasar por Ana en el mismo editor (todo dentro de una transacción que se deshace al final):

   ```sql
   begin;
   set local role authenticated;
   select set_config('request.jwt.claims', '{"sub":"<ID_ANA>","role":"authenticated"}', true);

   select merchant from public.transactions;                          -- solo 'PRUEBA ANA'
   update public.transactions set ignored = true where merchant = 'PRUEBA BEN';  -- UPDATE 0
   delete from public.transactions where merchant = 'PRUEBA BEN';     -- DELETE 0
   select email, last_sync_at from public.gmail_connections;          -- solo ana@example.com
   select count(*) from public.profiles;                              -- 1
   rollback;
   ```

4. Comprobar que estos fallan (cada uno en su propia transacción, porque un error aborta la transacción):

   ```sql
   begin;
   set local role authenticated;
   select set_config('request.jwt.claims', '{"sub":"<ID_ANA>","role":"authenticated"}', true);
   select refresh_token_encrypted from public.gmail_connections;      -- permission denied
   rollback;

   begin;
   set local role authenticated;
   select set_config('request.jwt.claims', '{"sub":"<ID_ANA>","role":"authenticated"}', true);
   insert into public.category_rules (user_id, keyword, category)
   values ('<ID_BEN>', 'X', 'Otros');                                 -- violates row-level security policy
   rollback;

   begin;
   set local role anon;
   select count(*) from public.transactions;                          -- 0
   rollback;
   ```

5. Repetir el paso 3 con `<ID_BEN>` y comprobar que solo ve `PRUEBA BEN`.
6. Limpiar: borrar los dos usuarios en **Authentication → Users** (sus filas se borran en cascada).

Si algún resultado no coincide, no usar la app con datos reales hasta revisar las políticas.
