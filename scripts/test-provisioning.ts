/**
 * Prueba LOCAL del auto-provisioning + list-devices contra las tablas reales
 * de staging. Simula un nuevo usuario legacy.
 *
 * Uso: set AWS_PROFILE=staging-mini && pnpm exec ts-node scripts/test-provisioning.ts
 */
import { GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const DEVICES_TABLE = 'skyalert-stg-devices';
const CLIENTS_TABLE = 'skyalert-stg-clients';
// customerId de prueba, aislado para no chocar con datos reales
const CUSTOMER_ID = 'test-prov-' + Date.now();
const CLIENT_ID = `legacy#${CUSTOMER_ID}`;

async function run(): Promise<void> {
  process.env.AWS_REGION = 'us-east-1';
  process.env.TABLE_NAME = DEVICES_TABLE;
  process.env.CLIENTS_TABLE = CLIENTS_TABLE;
  process.env.LOG_LEVEL = 'DEBUG';

  const { docClient } = await import('../src/shared/dynamo');
  const { listDevices } = await import('../src/functions/devices/usecases/list-devices');

  const claims = {
    sub: CUSTOMER_ID,
    email: '',
    groups: ['client' as const],
    clientId: CLIENT_ID,
  };

  const event: any = { queryStringParameters: null };

  // 1. Verificar que NO existe antes
  const before = await docClient.send(
    new GetCommand({ TableName: CLIENTS_TABLE, Key: { PK: 'CLIENT', SK: `CLIENT#${CLIENT_ID}` } })
  );
  console.log('1) CLIENT existe antes?', !!before.Item);

  // 2. Primera llamada a list-devices (debe auto-provisionar y devolver 200 vacío)
  const res1: any = await listDevices(event, claims);
  console.log('2) list-devices #1 → status', res1.statusCode, 'body', res1.body);

  // 3. Verificar que AHORA existe el CLIENT
  const after = await docClient.send(
    new GetCommand({ TableName: CLIENTS_TABLE, Key: { PK: 'CLIENT', SK: `CLIENT#${CLIENT_ID}` } })
  );
  console.log('3) CLIENT existe después?', !!after.Item, '→', JSON.stringify(after.Item));

  // 4. Segunda llamada (idempotencia: no debe fallar ni duplicar)
  const res2: any = await listDevices(event, claims);
  console.log('4) list-devices #2 (idempotente) → status', res2.statusCode, 'body', res2.body);

  // 5. Limpieza: borrar el CLIENT de prueba
  await docClient.send(
    new DeleteCommand({ TableName: CLIENTS_TABLE, Key: { PK: 'CLIENT', SK: `CLIENT#${CLIENT_ID}` } })
  );
  console.log('5) CLIENT de prueba eliminado (limpieza)');
}

run().catch((e) => { console.error('ERROR:', e); process.exit(1); });
