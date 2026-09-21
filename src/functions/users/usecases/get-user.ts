import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AdminGetUserCommand,
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
 * Obtiene un usuario por username. Solo admins.
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
    const result = await cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
      })
    );

    return success({
      username: result.Username,
      email: getAttr(result.UserAttributes, 'email'),
      name: getAttr(result.UserAttributes, 'name'),
      role: getAttr(result.UserAttributes, 'custom:role'),
      clientId: getAttr(result.UserAttributes, 'custom:clientId'),
      status: result.UserStatus,
      enabled: result.Enabled,
      createdAt: result.UserCreateDate,
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
