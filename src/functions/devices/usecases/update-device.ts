import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, badRequest, forbidden, notFound, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { logger } from '../../../shared/logger';
import { z } from 'zod';

const TABLE_NAME = process.env.TABLE_NAME!;

const UpdateDeviceSchema = z.object({
  name: z.string().min(1).max(200),
});

/**
 * Actualiza los datos editables de un device registrado (name).
 * PUT /devices/{registrationId}
 * El status del hardware se maneja en gps-tracker-devices, no aquí.
 */
export async function updateDevice(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  if (!isAdmin(claims)) {
    return forbidden('Only admin users can update devices');
  }

  const registrationId = event.pathParameters?.proxy ?? '';
  const clientId = event.queryStringParameters?.clientId;

  if (!clientId) {
    return badRequest('clientId query parameter is required');
  }

  const body = JSON.parse(event.body ?? '{}');
  const validation = UpdateDeviceSchema.safeParse(body);

  if (!validation.success) {
    return badRequest(validation.error.issues.map((i) => i.message).join(', '));
  }

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `DEVICE#${clientId}`,
          SK: `DEVICE#${registrationId}`,
        },
        UpdateExpression: 'SET #name = :name, updatedAt = :now',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: {
          ':name': validation.data.name,
          ':now': new Date().toISOString(),
        },
        ConditionExpression: 'attribute_exists(SK)',
        ReturnValues: 'ALL_NEW',
      })
    );

    logger.info('Device updated', { registrationId, updatedBy: claims.sub });
    return success(result.Attributes);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return notFound(`Device ${registrationId} not found`);
    }
    logger.error('Failed to update device', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to update device');
  }
}
