// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssistantResizeGrip } from '../AssistantResizeGrip.tsx';
import {
  CSS_VAR,
  MAX_ASSISTANT_W,
  MIN_ASSISTANT_W,
  loadAssistantWidth,
} from '../../chat/assistantWidth.ts';

const VIEWPORT = 1600;

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
}

/** jsdom implements no pointer capture; the component calls it on every drag. */
function stubPointerCapture(el: Element) {
  Object.assign(el, {
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => true,
  });
}

const grip = () => screen.getByRole('separator');
const currentWidth = () => document.documentElement.style.getPropertyValue(CSS_VAR);

/** A full drag: press at `from`, move to `to`, release. */
function drag(from: number, to: number) {
  const el = grip();
  stubPointerCapture(el);
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: from });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: to });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: to });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty(CSS_VAR);
  setViewport(VIEWPORT);
});
afterEach(cleanup);

describe('AssistantResizeGrip', () => {
  it('describes itself as a separator with its bounds', () => {
    render(<AssistantResizeGrip />);
    expect(grip().getAttribute('aria-orientation')).toBe('vertical');
    expect(grip().getAttribute('aria-valuemin')).toBe(String(MIN_ASSISTANT_W));
    expect(grip().getAttribute('aria-valuemax')).toBe(String(MAX_ASSISTANT_W));
  });

  // Nothing stored means the stylesheet's default is in charge; the component
  // must not invent a width and stamp it on the document.
  it('sets no width when nothing is remembered', () => {
    render(<AssistantResizeGrip />);
    expect(currentWidth()).toBe('');
    expect(grip().getAttribute('aria-valuenow')).toBeNull();
  });

  it('restores a remembered width on mount', () => {
    localStorage.setItem('assistantWidth', '540');
    render(<AssistantResizeGrip />);
    expect(currentWidth()).toBe('540px');
    expect(grip().getAttribute('aria-valuenow')).toBe('540');
  });

  it('widens as the pointer moves left, and reports it', () => {
    render(<AssistantResizeGrip />);
    drag(VIEWPORT - 380, VIEWPORT - 560);
    expect(currentWidth()).toBe('560px');
    expect(grip().getAttribute('aria-valuenow')).toBe('560');
  });

  it('remembers the width once the drag ends', () => {
    render(<AssistantResizeGrip />);
    drag(VIEWPORT - 380, VIEWPORT - 500);
    expect(loadAssistantWidth()).toBe(500);
  });

  // Writing on every pointermove would be dozens of synchronous localStorage
  // writes per drag.
  it('does not write to storage mid-drag', () => {
    render(<AssistantResizeGrip />);
    const el = grip();
    stubPointerCapture(el);
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: VIEWPORT - 380 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: VIEWPORT - 500 });
    expect(loadAssistantWidth()).toBeNull();
    fireEvent.pointerUp(el, { pointerId: 1, clientX: VIEWPORT - 500 });
    expect(loadAssistantWidth()).toBe(500);
  });

  it('clamps a drag past either limit', () => {
    render(<AssistantResizeGrip />);
    drag(VIEWPORT - 380, VIEWPORT - 20);
    expect(currentWidth()).toBe(`${MIN_ASSISTANT_W}px`);
    drag(VIEWPORT - 380, 0);
    expect(currentWidth()).toBe(`${MAX_ASSISTANT_W}px`);
  });

  it('ignores a move that never started with a press', () => {
    render(<AssistantResizeGrip />);
    fireEvent.pointerMove(grip(), { pointerId: 1, clientX: 400 });
    expect(currentWidth()).toBe('');
  });

  it('ignores a non-primary button', () => {
    render(<AssistantResizeGrip />);
    const el = grip();
    stubPointerCapture(el);
    fireEvent.pointerDown(el, { button: 2, pointerId: 1, clientX: VIEWPORT - 380 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: VIEWPORT - 600 });
    expect(currentWidth()).toBe('');
  });

  // Left widens, because the drawer is pinned to the right edge.
  it('moves on arrow keys, and remembers immediately', () => {
    localStorage.setItem('assistantWidth', '500');
    render(<AssistantResizeGrip />);
    fireEvent.keyDown(grip(), { key: 'ArrowLeft' });
    expect(currentWidth()).toBe('524px');
    expect(loadAssistantWidth()).toBe(524);
    fireEvent.keyDown(grip(), { key: 'ArrowRight' });
    expect(currentWidth()).toBe('500px');
  });

  it('leaves other keys alone', () => {
    localStorage.setItem('assistantWidth', '500');
    render(<AssistantResizeGrip />);
    fireEvent.keyDown(grip(), { key: 'ArrowUp' });
    fireEvent.keyDown(grip(), { key: 'a' });
    expect(currentWidth()).toBe('500px');
  });

  // A width saved on a wide display must not swallow a narrow one.
  it('re-clamps when the window shrinks under it', () => {
    localStorage.setItem('assistantWidth', '860');
    render(<AssistantResizeGrip />);
    expect(currentWidth()).toBe('860px');
    setViewport(900);
    fireEvent(window, new Event('resize'));
    expect(Number.parseInt(currentWidth(), 10)).toBeLessThan(860);
  });

  it('marks the body while dragging, and unmarks it after', () => {
    render(<AssistantResizeGrip />);
    const el = grip();
    stubPointerCapture(el);
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: VIEWPORT - 380 });
    expect(document.body.classList.contains('assistant-resizing')).toBe(true);
    fireEvent.pointerUp(el, { pointerId: 1, clientX: VIEWPORT - 380 });
    expect(document.body.classList.contains('assistant-resizing')).toBe(false);
  });
});
