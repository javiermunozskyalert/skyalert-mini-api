import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AdminDeleteUserCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { noContent, badRequest, forbidden, notFound, serverError } from '../../../shared/response';
import { cognitoClient, USER_POOL_ID } from '../../../shared/cognito';
import { logger } from '../../../shared/logger';

/**
 * Elimina un usuario de Cognito con AdminDeleteUser. Solo admins.
 * Un admin no puede eliminarse a sí mismo.
 */
export async function deleteUser(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  if (!isAdmin(claims)) {
    return forbidden('Only admin users can delete users');
  }

  const username = event.pathParameters?.proxy ?? '';

  if (username === claims.sub || username === claims.email) {
    return badRequest('You cannot delete your own account');
  }

  try {
    await cognitoClient.send(
      new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
      })
    );

    logger.info('User deleted', { username, deletedBy: claims.sub });
    return noContent();
  } catch (error: unknown) {
    if (error instanceof UserNotFoundException) {
      return notFound(`User ${username} not found`);
    }
    logger.error('Failed to delete user', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to delete user');
  }
}
