import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { UserClaims } from '../../src/shared/auth';
import type { LegacyLookupResult } from '../../src/shared/legacy-client';

// --- Mocks de dependencias ---
const sendMock = vi.fn();
vi.mock('../../src/shared/dynamo', () => ({
  docClient: { send: (...args: unknown[]) => sendMock(...args) },
}));

const fetchLegacyCustomerMock = vi.fn();
vi.mock('../../src/shared/legacy-client', () => ({
  fetchLegacyCustomer: (...args: unknown[]) => fetchLegacyCustomerMock(...args),
}));

import {
  ensureLegacyCustomerProvisioned,
  LegacyCustomerUnavailableError,
} from '../../src/shared/provisioning';

const RAW_TOKEN = 'header.payload.signature';
const SUB = '6a2860238939e01774d18fda';

function legacyClaims(): UserClaims {
  return { sub: SUB, email: '', groups: ['client'], clientId: `legacy#${SUB}` };
}

function lastPutItem(): Record<string, unknown> | undefined {
  const call = sendMock.mock.calls.find(([cmd]) => cmd instanceof PutCommand);
  return call ? (call[0].input.Item as Record<string, unknown>) : undefined;
}

function lookup(result: LegacyLookupResult) {
  fetchLegacyCustomerMock.mockResolvedValueOnce(result);
}

describe('ensureLegacyCustomerProvisioned', () => {
  beforeEach(() => {
    sendMock.mockReset();
    fetchLegacyCustomerMock.mockReset();
    process.env.CLIENTS_TABLE = 'clients-table';
    delete process.env.ENV_NAME; // default: no-prod
  });

  afterEach(() => {
    delete process.env.ENV_NAME;
  });

  it('is a no-op for non-legacy users', async () => {
    const claims: UserClaims = { sub: 'x', email: 'a@b.com', groups: ['admin'], clientId: 'uuid-123' };
    await ensureLegacyCustomerProvisioned(claims, RAW_TOKEN);
    expect(sendMock).not.toHaveBeenCalled();
    expect(fetchLegacyCustomerMock).not.toHaveBeenCalled();
  });

  it('is a no-op when the customer already exists', async () => {
    sendMock.mockResolvedValueOnce({ Item: { SK: `CLIENT#legacy#${SUB}` } });
    await ensureLegacyCustomerProvisioned(legacyClaims(), RAW_TOKEN);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(fetchLegacyCustomerMock).not.toHaveBeenCalled();
  });

  it('saves name/email when legacy returns ok', async () => {
    sendMock.mockResolvedValueOnce({}); // Get: no existe
    lookup({ status: 'ok', profile: { name: 'Francisco Santiago', email: 'javier.munoz@skyalert.mx' } });
    sendMock.mockResolvedValueOnce({}); // Put OK

    await ensureLegacyCustomerProvisioned(legacyClaims(), RAW_TOKEN);

    expect(fetchLegacyCustomerMock).toHaveBeenCalledWith(SUB, RAW_TOKEN);
    expect(lastPutItem()).toMatchObject({
      SK: `CLIENT#legacy#${SUB}`,
      name: 'Francisco Santiago',
      email: 'javier.munoz@skyalert.mx',
    });
  });

  it('saves minimal (customerId only) when legacy returns no-data (any env)', async () => {
    process.env.ENV_NAME = 'production'; // incluso en prod, no-data NO bloquea
    sendMock.mockResolvedValueOnce({});
    lookup({ status: 'no-data' });
    sendMock.mockResolvedValueOnce({});

    await ensureLegacyCustomerProvisioned(legacyClaims(), RAW_TOKEN);

    const item = lastPutItem();
    expect(item).toMatchObject({ clientId: `legacy#${SUB}`, source: 'legacy' });
    expect(item).not.toHaveProperty('name');
    expect(item).not.toHaveProperty('email');
  });

  // --- Política por ambiente: not-found / error ---

  it('NON-PROD: saves minimal when legacy returns not-found', async () => {
    process.env.ENV_NAME = 'staging';
    sendMock.mockResolvedValueOnce({});
    lookup({ status: 'not-found' });
    sendMock.mockResolvedValueOnce({});

    await ensureLegacyCustomerProvisioned(legacyClaims(), RAW_TOKEN);

    expect(lastPutItem()).toMatchObject({ clientId: `legacy#${SUB}` });
  });

  it('NON-PROD: saves minimal when legacy returns error', async () => {
    process.env.ENV_NAME = 'staging';
    sendMock.mockResolvedValueOnce({});
    lookup({ status: 'error' });
    sendMock.mockResolvedValueOnce({});

    await ensureLegacyCustomerProvisioned(legacyClaims(), RAW_TOKEN);

    expect(lastPutItem()).toMatchObject({ clientId: `legacy#${SUB}` });
  });

  it('PROD: blocks (throws) when legacy returns not-found', async () => {
    process.env.ENV_NAME = 'production';
    sendMock.mockResolvedValueOnce({}); // Get: no existe
    lookup({ status: 'not-found' });

    await expect(
      ensureLegacyCustomerProvisioned(legacyClaims(), RAW_TOKEN)
    ).rejects.toBeInstanceOf(LegacyCustomerUnavailableError);

    // No se intentó persistir nada
    expect(sendMock.mock.calls.some(([c]) => c instanceof PutCommand)).toBe(false);
  });

  it('PROD: blocks (throws) when legacy returns error', async () => {
    process.env.ENV_NAME = 'production';
    sendMock.mockResolvedValueOnce({});
    lookup({ status: 'error' });

    await expect(
      ensureLegacyCustomerProvisioned(legacyClaims(), RAW_TOKEN)
    ).rejects.toMatchObject({ code: 'LEGACY_CUSTOMER_UNAVAILABLE', reason: 'error' });
    expect(sendMock.mock.calls.some(([c]) => c instanceof PutCommand)).toBe(false);
  });

  it('PROD: blocks when no rawToken is available (cannot validate against legacy)', async () => {
    process.env.ENV_NAME = 'production';
    sendMock.mockResolvedValueOnce({});

    await expect(
      ensureLegacyCustomerProvisioned(legacyClaims())
    ).rejects.toBeInstanceOf(LegacyCustomerUnavailableError);
    expect(fetchLegacyCustomerMock).not.toHaveBeenCalled();
  });

  it('NON-PROD: saves minimal when no rawToken is available', async () => {
    process.env.ENV_NAME = 'staging';
    sendMock.mockResolvedValueOnce({});
    sendMock.mockResolvedValueOnce({});

    await ensureLegacyCustomerProvisioned(legacyClaims());

    expect(fetchLegacyCustomerMock).not.toHaveBeenCalled();
    expect(lastPutItem()).toMatchObject({ clientId: `legacy#${SUB}` });
  });

  it('swallows ConditionalCheckFailedException (race) without throwing', async () => {
    sendMock.mockResolvedValueOnce({});
    lookup({ status: 'no-data' });
    const condErr = new Error('exists');
    condErr.name = 'ConditionalCheckFailedException';
    sendMock.mockRejectedValueOnce(condErr);

    await expect(
      ensureLegacyCustomerProvisioned(legacyClaims(), RAW_TOKEN)
    ).resolves.toBeUndefined();
  });

  it('propagates unexpected errors from Put', async () => {
    sendMock.mockResolvedValueOnce({});
    lookup({ status: 'no-data' });
    sendMock.mockRejectedValueOnce(new Error('DynamoDB down'));

    await expect(
      ensureLegacyCustomerProvisioned(legacyClaims(), RAW_TOKEN)
    ).rejects.toThrow('DynamoDB down');
  });
});
