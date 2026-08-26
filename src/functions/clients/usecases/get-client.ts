import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, notFound, forbidden } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { GetCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME!;

export async function getClient(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  const clientId = event.pathParameters?.proxy ?? '';

  // Clientes solo ven su propio registro
  if (!isAdmin(claims) && claims.clientId !== clientId) {
    return forbidden('You can only access your own client record');
  }

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: 'CLIENT',
        SK: `CLIENT#${clientId}`,
      },
    })
  );

  if (!result.Item) {
    return notFound(`Client ${clientId} not found`);
  }

  return success(result.Item);
}
