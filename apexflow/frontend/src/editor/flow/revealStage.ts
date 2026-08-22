// The second half of the Flow -> Stages jump: bring a stage card into view
// and put focus on it.
//
// Its own module rather than a helper inside EditorPage so it can be tested
// against a real DOM without mounting the page, its router, its auth context
// and its draft store — none of which have anything to do with what this
// does.

/** Marks the control focus lands on inside a stage card (`StageCard`). */
export const STAGE_FOCUS_ATTR = 'data-stage-focus';

/** The `id` a stage card carries. Kept here so the writer (`StageCard`) and
 * the reader (this file) cannot drift apart. */
export function stageCardId(stageId: string): string {
  return `stage-${stageId}`;
}

/**
 * Reveal a stage card. Returns false when it is not in the DOM.
 *
 * `getElementById` rather than `querySelector('#...')` on purpose: a
 * `stage_id` is an authored string, and one containing a space or a quote
 * makes an invalid selector, which THROWS rather than returning null.
 * `getElementById` compares the id literally, so nothing an author can type
 * breaks it — which is why the tests feed it exactly those ids.
 */
export function revealStage(stageId: string, doc: Document = document): boolean {
  const card = doc.getElementById(stageCardId(stageId));
  if (!card) return false;

  // `scrollIntoView` is absent in some test environments and older
  // embedders; a missing scroll must not cost the focus move, which is the
  // half that matters for a keyboard user.
  if (typeof card.scrollIntoView === 'function') {
    const reduced =
      typeof doc.defaultView?.matchMedia === 'function' &&
      doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  }

  // Focus moves, not just the viewport: someone who activated the stage from
  // the keyboard must land on it rather than be left where they were.
  // `preventScroll` so this does not fight the scroll above.
  const focusTarget = card.querySelector<HTMLElement>(`[${STAGE_FOCUS_ATTR}]`);
  focusTarget?.focus({ preventScroll: true });
  return true;
}
