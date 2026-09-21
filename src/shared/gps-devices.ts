import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './dynamo';

/**
 * Acceso a la tabla del proyecto GPS Tracker (gps-tracker-devices).
 * Esta tabla pertenece a otro proyecto; aquí solo la referenciamos
 * para validar/vincular devices al registrarlos en skyalert.
 */
const GPS_DEVICES_TABLE = process.env.GPS_DEVICES_TABLE ?? 'gps-tracker-devices';

/** Estados válidos del device en la tabla del GPS. */
export type GpsDeviceStatus = 'active' | 'inactive' | 'revoke' | 'maintenance';

export interface GpsDevice {
  device_id: string;
  'uuid-device'?: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * Busca un device en gps-tracker-devices por su uuid-device (ej: ska-jYio5d).
 *
 * NOTA: usa Scan con filtro porque la tabla no tiene GSI sobre uuid-device.
 * Es aceptable con pocos devices (beta). A futuro, agregar un GSI sobre
 * uuid-device en el proyecto GPS y cambiar esto por un Query.
 */
export async function findGpsDeviceByUuid(uuid: string): Promise<GpsDevice | null> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: GPS_DEVICES_TABLE,
      FilterExpression: '#uuid = :uuid',
      ExpressionAttributeNames: { '#uuid': 'uuid-device' },
      ExpressionAttributeValues: { ':uuid': uuid },
      Limit: 1,
    })
  );

  const item = result.Items?.[0];
  return item ? (item as GpsDevice) : null;
}

/**
 * Actualiza el status de un device en gps-tracker-devices.
 */
export async function updateGpsDeviceStatus(
  deviceId: string,
  status: GpsDeviceStatus
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: GPS_DEVICES_TABLE,
      Key: { device_id: deviceId },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status },
      ConditionExpression: 'attribute_exists(device_id)',
    })
  );
}
