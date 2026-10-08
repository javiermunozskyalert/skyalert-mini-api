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
