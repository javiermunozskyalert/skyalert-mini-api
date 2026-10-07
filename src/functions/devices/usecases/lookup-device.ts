import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UserClaims } from '../../../shared/auth';
import { success, badRequest, notFound, serverError } from '../../../shared/response';
import { findGpsDeviceByUuid } from '../../../shared/gps-devices';
import { logger } from '../../../shared/logger';

const UUID_PATTERN = /^ska-[A-Za-z0-9]{6}$/;

/**
 * Busca un device en gps-tracker-devices por su uuid-device y valida que exista.
 * GET /devices/lookup/{uuid}
 * Se usa antes de registrar el device en skyalert (para confirmar que el
 * dispositivo físico existe y está reportando en el GPS tracker).
 * Accesible por cualquier rol autenticado.
 */
export async function lookupDevice(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  _claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  // path: /devices/lookup/{uuid}
  const uuid = event.pathParameters?.proxy?.replace(/^lookup\//, '') ?? '';

  if (!UUID_PATTERN.test(uuid)) {
    return badRequest('Invalid uuid format. Expected: ska-XXXXXX (6 alphanumeric chars)');
  }

  try {
    const gpsDevice = await findGpsDeviceByUuid(uuid);

    if (!gpsDevice) {
      return notFound(`No device found with uuid ${uuid}`);
    }

    // Se puede dar de alta si status_device NO existe o es "inactive".
    // Cualquier otro valor → no se puede (ya asignado / no disponible).
    const statusDevice = gpsDevice.status_device ?? null;
    const canRegister = statusDevice === null || statusDevice === 'inactive';

    return success({
      uuid,
      reservedFor: gpsDevice.reserved_for ?? null,
      statusDevice,
      canRegister,
      exists: true,
    });
  } catch (error: unknown) {
    logger.error('Failed to lookup device', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to lookup device');
  }
}
