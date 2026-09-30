import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, badRequest, forbidden, notFound, serverError } from '../../../shared/response';
import { cognitoClient, USER_POOL_ID } from '../../../shared/cognito';
import { logger } from '../../../shared/logger';
import { z } from 'zod';

const SetStatusSchema = z.object({
  action: z.enum(['enable', 'disable']),
});

/**
 * Bloquea (disable) o desbloquea (enable) un usuario. Solo admins.
 * Un admin no puede bloquearse a sí mismo.
 */
export async function setUserStatus(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  if (!isAdmin(claims)) {
    return forbidden('Only admin users can enable/disable users');
  }

  const username = event.pathParameters?.proxy ?? '';
  const body = JSON.parse(event.body ?? '{}');
  const validation = SetStatusSchema.safeParse(body);

  if (!validation.success) {
    return badRequest(validation.error.issues.map((i) => i.message).join(', '));
  }

  const { action } = validation.data;

  // Prevenir que un admin se bloquee a sí mismo
  if (action === 'disable' && (username === claims.sub || username === claims.email)) {
    return badRequest('You cannot disable your own account');
  }

  try {
    const command =
      action === 'enable'
        ? new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
        : new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username });

    await cognitoClient.send(command);

    logger.info('User status changed', { username, action, changedBy: claims.sub });
    return success({ username, action, enabled: action === 'enable' });
  } catch (error: unknown) {
    if (error instanceof UserNotFoundException) {
      return notFound(`User ${username} not found`);
    }
    logger.error('Failed to change user status', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to change user status');
  }
}
