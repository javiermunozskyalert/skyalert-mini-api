import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, forbidden, notFound, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { getGpsConnectivityFields } from '../../../shared/gps-devices';
import { computeConnectivityStatus } from '../../../shared/connectivity';
import { logger } from '../../../shared/logger';

const TABLE_NAME = process.env.TABLE_NAME!;

/** Expone solo los campos de negocio del device (omite PK/SK internos). */
function toDeviceResponse(item: Record<string, unknown>) {
  return {
    registrationId: item.registrationId ?? null,
    clientId: item.clientId ?? null,
    name: item.name ?? null,
    address: item.address ?? null,
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
    gpsDeviceId: item.gpsDeviceId ?? null,
    statusDevice: item.status_device ?? null,
    createdAt: item.createdAt ?? null,
    updatedAt: item.updatedAt ?? null,
    createdBy: item.createdBy ?? null,
  };
}

/**
 * Enriquece la respuesta del device con el estado de conectividad DERIVADO,
 * leído del device físico GPS (gpsDeviceId). Si no hay gpsDeviceId o el device
 * GPS no existe, connectivity_status = "disconnected".
 */
async function withConnectivity(
  base: ReturnType<typeof toDeviceResponse>
): Promise<ReturnType<typeof toDeviceResponse> & {
  connectivity_status: string;
  last_seen_seconds_ago: number | null;
  last_seen_at: string | null;
}> {
  const gpsDeviceId = base.gpsDeviceId;
  const fields =
    typeof gpsDeviceId === 'string' ? await getGpsConnectivityFields(gpsDeviceId) : null;
  const { connectivity_status, last_seen_seconds_ago } = computeConnectivityStatus(
    fields ?? {}
  );
  return {
    ...base,
    connectivity_status,
    last_seen_seconds_ago,
    last_seen_at: fields?.last_seen_at ?? null,
  };
}

/**
 * Obtiene un device por su registrationId, respetando la visibilidad del rol:
 *  - admin/internal → cualquier device (búsqueda global).
 *  - client/collaborator → solo si pertenece a su compañía.
 *
 * GET /devices/{registrationId}
 */
export async function getDevice(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  const registrationId = event.pathParameters?.proxy ?? '';

  try {
    if (isAdmin(claims)) {
      // admin/internal → buscar globalmente por registrationId
      const result = await docClient.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          FilterExpression: 'registrationId = :rid AND status_device <> :inactive',
          ExpressionAttributeValues: {
            ':rid': registrationId,
            ':inactive': 'inactive',
          },
          Limit: 1,
        })
      );
      const item = result.Items?.[0];
      if (!item) return notFound(`Device ${registrationId} not found`);
      return success(await withConnectivity(toDeviceResponse(item)));
    }

    // client/collaborator → solo dentro de su compañía
    if (!claims.clientId) {
      return forbidden('Your user is not associated with a client');
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `DEVICE#${claims.clientId}`,
          SK: `DEVICE#${registrationId}`,
        },
      })
    );

    if (!result.Item || result.Item.status_device === 'inactive') {
      return notFound(`Device ${registrationId} not found`);
    }

    return success(await withConnectivity(toDeviceResponse(result.Item)));
  } catch (error: unknown) {
    logger.error('Failed to get device', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to get device');
  }
}
