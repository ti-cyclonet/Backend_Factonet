# Reset completo de la base de datos — FactoNet

Script para **vaciar** las tablas locales de FactoNet.

> ⚠️ **Operación destructiva e irreversible.**

## Contexto importante (leer antes de usar)

FactoNet es un caso especial dentro del ecosistema:

- **No** establece una conexión TypeORM de raíz (no hay `TypeOrmModule.forRoot`,
  no hay `synchronize: true`, no hay migraciones).
- La mayor parte de su lógica (contratos, facturas) **delega en Authoriza** vía
  HTTP (`AUTH_SERVICE_URL`), no en una BD local.
- Solo existen **4 tablas locales** en el schema `billing`:
  `customers`, `products`, `invoices`, `invoice_items`.

**Consecuencias del punto anterior:**

1. Reiniciar el contenedor **NO** recrea el esquema (a diferencia de Authoriza /
   InOut, que usan `synchronize`). El esquema `billing` fue creado fuera de la
   app (manualmente o por otro proceso).
2. Este script **solo vacía datos**. No recrea tablas ni repone catálogo.
3. Buena parte del "reset" de FactoNet en realidad ocurre al resetear
   **Authoriza** (de donde vienen contratos/facturas). Si tu objetivo es limpiar
   el ecosistema completo, resetea Authoriza también.

## Archivos

- `reset-database.sql` — `TRUNCATE` de las 4 tablas del schema `billing`
  (`invoice_items` → `invoices` → `products` → `customers`), con reinicio de
  identidades. Sin FKs circulares.

## Pasos

### 1. Ejecutar el SQL (TablePlus o psql)

Conéctate a la base de **FactoNet** y **verifica primero**:

```sql
SELECT current_database();   -- debe decir FactonetDB
```

Ejecuta el contenido de `reset-database.sql`.

```bash
psql "host=<HOST> port=5432 dbname=FactonetDB user=cyclonet_admin sslmode=require" \
  -f reset-database.sql
```

### 2. (Opcional) Reiniciar el contenedor

No es necesario para recrear el esquema (no lo recrea). Reinícialo solo si
quieres limpiar caché en memoria del servicio:

```bash
sudo docker restart cyclonet-factonet-api
```

## Si el esquema `billing` NO existiera

Como la app no crea el esquema por sí sola, si necesitas reconstruir las tablas
desde cero (no solo vaciarlas), deberás crear el schema `billing` y sus tablas
con la estructura de las entidades (`src/**/entities/*.entity.ts`):
`customers`, `products`, `invoices`, `invoice_items`. Coordinar con el proceso
que originalmente creó el esquema en el RDS.

## Entornos

| Entorno | Base de datos | Schema | Contenedor |
|---|---|---|---|
| Producción | `FactonetDB` | `billing` | `cyclonet-factonet-api` |
| Staging | (según despliegue) | `billing` | (según despliegue de staging) |
