/**
 * Script de prueba LOCAL para simular el token que emitirá el backend legacy,
 * mientras el equipo de app aún no implementa.
 *
 * Lee el secreto HS256 desde SSM (/skyalert-mini-api/staging/jwt.secretOrKey),
 * firma un JWT con los MISMOS claims que produce el legacy, y lo imprime listo
 * para usar con el header:  Authorization: JWT <token>
 *
 * Uso:
 *   pnpm exec ts-node scripts/gen-legacy-token.ts <customerId>
 *   (con el perfil AWS staging-mini activo, ej. set AWS_PROFILE=staging-mini)
 *
 * NOTA: este script NO va a producción; es solo para pruebas manuales.
 */
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import jwt from 'jsonwebtoken';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const PARAM = process.env.SECRET_PARAM ?? '/skyalert-mini-api/staging/jwt.secretOrKey';
const ISSUER = 'api.v3.skyalert';

async function main(): Promise<void> {
  const customerId = process.argv[2] ?? '507f1f77bcf86cd799439011'; // ObjectId de ejemplo

  const ssm = new SSMClient({ region: REGION });
  const res = await ssm.send(
    new GetParameterCommand({ Name: PARAM, WithDecryption: true })
  );
  const secret = res.Parameter?.Value;
  if (!secret) throw new Error(`No se pudo leer el secreto de ${PARAM}`);

  // Mismos claims que _getJWTClaims + getJwtToken del legacy
  const token = jwt.sign(
    {
      sub: customerId,
      kind: 'Customer',
      tokenType: 'access',
    },
    secret,
    { issuer: ISSUER, algorithm: 'HS256', expiresIn: '1h' }
  );

  // No imprimimos el secreto, solo el token
  console.log('\n=== JWT de prueba (legacy) ===');
  console.log(token);
  console.log('\n=== Header para la request ===');
  console.log(`Authorization: JWT ${token}`);
  console.log(`\n(customerId=${customerId} -> clientId esperado: legacy#${customerId})\n`);
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
