/**
 * The DSD content lifecycle.
 *
 * Every state change is one of five named actions, and every action writes a
 * provenance event. That is the design rule this file exists to enforce: an
 * action with no event type is an action that leaves no trace, so it is not
 * offered. Withdrawing a submission and quietly reworking a rejected row both
 * fall foul of it — a correction is a new draft revision that points at the old
 * row through supersedes_id and repeats every gate.
 *
 * Skipped states are refused here rather than in the database. The CHECK
 * constraints know a status is valid; only this table knows that
 * draft → approved skipped review.
 */

export const DSD_STATES = [
  'draft', 'in_review', 'approved', 'published', 'retired', 'rejected',
] as const;
export type DsdState = (typeof DSD_STATES)[number];

export const DSD_ACTIONS = ['submit', 'approve', 'reject', 'publish', 'retire'] as const;
export type DsdAction = (typeof DSD_ACTIONS)[number];

/**
 * Mirrors CHK_dsd_event_type in 1785628800000-CreateDsdCorpusCore. Duplicated
 * deliberately: a test asserts every transition's event is in this list, which
 * is what stops a transition being added that the database would then reject.
 */
export const DSD_EVENT_TYPES = [
  'authored', 'submitted', 'reviewed', 'approved', 'rejected', 'published',
  'retired', 'superseded', 'imported', 'generated', 'similarity_checked', 'released',
] as const;
export type DsdEventType = (typeof DSD_EVENT_TYPES)[number];

export interface TransitionRule {
  from: DsdState;
  to: DsdState;
  event: DsdEventType;
  /** True when the actor must be a reviewer other than the author. */
  requiresIndependentReviewer: boolean;
}

export const TRANSITIONS: Record<DsdAction, TransitionRule> = {
  submit:  { from: 'draft',     to: 'in_review', event: 'submitted', requiresIndependentReviewer: false },
  approve: { from: 'in_review', to: 'approved',  event: 'approved',  requiresIndependentReviewer: true },
  reject:  { from: 'in_review', to: 'rejected',  event: 'rejected',  requiresIndependentReviewer: true },
  publish: { from: 'approved',  to: 'published', event: 'published', requiresIndependentReviewer: false },
  retire:  { from: 'published', to: 'retired',   event: 'retired',   requiresIndependentReviewer: false },
};

/** No action leaves these. Corrections start a new draft revision instead. */
export const TERMINAL_STATES: DsdState[] = ['rejected', 'retired'];

export function isTerminal(state: string): boolean {
  return TERMINAL_STATES.includes(state as DsdState);
}

/** Actions legal from a state, for error messages that say what to do next. */
export function actionsFrom(state: string): DsdAction[] {
  return DSD_ACTIONS.filter((action) => TRANSITIONS[action].from === state);
}

/**
 * Resolve an action against the current state, or explain the refusal.
 * Returns null and pushes one message rather than throwing, so a batch of
 * decisions reports every problem in one pass.
 */
export function resolveTransition(
  current: string,
  action: DsdAction,
  where: string,
  errors: string[],
): TransitionRule | null {
  if (!(DSD_STATES as readonly string[]).includes(current)) {
    errors.push(`${where}: unknown state '${current}'`);
    return null;
  }

  const rule = TRANSITIONS[action];
  if (!rule) {
    errors.push(`${where}: unknown action '${action}'`);
    return null;
  }

  if (rule.from === current) return rule;

  if (isTerminal(current)) {
    errors.push(
      `${where}: cannot ${action} a ${current} record — supersede it with a new draft revision`,
    );
    return null;
  }

  const legal = actionsFrom(current);
  errors.push(
    `${where}: cannot ${action} from '${current}' — that would skip '${rule.from}'. ` +
      (legal.length > 0 ? `Legal here: ${legal.join(', ')}.` : 'No action is legal here.'),
  );
  return null;
}

/** Throwing form, for single-record commands where one failure ends the run. */
export function nextState(current: string, action: DsdAction): DsdState {
  const errors: string[] = [];
  const rule = resolveTransition(current, action, 'transition', errors);
  if (!rule) throw new Error(errors[0]);
  return rule.to;
}
