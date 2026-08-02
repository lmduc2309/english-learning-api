import * as fs from 'fs';
import * as path from 'path';
import {
  DSD_ACTIONS,
  DSD_EVENT_TYPES,
  DSD_STATES,
  TRANSITIONS,
  actionsFrom,
  isTerminal,
  nextState,
  resolveTransition,
} from './state-machine';

describe('the transition table', () => {
  it('is the lifecycle the schema allows', () => {
    expect(nextState('draft', 'submit')).toBe('in_review');
    expect(nextState('in_review', 'approve')).toBe('approved');
    expect(nextState('in_review', 'reject')).toBe('rejected');
    expect(nextState('approved', 'publish')).toBe('published');
    expect(nextState('published', 'retire')).toBe('retired');
  });

  it('gives every action a provenance event type the database accepts', () => {
    // An action whose event the CHECK constraint rejects would fail at write
    // time, after the status update in the same transaction.
    for (const action of DSD_ACTIONS) {
      expect(DSD_EVENT_TYPES).toContain(TRANSITIONS[action].event);
    }
  });

  it('keeps its event types in step with the migration', () => {
    const migration = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../src/dsd-corpus/migrations/1785628800000-CreateDsdCorpusCore.ts',
      ),
      'utf8',
    );
    const check = migration.match(/CHK_dsd_event_type[\s\S]*?\)\)/)![0];
    for (const type of DSD_EVENT_TYPES) {
      expect(check).toContain(`'${type}'`);
    }
  });

  it('uses only declared states', () => {
    for (const action of DSD_ACTIONS) {
      expect(DSD_STATES).toContain(TRANSITIONS[action].from);
      expect(DSD_STATES).toContain(TRANSITIONS[action].to);
    }
  });

  it('requires an independent reviewer for exactly the review decisions', () => {
    expect(TRANSITIONS.approve.requiresIndependentReviewer).toBe(true);
    expect(TRANSITIONS.reject.requiresIndependentReviewer).toBe(true);
    expect(TRANSITIONS.submit.requiresIndependentReviewer).toBe(false);
  });
});

describe('skipped states', () => {
  it('refuses to approve a draft, which would skip review', () => {
    expect(() => nextState('draft', 'approve')).toThrow(/skip 'in_review'/);
  });

  it('refuses to publish a draft or an unreviewed submission', () => {
    expect(() => nextState('draft', 'publish')).toThrow(/skip 'approved'/);
    expect(() => nextState('in_review', 'publish')).toThrow(/skip 'approved'/);
  });

  it('refuses to retire something never published', () => {
    expect(() => nextState('approved', 'retire')).toThrow(/skip 'published'/);
  });

  it('names the actions that are legal instead', () => {
    expect(() => nextState('draft', 'publish')).toThrow(/Legal here: submit/);
  });
});

describe('terminal states', () => {
  it.each(['rejected', 'retired'])('%s cannot be moved by any action', (state) => {
    expect(isTerminal(state)).toBe(true);
    for (const action of DSD_ACTIONS) {
      expect(() => nextState(state, action)).toThrow(/supersede it with a new draft revision/);
    }
  });

  it('offers no action from a terminal state', () => {
    expect(actionsFrom('rejected')).toEqual([]);
    expect(actionsFrom('retired')).toEqual([]);
  });

  it('published can only be retired', () => {
    expect(actionsFrom('published')).toEqual(['retire']);
  });
});

describe('resolveTransition', () => {
  it('collects the reason rather than throwing, so a batch reports everything', () => {
    const errors: string[] = [];
    expect(resolveTransition('draft', 'approve', 'sense abc', errors)).toBeNull();
    expect(resolveTransition('draft', 'publish', 'sense def', errors)).toBeNull();
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^sense abc:/);
    expect(errors[1]).toMatch(/^sense def:/);
  });

  it('rejects a state that is not in the schema', () => {
    const errors: string[] = [];
    expect(resolveTransition('almost_approved', 'publish', 'row', errors)).toBeNull();
    expect(errors[0]).toMatch(/unknown state 'almost_approved'/);
  });
});
