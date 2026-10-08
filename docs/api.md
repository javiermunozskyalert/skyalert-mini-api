# SkyAlert Mini API — Referencia de Endpoints

API HTTP serverless (AWS API Gateway HTTP API + Lambda + DynamoDB + Cognito).
Arquitectura **Serverless SOA**: un Lambda por dominio (`clients`, `devices`, `users`, `seismic`).

## Base URL

La URL del HTTP API Gateway (output `ApiUrl` del stack de API):

```
https://{apiId}.execute-api.us-east-1.amazonaws.com
```

## Autenticación

Todas las rutas están protegidas por un **Cognito JWT Authorizer**. Cada request debe incluir:

```
Authorization: Bearer {accessToken}
```

- El token es un JWT emitido por AWS Cognito (User Pool `us-east-1_jWSv0ZVCp` en staging).
- Sin token válido, API Gateway responde `401` antes de invocar el Lambda.
- Los roles provienen del claim `cognito:groups`. Roles: `admin`, `internal`, `client`, `collaborator`.
- `admin` e `internal` se consideran administradores (`isAdmin`).
- `client` / `collaborator` solo acceden a datos de su propia compañía (`custom:clientId` del JWT).

## CORS (staging)

Orígenes permitidos: `http://localhost:3000`, `https://staging.skyalert.mx`.
Headers: `Content-Type`, `Authorization`. Métodos: `GET, POST, PUT, DELETE, OPTIONS`.

## Convenciones de respuesta

| Código | Significado |
|---|---|
| 200 | OK |
| 201 | Creado |
| 204 | Sin contenido (soft delete de client/user) |
| 400 | Bad Request / error de validación (Zod) |
| 401 | Sin token válido (API Gateway) |
| 403 | Rol insuficiente |
| 404 | Recurso no encontrado |
| 500 | Error interno |

Los errores tienen forma `{ "error": "...", "message": "..." }`.

---

## 1. Clients — `/clients`

Gestión de clientes (organizaciones). Solo administradores, salvo que un `client` consulte su propio registro.

### POST `/clients` — Crear cliente
Rol: admin/internal.

Body:
```json
{
  "name": "Empresa Demo",
  "email": "contacto@demo.com",
  "phone": "+525512345678",
  "address": "CDMX"
}
```
- `name`: requerido, 1–200 chars.
- `email`: requerido, formato email.
- `phone`, `address`: opcionales.

Respuesta `201`: objeto del cliente creado (incluye `clientId`, `status: "active"`, timestamps).

### GET `/clients` — Listar clientes
Rol: admin/internal. Query params: `limit` (def. 20, máx. 100), `lastKey` (paginación).

Respuesta `200`:
```json
{ "items": [ /* clientes */ ], "lastKey": "token-o-null" }
```

### GET `/clients/{clientId}` — Detalle
Rol: admin/internal, o el propio `client` (`claims.clientId === clientId`).

### PUT `/clients/{clientId}` — Actualizar
Rol: admin/internal. Body (todos opcionales):
```json
{ "name": "...", "phone": "...", "address": "...", "status": "active" }
```
`status` ∈ `active | inactive`.

### DELETE `/clients/{clientId}` — Soft delete
Rol: admin/internal. Marca `status: "deleted"`. Respuesta `204`.

---

## 2. Devices — `/devices`

Registro de dispositivos vinculados a un cliente. Referencia cruzada con la tabla `gps-tracker-devices` (otro proyecto).

> Autenticación: todos los endpoints aceptan tanto el flujo **web (Cognito)** con
> `Authorization: Bearer <token>` como el flujo **app legacy** con
> `Authorization: JWT <token>`. Para legacy, el rol es siempre `client` y el tenant
> es `legacy#<customerId>` (derivado del `sub` del JWT).

### GET `/devices/lookup/{uuid}` — Verificar device físico
Rol: cualquier rol autenticado. `uuid` debe cumplir el patrón `ska-XXXXXX` (6 alfanuméricos).

