import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, badRequest, forbidden, notFound, serverError } from '../../../shared/response';
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
 */
export async function deleteDevice(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  if (!isAdmin(claims)) {
    return forbidden('Only admin users can delete devices');
  }

  const registrationId = event.pathParameters?.proxy ?? '';
  const clientId = event.queryStringParameters?.clientId;

  if (!clientId) {
    return badRequest('clientId query parameter is required');
  }

  try {
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

    if (!existing.Item) {
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
