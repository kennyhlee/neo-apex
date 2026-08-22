// The drawer's left edge, as a drag handle.
//
// A `separator` rather than a button: it divides the page from the drawer and
// reports where the divide currently is, which is what a screen reader needs
// to make sense of arrow keys moving it. `aria-orientation="vertical"`
// describes the DIVIDER's orientation, not the direction it travels.
//
// Pointer events, not mouse events, so a trackpad, a touch drag and a stylus
// all work from one code path. `setPointerCapture` is what keeps the drag
// alive when the pointer outruns the 6px strip — without it a fast drag
// simply stops.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_ASSISTANT_W,
  MIN_ASSISTANT_W,
  applyAssistantWidth,
  clampAssistantWidth,
  loadAssistantWidth,
  saveAssistantWidth,
  widthFromPointer,
} from '../../chat/assistantWidth.ts';
import { useTranslation } from '../../hooks/useTranslation.ts';

/** How far one arrow-key press moves the edge. */
const KEY_STEP = 24;

export function AssistantResizeGrip() {
  const { t } = useTranslation();
  // Mirrors the CSS custom property so the separator can report its position.
  // Null until something is stored or dragged: the stylesheet's own default
  // is the truth until then, and this component must not overwrite it.
  //
  // Read in a lazy initialiser rather than an effect. Reading storage is not
  // a side effect, and doing it here means the first render already knows the
  // remembered width — an effect would render once at the default and then
  // set state, which is the cascading-render shape the lint rule forbids.
  const [width, setWidth] = useState<number | null>(() => {
    const stored = loadAssistantWidth();
    return stored === null ? null : clampAssistantWidth(stored, window.innerWidth);
  });
  const dragging = useRef(false);

  // WRITING the custom property is a side effect, so it stays in an effect.
  // Mount only: every later change goes through `commit`. The drawer starts
  // off-screen (`translateX(100%)`), so there is nothing to paint early and
  // no need for `useLayoutEffect`.
  useEffect(() => {
    if (width !== null) applyAssistantWidth(width, document.documentElement);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  /** A window narrowed after a wide width was set would otherwise leave the
   * drawer covering everything. */
  useEffect(() => {
    const onResize = () => {
      setWidth((current) => {
        if (current === null) return null;
        const next = clampAssistantWidth(current, window.innerWidth);
        if (next !== current) applyAssistantWidth(next, document.documentElement);
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const commit = useCallback((next: number) => {
    applyAssistantWidth(next, document.documentElement);
    setWidth(next);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Left button / primary contact only — a right-click drag should open a
    // context menu, not resize.
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Suppresses the text-selection I-beam and the drawer's own 0.28s
    // transition, which would otherwise make the edge lag the pointer.
    document.body.classList.add('assistant-resizing');
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      commit(widthFromPointer(e.clientX, window.innerWidth));
    },
    [commit],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      document.body.classList.remove('assistant-resizing');
      // Written once, on release, rather than on every move — a drag fires
      // dozens of pointermove events and localStorage writes are synchronous.
      if (width !== null) saveAssistantWidth(width);
    },
    [width],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.key === 'ArrowLeft' ? KEY_STEP : e.key === 'ArrowRight' ? -KEY_STEP : 0;
      if (step === 0) return;
      e.preventDefault();
      // Left widens, because the drawer is pinned to the right edge and its
      // divider moving left makes it bigger.
      const base = width ?? getComputedWidth();
      const next = clampAssistantWidth(base + step, window.innerWidth);
      commit(next);
      saveAssistantWidth(next);
    },
    [commit, width],
  );

  return (
    <div
      className="assistant-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('assistant.resize')}
      aria-valuenow={width ?? undefined}
      aria-valuemin={MIN_ASSISTANT_W}
      aria-valuemax={MAX_ASSISTANT_W}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    />
  );
}

/** The width the stylesheet is currently using, for the first keyboard nudge
 * when nothing has been stored or dragged yet. */
function getComputedWidth(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--assistant-w');
  const px = Number.parseInt(raw, 10);
  return Number.isFinite(px) && px > 0 ? px : MIN_ASSISTANT_W;
}

export default AssistantResizeGrip;
