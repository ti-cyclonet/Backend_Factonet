# 🧾 Backend Factonet

![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

## 📋 Descripción

Backend de **FactoNet**, el portal donde los clientes de CycloNet consultan y pagan las facturas que emite Authoriza, y donde el administrador verifica los pagos y configura periodos y parámetros de facturación.

FactoNet **no tiene base de datos propia**. Authoriza es la fuente de verdad de facturas, contratos, periodos y usuarios; este backend valida el JWT, limita qué ve cada rol y llama a Authoriza con la clave interna (`x-internal-key`).

| Rol | Ve y hace |
|---|---|
| `adminFactonet` | Todas las facturas; verifica pagos (aprobar o rechazar), genera facturas pendientes, periodos, parámetros y reportes |
| `adminInvoices` (cliente) | Solo las facturas de su tenant; reporta pagos con constancia (y paga en línea cuando la pasarela esté activa) |

## 🚀 Instalación y configuración

Requiere Backend_Authoriza corriendo (puerto 3000), con la misma `INTERNAL_API_KEY`.

```bash
yarn install
yarn start:dev        # http://localhost:3003
```

`.env`:

```env
PORT=3003
AUTH_SERVICE_URL=http://localhost:3000      # Authoriza
JWT_SECRET=...                              # el mismo de Authoriza
INTERNAL_API_KEY=...                        # la misma de Authoriza (16+ caracteres)
```

## 📚 API (prefijo `/api`; en producción, `https://api.cyclonet.com.co/api/billing`)

- `auth`: `profile`, `validate`, `users`, `applications`, `change-password`.
- `invoices`:
  - `GET /` (según el rol);
  - `POST :id/register-payment` (constancia obligatoria), `GET :id/voucher`;
  - solo administrador: `POST :id/confirm-payment`, `POST :id/reject-payment`, `PATCH :id/status`, `POST sweep`, `GET profit-report`, `GET check-period`.
- `contracts`: `GET /`, `PATCH :id/status`, `POST :id/pdf`, `PATCH :id/sign`, `PATCH :id/issue`.
- `dashboard`: `overview`, `metrics`.
- `periods`, `global-parameters-periods`, `global-parameters-for-invoices`: periodos y parámetros de facturación.
- `reports`: `clients`, `contracts`, `invoices`, `profits`, `taxes`, `global-parameters`, `management-indicators`.
- `pagos`: pago en línea, ver abajo.

Los errores de Authoriza llegan con su código y mensaje (`errorDeAuthoriza`): un 4xx conserva el motivo, y una caída de Authoriza responde 502.

## 💳 Pago en línea (Wompi) — apagado por defecto

El cliente paga hoy reportando el pago con una constancia, y el administrador lo verifica. El módulo `src/pagos/` agrega el pago en línea con Wompi (PSE, tarjeta, Nequi y botón Bancolombia), pero **solo se enciende** con `PASARELA_ACTIVA=true` y todas las llaves configuradas. Mientras tanto, el portal solo muestra "Reportar pago".

```env
PASARELA_ACTIVA=true
WOMPI_ENTORNO=sandbox                    # o produccion
WOMPI_LLAVE_PUBLICA=pub_test_...         # pub_prod_... en producción
WOMPI_SECRETO_INTEGRIDAD=test_integrity_...
WOMPI_SECRETO_EVENTOS=test_events_...
FACTONET_URL_PORTAL=https://<dominio del portal FactoNet>
```

En el panel de Wompi (Desarrolladores), la URL de eventos es `https://api.cyclonet.com.co/api/billing/pagos/wompi/eventos`.

Cómo funciona:

1. `POST /api/pagos/facturas/:id/checkout`: el servidor calcula el TOTAL (valor ± conceptos, con la mora del día que trae Authoriza), lo firma y devuelve la URL de Wompi. El navegador no puede cambiar el monto.
2. Wompi avisa a `POST /api/pagos/wompi/eventos`. Se verifica la firma con el secreto de eventos, se registra el pago en Authoriza (que congela la mora a la fecha del pago) y, si el valor cubre el total, se confirma: la factura queda **Pagada** sin intervención del administrador.
3. Al volver, el portal llama `GET /api/pagos/wompi/transacciones/:id`. Este consulta la transacción en Wompi y la aplica si el evento no llegó; un pago ya aplicado no se repite.

Si Wompi cobró menos del total (por ejemplo, la mora subió entre el pago y el registro), la factura queda en "Pago reportado" para que el administrador decida. Un pago reportado con constancia nunca se pisa.

## 📝 Scripts disponibles

```bash
yarn start:dev    # Desarrollo con hot reload
yarn build        # Compilar aplicación
yarn start:prod   # Producción
yarn lint         # Verificar código
yarn test         # Pruebas unitarias
```

## 🏗️ Arquitectura del sistema

```
Frontend_Factonet (Angular) → Backend_Factonet (NestJS) → Backend_Authoriza (facturas, contratos, periodos, usuarios)
                                      ↓
                                Wompi (pago en línea, apagado por defecto)
```

## 📄 Licencia

Privada - Derechos reservados Cyclonet

## 📒 Contabilidad (etapa 1: la de CycloNet)

Módulo `src/accounting`, con **base de datos propia de FactoNet**. Lleva el PUC base, los terceros, los comprobantes de partida doble (ingreso, egreso, nota contable y automáticos), los periodos con cierre y los reportes: balance de prueba, libro mayor/auxiliar, estado de resultados y estado de situación financiera. Las facturas y pagos de CycloNet en Authoriza se contabilizan solos (al pulsar «Sincronizar» y cada 30 minutos), sin duplicar. Solo lo ve el rol `adminFactonet`.

Mientras no se configure la base de datos, FactoNet arranca igual que siempre y `GET /api/accounting/status` responde `{ enabled: false }`.

**Para encenderla:**
1. Crear la base en el RDS, una sola vez: `CREATE DATABASE "FactonetDB";`. Las tablas `acc_*` las crea `synchronize`.
2. Agregar las variables al `.env` / compose del servidor. **No se sincronizan con el repo**, hay que ponerlas a mano:

| Variable | Para qué |
|---|---|
| `FACTONET_DB_HOST`, `FACTONET_DB_PORT`, `FACTONET_DB_NAME`, `FACTONET_DB_USER`, `FACTONET_DB_PASSWORD` | Conexión (la misma instancia RDS, otra base). |
| `FACTONET_DB_SSL` | `false` solo en local (por defecto SSL). |
| `FACTONET_DB_SYNC` | `false` para no crear ni alterar tablas al arrancar (por defecto las crea). |
| `ACCOUNTING_CYCLONET_TENANT_ID` | Usuario de Authoriza de CycloNet (dueño de la empresa contable). |
| `ACCOUNTING_CYCLONET_NAME`, `ACCOUNTING_CYCLONET_NIT` | Datos de la empresa. |
| `ACCOUNTING_AUTO_FROM` | `YYYY-MM-DD`: desde qué fecha se contabilizan las facturas automáticamente. Lo anterior se registra con saldos iniciales. |
| `ACCOUNTING_AUTO_SYNC` | `false` apaga la sincronización cada 30 minutos (queda el botón). |

**Pendiente con el contador de CycloNet:** validar el PUC base (`puc.ts`) y las cuentas de los asientos automáticos (`DEFAULT_ACCOUNT_MAP`):
- factura emitida: 130505 contra 415595 y 240805;
- pago: 111005 contra 130505, y la mora en 421005.

**Prueba de integración contra Postgres:** `ACCOUNTING_TEST_DB=postgres://user:pass@host:port/db npx jest src/accounting/accounting.int-spec.ts --testRegex int-spec`

### 📥 Facturas recibidas de proveedores (fase 1)
Los proveedores envían su factura electrónica (ZIP con el XML UBL 2.1 y el PDF) a `facturas@cyclonet.com.co`. FactoNet lee el XML, sin OCR, y la deja en **Contabilidad → Facturas recibidas**: por aprobar, con la cuenta de la regla del proveedor. Nada se contabiliza sin aprobación. Al aprobar se crea una nota contable (causación):
- **Débito al gasto:** base + otros tributos + IVA. El IVA va al gasto porque CycloNet presta servicios excluidos de IVA; cambia con `accountMap.ivaCompras = '240810'`.
- **Crédito a retenciones:** 236525 (renta), 236705 (IVA) y 236805 (ICA), según lo que traiga el XML.
- **Crédito a proveedores:** 220505, por el neto.

La bandeja descarta sola:
- las facturas duplicadas (por CUFE);
- las dirigidas a otro NIT;
- las que llegan sin XML.

Mientras el buzón no esté configurado, las facturas se pueden **cargar a mano** (ZIP, XML o PDF).

El correo de `cyclonet.com.co` está en **Titan**. Los proveedores envían a **`facturas@cyclonet.com.co`**, un buzón de Titan, y FactoNet lo lee por **IMAP**. No hay que tocar DNS ni AWS:
- Cada correo de la bandeja de entrada se procesa y se mueve a la carpeta **FactoNet**.
- Los correos que no se pudieron leer pasan a **FactoNet-Errores**, para revisarlos a mano.

| Variable | Uso |
|---|---|
| `INBOX_ADDRESS` | Dirección que se muestra para dar a los proveedores: `facturas@cyclonet.com.co` |
| `INBOX_IMAP_HOST` | Servidor IMAP: `imap.titan.email` |
| `INBOX_IMAP_PORT` / `INBOX_IMAP_SECURE` | Por defecto `993` / `true` (SSL) |
| `INBOX_IMAP_USER` / `INBOX_IMAP_PASSWORD` | Usuario (`facturas@cyclonet.com.co`) y contraseña del buzón. Solo en el `.env` del servidor |
| `INBOX_IMAP_DONE` | Carpeta de procesados (por defecto `FactoNet`) |
| `INBOX_POLL_MINUTES` | Cada cuánto se revisa el buzón (por defecto 5) |

**Alternativa sin buzón de Titan: AWS SES + S3** (`INBOX_S3_BUCKET`, `INBOX_S3_PREFIX` = `entrantes/`, `INBOX_S3_REGION`). SES recibe en un subdominio, por ejemplo `facturas.cyclonet.com.co`, con su registro `MX 10 inbound-smtp.us-east-1.amazonaws.com`. Una regla de recepción entrega los correos al bucket. El contenedor necesita `s3:ListBucket`, `GetObject`, `PutObject` y `DeleteObject`. Si IMAP está configurado, tiene prioridad.

**Prueba de integración:** `ACCOUNTING_TEST_DB=… npx jest src/accounting/inbox/inbox.int-spec.ts --testRegex int-spec`
