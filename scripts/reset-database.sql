-- =============================================================================
-- RESET COMPLETO — FactonetDB   (schema: billing)
-- =============================================================================
-- ⚠️  DESTRUCTIVO E IRREVERSIBLE. Borra los datos locales de FactoNet.
--
-- IMPORTANTE — leer el README antes de usar:
--   FactoNet NO tiene una conexión TypeORM de raíz (no hay TypeOrmModule.forRoot,
--   no hay synchronize, no hay migraciones). La mayor parte de su lógica
--   (contratos, facturas) delega en Authoriza vía HTTP. Solo hay 4 tablas
--   locales en el schema "billing": customers, products, invoices, invoice_items.
--
--   Consecuencia: reiniciar el contenedor NO recrea el esquema. Si vacías estas
--   tablas, el esquema sigue existiendo (fue creado fuera de la app). Este script
--   solo VACÍA datos; no recrea nada.
--
-- Verifica primero que estás en la base correcta:
--     SELECT current_database();   -- debe decir FactonetDB
-- =============================================================================

-- Sin FKs circulares. TRUNCATE ... CASCADE limpia y reinicia identidades.
-- Orden lógico: invoice_items (hijo) → invoices → products / customers.

TRUNCATE TABLE
  billing.invoice_items,
  billing.invoices,
  billing.products,
  billing.customers
RESTART IDENTITY CASCADE;

-- No requiere reiniciar contenedor ni migraciones: el esquema "billing"
-- permanece. Ver README.md si el esquema NO existiera y hubiera que crearlo.
