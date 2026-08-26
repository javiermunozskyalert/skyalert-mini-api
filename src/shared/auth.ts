import { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

export interface UserClaims {
  sub: string;
  email: string;
  role: string;
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
    role: (claims['custom:role'] as string) ?? 'client',
    clientId: claims['custom:clientId'] as string | undefined,
  };
}

export function isAdmin(claims: UserClaims): boolean {
  return claims.role === 'admin' || claims.role === 'internal';
}
