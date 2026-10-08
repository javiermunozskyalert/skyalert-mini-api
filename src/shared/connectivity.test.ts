import { describe, it, expect } from 'vitest';
import {
  computeConnectivityStatus,
  ACTIVE_THRESHOLD_SECONDS,
  IDLE_THRESHOLD_SECONDS,
} from './connectivity';

/** now fijo para resultados deterministas. */
const NOW = new Date('2026-10-08T18:00:00.000Z');

/** Helper: construye un last_seen_at a N segundos antes de NOW. */
function secondsBefore(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

describe('computeConnectivityStatus', () => {
  it('should return active when last seen less than 120s ago and online', () => {
    const result = computeConnectivityStatus(
      { last_seen_at: secondsBefore(30), connection_status: 'online' },
      NOW
    );
    expect(result.connectivity_status).toBe('active');
    expect(result.last_seen_seconds_ago).toBe(30);
  });

  it('should return active just under the 120s boundary (119s)', () => {
    const result = computeConnectivityStatus(
      { last_seen_at: secondsBefore(119), connection_status: 'online' },
      NOW
    );
    expect(result.connectivity_status).toBe('active');
  });

  it('should return idle exactly at the 120s boundary', () => {
    const result = computeConnectivityStatus(
      { last_seen_at: secondsBefore(ACTIVE_THRESHOLD_SECONDS), connection_status: 'online' },
      NOW
    );
    expect(result.connectivity_status).toBe('idle');
    expect(result.last_seen_seconds_ago).toBe(120);
  });

  it('should return idle just under the 300s boundary (299s)', () => {
    const result = computeConnectivityStatus(
      { last_seen_at: secondsBefore(299), connection_status: 'online' },
      NOW
    );
    expect(result.connectivity_status).toBe('idle');
  });

  it('should return stale exactly at the 300s boundary', () => {
    const result = computeConnectivityStatus(
      { last_seen_at: secondsBefore(IDLE_THRESHOLD_SECONDS), connection_status: 'online' },
      NOW
    );
    expect(result.connectivity_status).toBe('stale');
    expect(result.last_seen_seconds_ago).toBe(300);
  });

  it('should return stale when last seen more than 300s ago', () => {
    const result = computeConnectivityStatus(
      { last_seen_at: secondsBefore(3600), connection_status: 'online' },
      NOW
    );
    expect(result.connectivity_status).toBe('stale');
    expect(result.last_seen_seconds_ago).toBe(3600);
  });

  it('should return disconnected when connection_status is offline (even if recent)', () => {
    const result = computeConnectivityStatus(
      { last_seen_at: secondsBefore(10), connection_status: 'offline' },
      NOW
    );
    expect(result.connectivity_status).toBe('disconnected');
    // Mantiene el seconds_ago aunque esté offline.
    expect(result.last_seen_seconds_ago).toBe(10);
  });

  it('should return disconnected when last_seen_at is absent', () => {
    const result = computeConnectivityStatus(
      { connection_status: 'online' },
      NOW
    );
    expect(result.connectivity_status).toBe('disconnected');
    expect(result.last_seen_seconds_ago).toBeNull();
  });

  it('should return disconnected when last_seen_at is null', () => {
    const result = computeConnectivityStatus(
      { last_seen_at: null, connection_status: 'online' },
      NOW
    );
    expect(result.connectivity_status).toBe('disconnected');
    expect(result.last_seen_seconds_ago).toBeNull();
  });

  it('should return disconnected when last_seen_at is an invalid date string', () => {
    const result = computeConnectivityStatus(
      { last_seen_at: 'not-a-date', connection_status: 'online' },
      NOW
    );
    expect(result.connectivity_status).toBe('disconnected');
    expect(result.last_seen_seconds_ago).toBeNull();
  });

  it('should treat UTC consistently regardless of host timezone', () => {
    // last_seen_at con Z explícito → se interpreta en UTC, no en local.
    const result = computeConnectivityStatus(
      { last_seen_at: '2026-10-08T17:59:00.000Z', connection_status: 'online' },
      NOW
    );
    expect(result.last_seen_seconds_ago).toBe(60);
    expect(result.connectivity_status).toBe('active');
  });

  it('should default now to current time when not provided (smoke)', () => {
    const recent = new Date(Date.now() - 5000).toISOString();
    const result = computeConnectivityStatus({ last_seen_at: recent, connection_status: 'online' });
    expect(result.connectivity_status).toBe('active');
  });
});
