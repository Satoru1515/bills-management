# Especificación de parseo de correos

Fuente de verdad para los parsers de `src/lib/parsers/`. Los ejemplos están tomados de correos reales con montos cambiados. Los parsers reciben el cuerpo en **texto plano** (el HTML se convierte a texto antes). Cualquier campo que no se pueda extraer con certeza → devolver `null` (el correo se registra como "no interpretado" en `sync_runs`).

Salida común (`ParsedEmail`):

```ts
{
  gmailMessageId: string;   // id del mensaje de Gmail = clave de deduplicación
  date: string;             // ISO 8601 con offset -04:00
  month: string;            // "YYYY-MM"
  bank: "Scotiabank" | "APAP" | "Banco Santa Cruz" | "PayPal";
  cardLast4: string;        // "7341"
  amount: number;           // 5986.90
  currency: "DOP" | "USD";
  merchant: string;         // texto tal cual, recortado
  kind: "consumo";          // por ahora solo consumos
}
```

Nunca extraer ni guardar: balances disponibles, números de cuenta, códigos OTP.

---

## 1. Scotiabank — `alertas@scotiabank.com`

El snippet/cuerpo tiene una sola frase con todo. Formato (puede llevar separador de miles):

```
Hola SATORU, Se realizó una autorización por un monto de $5,986.90 DOP en SUPERM. NACIONAL MAXIM con su Tarjeta de Crédito Scotiabank ***7341 a las 07:35 pm AST Si usted no lo hizo, ...
```

Variantes del mismo consumo (asunto):
- `Uso de tarjeta de crédito` → "Se realizó una autorización por un monto de $X CUR en COMERCIO con su Tarjeta de Crédito Scotiabank ***1234 a las hh:mm am/pm AST"
- `Autorización fuera del país` → "Se realizó una autorización fuera del país por un monto de $X CUR en COMERCIO con su Tarjeta de Crédito Scotiabank ***1234 a las ..."
- `Autorización sin tarjeta de crédito presente` → "Se realizó una autorización sin su Tarjeta de Crédito Scotiabank presente por un monto de $X CUR en COMERCIO con su tarjeta ***1234 a las ..."

Regex sugerida (sobre el cuerpo normalizado a una línea):
```
/monto de \$([\d,]+\.\d{2}) (DOP|USD) en (.+?) con su (?:Tarjeta de Crédito Scotiabank|tarjeta) \*{3}(\d{4}) a las (\d{1,2}:\d{2}) (am|pm)/i
```

También es consumo:
- `Pago de factura realizado` → "Se realizó un pago de factura desde tu Tarjeta de Crédito por un cantidad de $2,251.46 DOP en la tarjeta ***7341 a las 12:59 pm AST". merchant = `PAGO DE FACTURA`.

Ignorar (devolver `null`):
- `Pago recibido` ("Recibimos un pago a su Tarjeta de Crédito ...")
- `Pago al Instante recibido` ("Ha recibido un crédito a su cuenta ...")
- `Configuración de billetera digital` (códigos)
- Autorizaciones de **$0.10 USD** (verificaciones de tarjeta de Anthropic, Amazon, ChatGPT, Apple).

Fecha: el correo no trae fecha en el cuerpo; usar la fecha de recepción del mensaje (`internalDate`) convertida a `-04:00` y reemplazar la hora por la que dice el texto ("07:35 pm").

**Deduplicación**: Scotiabank manda 2 o 3 correos por una misma compra (uno por cada asunto de arriba). Se consideran el mismo consumo cuando coinciden `cardLast4`, `amount`, `currency`, `merchant` y la hora con ±2 minutos. Se conserva el de asunto `Uso de tarjeta de crédito` si existe; si no, el primero recibido. Los descartados no se guardan.

Tarjetas vistas: 7341, 1842.

---

## 2. APAP — `no-reply@apap.com.do`

Asunto: `APAP, Notificaciones`. Cuerpo en tabla (en texto plano llega con `|`):

```
Hola YANO ROMERO/SATORU, Tu titular Visa Platinum terminada en 5977 presenta una transacción contactless con el siguiente detalle:
Detalle de la transacción
Fecha: | 4/10/2026
Hora: | 20:7
Moneda: | RD pesos dominicanos
Monto: | 920.00
Comercio: | BURGER KING SAN ISIDRO
Estado: | Transacción Aprobada
Balance disponible: | RD$ ...   ← NO guardar
```

- Tipo de transacción en la primera frase: "contactless", "sin presencia de plástico" (online), etc. No afecta el parseo.
- `Fecha` es `d/m/aaaa`. `Hora` es `h:m` sin ceros a la izquierda (`20:7` = 20:07).
- `Moneda`: contiene "pesos" → DOP; contiene "dólar"/"USD" → USD.
- `cardLast4`: dígitos después de "terminada en".
- Solo guardar si `Estado` contiene "Aprobada".

