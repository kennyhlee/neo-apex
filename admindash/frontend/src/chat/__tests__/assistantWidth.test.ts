// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CSS_VAR,
  MAX_ASSISTANT_W,
  MIN_ASSISTANT_W,
  applyAssistantWidth,
  clampAssistantWidth,
  loadAssistantWidth,
  restoreAssistantWidth,
  saveAssistantWidth,
  widthFromPointer,
} from '../assistantWidth.ts';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const WIDE = 1600;

describe('clampAssistantWidth', () => {
  it('leaves a sensible width alone', () => {
    expect(clampAssistantWidth(480, WIDE)).toBe(480);
  });

  it('holds the floor and the ceiling', () => {
    expect(clampAssistantWidth(10, WIDE)).toBe(MIN_ASSISTANT_W);
    expect(clampAssistantWidth(5000, WIDE)).toBe(MAX_ASSISTANT_W);
  });

  it('always leaves some page showing', () => {
    // On a 900px window the absolute cap is not the binding constraint —
    // leaving content visible is.
    expect(clampAssistantWidth(5000, 900)).toBeLessThan(900);
    expect(clampAssistantWidth(5000, 900)).toBeLessThan(MAX_ASSISTANT_W);
  });

  it('never returns less than the minimum, even on a tiny window', () => {
    // Where "leave content visible" and "be usable" conflict, usable wins;
    // a viewport this small is full-width by media query anyway.
    expect(clampAssistantWidth(500, 400)).toBe(MIN_ASSISTANT_W);
    expect(clampAssistantWidth(10, 400)).toBe(MIN_ASSISTANT_W);
  });

  it('returns whole pixels', () => {
    expect(Number.isInteger(clampAssistantWidth(480.6, WIDE))).toBe(true);
  });

  it('survives a nonsense number', () => {
    expect(clampAssistantWidth(Number.NaN, WIDE)).toBe(MIN_ASSISTANT_W);
    expect(clampAssistantWidth(Number.POSITIVE_INFINITY, WIDE)).toBe(MIN_ASSISTANT_W);
  });
});

describe('widthFromPointer', () => {
  it('measures from the pointer to the right edge', () => {
    // The drawer is pinned right, so dragging left widens it.
    expect(widthFromPointer(1100, WIDE)).toBe(500);
    expect(widthFromPointer(1000, WIDE)).toBe(600);
  });

  it('clamps like everything else', () => {
    expect(widthFromPointer(WIDE - 10, WIDE)).toBe(MIN_ASSISTANT_W);
    expect(widthFromPointer(0, WIDE)).toBe(MAX_ASSISTANT_W);
    // Dragging past the right edge does not invert the panel.
    expect(widthFromPointer(WIDE + 200, WIDE)).toBe(MIN_ASSISTANT_W);
  });
});

describe('remembering', () => {
  it('round-trips a width', () => {
    saveAssistantWidth(512);
    expect(loadAssistantWidth()).toBe(512);
  });

  it('reports nothing stored as null, not as a default', () => {
    expect(loadAssistantWidth()).toBeNull();
  });

  it('treats junk as absent rather than repairing it', () => {
    for (const junk of ['', 'wide', '-40', '0', 'NaN']) {
      localStorage.setItem('assistantWidth', junk);
      expect(loadAssistantWidth()).toBeNull();
    }
  });
});

describe('restoreAssistantWidth', () => {
  it('sets the custom property both fixed elements read', () => {
    const root = document.createElement('div');
    saveAssistantWidth(520);
    expect(restoreAssistantWidth(root, WIDE)).toBe(520);
    expect(root.style.getPropertyValue(CSS_VAR)).toBe('520px');
  });

  // A width saved on a wide display must not cover a narrow one entirely.
  it('re-clamps a remembered width to the current window', () => {
    saveAssistantWidth(860);
    const root = document.createElement('div');
    const applied = restoreAssistantWidth(root, 900);
    expect(applied).toBeLessThan(860);
    expect(root.style.getPropertyValue(CSS_VAR)).toBe(`${applied}px`);
  });

  // Nothing stored must leave the stylesheet's own default in charge, rather
  // than this module inventing one.
  it('sets no property at all when nothing is remembered', () => {
    const root = document.createElement('div');
    expect(restoreAssistantWidth(root, WIDE)).toBeNull();
    expect(root.style.getPropertyValue(CSS_VAR)).toBe('');
  });

  it('applyAssistantWidth writes whole pixels', () => {
    const root = document.createElement('div');
    applyAssistantWidth(480.7, root);
    expect(root.style.getPropertyValue(CSS_VAR)).toBe('481px');
  });
});
