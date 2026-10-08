import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, badRequest, notFound, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { toDeviceResponse } from '../../../shared/device-response';
import { logger } from '../../../shared/logger';
import { z } from 'zod';

const TABLE_NAME = process.env.TABLE_NAME!;

const UpdateDeviceSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    address: z.string().max(500).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'At least one field (name, address, latitude, longitude) is required' }
  );

/**
 * Actualiza los datos editables de un device: name, address, latitude, longitude.
 * PUT /devices/{registrationId}
 *
 * Actualización parcial: solo se modifican los campos presentes en el body.
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

    // Construir la expresión de actualización dinámicamente (solo campos presentes).
    const data = validation.data;
    const setParts: string[] = ['updatedAt = :now'];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {
      ':now': new Date().toISOString(),
      ':inactive': 'inactive',
    };

    if (data.name !== undefined) {
      setParts.push('#name = :name');
      names['#name'] = 'name';
      values[':name'] = data.name;
    }
    if (data.address !== undefined) {
      setParts.push('address = :address');
      values[':address'] = data.address;
    }
    if (data.latitude !== undefined) {
      setParts.push('latitude = :latitude');
      values[':latitude'] = data.latitude;
    }
    if (data.longitude !== undefined) {
      setParts.push('longitude = :longitude');
      values[':longitude'] = data.longitude;
    }

    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `DEVICE#${clientId}`,
          SK: `DEVICE#${registrationId}`,
        },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(SK) AND status_device <> :inactive',
        ReturnValues: 'ALL_NEW',
      })
    );

    logger.info('Device updated', { registrationId, updatedBy: claims.sub });
    return success(toDeviceResponse(result.Attributes ?? {}));
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
