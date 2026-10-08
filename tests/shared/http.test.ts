import { describe, it, expect } from 'vitest';
import { stripVersionPrefix } from '../../src/shared/http';

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
