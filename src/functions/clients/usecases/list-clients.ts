import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, forbidden } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../../shared/logger';

const TABLE_NAME = process.env.TABLE_NAME!;

export async function listClients(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  // Solo admins pueden listar todos los clientes
  if (!isAdmin(claims)) {
    return forbidden('Only admin users can list all clients');
  }

  const limit = parseInt(event.queryStringParameters?.limit ?? '20', 10);
  const lastKey = event.queryStringParameters?.lastKey;

  logger.debug('Listing clients', { limit, lastKey });

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'CLIENT',
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
