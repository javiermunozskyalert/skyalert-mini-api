import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { created, badRequest, forbidden } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../../shared/logger';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const TABLE_NAME = process.env.TABLE_NAME!;

const CreateClientSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
});

export async function createClient(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  if (!isAdmin(claims)) {
    return forbidden('Only admin users can create clients');
  }

  const body = JSON.parse(event.body ?? '{}');
  const validation = CreateClientSchema.safeParse(body);

  if (!validation.success) {
    return badRequest(validation.error.issues.map(i => i.message).join(', '));
  }

  const { name, email, phone, address } = validation.data;
  const clientId = randomUUID();
  const now = new Date().toISOString();

  const item = {
    PK: 'CLIENT',
    SK: `CLIENT#${clientId}`,
    clientId,
    name,
    email,
    phone,
    address,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: claims.sub,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: 'attribute_not_exists(SK)', // Idempotencia
    })
  );

  logger.info('Client created', { clientId, createdBy: claims.sub });

  return created(item);
}
