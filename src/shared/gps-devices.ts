import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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

/** Estado administrativo del device (campo status_device). */
export type DeviceStatus = 'active' | 'inactive' | 'revoke' | 'maintenance';

export interface GpsDevice {
  device_id: string;
  uuid_device?: string;
  status_device?: DeviceStatus;
  /** status de conectividad (online/offline) — manejado por el GPS, no tocar. */
  status?: string;
  [key: string]: unknown;
}

/**
 * Busca un device en gps-tracker-devices por su uuid_device (ej: ska-jYio5d).
 *
 * NOTA: usa Scan con filtro porque la tabla no tiene GSI sobre uuid_device.
 * Es aceptable con pocos devices (beta). A futuro, agregar un GSI sobre
 * uuid_device en el proyecto GPS y cambiar esto por un Query.
 */
export async function findGpsDeviceByUuid(uuid: string): Promise<GpsDevice | null> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: GPS_DEVICES_TABLE,
      FilterExpression: 'uuid_device = :uuid',
      ExpressionAttributeValues: { ':uuid': uuid },
      Limit: 1,
    })
  );

  const item = result.Items?.[0];
  return item ? (item as GpsDevice) : null;
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
