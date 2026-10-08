import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { badRequest, serverError } from '../../shared/response';
import { extractClaims } from '../../shared/auth';
import { stripVersionPrefix } from '../../shared/http';
import { listHistoryEvents } from './usecases/list-history-events';

/**
 * Handler delgado — History Events domain.
 * Historial de eventos (activaciones sísmicas) de gps-tracker-activations,
 * filtrado por los devices asociados al customer del token (legacy).
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = stripVersionPrefix(event.rawPath);
  const claims = extractClaims(event);

  logger.info('Request received', { method, path, userId: claims.sub });

  try {
    // GET /history-events — últimos 10 eventos del tenant (más reciente primero)
    if (method === 'GET' && path === '/history-events') {
      return await listHistoryEvents(event, claims);
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
