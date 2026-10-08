import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { badRequest, serverError } from '../../shared/response';
import { extractClaims } from '../../shared/auth';
import { stripVersionPrefix } from '../../shared/http';
import { listReadings } from './usecases/list-readings';
import { getLatestReading } from './usecases/get-latest-reading';

/**
 * Handler delgado — Seismic domain.
 * Consulta de lecturas sísmicas registradas por los acelerómetros.
 * (La ingesta de lecturas se hará vía pipeline IoT — pendiente de definir.)
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = stripVersionPrefix(event.rawPath);
  const claims = extractClaims(event);

  logger.info('Request received', { method, path, userId: claims.sub });

  try {
    // GET /seismic/{deviceId}/latest — última lectura
    if (method === 'GET' && path.endsWith('/latest')) {
      return await getLatestReading(event, claims);
    }

    // GET /seismic/{deviceId} — historial (opcional ?from=&to=)
    if (method === 'GET' && path.startsWith('/seismic/')) {
      return await listReadings(event, claims);
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
