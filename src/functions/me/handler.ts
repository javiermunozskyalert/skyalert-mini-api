import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { badRequest, serverError, success } from '../../shared/response';
import { extractClaims, extractSource, isAdmin } from '../../shared/auth';
import { stripVersionPrefix } from '../../shared/http';

/**
 * Handler delgado — Me domain (identidad).
 *
 * GET /me — devuelve los claims que el DualAuthorizer ya resolvió del token
 * (Cognito Bearer o legacy JWT HS256). Es un endpoint ligero de introspección
 * de identidad: NO lee la base de datos ni mezcla autorización de recursos de
 * negocio con verificación de identidad.
 *
 * Caso de uso principal: el dashboard web valida un token v3 del Customer
 * (deep-link SSO) llamando a este endpoint:
 *   - 200 → token válido; usa los claims para abrir la sesión.
 *   - 401 → API Gateway ya rechazó el token (nunca llega al Lambda).
 *
 * Ventaja: el dashboard NO necesita el secreto HS256 compartido para validar.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = stripVersionPrefix(event.rawPath);
  const claims = extractClaims(event);

  logger.info('Request received', { method, path, userId: claims.sub });

  try {
    // GET /me — identidad del portador del token
    if (method === 'GET' && path === '/me') {
      const admin = isAdmin(claims);
      return success({
        sub: claims.sub,
        email: claims.email || null,
        // Rol efectivo: el primero de los grupos (para legacy siempre "client").
        role: claims.groups[0] ?? null,
        roles: claims.groups,
        clientId: claims.clientId ?? null,
        source: extractSource(event),
        isAdmin: admin,
      });
    }

    return badRequest(`Unsupported route: ${method} ${path}`);
  } catch (error) {
    logger.error('Unhandled error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return serverError();
  }
}
