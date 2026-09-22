import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, forbidden, notFound, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { logger } from '../../../shared/logger';

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Obtiene un device registrado por su registrationId.
 * GET /devices/{registrationId}
 *
 * Como la PK depende del clientId, se busca vía el registrationId dentro
 * del scope del cliente del usuario (no-admin) o buscando el item (admin).
 */
export async function getDevice(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  const registrationId = event.pathParameters?.proxy ?? '';
  const clientId = isAdmin(claims)
    ? event.queryStringParameters?.clientId
    : claims.clientId;

  if (!clientId) {
    return forbidden(
      isAdmin(claims)
        ? 'clientId query parameter is required for admins'
        : 'Your user is not associated with a client'
    );
  }

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: {
          ':pk': `DEVICE#${clientId}`,
          ':sk': `DEVICE#${registrationId}`,
        },
        Limit: 1,
      })
    );

    const item = result.Items?.[0];
    if (!item || item.status_device === 'inactive') {
      return notFound(`Device ${registrationId} not found`);
    }

    return success(item);
  } catch (error: unknown) {
    logger.error('Failed to get device', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to get device');
  }
}
