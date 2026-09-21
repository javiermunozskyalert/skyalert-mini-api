import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
  AdminUpdateUserAttributesCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { success, badRequest, forbidden, notFound, serverError } from '../../../shared/response';
import { cognitoClient, USER_POOL_ID } from '../../../shared/cognito';
import { logger } from '../../../shared/logger';
import { z } from 'zod';

const UpdateRoleSchema = z.object({
  role: z.enum(['admin', 'internal', 'client', 'collaborator']),
  clientId: z.string().optional(),
});

/**
 * Cambia el rol de un usuario reasignando su Cognito Group. Solo admins.
 * Quita al usuario de todos sus grupos actuales y lo agrega al nuevo.
 */
export async function updateUserRole(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  if (!isAdmin(claims)) {
    return forbidden('Only admin users can change roles');
  }

  const username = event.pathParameters?.proxy?.split('/')[0] ?? '';
  const body = JSON.parse(event.body ?? '{}');
  const validation = UpdateRoleSchema.safeParse(body);

  if (!validation.success) {
    return badRequest(validation.error.issues.map((i) => i.message).join(', '));
  }

  const { role, clientId } = validation.data;

  if ((role === 'client' || role === 'collaborator') && !clientId) {
    return badRequest(`clientId is required for users with role "${role}"`);
  }

  try {
    // Quitar al usuario de todos sus grupos actuales
    const currentGroups = await cognitoClient.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
      })
    );

    for (const group of currentGroups.Groups ?? []) {
      if (group.GroupName) {
        await cognitoClient.send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: USER_POOL_ID,
            Username: username,
            GroupName: group.GroupName,
          })
        );
      }
    }

    // Agregar al nuevo grupo
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: role,
      })
    );

    // Actualizar clientId si aplica
    if (clientId) {
      await cognitoClient.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
          UserAttributes: [{ Name: 'custom:clientId', Value: clientId }],
        })
      );
    }

    logger.info('User role updated', { username, role, updatedBy: claims.sub });
    return success({ username, role, clientId });
  } catch (error: unknown) {
    if (error instanceof UserNotFoundException) {
      return notFound(`User ${username} not found`);
    }
    logger.error('Failed to update user role', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to update user role');
  }
}
