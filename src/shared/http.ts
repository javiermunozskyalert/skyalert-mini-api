/**
 * Normaliza el rawPath de API Gateway quitando el prefijo de versión (/v1, /v2...).
 * Permite que los handlers routeen por rutas sin versión, manteniendo el
 * versionado en la capa de ruteo (API Gateway) desacoplado de la lógica.
 *
 * Ejemplos:
 *   /v1/devices            -> /devices
 *   /v1/devices/lookup/x   -> /devices/lookup/x
 *   /devices               -> /devices  (sin prefijo, sin cambios)
 */
const VERSION_PREFIX = /^\/v\d+(?=\/)/;

export function stripVersionPrefix(path: string): string {
  return path.replace(VERSION_PREFIX, '');
}

/**
 * Extrae el token crudo del header Authorization, sin el esquema.
 *
 * Soporta ambos esquemas usados por el API: "JWT <token>" (app legacy) y
 * "Bearer <token>" (web Cognito). Devuelve undefined si no hay header o no
 * tiene el formato "<scheme> <token>".
 *
 * Útil para reenviar el token del customer en llamadas S2S al backend legacy.
 */
export function extractAuthToken(headers?: Record<string, string | undefined>): string | undefined {
  const raw = headers?.authorization ?? headers?.Authorization ?? '';
  const [scheme, token] = raw.split(/\s+/);
  if (!scheme || !token) return undefined;
  return token;
}
