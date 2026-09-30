# Integración de login: App legacy → SkyAlert Mini API

Guía para que la **app iOS** (autenticada por el backend legacy vía Sign in with Apple/Facebook) consuma **skyalert-mini-api**.

## Resumen

El login principal sigue siendo el backend legacy (`POST /login/apple`). La app toma el **access token** que emite el legacy y lo envía a mini-api. Un **Lambda Authorizer** en API Gateway valida ese token y autoriza la request.

```
App iOS ──POST /login/apple {code}──▶ Backend Legacy ──▶ { accessToken.token (JWT HS256) }
   │
   └──GET /devices  (Authorization: JWT <token>)──▶ Mini API (API Gateway)
                                                        │
                                                        ├─ DualAuthorizer valida el JWT (HS256, iss=api.v3.skyalert)
                                                        └─ Lambda de dominio responde (200 / 403)
```

## Base URL (staging)

```
https://n97qy0xdw3.execute-api.us-east-1.amazonaws.com
```

## Autenticación

Enviar el access token del legacy en el header, con el **esquema `JWT`** (no `Bearer`):

```
Authorization: JWT <accessToken.token>
```

- El token es el campo `accessToken.token` del response de `POST /login/apple` del legacy.
- Es un JWT **HS256** con `iss = api.v3.skyalert` y `tokenType = access`.
- Mini-api valida la firma contra el secreto compartido (SSM) y comprueba `iss`, `tokenType === 'access'` y `kind === 'Customer'`.
- El TTL lo define el legacy. Cuando expire, la app debe renovar con el flujo de refresh del legacy y volver a enviar el nuevo access token.

> Nota: el dashboard **web** usa Cognito con `Authorization: Bearer <token>`. El mismo authorizer soporta ambos esquemas; la app usa `JWT`, la web usa `Bearer`.

## Modelo de acceso para usuarios de app

Los usuarios que llegan desde la app legacy son **siempre rol de usuario final**:

- **Rol**: `client` (nunca admin/internal). No pueden ejecutar operaciones administrativas.
- **Tenant**: cada usuario es su propio tenant → `clientId = legacy#<sub>` (donde `<sub>` es el `customerId` del legacy).
- Solo ven/gestionan datos asociados a su propio `clientId`.

### Endpoints disponibles para un usuario de app

| Método | Ruta | Acceso app (rol client) |
|---|---|---|
| GET | `/devices` | ✅ Lista los devices de su tenant |
| GET | `/devices/{registrationId}` | ✅ Solo si es de su tenant |
| GET | `/seismic/{deviceId}/latest` | ✅ Solo devices de su tenant |
| GET | `/seismic/{deviceId}` | ✅ Solo devices de su tenant |
| POST/PUT/DELETE | `/clients`, `/users`, registro de `/devices` | ❌ 403 (solo admin) |

Ver `docs/api.md` para el contrato completo de cada endpoint (params, body, respuestas).

## Códigos de respuesta

| Código | Significado |
|---|---|
| 200 | OK |
| 401 | Sin token / token inválido (rechazado por API Gateway antes del Lambda) |
| 403 | Token válido pero rol insuficiente (ej. usuario de app intentando operación admin) |
| 404 | Recurso no encontrado |

## Ejemplos verificados (staging)

Prueba real ejecutada contra la API de staging con un token de un `customerId` de ejemplo:

```bash
BASE="https://n97qy0xdw3.execute-api.us-east-1.amazonaws.com"
TOKEN="<accessToken.token del legacy>"

# 1) Listar devices del tenant → 200
curl -H "Authorization: JWT $TOKEN" "$BASE/devices"
# HTTP 200  {"items":[],"lastKey":null}

# 2) Operación admin → 403
curl -X POST -H "Authorization: JWT $TOKEN" -H "Content-Type: application/json" -d '{}' "$BASE/clients"
# HTTP 403  {"error":"Forbidden","message":"Only admin users can create clients"}

# 3) Sin token → 401
curl "$BASE/devices"
# HTTP 401  {"message":"Unauthorized"}
```

## Notas para el equipo de app

- Usar exactamente el header `Authorization: JWT <token>` (esquema `JWT`, no `Bearer`).
- Enviar el `accessToken.token`, no el objeto `accessToken` completo ni el `refreshToken`.
- Renovar el access token con el flujo de refresh del legacy cuando expire; mini-api no maneja refresh.
- Si un `GET /devices` devuelve `{"items":[]}`, es correcto: significa que el tenant del usuario aún no tiene devices registrados (los registra un admin desde el dashboard).

## Notas operativas (backend)

- El secreto HS256 se replica en SSM: `/skyalert-mini-api/{env}/jwt.secretOrKey` (SecureString). Debe mantenerse sincronizado con el `jwt.secretOrKey` del legacy. Si el legacy lo rota, actualizar este parámetro.
- El authorizer cachea la decisión por token durante 5 minutos (`AuthorizerResultTtlInSeconds = 300`).
- Producción pendiente: crear `/skyalert-mini-api/production/jwt.secretOrKey` y evaluar migrar a RS256/ES256 + JWKS para evitar el secreto compartido (con HS256, quien valida también puede firmar).
