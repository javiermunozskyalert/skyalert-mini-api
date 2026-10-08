import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './dynamo';

/**
 * Acceso a la tabla del proyecto GPS Tracker (gps-tracker-devices).
 * Esta tabla pertenece a otro proyecto; aquí solo la referenciamos
 * para validar/vincular devices al registrarlos en skyalert.
 *
 * IMPORTANTE: no tocamos el campo `status` (online/offline) que el
 * servidor TCP del GPS actualiza en tiempo real. El estado administrativo
 * vive en un campo separado: `status_device`.
 */
const GPS_DEVICES_TABLE = process.env.GPS_DEVICES_TABLE ?? 'gps-tracker-devices';

/** Prefijo con el que la tabla GPS indexa un device por su uuid. */
const UUID_KEY_PREFIX = 'uuid#';

/** Clave de caché para el lookup de un device GPS por uuid. */
export function gpsCacheKey(uuid: string): string {
  return `gps:lookup:${uuid}`;
}

/** Estado administrativo del device (campo status_device). */
export type DeviceStatus = 'active' | 'inactive' | 'revoke' | 'maintenance';

export interface GpsDevice {
  device_id: string;
  uuid_device?: string;
  status_device?: DeviceStatus;
  /** device físico al que apunta el registro uuid# (reserva/mapeo). */
  reserved_for?: string;
  /** estado administrativo real del device físico (ej: "inactive"). */
  status?: string;
  /** coordenadas del device reportadas por el GPS tracker. */
  latitude?: number;
  longitude?: number;
  [key: string]: unknown;
}

/**
 * Busca un device en gps-tracker-devices por su uuid (ej: ska-L0z4AD).
 *
 * La tabla GPS indexa el uuid como clave primaria con el patrón
 * `device_id = "uuid#<uuid>"`, que apunta al device físico real en
 * `reserved_for`. Esta función resuelve ambos:
 *   1. GetItem del registro uuid# → obtiene reserved_for.
 *   2. GetItem del device físico → obtiene su `status` real.
 *
 * Devuelve el device físico (con su status) enriquecido con uuid_device y
 * reserved_for. Null si el uuid no existe.
 */
export async function findGpsDeviceByUuid(uuid: string): Promise<GpsDevice | null> {
  // 1. Resolver el registro de mapeo por uuid.
  const mapping = await docClient.send(
    new GetCommand({
      TableName: GPS_DEVICES_TABLE,
      Key: { device_id: `${UUID_KEY_PREFIX}${uuid}` },
    })
  );

  if (!mapping.Item) return null;

  const reservedFor = mapping.Item.reserved_for as string | undefined;
  if (!reservedFor) {
    // uuid existe pero no está vinculado a un device físico.
    return { ...(mapping.Item as GpsDevice), uuid_device: uuid };
  }

  // 2. Resolver el device físico para leer su status real.
  const physical = await docClient.send(
    new GetCommand({
      TableName: GPS_DEVICES_TABLE,
      Key: { device_id: reservedFor },
    })
  );

  if (!physical.Item) {
    // El mapeo apunta a un device inexistente.
    return { device_id: reservedFor, uuid_device: uuid, reserved_for: reservedFor };
  }

  return {
    ...(physical.Item as GpsDevice),
    uuid_device: uuid,
    reserved_for: reservedFor,
  };
}

/**
 * Actualiza el estado administrativo (status_device) de un device.
 * NO toca el campo `status` de conectividad del GPS.
 */
export async function updateDeviceStatus(
  deviceId: string,
  statusDevice: DeviceStatus
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: GPS_DEVICES_TABLE,
      Key: { device_id: deviceId },
      UpdateExpression: 'SET status_device = :statusDevice',
      ExpressionAttributeValues: { ':statusDevice': statusDevice },
      ConditionExpression: 'attribute_exists(device_id)',
    })
  );
}

/**
 * Resuelve el uuid (device_uuid) de un device físico por su device_id.
 * Se usa para invalidar el caché del lookup tras cambiar su status.
 */
export async function findGpsDeviceUuidById(deviceId: string): Promise<string | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: GPS_DEVICES_TABLE,
      Key: { device_id: deviceId },
    })
  );
  return (result.Item?.device_uuid as string | undefined) ?? null;
}

/** Campos de conectividad leídos del device físico GPS. */
export interface GpsConnectivityFields {
  last_seen_at?: string | null;
  connection_status?: string | null;
}

/**
 * Lee los campos de conectividad (last_seen_at, connection_status) de un device
 * físico por su device_id. Solo proyecta esos atributos para minimizar lectura.
 * Devuelve null si el device no existe.
 */
export async function getGpsConnectivityFields(
  deviceId: string
): Promise<GpsConnectivityFields | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: GPS_DEVICES_TABLE,
      Key: { device_id: deviceId },
      ProjectionExpression: 'last_seen_at, connection_status',
    })
  );
  if (!result.Item) return null;
  return {
    last_seen_at: (result.Item.last_seen_at as string | undefined) ?? null,
    connection_status: (result.Item.connection_status as string | undefined) ?? null,
  };
}
