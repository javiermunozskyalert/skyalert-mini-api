import { describe, it, expect } from 'vitest';
import {
  badRequest,
  notFound,
  forbidden,
  unauthorized,
  serverError,
  success,
  created,
  noContent,
} from '../../src/shared/response';

function parse(res: { statusCode: number; body?: string }) {
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}

describe('response error format (Apigee style)', () => {
  it('badRequest uses default code BAD_REQUEST and nests error', () => {
    const { status, body } = parse(badRequest('bad input') as never);
    expect(status).toBe(400);
    expect(body.error).toEqual({ code: 'BAD_REQUEST', message: 'bad input', status: 400 });
  });

  it('allows a custom machine-readable code', () => {
    const { body } = parse(badRequest('Invalid uuid', 'INVALID_UUID') as never);
    expect(body.error.code).toBe('INVALID_UUID');
  });

  it('notFound -> NOT_FOUND / 404', () => {
    const { status, body } = parse(notFound('x not found') as never);
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('forbidden -> FORBIDDEN / 403', () => {
    const { status, body } = parse(forbidden() as never);
    expect(status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('unauthorized -> UNAUTHORIZED / 401', () => {
    const { body } = parse(unauthorized() as never);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('serverError -> INTERNAL_ERROR / 500', () => {
    const { status, body } = parse(serverError() as never);
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('response success format', () => {
  it('success returns 200 with raw body', () => {
    const { status, body } = parse(success({ a: 1 }) as never);
    expect(status).toBe(200);
    expect(body).toEqual({ a: 1 });
  });

  it('created returns 201', () => {
    expect((created({}) as { statusCode: number }).statusCode).toBe(201);
  });

  it('noContent returns 204 without body', () => {
    const res = noContent() as { statusCode: number; body?: string };
    expect(res.statusCode).toBe(204);
    expect(res.body).toBeUndefined();
  });
});
