import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { badRequest, serverError } from '../../shared/response';
import { extractClaims } from '../../shared/auth';
import { listClients } from './usecases/list-clients';
import { createClient } from './usecases/create-client';
import { getClient } from './usecases/get-client';
import { updateClient } from './usecases/update-client';
import { deleteClient } from './usecases/delete-client';

/**
 * Handler delgado — solo rutea por método HTTP y path.
 * Toda la lógica de negocio está en usecases/.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const claims = extractClaims(event);

  logger.info('Request received', { method, path, userId: claims.sub });

  try {
    // POST /clients
    if (method === 'POST' && path === '/clients') {
      return await createClient(event, claims);
    }

    // GET /clients
    if (method === 'GET' && path === '/clients') {
      return await listClients(event, claims);
    }

    // GET /clients/{id}
    if (method === 'GET' && path.startsWith('/clients/')) {
      return await getClient(event, claims);
    }

    // PUT /clients/{id}
    if (method === 'PUT' && path.startsWith('/clients/')) {
      return await updateClient(event, claims);
    }

    // DELETE /clients/{id}
    if (method === 'DELETE' && path.startsWith('/clients/')) {
      return await deleteClient(event, claims);
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
