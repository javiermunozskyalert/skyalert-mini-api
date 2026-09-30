import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { UserClaims, isAdmin } from '../../../shared/auth';
import { created, badRequest, forbidden, serverError } from '../../../shared/response';
import { cognitoClient, USER_POOL_ID } from '../../../shared/cognito';
import { logger } from '../../../shared/logger';
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  role: z.enum(['admin', 'internal', 'client', 'collaborator']),
  clientId: z.string().optional(),
});

/**
 * Crea un usuario en Cognito con AdminCreateUser y lo asigna a un grupo (rol).
 * Cognito genera una password temporal y envía un email (vía SES) con las credenciales.
 * El usuario deberá cambiar la contraseña en el primer login (NEW_PASSWORD_REQUIRED).
 */
export async function createUser(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: UserClaims
): Promise<APIGatewayProxyResultV2> {
  if (!isAdmin(claims)) {
    return forbidden('Only admin users can create users');
  }

  const body = JSON.parse(event.body ?? '{}');
  const validation = CreateUserSchema.safeParse(body);

  if (!validation.success) {
    return badRequest(validation.error.issues.map((i) => i.message).join(', '));
  }

  const { email, name, role, clientId } = validation.data;

  // Los roles client y collaborator deben estar vinculados a un clientId
  if ((role === 'client' || role === 'collaborator') && !clientId) {
    return badRequest(`clientId is required for users with role "${role}"`);
  }

  try {
    const result = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: name },
          ...(clientId ? [{ Name: 'custom:clientId', Value: clientId }] : []),
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      })
    );

    // Asignar el rol vía Cognito Group
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        GroupName: role,
      })
    );

    logger.info('User created and assigned to group', {
      email,
      role,
      createdBy: claims.sub,
    });

    return created({
      username: result.User?.Username,
      email,
      name,
      role,
      clientId,
      status: result.User?.UserStatus,
    });
  } catch (error: unknown) {
    if (error instanceof UsernameExistsException) {
      return badRequest(`User with email ${email} already exists`);
    }
    logger.error('Failed to create user', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError('Failed to create user');
  }
}
