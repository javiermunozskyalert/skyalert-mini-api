import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, forbidden, notFound, serverError } from '../../../shared/response';
import { docClient } from '../../../shared/dynamo';
import { logger } from '../../../shared/logger';

const TABLE_NAME = process.env.TABLE_NAME!;

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
      return success(item);
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

    return success(result.Item);
  } catch (error: unknown) {
    logger.error('Failed to get device', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to get device');
  }
}
