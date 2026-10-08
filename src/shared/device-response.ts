import { getGpsConnectivityFields } from './gps-devices';
import { computeConnectivityStatus } from './connectivity';

/**
 * Normalización del response de un device (camelCase, sin claves internas PK/SK).
 * Única fuente de verdad del contrato público del recurso device.
 */
export interface DeviceResponse {
  registrationId: string | null;
  clientId: string | null;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  gpsDeviceId: string | null;
  statusDevice: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  createdBy: string | null;
}

export interface DeviceWithConnectivity extends DeviceResponse {
  connectivityStatus: string;
  connectionStatus: string | null;
  lastSeenSecondsAgo: number | null;
  lastSeenAt: string | null;
}

/** Mapea un item crudo de DynamoDB al contrato público (camelCase, sin PK/SK). */
export function toDeviceResponse(item: Record<string, unknown>): DeviceResponse {
  return {
    registrationId: (item.registrationId as string) ?? null,
    clientId: (item.clientId as string) ?? null,
    name: (item.name as string) ?? null,
    address: (item.address as string) ?? null,
    latitude: (item.latitude as number) ?? null,
    longitude: (item.longitude as number) ?? null,
    gpsDeviceId: (item.gpsDeviceId as string) ?? null,
    statusDevice: (item.status_device as string) ?? null,
    createdAt: (item.createdAt as string) ?? null,
    updatedAt: (item.updatedAt as string) ?? null,
    createdBy: (item.createdBy as string) ?? null,
  };
}

/**
 * Enriquece un item de device con el estado de conectividad (camelCase),
 * resolviendo el device físico GPS por gpsDeviceId. Si no hay gpsDeviceId o
 * el device GPS no existe → "disconnected".
 */
export async function toDeviceWithConnectivity(
  item: Record<string, unknown>
): Promise<DeviceWithConnectivity> {
  const base = toDeviceResponse(item);
  const fields =
    typeof base.gpsDeviceId === 'string'
      ? await getGpsConnectivityFields(base.gpsDeviceId)
      : null;
  const { connectivity_status, last_seen_seconds_ago, connection_status } =
    computeConnectivityStatus(fields ?? {});
  return {
    ...base,
    connectivityStatus: connectivity_status,
    connectionStatus: connection_status,
    lastSeenSecondsAgo: last_seen_seconds_ago,
    lastSeenAt: fields?.last_seen_at ?? null,
  };
}
