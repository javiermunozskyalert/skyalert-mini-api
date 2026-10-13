import { describe, it, expect } from 'vitest';
import { handler } from '../../src/functions/me/handler';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

/**
 * Construye un evento mock con el contexto del Lambda Authorizer dual.
 * Replica la forma que produce src/functions/authorizer/handler.ts.
 */
function buildEvent(opts: {
  method?: string;
  rawPath?: string;
  source: 'cognito' | 'legacy';
  sub: string;
  email?: string;
  role?: string;
  clientId?: string;
}): APIGatewayProxyEventV2WithJWTAuthorizer {
  const { method = 'GET', rawPath = '/v1/me', source, sub, email = '', role = '', clientId = '' } = opts;
  return {
    rawPath,
    requestContext: {
      http: { method },
      authorizer: {
        lambda: { source, sub, email, role, clientId },
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function parse(res: { statusCode: number; body?: string }) {
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}

describe('GET /me handler', () => {
  it('returns legacy Customer identity mapped to client', async () => {
    const event = buildEvent({
      source: 'legacy',
      sub: '507f1f77bcf86cd799439011',
      role: 'client',
      clientId: 'legacy#507f1f77bcf86cd799439011',
    });

    const { status, body } = parse((await handler(event)) as never);

    expect(status).toBe(200);
    expect(body).toEqual({
      sub: '507f1f77bcf86cd799439011',
      email: null,
      role: 'client',
      roles: ['client'],
      clientId: 'legacy#507f1f77bcf86cd799439011',
      source: 'legacy',
      isAdmin: false,
    });
  });

  it('returns cognito admin identity with isAdmin true', async () => {
    const event = buildEvent({
      source: 'cognito',
      sub: 'cognito-user-1',
      email: 'admin@skyalert.mx',
      role: 'admin,internal',
      clientId: '',
    });

    const { status, body } = parse((await handler(event)) as never);

    expect(status).toBe(200);
    expect(body.sub).toBe('cognito-user-1');
    expect(body.email).toBe('admin@skyalert.mx');
    expect(body.role).toBe('admin');
    expect(body.roles).toEqual(['admin', 'internal']);
    expect(body.clientId).toBeNull();
    expect(body.source).toBe('cognito');
    expect(body.isAdmin).toBe(true);
  });

  it('forces role to client for legacy even if context says admin (defense in depth)', async () => {
    const event = buildEvent({
      source: 'legacy',
      sub: 'attacker',
      role: 'admin', // malicioso: el handler debe ignorarlo para legacy
      clientId: 'legacy#attacker',
    });

    const { body } = parse((await handler(event)) as never);

    expect(body.role).toBe('client');
    expect(body.roles).toEqual(['client']);
    expect(body.isAdmin).toBe(false);
  });

  it('returns a cognito client (no admin privileges)', async () => {
    const event = buildEvent({
      source: 'cognito',
      sub: 'client-user',
      email: 'user@empresa.com',
      role: 'client',
      clientId: 'acme-123',
    });

    const { body } = parse((await handler(event)) as never);

    expect(body.role).toBe('client');
    expect(body.clientId).toBe('acme-123');
    expect(body.isAdmin).toBe(false);
  });

  it('rejects unsupported route with 400', async () => {
    const event = buildEvent({
      method: 'POST',
      rawPath: '/v1/me',
      source: 'cognito',
      sub: 'x',
    });

    const { status, body } = parse((await handler(event)) as never);

    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});
