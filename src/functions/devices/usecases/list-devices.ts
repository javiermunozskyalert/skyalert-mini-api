import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, forbidden, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { getGpsConnectivityFields } from '../../../shared/gps-devices';
import { computeConnectivityStatus } from '../../../shared/connectivity';
import { logger } from '../../../shared/logger';
import { ensureLegacyCustomerProvisioned } from '../../../shared/provisioning';

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Enriquece un item de device con el estado de conectividad derivado, leído
 * del device físico GPS (gpsDeviceId). Si no hay gpsDeviceId o no existe el
 * device GPS → "disconnected".
 */
async function enrichWithConnectivity(
  item: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const gpsDeviceId = item.gpsDeviceId;
  const fields =
    typeof gpsDeviceId === 'string' ? await getGpsConnectivityFields(gpsDeviceId) : null;
  const { connectivity_status, last_seen_seconds_ago } = computeConnectivityStatus(
    fields ?? {}
  );
  return {
    ...item,
    connectivity_status,
    last_seen_seconds_ago,
    last_seen_at: fields?.last_seen_at ?? null,
  };
}

/** Enriquece una lista de devices en paralelo. */
async function enrichItems(
  items: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  return Promise.all(items.map(enrichWithConnectivity));
}

/**
 * Lista devices según la visibilidad del rol del usuario:
 *
 *  - admin / internal → ven TODOS los devices (todas las organizaciones).
 *  - client / collaborator → ven solo los de SU compañía (su clientId).
 *
 * Para usuarios legacy, al ser el primer endpoint que consulta el webview,
 * se asegura el auto-provisioning del customer antes de responder.
 *
 * GET /devices
 *   admin/internal: opcionalmente ?clientId=... para filtrar una compañía.
 */
export async function listDevices(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  const limit = parseInt(event.queryStringParameters?.limit ?? '20', 10);
  const lastKey = event.queryStringParameters?.lastKey;
  const requestedClientId = event.queryStringParameters?.clientId;

  try {
    // Auto-provisioning idempotente del customer legacy (no-op si ya existe
    // o si no es un usuario legacy).
    await ensureLegacyCustomerProvisioned(claims);

    // Determinar el scope según el rol
    if (isAdmin(claims)) {
      // admin/internal → ven todo; si mandan clientId, filtran esa compañía
      if (requestedClientId) {
        return await listByClient(requestedClientId, limit, lastKey);
      }
      return await listAll(limit, lastKey);
    }

    // client/collaborator → solo su compañía
    if (!claims.clientId) {
      return forbidden('Your user is not associated with a client');
    }
    return await listByClient(claims.clientId, limit, lastKey);
  } catch (error: unknown) {
    logger.error('Failed to list devices', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to list devices');
  }
}

/** Lista los devices de una compañía específica (Query por PK). */
async function listByClient(
  clientId: string,
  limit: number,
  lastKey?: string
): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'status_device <> :inactive',
      ExpressionAttributeValues: {
        ':pk': `DEVICE#${clientId}`,
        ':inactive': 'inactive',
      },
      Limit: Math.min(limit, 100),
      ExclusiveStartKey: lastKey ? JSON.parse(decodeURIComponent(lastKey)) : undefined,
    })
  );

  return success({
    items: await enrichItems(result.Items ?? []),
    lastKey: result.LastEvaluatedKey
      ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey))
      : null,
  });
}

/**
 * Lista TODOS los devices (admin/internal) con Scan.
 * NOTA: Scan recorre toda la tabla. Aceptable en beta con pocos devices.
 * A futuro, considerar un GSI con PK fija (ej: "ALL") para poder hacer Query.
 */
async function listAll(limit: number, lastKey?: string): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'status_device <> :inactive',
      ExpressionAttributeValues: { ':inactive': 'inactive' },
      Limit: Math.min(limit, 100),
      ExclusiveStartKey: lastKey ? JSON.parse(decodeURIComponent(lastKey)) : undefined,
    })
  );

  return success({
    items: await enrichItems(result.Items ?? []),
    lastKey: result.LastEvaluatedKey
      ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey))
      : null,
  });
}
