import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, badRequest, forbidden, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { logger } from '../../../shared/logger';

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Lista los devices de un cliente.
 * GET /devices?clientId=...
 *
 * - Admin/internal: pueden listar los de cualquier clientId.
 * - client/collaborator: solo pueden listar los de su propia organización.
 */
export async function listDevices(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  const requestedClientId = event.queryStringParameters?.clientId;

  // Determinar el clientId efectivo según el rol
  let clientId: string;
  if (isAdmin(claims)) {
    if (!requestedClientId) {
      return badRequest('clientId query parameter is required');
    }
    clientId = requestedClientId;
  } else {
    // Un usuario no-admin solo puede ver los de su propia organización
    if (!claims.clientId) {
      return forbidden('Your user is not associated with a client');
    }
    if (requestedClientId && requestedClientId !== claims.clientId) {
      return forbidden('You can only list devices from your own organization');
    }
    clientId = claims.clientId;
  }

  const limit = parseInt(event.queryStringParameters?.limit ?? '20', 10);
  const lastKey = event.queryStringParameters?.lastKey;

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `DEVICE#${clientId}` },
        Limit: Math.min(limit, 100),
        ExclusiveStartKey: lastKey ? JSON.parse(decodeURIComponent(lastKey)) : undefined,
      })
    );

    return success({
      items: (result.Items ?? []).filter((d) => d.status_device !== 'inactive'),
      lastKey: result.LastEvaluatedKey
        ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey))
        : null,
    });
  } catch (error: unknown) {
    logger.error('Failed to list devices', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to list devices');
  }
}
