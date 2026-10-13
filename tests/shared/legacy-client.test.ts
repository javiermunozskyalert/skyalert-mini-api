import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchLegacyCustomer } from '../../src/shared/legacy-client';

const SUB = '6a2860238939e01774d18fda';
const JWT = 'header.payload.signature';
const BASE = 'https://clients-api.develop.skyalert.mx';

function mockFetchOnce(response: {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
}) {
  const status = response.status ?? 200;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok ?? (status >= 200 && status < 300),
    status,
    json: response.json ?? (async () => ({})),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('fetchLegacyCustomer', () => {
  beforeEach(() => {
    process.env.LEGACY_API_URL = BASE;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.LEGACY_API_URL;
  });

  it('returns ok + builds full name from first/pLast and maps email.address', async () => {
    const fetchMock = mockFetchOnce({
      json: async () => ({
        name: { first: 'Francisco', pLast: 'Santiago' },
        email: { address: 'javier.munoz@skyalert.mx', verified: false },
      }),
    });

    const result = await fetchLegacyCustomer(SUB, JWT);

    expect(result).toEqual({
      status: 'ok',
      profile: { name: 'Francisco Santiago', email: 'javier.munoz@skyalert.mx' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/customers/${SUB}`,
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: `JWT ${JWT}` },
      })
    );
  });

  it('includes mLast when present (first + pLast + mLast)', async () => {
    mockFetchOnce({
      json: async () => ({ name: { first: 'Ana', pLast: 'López', mLast: 'Ruiz' } }),
    });
    expect(await fetchLegacyCustomer(SUB, JWT)).toEqual({
      status: 'ok',
      profile: { name: 'Ana López Ruiz' },
    });
  });

  it('ignores the non-serialized virtual name.full and uses the parts', async () => {
    // Aunque llegara un `full`, el mapeo se basa en las partes reales.
    mockFetchOnce({
      json: async () => ({ name: { first: 'Solo', full: 'IGNORED' } }),
    });
    expect(await fetchLegacyCustomer(SUB, JWT)).toEqual({
      status: 'ok',
      profile: { name: 'Solo' },
    });
  });

  it('does NOT expose sensitive fields', async () => {
    mockFetchOnce({
      json: async () => ({
        name: { first: 'Francisco', pLast: 'Santiago' },
        email: { address: 'javier.munoz@skyalert.mx', token: 'SENSITIVE_EMAIL_TOKEN' },
        recoveryToken: 'SENSITIVE_RECOVERY_TOKEN',
        googleId: '117957520512901566377',
      }),
    });

    const result = await fetchLegacyCustomer(SUB, JWT);

    expect(result).toEqual({
      status: 'ok',
      profile: { name: 'Francisco Santiago', email: 'javier.munoz@skyalert.mx' },
    });
    expect(JSON.stringify(result)).not.toContain('SENSITIVE');
    expect(JSON.stringify(result)).not.toContain('googleId');
  });

  it('returns not-found on HTTP 404', async () => {
    mockFetchOnce({ status: 404 });
    expect(await fetchLegacyCustomer(SUB, JWT)).toEqual({ status: 'not-found' });
  });

  it('returns error on non-OK status other than 404 (e.g. 401/500)', async () => {
    mockFetchOnce({ status: 401 });
    expect(await fetchLegacyCustomer(SUB, JWT)).toEqual({ status: 'error' });
  });

  it('returns error when fetch throws (network/timeout)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchLegacyCustomer(SUB, JWT)).toEqual({ status: 'error' });
  });

  it('returns no-data when response OK but no name/email', async () => {
    mockFetchOnce({ json: async () => ({ _id: SUB, roles: ['app'] }) });
    expect(await fetchLegacyCustomer(SUB, JWT)).toEqual({ status: 'no-data' });
  });

  it('returns error when LEGACY_API_URL is not configured', async () => {
    delete process.env.LEGACY_API_URL;
    const fetchMock = mockFetchOnce({ json: async () => ({ name: { full: 'X' } }) });
    expect(await fetchLegacyCustomer(SUB, JWT)).toEqual({ status: 'error' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns ok with partial profile when only email is present', async () => {
    mockFetchOnce({ json: async () => ({ email: { address: 'a@b.com' } }) });
    expect(await fetchLegacyCustomer(SUB, JWT)).toEqual({
      status: 'ok',
      profile: { email: 'a@b.com' },
    });
  });
});
