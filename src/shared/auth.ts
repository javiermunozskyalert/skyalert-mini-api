import { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

/** Roles disponibles, alineados con los Cognito Groups del User Pool. */
export type Role = 'admin' | 'internal' | 'client' | 'collaborator';

export interface UserClaims {
  sub: string;
  email: string;
  /** Grupos de Cognito a los que pertenece el usuario (claim cognito:groups). */
  groups: Role[];
  clientId?: string;
}

/**
 * Extrae claims del JWT ya validado por API Gateway + Cognito Authorizer.
 * No hace validación adicional — API Gateway ya verificó la firma.
 */
export function extractClaims(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): UserClaims {
  const claims = event.requestContext.authorizer.jwt.claims;

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