Ignorar: pagos recibidos, recordatorios de fecha de pago, códigos OTP / activación de billetera (remitente a veces en mayúsculas `NO-REPLY@apap.com.do`).

Tarjetas vistas: 5977.

---

## 3. Banco Santa Cruz — `notificaciones@bsc.com.do`

Asunto: `Notificación, Banco Santa Cruz`. Cuerpo:

```
NOTIFICACIÓN DE consumo
Estimado (a) cliente.
...
Te notificamos que desde tu tarjeta de Crédito Gold terminada en 9236
fue realizada la siguiente transacción:

Monto: RD$ 394.00
Lugar de transacción: SM BRAVO LAS AMERICAS SANTO DOMINGODO
Fecha y hora: 6/10/2026 23:18:05
Estado: Aprobada
```

- `Monto`: prefijo `RD$` → DOP, `US$` → USD. Puede traer separador de miles.
- `Fecha y hora`: `d/m/aaaa HH:MM:SS`.
- `Lugar de transacción` → merchant (recortar espacios; el sufijo "DO" de país puede quedarse).
- "terminada en" / "terminada en" puede estar partido en dos líneas: normalizar saltos de línea a espacios antes de aplicar regex.

Ignorar: "Transferencia recibida" / abonos para pago de tarjeta, devoluciones de cashback, cualquier correo sin "NOTIFICACIÓN DE consumo".

Tarjetas vistas: 9236.

---

## 4. PayPal — `service@intl.paypal.com`

Asunto: `Receipt for Your Payment to <Merchant>`. Cuerpo (inglés):

```
You paid $11.99 USD to Spotify AB
Transaction ID 5M370362P66534715
Transaction date 4 Oct 2026
Merchant Spotify AB support@spotify.com
...
Paid Spotify AB with
Visa-7782 | $11.99 USD
```

- amount/currency de "You paid $X CUR to Y". merchant = Y (o el nombre del asunto).
- `Transaction date`: `d Mon yyyy` (mes en inglés abreviado; "Sept" también aparece).
- `cardLast4`: dígitos después de `Visa-` / `Mastercard-`. Si no hay, `"0000"`.
- Hora: no viene; usar la hora de recepción del correo.

Ignorar: cualquier correo de PayPal que no sea un receipt de pago enviado (p. ej. "You've got money", promociones).

---

## 5. Categorías

Regla: primera coincidencia (sin distinguir mayúsculas) de una palabra clave dentro de `merchant`. Si nada coincide → `Otros`. Las reglas deben vivir en un solo módulo (`categorize.ts`) y más adelante poder ampliarse desde la base de datos (`category_rules`).

| Categoría | Palabras clave |
|---|---|
| Supermercado | PRICESMART, JUMBO, SIRENA, BRAVO, HIPER OLE, HIPERMERCADOS OLE, NACIONAL, SUPERM |
| Combustible | SHELL, ESSO, PETRONAN, CREDIGAS, PROPAGAS, ESTACION |
| Restaurantes | MC DONALDS, MCDONALD, BURGER KING, HOT DOG, LA TINAJA, RESTAURANT, CAFE, BAR, RINCON SOLEADO, LA LOLA |
| Viajes | AIRBNB, AERODOM, TOURS, HACIENDA, HOTEL |
| Transporte | UBER, PEAJES |
| Suscripciones | SPOTIFY, CRUNCHYROLL, APPLE.COM, CHATGPT, ANTHROPIC, NETFLIX |
| Entretenimiento | RIOT GAMES, EVENTOS TOI |
| Compras online | AMAZON, BM CARGO, SHEIN |
| Hogar | IKEA, BELL HOME, FERREDEPOT |
| Salud | FCIA, FARMACIA |
| Telecom | WIND TELECOM, CLARO, ALTICE |
| Servicios | PROCURADURIA, TRANSITO, CORAABO, PAGO DE FACTURA, EDESUR, EDEESTE |
| Cuidado personal | BARBER |
| Licores | LIQUOR |

Orden de evaluación = orden de la tabla (así "SM BRAVO" cae en Supermercado antes que "BAR" en Restaurantes).

---

## 6. Consulta a Gmail

Una búsqueda por remitente, con `after:YYYY/MM/DD` = último sync − 1 día:

```
from:alertas@scotiabank.com after:2026/10/06
from:no-reply@apap.com.do after:2026/10/06
from:notificaciones@bsc.com.do after:2026/10/06
from:service@intl.paypal.com subject:receipt after:2026/10/06
```

Procesar **todos los mensajes de cada hilo** (APAP y BSC agrupan varias notificaciones del día en un hilo).
