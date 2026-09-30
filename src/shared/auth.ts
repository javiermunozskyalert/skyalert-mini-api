import {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyEventV2WithLambdaAuthorizer,
} from 'aws-lambda';

/** Roles disponibles, alineados con los Cognito Groups del User Pool. */
export type Role = 'admin' | 'internal' | 'client' | 'collaborator';

/** Contexto que produce el Lambda Authorizer (src/functions/authorizer). */
export interface AuthorizerContext {
  source: 'cognito' | 'legacy';
  sub: string;
  email: string;
  /** Rol(es) como string separado por comas (ej. "admin,internal" o "client"). */
  role: string;
  clientId: string;
}

export interface UserClaims {
  sub: string;
  email: string;
  /** Grupos/roles del usuario, normalizados a array. */
  groups: Role[];
  clientId?: string;
}

/** Evento con cualquiera de los dos authorizers soportados. */
type AuthEvent =
  | APIGatewayProxyEventV2WithLambdaAuthorizer<AuthorizerContext>
  | APIGatewayProxyEventV2WithJWTAuthorizer;

/**
 * Extrae claims del token ya validado por API Gateway.
 *
 * Soporta dos authorizers:
 *  - Lambda Authorizer (web Cognito + app legacy): datos en authorizer.lambda.
 *  - JWT Authorizer nativo (legado): datos en authorizer.jwt.claims.
 *
 * Regla de seguridad: los tokens de origen "legacy" (app) NUNCA obtienen rol
 * admin/internal — se fuerzan a "client" aquí como defensa en profundidad,
 * independientemente de lo que traiga el contexto.
 */
export function extractClaims(event: AuthEvent): UserClaims {
  const authorizer = event.requestContext.authorizer;

  // Lambda Authorizer → contexto en `lambda`
  if ('lambda' in authorizer && authorizer.lambda) {
    const ctx = authorizer.lambda as AuthorizerContext;
    const isLegacy = ctx.source === 'legacy';
    const roleStr = isLegacy ? 'client' : ctx.role ?? '';

    return {
      sub: ctx.sub,
      email: ctx.email,
      groups: parseGroups(roleStr),
      clientId: ctx.clientId || undefined,
    };
  }

  // JWT Authorizer nativo (compatibilidad)
  const claims = (authorizer as APIGatewayProxyEventV2WithJWTAuthorizer['requestContext']['authorizer']).jwt.claims;

  return {
    sub: claims.sub as string,
    email: claims.email as string,
    groups: parseGroups(claims['cognito:groups']),
    clientId: claims['custom:clientId'] as string | undefined,
  };
}

/**
 * El claim cognito:groups puede llegar como array o como string
 * (dependiendo del serializador de API Gateway). Normalizamos a array.
 */
function parseGroups(raw: unknown): Role[] {
  if (Array.isArray(raw)) {
    return raw as Role[];
  }
  if (typeof raw === 'string') {
    // Formato "[admin internal]" o "admin,internal"
    return raw
      .replace(/[[\]]/g, '')
      .split(/[\s,]+/)
      .filter(Boolean) as Role[];
  }
  return [];
}

export function hasRole(claims: UserClaims, role: Role): boolean {
  return claims.groups.includes(role);
}

/** Admin o internal tienen privilegios de administración. */
export function isAdmin(claims: UserClaims): boolean {
  return claims.groups.includes('admin') || claims.groups.includes('internal');
}
