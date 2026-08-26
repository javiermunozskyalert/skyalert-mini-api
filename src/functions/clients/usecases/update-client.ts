import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, badRequest, forbidden, notFound } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../../shared/logger';
import { z } from 'zod';

const TABLE_NAME = process.env.TABLE_NAME!;

const UpdateClientSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export async function updateClient(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  if (!isAdmin(claims)) {
    return forbidden('Only admin users can update clients');
  }

  const clientId = event.pathParameters?.proxy ?? '';
  const body = JSON.parse(event.body ?? '{}');
  const validation = UpdateClientSchema.safeParse(body);

  if (!validation.success) {
    return badRequest(validation.error.issues.map(i => i.message).join(', '));
  }

  const data = validation.data;
  const now = new Date().toISOString();

  // Construir expresión de actualización dinámicamente
  const expressionParts: string[] = ['#updatedAt = :updatedAt'];
  const expressionNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const expressionValues: Record<string, unknown> = { ':updatedAt': now };

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      expressionParts.push(`#${key} = :${key}`);
      expressionNames[`#${key}`] = key;
      expressionValues[`:${key}`] = value;
    }
  });

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: 'CLIENT',
          SK: `CLIENT#${clientId}`,
        },
        UpdateExpression: `SET ${expressionParts.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: 'attribute_exists(SK)',
        ReturnValues: 'ALL_NEW',
      })
    );

    logger.info('Client updated', { clientId, updatedBy: claims.sub });
    return success(result.Attributes);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return notFound(`Client ${clientId} not found`);
    }
    throw error;
  }
}
