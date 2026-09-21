import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { badRequest, serverError } from '../../shared/response';
import { extractClaims } from '../../shared/auth';
import { lookupDevice } from './usecases/lookup-device';
import { registerDevice } from './usecases/register-device';

/**
 * Handler delgado — Devices domain.
 * Registra devices en skyalert vinculándolos a un cliente y al device
 * físico existente en gps-tracker-devices.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const claims = extractClaims(event);

  logger.info('Request received', { method, path, userId: claims.sub });

  try {
    // GET /devices/lookup/{uuid} — valida existencia por uuid en gps-tracker-devices
    if (method === 'GET' && path.includes('/devices/lookup/')) {
      return await lookupDevice(event, claims);
    }

    // POST /devices — registra el device vinculado al cliente
    if (method === 'POST' && path === '/devices') {
      return await registerDevice(event, claims);
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
