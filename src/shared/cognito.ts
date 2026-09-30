import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

/**
 * Cliente Cognito inicializado FUERA del handler.
 * Se reutiliza entre invocaciones calientes (optimiza cold starts).
 */
export const cognitoClient = new CognitoIdentityProviderClient({});

export const USER_POOL_ID = process.env.USER_POOL_ID ?? '';
