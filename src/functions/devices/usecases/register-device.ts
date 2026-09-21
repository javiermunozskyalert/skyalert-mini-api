import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { created, badRequest, forbidden, notFound, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { findGpsDeviceByUuid, updateDeviceStatus } from '../../../shared/gps-devices';
import { logger } from '../../../shared/logger';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const TABLE_NAME = process.env.TABLE_NAME!;

const RegisterDeviceSchema = z.object({
  uuid: z.string().regex(/^ska-[A-Za-z0-9]{6}$/, 'Invalid uuid format (expected ska-XXXXXX)'),
  clientId: z.string().min(1),
  name: z.string().min(1).max(200),
});

/**
 * Registra un device en skyalert vinculándolo al cliente/usuario.
 * POST /devices
 *
 * Flujo:
 *  1. Valida que el device existe en gps-tracker-devices (por uuid_device).
 *  2. Crea el registro en skyalert-stg-devices guardando SOLO el device_id
 *     del GPS como referencia (gpsDeviceId).
 *  3. Cambia el status_device del device en gps-tracker-devices a "active"
 *     (sin tocar el campo `status` de conectividad online/offline del GPS).
 */
export async function registerDevice(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  if (!isAdmin(claims)) {
    return forbidden('Only admin users can register devices');
  }

  const body = JSON.parse(event.body ?? '{}');
  const validation = RegisterDeviceSchema.safeParse(body);

  if (!validation.success) {
    return badRequest(validation.error.issues.map((i) => i.message).join(', '));
  }

  const { uuid, clientId, name } = validation.data;

  try {
    // 1. Validar que el device existe en gps-tracker-devices
    const gpsDevice = await findGpsDeviceByUuid(uuid);
    if (!gpsDevice) {
      return notFound(`No GPS device found with uuid ${uuid}`);
    }

    const gpsDeviceId = gpsDevice.device_id;
    const now = new Date().toISOString();
    const registrationId = randomUUID();

    // 2. Crear el registro en skyalert vinculado al cliente
    const item = {
      PK: `DEVICE#${clientId}`,
      SK: `DEVICE#${registrationId}`,
      registrationId,
      clientId,
      name,
      gpsDeviceId, // referencia al device en gps-tracker-devices
      createdAt: now,
      updatedAt: now,
      createdBy: claims.sub,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(SK)', // idempotencia
      })
    );

    // 3. Cambiar el status administrativo del device a "active" (status_device)
    await updateDeviceStatus(gpsDeviceId, 'active');

    logger.info('Device registered and status_device set to active', {
      registrationId,
      gpsDeviceId,
      clientId,
      registeredBy: claims.sub,
    });

    return created({
      registrationId,
      clientId,
      name,
      gpsDeviceId,
      statusDevice: 'active',
    });
  } catch (error: unknown) {
    logger.error('Failed to register device', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to register device');
  }
}
