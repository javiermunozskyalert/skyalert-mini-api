import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, badRequest, forbidden, notFound, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { logger } from '../../../shared/logger';
import { userCanAccessDevice } from './access';

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Obtiene la última lectura sísmica de un dispositivo.
 * GET /seismic/{deviceId}/latest
 *
 * Visibilidad por rol igual que list-readings.
 */
export async function getLatestReading(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  const deviceId = event.pathParameters?.proxy?.split('/')[0] ?? '';

  if (!deviceId) {
    return badRequest('deviceId is required in the path');
  }

  if (!isAdmin(claims)) {
    const allowed = await userCanAccessDevice(deviceId, claims);
    if (!allowed) {
      return forbidden('You can only access devices from your own organization');
    }
  }

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI-DeviceTime',
        KeyConditionExpression: 'deviceId = :deviceId',
        ExpressionAttributeValues: { ':deviceId': deviceId },
        ScanIndexForward: false, // descendente → el más reciente primero
        Limit: 1,
      })
    );

    const latest = result.Items?.[0];
    if (!latest) {
      return notFound(`No seismic readings found for device ${deviceId}`);
    }

    return success(latest);
  } catch (error: unknown) {
    logger.error('Failed to get latest seismic reading', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to get latest seismic reading');
  }
}
