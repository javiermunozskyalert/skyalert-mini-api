import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { badRequest, serverError } from '../../shared/response';
import { extractClaims } from '../../shared/auth';

/**
 * Handler delgado — Seismic domain.
 * TODO: Implementar usecases/ cuando se definan los endpoints.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const claims = extractClaims(event);

  logger.info('Request received', { method, path, userId: claims.sub });

  try {
    // TODO: Implementar routing a usecases
    return badRequest(`Seismic: route not implemented yet — ${method} ${path}`);
  } catch (error) {
    logger.error('Unhandled error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return serverError();
  }
}