Resuelve el device en `gps-tracker-devices` (indexado como `device_id = "uuid#<uuid>"`,
que apunta al device físico vía `reserved_for`) y determina si se puede dar de alta.

Regla `canRegister`: `true` si `status_device` está **ausente** o es `"inactive"`; cualquier otro valor → `false`.

Respuesta `200`:
```json
{
  "uuid": "ska-L0z4AD",
  "reservedFor": "2550000004",
  "statusDevice": "inactive",
  "canRegister": true,
  "latitude": 19.400317,
  "longitude": -99.28739,
  "exists": true
}
```
`404` si el uuid no existe. Cacheado en Redis (TTL 30s); se invalida al registrar/eliminar.

### POST `/devices` — Registrar device
Rol: cualquier rol autenticado.
- admin/internal: registran en el `clientId` del body (requerido para ellos).
- client/collaborator/legacy: el `clientId` se **fuerza** al del token (se ignora el del body).

Body:
```json
{
  "uuid": "ska-L0z4AD",
  "name": "Sensor Planta Baja",
  "address": "Av. Reforma 123, CDMX",
  "latitude": 19.400317,
  "longitude": -99.28739,
  "clientId": "<clientId>"
}
```
- `uuid`: requerido, patrón `ska-XXXXXX`.
- `name`: requerido, 1–200.
- `latitude`: requerido, -90 a 90. `longitude`: requerido, -180 a 180.
- `address`: opcional, máx 500.
- `clientId`: requerido solo para admin/internal; legacy/client lo omite.

Valida que el device esté disponible (`status_device` ausente o `inactive`; si no → `400`),
crea el registro, vincula al device físico (`reserved_for`) y pone `status_device = active`.

Respuesta `201`:
```json
{
  "registrationId": "...", "clientId": "...", "name": "...",
  "address": "...", "latitude": 19.400317, "longitude": -99.28739,
  "gpsDeviceId": "2550000004", "statusDevice": "active"
}
```

### GET `/devices` — Listar devices
Rol: todos. admin/internal ven todos (Scan); pueden filtrar con `?clientId=`. client/collaborator ven solo su compañía. Excluye `inactive`.
Query params: `limit` (def. 20, máx. 100), `lastKey`, `clientId` (solo admin).

Para usuarios **legacy**, es el primer endpoint del webview: **auto-provisiona** el customer
(crea el registro CLIENT `legacy#<sub>` si no existe) antes de responder.

Cada device del response incluye los campos de conectividad (ver abajo).

### GET `/devices/{registrationId}` — Detalle
Rol: todos (según scope). admin busca global; client/collaborator solo su compañía.
Respuesta normalizada (sin claves internas PK/SK) + campos de conectividad.

### Campos de conectividad (en list y get)
Cada device se enriquece con el estado derivado del device físico GPS:

| Campo | Descripción |
|---|---|
| `connection_status` | Estado del socket TCP (crudo del EC2): `online` / `offline` / `null` |
| `connectivity_status` | Derivado de `last_seen_at`: `active` / `idle` / `stale` / `disconnected` |
| `last_seen_seconds_ago` | Segundos desde la última posición (o `null`) |
| `last_seen_at` | Timestamp ISO crudo de la última posición |

Reglas de `connectivity_status` (umbrales 120s/300s):
- `offline` o sin `last_seen_at` → `disconnected`
- `< 120s` (se perdió ≤1 reporte) → `active`
- `120–300s` → `idle`
- `>= 300s` → `stale`

Las dos dimensiones son independientes: un device puede estar `connection_status: online`
pero `connectivity_status: idle/stale` (conectado, sin posición reciente — caso keep-alive).

