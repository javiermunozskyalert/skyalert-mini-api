import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { created, badRequest, forbidden, notFound, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { findGpsDeviceByUuid, updateDeviceStatus, gpsCacheKey } from '../../../shared/gps-devices';
import { invalidate } from '../../../shared/cache';
import { logger } from '../../../shared/logger';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const TABLE_NAME = process.env.TABLE_NAME!;

const RegisterDeviceSchema = z.object({
  uuid: z.string().regex(/^ska-[A-Za-z0-9]{6}$/, 'Invalid uuid format (expected ska-XXXXXX)'),
  // clientId es opcional: para legacy se fuerza al del token; admin/internal lo envían.
  clientId: z.string().min(1).optional(),
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/**
 * Registra un device en skyalert vinculándolo al cliente/usuario.
 * POST /devices
 *
 * Accesible por cualquier rol autenticado:
 *  - admin/internal → pueden registrar en cualquier clientId (el del body).
 *  - client/collaborator → el clientId se fuerza al del propio usuario
 *    (se ignora el del body) para preservar el aislamiento multi-tenant.
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
  const body = JSON.parse(event.body ?? '{}');
  const validation = RegisterDeviceSchema.safeParse(body);

  if (!validation.success) {
    return badRequest(validation.error.issues.map((i) => i.message).join(', '));
  }

  const { uuid, name, address, latitude, longitude } = validation.data;

  // Resolución de clientId para ambos flujos:
  //  - admin/internal: debe venir en el body (registran en cualquier tenant).
  //  - client/collaborator (legacy o cognito): se fuerza al del token.
  let clientId: string;
  if (isAdmin(claims)) {
    if (!validation.data.clientId) {
      return badRequest('clientId is required for admin/internal users');
    }
    clientId = validation.data.clientId;
  } else {
    if (!claims.clientId) {
      return forbidden('Your user is not associated with a client');
    }
    clientId = claims.clientId;
  }

  try {
    // 1. Validar que el device existe en gps-tracker-devices
    const gpsDevice = await findGpsDeviceByUuid(uuid);
    if (!gpsDevice) {
      return notFound(`No GPS device found with uuid ${uuid}`);
    }

    // La tabla GPS indexa el uuid con device_id = "uuid#<uuid>" y apunta al
    // device físico real en `reserved_for`. Ese es el gpsDeviceId a vincular.
    const gpsDeviceId = gpsDevice.reserved_for;
    if (!gpsDeviceId) {
      return notFound(`UUID ${uuid} is not linked to a physical device`);
    }

    // Solo se puede dar de alta si status_device NO existe o es "inactive".
    // Cualquier otro valor significa que ya está asignado/no disponible.
    const statusDevice = gpsDevice.status_device ?? null;
    if (statusDevice !== null && statusDevice !== 'inactive') {
      return badRequest(
        `Device ${uuid} cannot be registered: status_device is "${statusDevice}" (must be absent or "inactive")`
      );
    }

    const now = new Date().toISOString();
    const registrationId = randomUUID();

    // 2. Crear el registro en skyalert vinculado al cliente
    const item = {
      PK: `DEVICE#${clientId}`,
      SK: `DEVICE#${registrationId}`,
      registrationId,
      clientId,
      name,
      address: address ?? null,
      latitude,
      longitude,
      gpsDeviceId, // referencia al device en gps-tracker-devices
      status_device: 'active',
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

    // Invalidar el caché del lookup (el status_device cambió).
    await invalidate(gpsCacheKey(uuid));

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
      address: address ?? null,
      latitude,
      longitude,
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
