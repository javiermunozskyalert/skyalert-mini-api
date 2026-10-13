import { describe, it, expect } from 'vitest';
import { stripVersionPrefix, extractAuthToken } from '../../src/shared/http';

describe('stripVersionPrefix', () => {
  it('removes /v1 prefix', () => {
    expect(stripVersionPrefix('/v1/devices')).toBe('/devices');
  });
  it('removes /v1 prefix keeping subpaths', () => {
    expect(stripVersionPrefix('/v1/devices/lookup/ska-L0z4AD')).toBe('/devices/lookup/ska-L0z4AD');
  });
  it('handles history-events', () => {
    expect(stripVersionPrefix('/v1/history-events')).toBe('/history-events');
  });
  it('removes other version numbers (/v2)', () => {
    expect(stripVersionPrefix('/v2/users')).toBe('/users');
  });
  it('leaves path without version unchanged', () => {
    expect(stripVersionPrefix('/devices')).toBe('/devices');
  });
  it('does not strip a non-version segment that starts with v', () => {
    expect(stripVersionPrefix('/version/devices')).toBe('/version/devices');
  });
});

describe('extractAuthToken', () => {
  it('extracts the token from a "JWT <token>" header (legacy app)', () => {
    expect(extractAuthToken({ authorization: 'JWT abc.def.ghi' })).toBe('abc.def.ghi');
  });
  it('extracts the token from a "Bearer <token>" header (web Cognito)', () => {
    expect(extractAuthToken({ authorization: 'Bearer xyz.123' })).toBe('xyz.123');
  });
  it('supports the capitalized Authorization key', () => {
    expect(extractAuthToken({ Authorization: 'JWT tok' })).toBe('tok');
  });
  it('returns undefined when there is no header', () => {
    expect(extractAuthToken(undefined)).toBeUndefined();
    expect(extractAuthToken({})).toBeUndefined();
  });
  it('returns undefined when the header has no token part', () => {
    expect(extractAuthToken({ authorization: 'JWT' })).toBeUndefined();
  });
});
