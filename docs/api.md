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

### GET `/devices/lookup/{uuid}` — Verificar device físico
Rol: admin/internal. `uuid` debe cumplir el patrón `ska-XXXXXX` (6 alfanuméricos).

Respuesta `200`:
```json
{ "deviceId": "...", "uuid": "ska-A1B2C3", "statusDevice": "...", "exists": true }
```

### POST `/devices` — Registrar device
Rol: admin/internal. Body:
```json
{ "uuid": "ska-A1B2C3", "clientId": "<clientId>", "name": "Sensor Planta Baja" }
```
Todos requeridos. Valida el device en `gps-tracker-devices`, crea el registro y pone `status_device = active`.

Respuesta `201`:
```json
{ "registrationId": "...", "clientId": "...", "name": "...", "gpsDeviceId": "...", "statusDevice": "active" }
```

### GET `/devices` — Listar devices
Rol: todos. admin/internal ven todos (Scan); pueden filtrar con `?clientId=`. client/collaborator ven solo su compañía. Excluye `inactive`.
Query params: `limit` (def. 20, máx. 100), `lastKey`, `clientId` (solo admin).

### GET `/devices/{registrationId}` — Detalle
Rol: todos (según scope). admin busca global; client/collaborator solo su compañía.

### PUT `/devices/{registrationId}` — Actualizar
Rol: todos (según scope). Body:
```json
{ "name": "Nuevo nombre" }
```
`name` requerido, 1–200 chars.

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
