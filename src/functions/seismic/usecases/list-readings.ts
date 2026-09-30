import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, badRequest, forbidden, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { logger } from '../../../shared/logger';
import { userCanAccessDevice } from './access';

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Lista las lecturas sísmicas de un dispositivo, opcionalmente en un rango
 * de tiempo, usando el índice GSI-DeviceTime (deviceId + timestamp).
 *
 * GET /seismic/{deviceId}
 * GET /seismic/{deviceId}?from=ISO&to=ISO&limit=&lastKey=
 *
 * Visibilidad por rol:
 *  - admin/internal → cualquier dispositivo.
 *  - client/collaborator → solo dispositivos de su compañía.
 */
export async function listReadings(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  const deviceId = event.pathParameters?.proxy?.split('/')[0] ?? '';

  if (!deviceId) {
    return badRequest('deviceId is required in the path');
  }

  // Validar que el usuario puede acceder a este dispositivo
  if (!isAdmin(claims)) {
    const allowed = await userCanAccessDevice(deviceId, claims);
    if (!allowed) {
      return forbidden('You can only access devices from your own organization');
    }
  }

  const from = event.queryStringParameters?.from;
  const to = event.queryStringParameters?.to;
  const limit = parseInt(event.queryStringParameters?.limit ?? '50', 10);
  const lastKey = event.queryStringParameters?.lastKey;

  // Construir condición de rango de tiempo si se proveen from/to
  let keyCondition = 'deviceId = :deviceId';
  const values: Record<string, unknown> = { ':deviceId': deviceId };

  if (from && to) {
    keyCondition += ' AND #ts BETWEEN :from AND :to';
    values[':from'] = from;
    values[':to'] = to;
  } else if (from) {
    keyCondition += ' AND #ts >= :from';
    values[':from'] = from;
  } else if (to) {
    keyCondition += ' AND #ts <= :to';
    values[':to'] = to;
  }

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI-DeviceTime',
        KeyConditionExpression: keyCondition,
        ExpressionAttributeNames:
          from || to ? { '#ts': 'timestamp' } : undefined,
        ExpressionAttributeValues: values,
        ScanIndexForward: false, // más recientes primero
        Limit: Math.min(limit, 200),
        ExclusiveStartKey: lastKey ? JSON.parse(decodeURIComponent(lastKey)) : undefined,
      })
    );

    return success({
      deviceId,
      items: result.Items ?? [],
      lastKey: result.LastEvaluatedKey
        ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey))
        : null,
    });
  } catch (error: unknown) {
    logger.error('Failed to list seismic readings', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to list seismic readings');
  }
}
