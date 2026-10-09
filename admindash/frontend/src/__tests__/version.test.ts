import { describe, expect, it } from 'vitest';
import { releaseLabel } from '../version.ts';

describe('releaseLabel', () => {
  it('turns a release tag into "module vX.Y.Z"', () => {
    expect(releaseLabel('admindash-v0.9.0')).toBe('admindash v0.9.0');
  });
  it('splits only on the first hyphen so prerelease suffixes survive', () => {
    expect(releaseLabel('admindash-v1.0.0-rc.1')).toBe('admindash v1.0.0-rc.1');
  });
  it('labels a local build "dev" when no tag is baked in', () => {
    expect(releaseLabel(undefined)).toBe('admindash dev');
    expect(releaseLabel('')).toBe('admindash dev');
  });
  it('keeps a tag with no module prefix readable', () => {
    expect(releaseLabel('v1')).toBe('admindash v1');
  });
});
