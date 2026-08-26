import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { noContent, forbidden, notFound } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../../shared/logger';

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Soft delete — marca el cliente como eliminado sin borrar datos.
 * Cumple con retención de datos y auditoría.
 */
export async function deleteClient(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  if (!isAdmin(claims)) {
    return forbidden('Only admin users can delete clients');
  }

  const clientId = event.pathParameters?.proxy ?? '';
  const now = new Date().toISOString();

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: 'CLIENT',
          SK: `CLIENT#${clientId}`,
        },
        UpdateExpression: 'SET #status = :status, #deletedAt = :deletedAt, #deletedBy = :deletedBy',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#deletedAt': 'deletedAt',
          '#deletedBy': 'deletedBy',
        },
        ExpressionAttributeValues: {
          ':status': 'deleted',
          ':deletedAt': now,
          ':deletedBy': claims.sub,
        },
        ConditionExpression: 'attribute_exists(SK)',
      })
    );

    logger.info('Client soft-deleted', { clientId, deletedBy: claims.sub });
    return noContent();
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return notFound(`Client ${clientId} not found`);
    }
    throw error;
  }
}
