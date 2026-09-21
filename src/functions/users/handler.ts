import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { badRequest, serverError } from '../../shared/response';
import { extractClaims } from '../../shared/auth';
import { createUser } from './usecases/create-user';
import { listUsers } from './usecases/list-users';
import { getUser } from './usecases/get-user';
import { updateUserRole } from './usecases/update-user-role';
import { setUserStatus } from './usecases/set-user-status';
import { deleteUser } from './usecases/delete-user';

/**
 * Handler delgado — Users domain.
 * Gestiona usuarios en Cognito (crear, listar, cambiar rol, bloquear, eliminar).
 * Toda la lógica está en usecases/.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const claims = extractClaims(event);

  logger.info('Request received', { method, path, userId: claims.sub });

  try {
    // POST /users
    if (method === 'POST' && path === '/users') {
      return await createUser(event, claims);
    }

    // GET /users
    if (method === 'GET' && path === '/users') {
      return await listUsers(event, claims);
    }

    // GET /users/{username}
    if (method === 'GET' && path.startsWith('/users/')) {
      return await getUser(event, claims);
    }

    // PUT /users/{username}/role
    if (method === 'PUT' && path.endsWith('/role')) {
      return await updateUserRole(event, claims);
    }

    // PUT /users/{username}/status
    if (method === 'PUT' && path.endsWith('/status')) {
      return await setUserStatus(event, claims);
    }

    // DELETE /users/{username}
    if (method === 'DELETE' && path.startsWith('/users/')) {
      return await deleteUser(event, claims);
    }

    return badRequest(`Unsupported route: ${method} ${path}`);
  } catch (error) {
    logger.error('Unhandled error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return serverError();
  }
}
