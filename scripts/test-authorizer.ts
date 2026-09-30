/**
 * Prueba LOCAL del Lambda Authorizer sin desplegar.
 * Lee el secreto real de SSM, firma un token legacy y ejecuta el handler
 * simulando el evento de API Gateway (HTTP API, payload v2, simple response).
 *
 * Uso: set AWS_PROFILE=staging-mini && pnpm exec ts-node scripts/test-authorizer.ts
 */
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import jwt from 'jsonwebtoken';

const REGION = 'us-east-1';
const PARAM = '/skyalert-mini-api/staging/jwt.secretOrKey';
const ISSUER = 'api.v3.skyalert';
const CUSTOMER_ID = '507f1f77bcf86cd799439011';

async function run(): Promise<void> {
  // Config de entorno que espera el handler
  process.env.COGNITO_ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/us-east-1_jWSv0ZVCp`;
  process.env.LEGACY_ISSUER = ISSUER;
  process.env.LEGACY_JWT_SECRET_PARAM = PARAM;
  process.env.AWS_REGION = REGION;
  process.env.LOG_LEVEL = 'DEBUG';

  const ssm = new SSMClient({ region: REGION });
  const res = await ssm.send(new GetParameterCommand({ Name: PARAM, WithDecryption: true }));
  const secret = res.Parameter?.Value;
  if (!secret) throw new Error('No se pudo leer el secreto');

  // Import dinámico DESPUÉS de setear las env vars (el handler las lee al cargar)
  const { handler } = await import('../src/functions/authorizer/handler');

  const makeEvent = (authHeader: string): any => ({
    version: '2.0',
    type: 'REQUEST',
    routeArn: 'arn:aws:execute-api:us-east-1:438633446050:abc/$default/GET/devices',
    headers: { authorization: authHeader },
    requestContext: { http: { method: 'GET', path: '/devices' } },
  });

  const cases: Array<[string, string]> = [
    [
      'Token legacy VALIDO',
      'JWT ' + jwt.sign(
        { sub: CUSTOMER_ID, kind: 'Customer', tokenType: 'access' },
        secret, { issuer: ISSUER, algorithm: 'HS256', expiresIn: '1h' }
      ),
    ],
    [
      'tokenType incorrecto (refresh) -> debe DENEGAR',
      'JWT ' + jwt.sign(
        { sub: CUSTOMER_ID, kind: 'Customer', tokenType: 'refresh' },
        secret, { issuer: ISSUER, algorithm: 'HS256', expiresIn: '1h' }
      ),
    ],
    [
      'issuer incorrecto -> debe DENEGAR',
      'JWT ' + jwt.sign(
        { sub: CUSTOMER_ID, kind: 'Customer', tokenType: 'access' },
        secret, { issuer: 'otro-emisor', algorithm: 'HS256', expiresIn: '1h' }
      ),
    ],
    [
      'firma invalida (otro secreto) -> debe DENEGAR',
      'JWT ' + jwt.sign(
        { sub: CUSTOMER_ID, kind: 'Customer', tokenType: 'access' },
        'secreto-equivocado', { issuer: ISSUER, algorithm: 'HS256', expiresIn: '1h' }
      ),
    ],
    ['header ausente -> debe DENEGAR', ''],
  ];

  for (const [label, authHeader] of cases) {
    const result: any = await (handler as any)(makeEvent(authHeader), {} as any, () => {});
    console.log(`\n[${label}]`);
    console.log('  isAuthorized:', result.isAuthorized);
    if (result.isAuthorized) console.log('  context:', JSON.stringify(result.context));
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