Ejemplo de item:
```json
{
  "registrationId": "...", "name": "Mi sensor", "address": "...",
  "latitude": 19.4, "longitude": -99.1, "gpsDeviceId": "2550000004",
  "statusDevice": "active",
  "connectivity_status": "active", "connection_status": "online",
  "last_seen_seconds_ago": 35, "last_seen_at": "2026-10-08T18:15:09.000Z",
  "createdAt": "...", "updatedAt": "...", "createdBy": "..."
}
```

### PUT `/devices/{registrationId}` — Actualizar (parcial)
Rol: todos (según scope). Actualización parcial: solo se modifican los campos presentes;
al menos uno es requerido. Body (todos opcionales):
```json
{
  "name": "Sensor Recepción",
  "address": "Insurgentes Sur 1000, CDMX",
  "latitude": 19.3621,
  "longitude": -99.1766
}
```
- `name`: 1–200. `address`: máx 500. `latitude`: -90 a 90. `longitude`: -180 a 180.
- Body vacío → `400` ("At least one field... is required").

Respuesta `200`: device normalizado (sin PK/SK, `statusDevice` camelCase), con `updatedAt` refrescado.

### DELETE `/devices/{registrationId}` — Soft delete
Rol: todos (según scope). Pone `status_device = inactive` en skyalert y en `gps-tracker-devices`.
Respuesta `200`:
```json
{ "registrationId": "...", "gpsDeviceId": "...", "statusDevice": "inactive" }
```

---

## 3. Users — `/users`

Gestión de usuarios en AWS Cognito. Solo administradores.

### POST `/users` — Crear usuario
Rol: admin/internal. Body:
```json
{ "email": "user@demo.com", "name": "Juan Pérez", "role": "client", "clientId": "<clientId>" }
```
- `role` ∈ `admin | internal | client | collaborator`.
- Si `role` es `client` o `collaborator`, `clientId` es obligatorio.
- Cognito genera password temporal y envía email vía SES.

Respuesta `201`: `{ "username", "email", "name", "role", "clientId", "status" }`.

### GET `/users` — Listar usuarios
Rol: admin/internal. Query params: `limit` (def. 20, máx. 60), `paginationToken`.

Respuesta `200`:
```json
{ "items": [ /* usuarios */ ], "paginationToken": "token-o-null" }
```

### GET `/users/{username}` — Detalle
Rol: admin/internal.

### PUT `/users/{username}/role` — Cambiar rol
Rol: admin/internal. Body:
```json
{ "role": "collaborator", "clientId": "<clientId>" }
```
`clientId` requerido si el rol es `client` o `collaborator`.

### PUT `/users/{username}/status` — Habilitar/Deshabilitar
Rol: admin/internal. Body:
```json
{ "action": "disable" }
```
`action` ∈ `enable | disable`. No puedes deshabilitarte a ti mismo.

### DELETE `/users/{username}` — Eliminar
Rol: admin/internal. Elimina de Cognito. No puedes eliminarte a ti mismo. Respuesta `204`.

---

## 4. Seismic — `/seismic`

Consulta de lecturas sísmicas (solo lectura). La ingesta se hará vía pipeline IoT (pendiente).

### GET `/seismic/{deviceId}/latest` — Última lectura
Rol: todos (según scope). admin cualquier device; client/collaborator solo los de su organización.

### GET `/seismic/{deviceId}` — Historial
Rol: todos (según scope). Query params opcionales: `from` (ISO), `to` (ISO), `limit` (def. 50, máx. 200), `lastKey`. Devueltas más recientes primero.

Respuesta `200`:
```json
{ "deviceId": "...", "items": [ /* lecturas */ ], "lastKey": "token-o-null" }
```

---

## Notas

- El enrutamiento fino lo resuelve cada handler leyendo `method` + `rawPath`. En API Gateway cada dominio registra `GET,POST` en la ruta base y `GET,PUT,DELETE` en `{base}/{proxy+}`.
- Los dominios `reports` y el pipeline IoT descritos en `project-context.md` **no están implementados** aún.
- Variables de entorno para las colecciones: `baseUrl` y `accessToken`.
