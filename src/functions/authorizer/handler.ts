import {
  APIGatewayRequestSimpleAuthorizerHandlerV2WithContext,
  APIGatewaySimpleAuthorizerWithContextResult,
} from 'aws-lambda';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { logger } from '../../shared/logger';
import type { AuthorizerContext } from '../../shared/auth';

/**
 * Lambda Authorizer dual para el HTTP API.
 *
 *  - Web (dashboard):  Authorization: Bearer <JWT de Cognito>  → validado con JWKS.
 *  - App (legacy iOS): Authorization: JWT <JWT HS256 del backend legacy> → validado
 *    con el secreto compartido (SSM) e issuer "api.v3.skyalert".
 *
 * Los usuarios que llegan desde la app legacy SIEMPRE son rol de usuario final
 * ("client"), nunca admin/internal. Además, cada usuario de la app es su propio
 * tenant: clientId = "legacy#<sub>".
 */

const COGNITO_ISSUER = process.env.COGNITO_ISSUER!;
const LEGACY_ISSUER = process.env.LEGACY_ISSUER!;
const LEGACY_JWT_SECRET_PARAM = process.env.LEGACY_JWT_SECRET_PARAM!;

const ssm = new SSMClient({});
const cognitoJWKS = createRemoteJWKSet(
  new URL(`${COGNITO_ISSUER}/.well-known/jwks.json`)
);

/** Cache del secreto entre invocaciones calientes (evita ir a SSM cada request). */
let cachedSecret: string | undefined;

/** Contexto vacío para respuestas denegadas (el tipo exige context presente). */
const EMPTY_CONTEXT: AuthorizerContext = {
  source: 'legacy',
  sub: '',
  email: '',
  role: '',
  clientId: '',
};

const DENY: APIGatewaySimpleAuthorizerWithContextResult<AuthorizerContext> = {
  isAuthorized: false,
  context: EMPTY_CONTEXT,
};

async function getLegacySecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const res = await ssm.send(
    new GetParameterCommand({ Name: LEGACY_JWT_SECRET_PARAM, WithDecryption: true })
  );
  cachedSecret = res.Parameter?.Value ?? '';
  return cachedSecret;
}

interface LegacyPayload {
  sub: string;
  kind?: string;
  tokenType?: string;
}

export const handler: APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<
  AuthorizerContext
> = async (event) => {
  const raw =
    event.headers?.authorization ?? event.headers?.Authorization ?? '';
  const [scheme, token] = raw.split(/\s+/);

  if (!scheme || !token) return DENY;

  try {
    // --- App legacy: esquema literal "JWT" ---
    if (scheme.toLowerCase() === 'jwt') {
      const secret = await getLegacySecret();
      const payload = jwt.verify(token, secret, {
        issuer: LEGACY_ISSUER,
        algorithms: ['HS256'],
      }) as LegacyPayload;

      // Solo access tokens de un Customer
      if (payload.tokenType !== 'access' || payload.kind !== 'Customer') {
        return DENY;
      }

      // Rol forzado por diseño (usuario final) + tenant propio por usuario.
      return {
        isAuthorized: true,
        context: {
          source: 'legacy',
          sub: payload.sub,
          email: '',
          role: 'client',
          clientId: `legacy#${payload.sub}`,
        },
      };
    }

    // --- Web Cognito: esquema "Bearer" ---
    if (scheme.toLowerCase() === 'bearer') {
      const { payload } = await jwtVerify(token, cognitoJWKS, {
        issuer: COGNITO_ISSUER,
      });
      const groups = payload['cognito:groups'];
      return {
        isAuthorized: true,
        context: {
          source: 'cognito',
          sub: String(payload.sub ?? ''),
          email: String(payload.email ?? ''),
          role: Array.isArray(groups) ? groups.join(',') : String(groups ?? ''),
          clientId: String(payload['custom:clientId'] ?? ''),
        },
      };
    }

    return DENY;
  } catch (error) {
    logger.warn('Authorization failed', {
      scheme,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return DENY;
  }
};
