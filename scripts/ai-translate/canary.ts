/**
 * The gate that stops a misconfigured server from writing a million bad rows.
 *
 * TranslateGemma fails in a way that looks like success: if the language codes
 * never reach the template, the model echoes English back and every response is
 * a well-formed non-empty string. Row-level validation catches each instance,
 * but by then the run has already wasted hours. This sweep runs a fixed set of
 * probes before the job starts and periodically during it, and aborts the whole
 * run if the model is not demonstrably producing Vietnamese.
 */

import { validateTranslation } from './validate-output';

/** Chosen so a correct Vietnamese translation necessarily carries diacritics. */
export const CANARY_CASES: string[] = [
  'A dog.',
  'A cat.',
  'The book is on the table.',
  'She walked to school this morning.',
  'Relating to the study of plants.',
  'To move quickly on foot.',
  'A large body of salt water.',
  'He bought a new car last year.',
  'The weather is very cold today.',
  'An instrument used for measuring temperature.',
  'They are learning Vietnamese together.',
  'A small village near the mountain.',
  'The child is sleeping quietly.',
  'To prepare food by heating it.',
  'A person who treats sick people.',
  'The river flows into the sea.',
  'I would like a cup of coffee.',
  'A place where books are kept.',
  'To speak in a loud voice.',
  'The flowers in the garden are beautiful.',
];

const VIETNAMESE_DIACRITIC_RE =
  /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;

export type CanaryFailureReason =
  | 'request_failed'
  | 'no_vietnamese_diacritics'
  | string;

export interface CanaryFailure {
  english: string;
  output: string;
  reason: CanaryFailureReason;
}

export interface CanaryReport {
  passed: number;
  total: number;
  failures: CanaryFailure[];
}

export type TranslateFn = (text: string) => Promise<string>;

export async function runCanary(
  translate: TranslateFn,
  cases: string[] = CANARY_CASES,
): Promise<CanaryReport> {
  const failures: CanaryFailure[] = [];
  let passed = 0;

  for (const english of cases) {
    let output = '';

    try {
      output = await translate(english);
    } catch (error: any) {
      failures.push({ english, output: '', reason: 'request_failed' });
      continue;
    }

    const validation = validateTranslation(english, output);
    if (!validation.ok) {
      failures.push({ english, output, reason: validation.reason as string });
      continue;
    }

    if (!VIETNAMESE_DIACRITIC_RE.test(output)) {
      failures.push({ english, output, reason: 'no_vietnamese_diacritics' });
      continue;
    }

    passed++;
  }

  return { passed, total: cases.length, failures };
}

export function assertCanaryPassed(report: CanaryReport, minPassRate: number): void {
  if (report.total === 0) {
    throw new Error('no canary probes were run — refusing to start the job');
  }

  const rate = report.passed / report.total;
  if (rate < minPassRate) {
    const detail = report.failures
      .slice(0, 3)
      .map((f) => `${f.reason}: "${f.english}" -> "${f.output}"`)
      .join('; ');

    throw new Error(
      `canary failed: ${report.passed}/${report.total} probes passed ` +
        `(need ${Math.round(minPassRate * 100)}%). ${detail}`,
    );
  }
}
