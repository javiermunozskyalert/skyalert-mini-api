import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  UserNotFoundException,
  AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, forbidden, notFound, serverError } from '../../../shared/response';
import { cognitoClient, USER_POOL_ID } from '../../../shared/cognito';
import { logger } from '../../../shared/logger';

function getAttr(attrs: AttributeType[] | undefined, name: string): string | undefined {
  return attrs?.find((a) => a.Name === name)?.Value;
}

/**
 * Obtiene un usuario por username, incluyendo su rol (grupo). Solo admins.
 */
export async function getUser(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  if (!isAdmin(claims)) {
    return forbidden('Only admin users can view user details');
  }

  const username = event.pathParameters?.proxy ?? '';

  try {
    const [user, groups] = await Promise.all([
      cognitoClient.send(
        new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
      ),
      cognitoClient.send(
        new AdminListGroupsForUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
      ),
    ]);

    const role = (groups.Groups ?? [])
      .sort((a, b) => (a.Precedence ?? 99) - (b.Precedence ?? 99))[0]?.GroupName;

    return success({
      username: user.Username,
      email: getAttr(user.UserAttributes, 'email'),
      name: getAttr(user.UserAttributes, 'name'),
      role,
      clientId: getAttr(user.UserAttributes, 'custom:clientId'),
      status: user.UserStatus,
      enabled: user.Enabled,
      createdAt: user.UserCreateDate,
    });
  } catch (error: unknown) {
    if (error instanceof UserNotFoundException) {
      return notFound(`User ${username} not found`);
    }
    logger.error('Failed to get user', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to get user');
  }
}
