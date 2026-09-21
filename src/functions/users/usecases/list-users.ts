import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  ListUsersCommand,
  UserType,
  AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, forbidden, serverError } from '../../../shared/response';
import { cognitoClient, USER_POOL_ID } from '../../../shared/cognito';
import { logger } from '../../../shared/logger';

function getAttr(attrs: AttributeType[] | undefined, name: string): string | undefined {
  return attrs?.find((a) => a.Name === name)?.Value;
}

function mapUser(user: UserType) {
  return {
    username: user.Username,
    email: getAttr(user.Attributes, 'email'),
    name: getAttr(user.Attributes, 'name'),
    role: getAttr(user.Attributes, 'custom:role'),
    clientId: getAttr(user.Attributes, 'custom:clientId'),
    status: user.UserStatus,
    enabled: user.Enabled,
    createdAt: user.UserCreateDate,
  };
}

/**
 * Lista usuarios del User Pool. Solo admins.
 * Soporta paginación con paginationToken.
 */
export async function listUsers(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  if (!isAdmin(claims)) {
    return forbidden('Only admin users can list users');
  }

  const limit = parseInt(event.queryStringParameters?.limit ?? '20', 10);
  const paginationToken = event.queryStringParameters?.paginationToken;

  try {
    const result = await cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Limit: Math.min(limit, 60),
        PaginationToken: paginationToken,
      })
    );

    return success({
      items: (result.Users ?? []).map(mapUser),
      paginationToken: result.PaginationToken ?? null,
    });
  } catch (error: unknown) {
    logger.error('Failed to list users', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to list users');
  }
}
