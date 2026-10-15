import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserClaims } from '../../src/shared/auth';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

/**
 * Mock del docClient compartido. `send` se resuelve según el comando:
 *  - QueryCommand  → devices del tenant.
 *  - ScanCommand   → activaciones.
 * Cada test define las respuestas vía las colas `queryItems` / `scanItems`.
 */
let queryItems: Record<string, unknown>[] = [];
let scanItems: Record<string, unknown>[] = [];

vi.mock('../../src/shared/dynamo', () => ({
  docClient: {
    send: vi.fn((cmd: { constructor: { name: string } }) => {
      const name = cmd.constructor.name;
      if (name === 'QueryCommand') {
        return Promise.resolve({ Items: queryItems });
      }
      if (name === 'ScanCommand') {
        return Promise.resolve({ Items: scanItems });
      }
      return Promise.resolve({ Items: [] });
    }),
  },
}));

// Importar DESPUÉS del mock para que tome la versión mockeada.
import { listHistoryEvents } from '../../src/functions/history-events/usecases/list-history-events';

const claims: UserClaims = {
  sub: 'user-1',
  email: '',
  groups: ['client'],
  clientId: 'acme-1',
};

const event = {} as APIGatewayProxyEventV2WithJWTAuthorizer;

function parse(res: { statusCode: number; body?: string }) {
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}

beforeEach(() => {
  queryItems = [];
  scanItems = [];
});

describe('listHistoryEvents — seismic fields', () => {
  it('maps coordinates, location, magnitude and startedAt from the activation item', async () => {
    queryItems = [
      { gpsDeviceId: 'abc123', registrationId: 'reg-1', name: 'Device A' },
    ];
    scanItems = [
      {
        notificationId: 'quake_xxx',
        timestamp: 1724673600000,
        impactAt: '2026-08-26T12:00:00Z',
        intensity: 4,
        magnitude: 5,
        startedAt: '2026-08-26T11:59:00Z',
        location: 'Coyuca de Benítez, Gro',
        coordinates: [-100.089, 17.009],
        deviceIds_sent: ['abc123'],
      },
    ];

    const { status, body } = parse((await listHistoryEvents(event, claims)) as never);

    expect(status).toBe(200);
    expect(body.items).toHaveLength(1);
    const ev = body.items[0];
    expect(ev.notificationId).toBe('quake_xxx');
    expect(ev.intensity).toBe(4);
    expect(ev.impactAt).toBe('2026-08-26T12:00:00Z');
    expect(ev.coordinates).toEqual([-100.089, 17.009]);
    expect(ev.location).toBe('Coyuca de Benítez, Gro');
    expect(ev.magnitude).toBe(5);
    expect(ev.startedAt).toBe('2026-08-26T11:59:00Z');
  });

  it('returns null for seismic fields when missing in the item', async () => {
    queryItems = [{ gpsDeviceId: 'abc123', registrationId: 'reg-1', name: 'A' }];
    scanItems = [
      {
        notificationId: 'sim-1',
        timestamp: 1,
        intensity: 1,
        deviceIds_sent: ['abc123'],
      },
    ];

    const { body } = parse((await listHistoryEvents(event, claims)) as never);
    const ev = body.items[0];
    expect(ev.coordinates).toBeNull();
    expect(ev.location).toBeNull();
    expect(ev.magnitude).toBeNull();
    expect(ev.startedAt).toBeNull();
  });

  it('normalizes invalid coordinates to null (wrong length, booleans, non-arrays)', async () => {
    queryItems = [{ gpsDeviceId: 'abc123', registrationId: 'r', name: 'A' }];
    scanItems = [
      { notificationId: 'e1', timestamp: 3, coordinates: [1], deviceIds_sent: ['abc123'] },
      { notificationId: 'e2', timestamp: 2, coordinates: [true, false], deviceIds_sent: ['abc123'] },
      { notificationId: 'e3', timestamp: 1, coordinates: 'nope', deviceIds_sent: ['abc123'] },
    ];

    const { body } = parse((await listHistoryEvents(event, claims)) as never);
    // Orden por timestamp desc: e1, e2, e3
    expect(body.items.map((i: { coordinates: unknown }) => i.coordinates)).toEqual([
      null,
      null,
      null,
    ]);
  });
});
