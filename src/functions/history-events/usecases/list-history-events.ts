import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, forbidden, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { logger } from '../../../shared/logger';

const DEVICES_TABLE = process.env.TABLE_NAME!;
const ACTIVATIONS_TABLE = process.env.ACTIVATIONS_TABLE ?? 'gps-tracker-activations';

/** Cuántos eventos devolver (más recientes primero). */
const MAX_EVENTS = 10;
/** Límite de seguridad al escanear la tabla de activaciones. */
const SCAN_LIMIT = 500;

interface ActivationItem {
  notificationId: string;
  timestamp: number;
  impactAt?: string;
  intensity?: number;
  command?: string;
  source?: string;
  latency_ms?: number;
  deviceIds_requested?: string[];
  deviceIds_sent?: string[];
  deviceIds_offline?: string[];
}

/**
 * Historial de eventos (activaciones sísmicas) filtrado por los devices del
 * customer del token legacy.
 *
 * GET /history_events
 *
 * Flujo:
 *  1. Resuelve los devices del tenant (PK = DEVICE#<clientId>) y toma sus gpsDeviceId.
 *  2. Escanea gps-tracker-activations.
 *  3. Incluye un evento si deviceIds_sent ∪ deviceIds_requested intersecta los
 *     gpsDeviceId del tenant.
 *  4. Ordena por timestamp desc y devuelve los MAX_EVENTS más recientes.
 *
 * Cada evento incluye solo los devices del tenant que participaron (con su
 * registrationId y name), no todos los deviceIds del evento global.
 */
export async function listHistoryEvents(
  _event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  // Requiere tenant (legacy/client). admin sin clientId no aplica a este módulo.
  const clientId = claims.clientId;
  if (!clientId && !isAdmin(claims)) {
    return forbidden('Your user is not associated with a client');
  }
  if (!clientId) {
    return forbidden('history_events requires a client-scoped user');
  }

  try {
    // 1. Devices del tenant → mapa gpsDeviceId -> { registrationId, name }
    const deviceMap = await getTenantDeviceMap(clientId);
    const tenantGpsIds = new Set(deviceMap.keys());

    if (tenantGpsIds.size === 0) {
      return success({ items: [] });
    }

    // 2. Escanear activaciones.
    const scan = await docClient.send(
      new ScanCommand({
        TableName: ACTIVATIONS_TABLE,
        Limit: SCAN_LIMIT,
      })
    );
    const activations = (scan.Items ?? []) as ActivationItem[];

    // 3. Filtrar por intersección con los devices del tenant.
    const filtered = activations
      .map((ev) => {
        const involved = new Set<string>([
          ...(ev.deviceIds_sent ?? []),
          ...(ev.deviceIds_requested ?? []),
        ]);
        const tenantDevices = [...involved].filter((id) => tenantGpsIds.has(id));
        return { ev, tenantDevices };
      })
      .filter(({ tenantDevices }) => tenantDevices.length > 0);

    // 4. Ordenar por timestamp desc y tomar los MAX_EVENTS más recientes.
    filtered.sort((a, b) => (b.ev.timestamp ?? 0) - (a.ev.timestamp ?? 0));
    const top = filtered.slice(0, MAX_EVENTS);

    const items = top.map(({ ev, tenantDevices }) => ({
      notificationId: ev.notificationId,
      timestamp: ev.timestamp,
      impactAt: ev.impactAt ?? null,
      intensity: ev.intensity ?? null,
      command: ev.command ?? null,
      source: ev.source ?? null,
      latency_ms: ev.latency_ms ?? null,
      devices: tenantDevices.map((gpsDeviceId) => ({
        gpsDeviceId,
        registrationId: deviceMap.get(gpsDeviceId)?.registrationId ?? null,
        name: deviceMap.get(gpsDeviceId)?.name ?? null,
      })),
    }));

    return success({ items });
  } catch (error: unknown) {
    logger.error('Failed to list history events', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to list history events');
  }
}

interface TenantDevice {
  registrationId: string | null;
  name: string | null;
}

/** Devuelve un mapa gpsDeviceId -> { registrationId, name } de los devices activos del tenant. */
async function getTenantDeviceMap(clientId: string): Promise<Map<string, TenantDevice>> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: DEVICES_TABLE,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'status_device <> :inactive',
      ExpressionAttributeValues: {
        ':pk': `DEVICE#${clientId}`,
        ':inactive': 'inactive',
      },
    })
  );

  const map = new Map<string, TenantDevice>();
  for (const item of result.Items ?? []) {
    const gpsDeviceId = item.gpsDeviceId as string | undefined;
    if (gpsDeviceId) {
      map.set(gpsDeviceId, {
        registrationId: (item.registrationId as string | undefined) ?? null,
        name: (item.name as string | undefined) ?? null,
      });
    }
  }
  return map;
}
