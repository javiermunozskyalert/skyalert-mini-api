import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, badRequest, notFound, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { logger } from '../../../shared/logger';
import { z } from 'zod';

const TABLE_NAME = process.env.TABLE_NAME!;

const UpdateDeviceSchema = z.object({
  name: z.string().min(1).max(200),
});

/**
 * Actualiza los datos editables de un device (name).
 * PUT /devices/{registrationId}
 *
 * Visibilidad por rol (misma lógica que list/get):
 *  - admin/internal → pueden actualizar cualquier device (búsqueda global).
 *  - client/collaborator → solo devices de su compañía.
 *
 * El status del hardware se maneja en gps-tracker-devices, no aquí.
 */
export async function updateDevice(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  const registrationId = event.pathParameters?.proxy ?? '';

  const body = JSON.parse(event.body ?? '{}');
  const validation = UpdateDeviceSchema.safeParse(body);
  if (!validation.success) {
    return badRequest(validation.error.issues.map((i) => i.message).join(', '));
  }

  try {
    // Resolver a qué compañía pertenece el device según el rol
    const clientId = await resolveClientId(registrationId, claims);
    if (!clientId) {
      return notFound(`Device ${registrationId} not found`);
    }

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
          ':inactive': 'inactive',
        },
        ConditionExpression: 'attribute_exists(SK) AND status_device <> :inactive',
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

/**
 * Resuelve el clientId del device según el rol:
 *  - admin/internal → busca el device globalmente y devuelve su clientId.
 *  - client/collaborator → usa su propio clientId (del JWT).
 * Devuelve null si no lo encuentra o no tiene acceso.
 */
async function resolveClientId(
  registrationId: string,
  claims: UserClaims
): Promise<string | null> {
  if (isAdmin(claims)) {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'registrationId = :rid',
        ExpressionAttributeValues: { ':rid': registrationId },
        Limit: 1,
      })
    );
    return (result.Items?.[0]?.clientId as string) ?? null;
  }
  return claims.clientId ?? null;
}
