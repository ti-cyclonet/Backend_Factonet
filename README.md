# 🧾 Backend Factonet

![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

## 📋 Descripción

Backend Factonet es una API REST desarrollada con **NestJS** y **TypeScript** para la gestión completa de facturación. El sistema está integrado con el ecosistema Cyclonet y se conecta con Backend_Authoriza para la autenticación.

## ✨ Características principales

- 🔐 **Autenticación JWT** integrada con Backend_Authoriza
- 👥 **Gestión de clientes** completa
- 📦 **Catálogo de productos** con control de inventario
- 🧾 **Facturación electrónica** con numeración automática
- 📊 **Cálculo automático** de impuestos y totales
- 🗄️ **Base de datos PostgreSQL** con esquema `billing`
- ☁️ **Integración Cloudinary** para documentos
- 📖 **Documentación automática** con Swagger

## 🛠 Tecnologías utilizadas

| Tecnología | Descripción |
|------------|------------|
| **NestJS** | Framework backend Node.js con TypeScript |
| **TypeScript** | Lenguaje con tipado fuerte |
| **PostgreSQL** | Base de datos relacional |
| **TypeORM** | ORM para TypeScript |
| **JWT** | Autenticación con tokens |
| **Docker** | Contenedores para desarrollo |
| **Cloudinary** | Almacenamiento de archivos |

## 🚀 Instalación y configuración

### Requisitos previos
- Node.js (v16+)
- Docker y Docker Compose
- Backend_Authoriza ejecutándose en puerto 3000

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar variables de entorno
Editar el archivo `.env` con tus configuraciones:
```env
# Database
DB_HOST=localhost
DB_PORT=5434
DB_USERNAME=postgres
DB_PASSWORD=123456
DB_NAME=FactonetDB

# Application
PORT=3002

# Auth Service
AUTH_SERVICE_URL=http://localhost:3000

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### 3. Iniciar base de datos
```bash
docker-compose up -d
```

### 4. Crear esquema de base de datos
```bash
docker exec -it factonetdb psql -U postgres -d FactonetDB
CREATE SCHEMA billing;
```

### 5. Ejecutar la aplicación
```bash
# Desarrollo
npm run start:dev

# Producción
npm run build
npm run start:prod
```

## 📚 API Endpoints

### Autenticación
- `GET /api/auth/profile` - Obtener perfil del usuario
- `GET /api/auth/validate` - Validar token

### Clientes
- `GET /api/customers` - Listar clientes
- `POST /api/customers` - Crear cliente
- `GET /api/customers/:id` - Obtener cliente
- `PATCH /api/customers/:id` - Actualizar cliente
- `DELETE /api/customers/:id` - Eliminar cliente

### Productos
- `GET /api/products` - Listar productos
- `POST /api/products` - Crear producto
- `GET /api/products/:id` - Obtener producto
- `PATCH /api/products/:id` - Actualizar producto
- `DELETE /api/products/:id` - Eliminar producto

### Facturas
- `GET /api/invoices` - Listar facturas
- `POST /api/invoices` - Crear factura
- `GET /api/invoices/:id` - Obtener factura
- `PATCH /api/invoices/:id` - Actualizar factura
- `DELETE /api/invoices/:id` - Eliminar factura

## 🗄️ Estructura de la base de datos

### Esquema: `billing`

**Tablas principales:**
- `customers` - Información de clientes
- `products` - Catálogo de productos
- `invoices` - Facturas emitidas
- `invoice_items` - Detalles de facturas

## 🔗 Integración con Frontend

El backend está configurado para conectarse con Frontend_Factonet en:
- **Desarrollo:** `http://localhost:4202`
- **CORS habilitado** para desarrollo

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
npm run start:dev    # Desarrollo con hot reload
npm run build        # Compilar aplicación
npm run start:prod   # Producción
npm run lint         # Verificar código
npm run test         # Pruebas unitarias
```

## 🏗️ Arquitectura del sistema

```
Frontend_Factonet (Angular) → Backend_Factonet (NestJS) → Backend_Authoriza (Auth)
                                      ↓
                              PostgreSQL (FactonetDB)
```

## 📄 Licencia

Privada - Derechos reservados Cyclonet
