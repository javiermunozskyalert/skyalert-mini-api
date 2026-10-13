import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './dynamo';
import { UserClaims } from './auth';
import { logger } from './logger';
import { fetchLegacyCustomer } from './legacy-client';

const CLIENTS_TABLE = process.env.CLIENTS_TABLE ?? process.env.TABLE_NAME!;

/**
 * Error lanzado cuando, en producción, no se puede resolver el customer contra
 * el backend legacy (not-found o fallo de comunicación). Bloquea el alta en vez
 * de crear un registro potencialmente huérfano.
 */
export class LegacyCustomerUnavailableError extends Error {
  readonly code = 'LEGACY_CUSTOMER_UNAVAILABLE';
  constructor(
    readonly reason: 'not-found' | 'error',
    readonly customerId: string
  ) {
    super(
      reason === 'not-found'
        ? `Legacy customer ${customerId} not found; auto-provisioning blocked`
        : `Legacy customer ${customerId} could not be resolved from legacy; auto-provisioning blocked`
    );
    this.name = 'LegacyCustomerUnavailableError';
  }
}

/**
 * Auto-provisioning de usuarios que llegan desde la app legacy.
 *
 * Se ejecuta cuando un Customer legacy entra (login SSO validado desde este
 * lado, en el primer request autenticado). Lógica:
 *
 *   1. Si el customer YA existe en mini-api → no-op.
 *   2. Si NO existe → se consulta su perfil al legacy (GET /customers/:id):
 *        - 'ok'        → se guarda con name + email.
 *        - 'no-data'   → se guarda con datos mínimos (tenemos el customerId del token).
 *        - 'not-found' → PROD: se bloquea (error). Otros ambientes: datos mínimos.
 *        - 'error'     → PROD: se bloquea (error). Otros ambientes: datos mínimos.
 *
 * El customerId siempre está disponible (viene del `sub` del token ya validado),
 * por eso 'no-data' nunca bloquea: podemos registrar el mínimo. El bloqueo en
 * producción aplica solo cuando el legacy no reconoce al customer (not-found,
 * que con este endpoint significa que el Customer fue borrado en el legacy) o
 * no se puede contactar (error).
 *
 * Idempotente: PutCommand con ConditionExpression attribute_not_exists(SK).
 *
 * clientId = "legacy#<customerId>" | PK = 'CLIENT' | SK = 'CLIENT#legacy#<customerId>'
 *
 * @param claims   Claims del token ya validado por el authorizer.
 * @param rawToken JWT crudo del customer para consultar el legacy. Sin él, se
 *                 omite el lookup y se guardan datos mínimos (no-prod).
 */
export async function ensureLegacyCustomerProvisioned(
  claims: UserClaims,
  rawToken?: string
): Promise<void> {
  const clientId = claims.clientId;
  if (!clientId || !clientId.startsWith('legacy#')) {
    return;
  }

  const sk = `CLIENT#${clientId}`;

  // 1. ¿Ya existe? → no-op.
  const existing = await docClient.send(
    new GetCommand({
      TableName: CLIENTS_TABLE,
      Key: { PK: 'CLIENT', SK: sk },
      ProjectionExpression: 'SK',
    })
  );
  if (existing.Item) {
    return;
  }

  const isProduction = process.env.ENV_NAME === 'production';

  // 2. No existe → resolver contra el legacy.
  let profile: { name?: string; email?: string } | undefined;
  if (rawToken) {
    const result = await fetchLegacyCustomer(claims.sub, rawToken);

    switch (result.status) {
      case 'ok':
        profile = result.profile;
        break;
      case 'no-data':
        // Respondió bien pero sin name/email → mínimos (tenemos customerId).
        break;
      case 'not-found':
      case 'error':
        // En producción, bloquear; en el resto, continuar con mínimos.
        if (isProduction) {
          throw new LegacyCustomerUnavailableError(result.status, claims.sub);
        }
        break;
    }
  } else if (isProduction) {
    // En prod no debemos provisionar sin haber podido validar contra legacy.
    throw new LegacyCustomerUnavailableError('error', claims.sub);
  }

  const now = new Date().toISOString();
  const item: Record<string, unknown> = {
    PK: 'CLIENT',
    SK: sk,
    clientId,
    source: 'legacy',
    status: 'active',
    createdVia: 'auto',
    createdAt: now,
    updatedAt: now,
    createdBy: claims.sub,
  };
  if (profile?.name) item.name = profile.name;
  if (profile?.email) item.email = profile.email;

  try {
    await docClient.send(
      new PutCommand({
        TableName: CLIENTS_TABLE,
        Item: item,
        ConditionExpression: 'attribute_not_exists(SK)', // idempotente
      })
    );
    logger.info('Legacy customer auto-provisioned', {
      clientId,
      customerId: claims.sub,
      enriched: Boolean(profile?.name || profile?.email),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return;
    }
    throw error;
  }
}
