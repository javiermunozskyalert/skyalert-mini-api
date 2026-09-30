import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, notFound, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { updateDeviceStatus } from '../../../shared/gps-devices';
import { logger } from '../../../shared/logger';

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * "Elimina" un device — soft delete.
 * DELETE /devices/{registrationId}
 *
 * NO borra el registro. En su lugar:
 *  1. Cambia el status_device del device en gps-tracker-devices a "inactive".
 *  2. Marca el registro en skyalert como status_device = inactive (auditoría).
 *
 * Visibilidad por rol (misma lógica que update):
 *  - admin/internal → cualquier device (resuelve clientId globalmente).
 *  - client/collaborator → solo devices de su compañía.
 */
export async function deleteDevice(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  const registrationId = event.pathParameters?.proxy ?? '';

  try {
    const clientId = await resolveClientId(registrationId, claims);
    if (!clientId) {
      return notFound(`Device ${registrationId} not found`);
    }

    // Obtener el registro para conocer el gpsDeviceId asociado
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `DEVICE#${clientId}`,
          SK: `DEVICE#${registrationId}`,
        },
      })
    );

    if (!existing.Item || existing.Item.status_device === 'inactive') {
      return notFound(`Device ${registrationId} not found`);
    }

    const gpsDeviceId = existing.Item.gpsDeviceId as string;
    const now = new Date().toISOString();

    // 1. Cambiar status_device a "inactive" en gps-tracker-devices
    await updateDeviceStatus(gpsDeviceId, 'inactive');

    // 2. Marcar el registro de skyalert como inactivo (soft delete, auditoría)
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `DEVICE#${clientId}`,
          SK: `DEVICE#${registrationId}`,
        },
        UpdateExpression:
          'SET status_device = :status, deactivatedAt = :now, deactivatedBy = :by',
        ExpressionAttributeValues: {
          ':status': 'inactive',
          ':now': now,
          ':by': claims.sub,
        },
      })
    );

    logger.info('Device soft-deleted (status_device set to inactive)', {
      registrationId,
      gpsDeviceId,
      deactivatedBy: claims.sub,
    });

    return success({
      registrationId,
      gpsDeviceId,
      statusDevice: 'inactive',
    });
  } catch (error: unknown) {
    logger.error('Failed to delete device', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to delete device');
  }
}

/**
 * Resuelve el clientId del device según el rol:
 *  - admin/internal → busca el device globalmente y devuelve su clientId.
 *  - client/collaborator → usa su propio clientId (del JWT).
 */
async function resolveClientId(
  registrationId: string,
  claims: UserClaims
): Promise<string | null> {
  if (isAdmin(claims)) {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'registrationId = :rid',
        ExpressionAttributeValues: { ':rid': registrationId },
        Limit: 1,
      })
    );
    return (result.Items?.[0]?.clientId as string) ?? null;
  }
  return claims.clientId ?? null;
}
