import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, forbidden, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { logger } from '../../../shared/logger';

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Lista devices según la visibilidad del rol del usuario:
 *
 *  - admin / internal → ven TODOS los devices (todas las organizaciones).
 *  - client / collaborator → ven solo los de SU compañía (su clientId).
 *
 * GET /devices
 *   admin/internal: opcionalmente ?clientId=... para filtrar una compañía.
 */
export async function listDevices(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  const limit = parseInt(event.queryStringParameters?.limit ?? '20', 10);
  const lastKey = event.queryStringParameters?.lastKey;
  const requestedClientId = event.queryStringParameters?.clientId;

  try {
    // Determinar el scope según el rol
    if (isAdmin(claims)) {
      // admin/internal → ven todo; si mandan clientId, filtran esa compañía
      if (requestedClientId) {
        return await listByClient(requestedClientId, limit, lastKey);
      }
      return await listAll(limit, lastKey);
    }

    // client/collaborator → solo su compañía
    if (!claims.clientId) {
      return forbidden('Your user is not associated with a client');
    }
    return await listByClient(claims.clientId, limit, lastKey);
  } catch (error: unknown) {
    logger.error('Failed to list devices', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to list devices');
  }
}

/** Lista los devices de una compañía específica (Query por PK). */
async function listByClient(
  clientId: string,
  limit: number,
  lastKey?: string
): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'status_device <> :inactive',
      ExpressionAttributeValues: {
        ':pk': `DEVICE#${clientId}`,
        ':inactive': 'inactive',
      },
      Limit: Math.min(limit, 100),
      ExclusiveStartKey: lastKey ? JSON.parse(decodeURIComponent(lastKey)) : undefined,
    })
  );

  return success({
    items: result.Items ?? [],
    lastKey: result.LastEvaluatedKey
      ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey))
      : null,
  });
}

/**
 * Lista TODOS los devices (admin/internal) con Scan.
 * NOTA: Scan recorre toda la tabla. Aceptable en beta con pocos devices.
 * A futuro, considerar un GSI con PK fija (ej: "ALL") para poder hacer Query.
 */
async function listAll(limit: number, lastKey?: string): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'status_device <> :inactive',
      ExpressionAttributeValues: { ':inactive': 'inactive' },
      Limit: Math.min(limit, 100),
      ExclusiveStartKey: lastKey ? JSON.parse(decodeURIComponent(lastKey)) : undefined,
    })
  );

  return success({
    items: result.Items ?? [],
    lastKey: result.LastEvaluatedKey
      ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey))
      : null,
  });
}
