import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../../shared/dynamo';
import { UserClaims } from '../../../shared/auth';

const DEVICES_TABLE = process.env.DEVICES_TABLE!;

/**
 * Verifica que un dispositivo (gpsDeviceId) pertenece a la compañía del usuario.
 * Usado para autorizar el acceso a lecturas sísmicas de client/collaborator.
 *
 * Busca en skyalert-stg-devices los devices del clientId del usuario y
 * comprueba que alguno referencia ese gpsDeviceId.
 */
export async function userCanAccessDevice(
  deviceId: string,
  claims: UserClaims
): Promise<boolean> {
  if (!claims.clientId) {
    return false;
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: DEVICES_TABLE,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'gpsDeviceId = :did AND status_device <> :inactive',
      ExpressionAttributeValues: {
        ':pk': `DEVICE#${claims.clientId}`,
        ':did': deviceId,
        ':inactive': 'inactive',
      },
      Limit: 1,
    })
  );

  return (result.Items?.length ?? 0) > 0;
}
