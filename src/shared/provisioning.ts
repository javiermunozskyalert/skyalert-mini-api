import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './dynamo';
import { UserClaims } from './auth';
import { logger } from './logger';

const CLIENTS_TABLE = process.env.CLIENTS_TABLE ?? process.env.TABLE_NAME!;

/**
 * Auto-provisioning de usuarios que llegan desde la app legacy.
 *
 * El token legacy solo trae el customerId (sub); no incluye email ni nombre.
 * La primera vez que un usuario legacy accede, lo registramos como un item
 * CLIENT con datos mínimos (sin email ni nombre). Es idempotente: si ya existe,
 * no hace nada (ConditionExpression attribute_not_exists).
 *
 * clientId = "legacy#<customerId>"  (ya resuelto por el authorizer en claims.clientId)
 * PK = 'CLIENT', SK = 'CLIENT#legacy#<customerId>'
 */
export async function ensureLegacyCustomerProvisioned(
  claims: UserClaims
): Promise<void> {
  // Solo aplica a usuarios legacy (clientId con prefijo "legacy#").
  const clientId = claims.clientId;
  if (!clientId || !clientId.startsWith('legacy#')) {
    return;
  }

  const now = new Date().toISOString();
  const item = {
    PK: 'CLIENT',
    SK: `CLIENT#${clientId}`,
    clientId,
    source: 'legacy',
    status: 'active',
    createdVia: 'auto',
    createdAt: now,
    updatedAt: now,
    createdBy: claims.sub,
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: CLIENTS_TABLE,
        Item: item,
        ConditionExpression: 'attribute_not_exists(SK)', // idempotente
      })
    );
    logger.info('Legacy customer auto-provisioned', { clientId, customerId: claims.sub });
  } catch (error: unknown) {
    // Si ya existe, el ConditionExpression falla: es el caso esperado, no es error.
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return;
    }
    // Cualquier otro error se propaga para que el handler lo registre.
    throw error;
  }
}
