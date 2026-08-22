// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { FlowCard } from '../FlowCard.tsx';
import { registerEditorBridge, unregisterEditorBridge } from '../../../chat/editorBridge.ts';
import { SIGNUP_MACHINE, SIGNUP_STEPS } from '../../../editor/stage/__tests__/fixtures.ts';
import * as designer from '../../../api/designer.ts';

vi.mock('../../../api/designer.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof designer>()),
  getBundle: vi.fn(),
}));

const getBundle = vi.mocked(designer.getBundle);

/** Reports the current location so the "Open flow view" navigation can be
 * asserted on the URL rather than on a spy. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="loc">{location.pathname + location.search}</span>;
}

function mount(entityId = 'wd-1') {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <FlowCard entityId={entityId} name="Program Signup" tenantId="acme" />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const bundle = () =>
  ({
    definition: { machine: SIGNUP_MACHINE, steps: SIGNUP_STEPS },
    models: {},
    health: 'healthy',
    errors: [],
  }) as never;

beforeEach(() => {
  getBundle.mockReset();
  getBundle.mockResolvedValue(bundle());
});

afterEach(() => {
  cleanup();
  unregisterEditorBridge('wd-1');
});

describe('FlowCard', () => {
  it('summarises the spine, not the whole graph', async () => {
    mount();
    // Spine stages appear as chips...
    for (const name of ['Draft', 'Confirmed', 'Completed']) {
      expect(await screen.findByText(name)).toBeTruthy();
    }
    // ...and the rail is collapsed to one line rather than drawn.
    expect(await screen.findByText(/Waitlisted → Spot Offered/)).toBeTruthy();
  });

  it('names the move between consecutive stages, with its actor', async () => {
    mount();
    expect(await screen.findByText('Submit')).toBeTruthy();
    expect(await screen.findByText('Complete program')).toBeTruthy();
    expect((await screen.findAllByText('A family')).length).toBeGreaterThan(0);
  });

  it('states the counts in the header', async () => {
    mount();
    // 5 drawn stages (Dropped is an exit target, not a stage), 7 moves, and
    // the two drop rules.
    expect(await screen.findByText('5 stages · 7 moves · 2 exit rules')).toBeTruthy();
  });

  it('states both drop rules rather than collapsing them', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll('.flow-card__exit')).toHaveLength(2));
  });

  it('draws nothing with characters', async () => {
    const { container } = mount();
    await screen.findByText('Draft');
    // No <pre>, and no box-drawing glyphs anywhere in the card.
    expect(container.querySelector('pre')).toBeNull();
    expect(/[─-╿]/.test(container.textContent ?? '')).toBe(false);
  });

  // The reason `EditorBridge.read` exists: a card showing the saved row
  // beside an editor showing edited work is a card that lies.
  it('prefers the open draft over the saved row, and never fetches for it', async () => {
    const edited = {
      ...SIGNUP_MACHINE,
      states: SIGNUP_MACHINE.states.map((s) =>
        s.state_id === 'confirmed' ? { ...s, name: 'Signed Up' } : s,
      ),
    };
    registerEditorBridge({
      entityId: 'wd-1',
      readOnly: false,
      apply: () => null,
      read: () => ({ machine: edited, steps: SIGNUP_STEPS }),
    });

    mount();
    expect(await screen.findByText('Signed Up')).toBeTruthy();
    expect(screen.queryByText('Confirmed')).toBeNull();
    expect(getBundle).not.toHaveBeenCalled();
  });

  it('ignores a bridge registered for a different workflow', async () => {
    registerEditorBridge({
      entityId: 'some-other-draft',
      readOnly: false,
      apply: () => null,
      read: () => ({ machine: { states: [], transitions: [] }, steps: [] }),
    });
    mount('wd-1');
    expect(await screen.findByText('Draft')).toBeTruthy();
    expect(getBundle).toHaveBeenCalledWith('acme', 'wd-1');
    unregisterEditorBridge('some-other-draft');
  });

  it('says so when the workflow cannot be loaded, and still offers the button', async () => {
    getBundle.mockRejectedValue(new Error('boom'));
    mount();
    expect(await screen.findByText(/Couldn't load this workflow/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open flow view/ })).toBeTruthy();
  });

  it('opens the Flow tab by URL', async () => {
    mount('wd-42');
    (await screen.findByRole('button', { name: /Open flow view/ })).click();
    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe('/definitions/wd-42?view=flow'),
    );
  });

  it('escapes an entity id that is not URL-safe', async () => {
    mount('wd 42/x');
    (await screen.findByRole('button', { name: /Open flow view/ })).click();
    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe('/definitions/wd%2042%2Fx?view=flow'),
    );
  });
});
