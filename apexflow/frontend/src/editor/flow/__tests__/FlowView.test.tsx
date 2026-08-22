// @vitest-environment jsdom
//
// Only the files that need a DOM pay for one — the other 300-odd tests in
// this suite are pure and stay on the default `node` environment.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import FlowView from '../FlowView.tsx';
import { STAGE_FOCUS_ATTR, revealStage, stageCardId } from '../revealStage.ts';
import { readStageModel } from '../../stage/read.ts';
import {
  ENROLLMENT_MACHINE,
  ENROLLMENT_STEPS,
  SIGNUP_MACHINE,
  SIGNUP_STEPS,
} from '../../stage/__tests__/fixtures.ts';

afterEach(cleanup);

const signupModel = () => readStageModel(SIGNUP_MACHINE, SIGNUP_STEPS);

/** The diagram's stage buttons, by accessible name. */
const stageButton = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`\\b${name}\\b`) });

describe('FlowView rendering', () => {
  it('draws every stage as a button and every move as a label', () => {
    render(<FlowView model={signupModel()} onSelectStage={() => {}} />);

    for (const name of ['Draft', 'Waitlisted', 'Spot Offered', 'Confirmed', 'Completed']) {
      expect(stageButton(name)).toBeTruthy();
    }
    // Actions are humanised for reading; the authored id stays in the machine.
    expect(screen.getAllByText(/Offer spot/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Complete program/).length).toBeGreaterThan(0);
  });

  it('does not draw the exit target as a stage', () => {
    render(<FlowView model={signupModel()} onSelectStage={() => {}} />);
    expect(screen.queryByRole('button', { name: /Dropped/ })).toBeNull();
  });

  it('lists exits as rules, naming their source stages', () => {
    const { container } = render(<FlowView model={signupModel()} onSelectStage={() => {}} />);
    const exits = container.querySelector('.flow-exits') as HTMLElement;
    expect(exits).toBeTruthy();
    // Signup's drop rule splits in two: the one leaving `confirmed` also
    // marks the enrollment row Withdrawn, so it is a separate rule.
    const actions = [...exits.querySelectorAll('.flow-exit-action')].map((el) => el.textContent);
    expect(actions).toEqual(['Drop', 'Drop']);
    expect([...exits.querySelectorAll('.flow-exit-target')].map((el) => el.textContent)).toEqual([
      'Dropped',
      'Dropped',
    ]);
    expect(within(exits).getByText(/Draft, Waitlisted, Spot Offered/)).toBeTruthy();
    expect(within(exits).getByText(/from Confirmed/)).toBeTruthy();
  });

  it('renders an empty machine without throwing', () => {
    const empty = readStageModel({ states: [], transitions: [] } as never, []);
    render(<FlowView model={empty} onSelectStage={() => {}} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('marks automatic moves distinctly (enrollment)', () => {
    const { container } = render(
      <FlowView
        model={readStageModel(ENROLLMENT_MACHINE, ENROLLMENT_STEPS)}
        onSelectStage={() => {}}
      />,
    );
    expect(container.querySelectorAll('.flow-edge.flow-who-automatic').length).toBeGreaterThan(0);
  });
});

describe('selecting a stage', () => {
  it('reports the stage_id, not the display name, on click', () => {
    const onSelectStage = vi.fn();
    render(<FlowView model={signupModel()} onSelectStage={onSelectStage} />);

    fireEvent.click(stageButton('Spot Offered'));
    // The name is "Spot Offered"; the id the editor needs is `offered`.
    expect(onSelectStage).toHaveBeenCalledWith('offered');
  });

  it('responds to Enter and to Space', () => {
    const onSelectStage = vi.fn();
    render(<FlowView model={signupModel()} onSelectStage={onSelectStage} />);
    const node = stageButton('Confirmed');

    fireEvent.keyDown(node, { key: 'Enter' });
    fireEvent.keyDown(node, { key: ' ' });
    expect(onSelectStage.mock.calls).toEqual([['confirmed'], ['confirmed']]);
  });

  it('ignores other keys', () => {
    const onSelectStage = vi.fn();
    render(<FlowView model={signupModel()} onSelectStage={onSelectStage} />);
    fireEvent.keyDown(stageButton('Draft'), { key: 'a' });
    fireEvent.keyDown(stageButton('Draft'), { key: 'Tab' });
    expect(onSelectStage).not.toHaveBeenCalled();
  });

  // Attribute lookup on an SVG element is CASE-SENSITIVE, unlike on an HTML
  // one — `getAttribute('tabIndex')` returns null here even when the element
  // is focusable. The lowercase name is the one that must be present, since
  // that is what browsers read to build the tab order.
  it('puts every stage in the tab order', () => {
    render(<FlowView model={signupModel()} onSelectStage={() => {}} />);
    for (const name of ['Draft', 'Waitlisted', 'Confirmed']) {
      expect(stageButton(name).getAttribute('tabindex')).toBe('0');
    }
  });
});

describe('revealStage', () => {
  /** A stand-in for a rendered StageCard, built with the same helpers the
   * real one uses so the two cannot drift. */
  function mountCard(stageId: string) {
    const card = document.createElement('li');
    card.id = stageCardId(stageId);
    const input = document.createElement('input');
    input.setAttribute(STAGE_FOCUS_ATTR, '');
    card.appendChild(input);
    document.body.appendChild(card);
    // jsdom implements no layout, so scrollIntoView is absent.
    card.scrollIntoView = vi.fn();
    return { card, input };
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('scrolls the card into view and focuses its first control', () => {
    const { card, input } = mountCard('confirmed');
    expect(revealStage('confirmed')).toBe(true);
    expect(card.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it('reports false for a stage that is not rendered', () => {
    mountCard('confirmed');
    expect(revealStage('never_existed')).toBe(false);
  });

  // The whole reason `revealStage` uses getElementById: these ids are legal
  // for an author to type, and `querySelector('#' + id)` THROWS on them
  // rather than returning null.
  it.each(['has space', 'has"quote', 'has.dot', 'has#hash', '1leading-digit'])(
    'finds a stage whose id is %j',
    (stageId) => {
      const { input } = mountCard(stageId);
      expect(revealStage(stageId)).toBe(true);
      expect(document.activeElement).toBe(input);
    },
  );

  it('still focuses when the environment has no scrollIntoView', () => {
    const { card, input } = mountCard('confirmed');
    // @ts-expect-error deliberately removing the method
    card.scrollIntoView = undefined;
    expect(revealStage('confirmed')).toBe(true);
    expect(document.activeElement).toBe(input);
  });
});
