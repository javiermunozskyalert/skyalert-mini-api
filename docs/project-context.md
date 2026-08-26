# SkyAlert Lite Dashboard — Contexto del Proyecto

## Descripción

Dashboard web para la gestión y monitoreo de dispositivos acelerómetros SkyAlert Lite. Permite a clientes ver la actividad sísmica registrada por sus dispositivos, y al equipo interno/admin administrar clientes, dispositivos y usuarios.

---

## Lenguajes y Frameworks

| Tecnología | Versión | Rol |
|---|---|---|
| **TypeScript** | 5.5 | Lenguaje principal — tipado estricto, cero `any` |
| **React** | 19.x | Librería de UI — componentes declarativos |
| **Next.js** | 15.x | Framework fullstack — App Router, SSR, Middleware |
| **Tailwind CSS** | 3.4 | Estilos — enfoque Mobile-First, clases utilitarias |
| **Zustand** | 5.x | Estado global — stores modulares con selectores atómicos |
| **Recharts** | 2.15 | Gráficas — visualización de datos del acelerómetro |
| **Leaflet** | 1.9 | Mapas — interactivos con OpenStreetMap (carga dinámica con `ssr: false`) |
| **react-grid-layout** | 1.5 | Grid — dashboard drag & drop configurable |
| **pnpm** | 9.x | Package manager exclusivo del proyecto |
| **Node.js** | 20.x | Runtime |

---

## Patrón de Carpetas: Feature-Based Architecture

También conocido como **Screaming Architecture** (Robert C. Martin). La estructura del proyecto comunica inmediatamente qué hace la aplicación:

```
src/
├── app/                              ← Rutas (Next.js App Router)
│   ├── (auth)/                       ← Rutas públicas
│   │   ├── login/
│   │   └── forgot-password/
│   │       ├── otp/
│   │       └── new-password/
│   ├── (dashboard)/                  ← Rutas protegidas
│   │   ├── dashboard/
│   │   ├── monitoring/
│   │   ├── monitoring/[deviceId]/
│   │   ├── devices/
│   │   ├── history/
│   │   ├── clients/
│   │   ├── clients/[clientId]/
│   │   ├── users/
│   │   ├── collaborators/
│   │   └── settings/
│   ├── not-found.tsx
│   └── page.tsx
│
├── modules/                          ← Lógica por dominio
│   ├── auth/
│   │   ├── components/
│   │   └── store/
│   ├── dashboard/
│   │   ├── components/
│   │   └── utils/
│   ├── devices/
│   │   └── components/
│   ├── monitoring/
│   │   ├── components/
│   │   └── types/
│   ├── clients/
│   │   └── components/
│   ├── collaborators/
│   │   └── components/
│   └── users/
│       └── components/
│
├── shared/                           ← Reutilizable entre módulos
│   ├── components/
│   │   ├── ui/                       ← Input, Modal, PhoneInput, Icons, Pagination, ErrorBoundary
│   │   └── layout/                   ← Sidebar, UserMenu, NotificationBell, Navbar
│   ├── constants/
│   ├── types/
│   └── utils/
│
├── config/
├── assets/
└── styles/
```

### Principios

- **1 módulo = 1 dominio de negocio** — cada módulo contiene solo lo que le pertenece
- **`shared/`** — exclusivo para código usado por 2+ módulos
- **`app/`** — solo orquestación de rutas y layouts, no lógica de negocio
- **Modales en sus módulos** — no inline en las páginas

---

## Patrón de Diseño: Presentación + Contenedores

| Capa | Responsabilidad | Ejemplo |
|---|---|---|
| **Página** (`app/`) | Orquesta estado, carga datos, renderiza contenedores | `clients/page.tsx` |
| **Contenedores** (modales, tablas) | Lógica de interacción, validaciones | `AddClientModal.tsx` |
| **Componentes UI** (`shared/ui/`) | Solo renderizado, sin estado de negocio | `Input.tsx`, `Modal.tsx` |

---

## Arquitectura

### Frontend: Next.js App Router

```
Navegador → CloudFront (CDN) → Amplify Hosting (Next.js SSR)
                                       │
                                       ├── Middleware (verifica sesión)
                                       ├── Server Components (layout, metadata)
                                       └── Client Components (interactividad)
```

### Arquitectura completa del sistema: Event-Driven Serverless SOA

```
┌──────────────────────────────────────────────────────────┐
│                   FRONTEND (Next.js)                      │
│                 Amplify + CloudFront                       │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTPS + Bearer Token
                         ▼
┌──────────────────────────────────────────────────────────┐
│              API GATEWAY + Cognito Authorizer             │
└─────┬────────┬────────┬────────┬────────┬────────────────┘
      ▼        ▼        ▼        ▼        ▼
  Clientsλ  Devicesλ  Seismicλ  Usersλ  Reportsλ
      │        │        │        │        │
      ▼        ▼        ▼        ▼        ▼
┌──────────────────────────────────────────────────────────┐
│                  DynamoDB + S3                            │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│                 IoT DATA PIPELINE                         │
│  Jetson → EC2 (TCP) → SQS → Lambdaλ → DB + EventBridge  │
└──────────────────────────────────────────────────────────┘
```

