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
