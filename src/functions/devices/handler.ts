import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { badRequest, serverError } from '../../shared/response';
import { extractClaims } from '../../shared/auth';
import { lookupDevice } from './usecases/lookup-device';
import { registerDevice } from './usecases/register-device';
import { listDevices } from './usecases/list-devices';
import { getDevice } from './usecases/get-device';
import { updateDevice } from './usecases/update-device';
import { deleteDevice } from './usecases/delete-device';

/**
 * Handler delgado — Devices domain.
 * Registra y administra devices en skyalert vinculados al device físico
 * de gps-tracker-devices. El delete es soft (status_device = inactive).
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

    // GET /devices — lista devices de un cliente
    if (method === 'GET' && path === '/devices') {
      return await listDevices(event, claims);
    }

    // GET /devices/{registrationId} — detalle
    if (method === 'GET' && path.startsWith('/devices/')) {
      return await getDevice(event, claims);
    }

    // PUT /devices/{registrationId} — actualiza name
    if (method === 'PUT' && path.startsWith('/devices/')) {
      return await updateDevice(event, claims);
    }

    // DELETE /devices/{registrationId} — soft delete (status_device = inactive)
    if (method === 'DELETE' && path.startsWith('/devices/')) {
      return await deleteDevice(event, claims);
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