### Nombre de la arquitectura

**Serverless SOA (Service per Domain)** — punto intermedio entre monolítico y microservicios:

- 1 Lambda por dominio (clients, devices, seismic, users, reports)
- Cada Lambda maneja todas las operaciones de su dominio (CRUD interno)
- Comunicación entre dominios via EventBridge/SQS (asíncrona)
- Cada Lambda accede solo a su tabla (IAM least privilege)

---

## Autenticación: AWS Cognito

### Flujo de Login

```
1. Usuario escribe email + password en LoginForm
2. Frontend llama a Cognito SDK directamente (signIn)
3. Cognito valida con SRP (password nunca viaja en texto plano)
4. Cognito responde con 3 tokens: ID Token, Access Token, Refresh Token
5. Frontend guarda tokens en memoria (Zustand)
6. Cada request al backend: header Authorization: Bearer {accessToken}
7. API Gateway valida JWT automáticamente con Cognito Authorizer
```

### Operaciones por capa

| Frontend (usuario sobre sí mismo) | Backend (admin sobre otros) |
|---|---|
| Login / Logout | Crear usuario/cliente/colaborador |
| Cambiar contraseña + OTP | Bloquear / Desbloquear usuario |
| Forgot password | Eliminar usuario |
| Refresh token | Cambiar rol |

### Creación de nuevos usuarios

1. Admin/Interno hace click en "Agregar" en el dashboard
2. Frontend envía POST al backend con datos del nuevo usuario
3. Lambda ejecuta `AdminCreateUser` en Cognito → genera password temporal
4. Cognito envía email automáticamente con credenciales temporales via SES
5. Nuevo usuario inicia sesión → Cognito responde `NEW_PASSWORD_REQUIRED`
6. Frontend muestra pantalla de cambio de contraseña
7. Usuario define su contraseña definitiva → acceso completo

### Protección de rutas (3 capas)

| Capa | Función | Si falla |
|---|---|---|
| Middleware Next.js | Redirige si no hay token | Flash momentáneo de la UI |
| Dashboard Layout | Verifica Zustand store | Redundancia |
| API Gateway + Cognito Authorizer | **Seguridad real** — 401 sin token válido | Sin datos expuestos |

---

## Backend (Planificado)

### Stack

| Servicio AWS | Función |
|---|---|
| API Gateway (HTTP) | Endpoints REST |
| Lambda (TypeScript) | Lógica de negocio (CRUDs, reportes) |
| Lambda (Go) | Funciones críticas de latencia (alertas sísmicas) — optimización futura |
| DynamoDB | Base de datos (1 tabla por dominio) |
| S3 | CSVs del acelerómetro + assets |
| SQS | Colas para procesamiento asíncrono |
| EventBridge | Eventos entre dominios |
| Cognito | Autenticación |
| SES | Emails (reportes, credenciales, alertas) |
| EC2 (t4g.nano) | Servidor TCP persistente para dispositivos IoT |
| CDK (TypeScript) | Infraestructura como Código |

### Estructura del backend

```
backend/
├── infra/                    ← CDK Stacks
│   ├── AuthStack.ts
│   ├── ApiStack.ts
│   ├── ClientsStack.ts
│   ├── DevicesStack.ts
│   ├── SeismicStack.ts
│   └── IotStack.ts
│
├── functions/
│   ├── clients/
│   │   ├── handler.ts       ← Router (POST/GET/PUT/DELETE)
│   │   └── usecases/        ← Lógica separada por operación
│   ├── devices/
│   ├── users/
│   ├── seismic/
│   └── reports/
│
└── shared/
    ├── dynamo.ts             ← Cliente DynamoDB (init global, fuera del handler)
    ├── validation.ts         ← Schemas Zod
    └── auth.ts               ← Extracción de claims del JWT
```

### Patrones del backend

- **Handlers delgados** — solo reciben, rutean y responden
- **SDK inicializado fuera del handler** — reutilizado en invocaciones calientes (optimiza cold starts)
- **Validación de payloads con Zod** — antes de tocar la base de datos
- **Idempotencia** — endpoints de escritura son seguros de reintentar
- **Filtrado por rol en código** — cliente solo accede a sus propios datos

### Operaciones síncronas vs asíncronas

| Síncrono (usuario espera) | Asíncrono (fuego y olvida) |
|---|---|
| CRUD clientes/dispositivos | Procesar lecturas del acelerómetro |
| Consultar historial | Generar reportes PDF |
| Login/Auth | Enviar notificaciones de sismo |
| | Emails de credenciales |

---

## Seguridad

- HTTPS obligatorio (CloudFront + TLS)
- Tokens en memoria, nunca en localStorage
- DynamoDB encryption at rest (AES-256 automático)
- IAM least privilege por Lambda
- WAF en CloudFront
- Cognito maneja contraseñas (hash SRP, nunca accesibles)
- Validación de inputs en frontend (pattern, type, onKeyDown)
- ErrorBoundary para crasheos inesperados
- `escapeHtml()` pendiente para popups de Leaflet cuando se conecten APIs reales
