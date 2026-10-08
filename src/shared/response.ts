import { APIGatewayProxyResultV2 } from 'aws-lambda';

const defaultHeaders: Record<string, string> = {
  'Content-Type': 'application/json',
};

export function success(body: unknown, statusCode = 200): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: defaultHeaders,
    body: JSON.stringify(body),
  };
}

export function created(body: unknown): APIGatewayProxyResultV2 {
  return success(body, 201);
}

export function noContent(): APIGatewayProxyResultV2 {
  return { statusCode: 204 };
}

/**
 * Formato de error estándar (Apigee/Google): objeto `error` anidado con
 * - code: código estable legible por máquina (p. ej. BAD_REQUEST, NOT_FOUND).
 * - message: mensaje humano.
 * - status: código HTTP.
 *
 * ```json
 * { "error": { "code": "NOT_FOUND", "message": "Device X not found", "status": 404 } }
 * ```
 */
function errorResponse(
  statusCode: number,
  defaultCode: string,
  message: string,
  code?: string
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: defaultHeaders,
    body: JSON.stringify({
      error: { code: code ?? defaultCode, message, status: statusCode },
    }),
  };
}

export function badRequest(message: string, code?: string): APIGatewayProxyResultV2 {
  return errorResponse(400, 'BAD_REQUEST', message, code);
}

export function unauthorized(message = 'Unauthorized', code?: string): APIGatewayProxyResultV2 {
  return errorResponse(401, 'UNAUTHORIZED', message, code);
}

export function forbidden(message = 'Forbidden', code?: string): APIGatewayProxyResultV2 {
  return errorResponse(403, 'FORBIDDEN', message, code);
}

export function notFound(message = 'Resource not found', code?: string): APIGatewayProxyResultV2 {
  return errorResponse(404, 'NOT_FOUND', message, code);
}

export function serverError(message = 'Internal server error', code?: string): APIGatewayProxyResultV2 {
  return errorResponse(500, 'INTERNAL_ERROR', message, code);
}
