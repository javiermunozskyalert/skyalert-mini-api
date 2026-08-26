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

export function badRequest(message: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 400,
    headers: defaultHeaders,
    body: JSON.stringify({ error: 'Bad Request', message }),
  };
}

export function unauthorized(message = 'Unauthorized'): APIGatewayProxyResultV2 {
  return {
    statusCode: 401,
    headers: defaultHeaders,
    body: JSON.stringify({ error: 'Unauthorized', message }),
  };
}

export function forbidden(message = 'Forbidden'): APIGatewayProxyResultV2 {
  return {
    statusCode: 403,
    headers: defaultHeaders,
    body: JSON.stringify({ error: 'Forbidden', message }),
  };
}

export function notFound(message = 'Resource not found'): APIGatewayProxyResultV2 {
  return {
    statusCode: 404,
    headers: defaultHeaders,
    body: JSON.stringify({ error: 'Not Found', message }),
  };
}

export function serverError(message = 'Internal server error'): APIGatewayProxyResultV2 {
  return {
    statusCode: 500,
    headers: defaultHeaders,
    body: JSON.stringify({ error: 'Internal Server Error', message }),
  };
}
