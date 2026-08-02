/**
 * DSD registry schema and validator.
 *
 * Three registries govern what may enter the DSD corpus:
 *
 *   data/dsd/source-registry.json       what content may be used, and for what
 *   data/dsd/tool-registry.json         what software may run, pinned
 *   data/dsd/contributor-registry.json  who may author and review
 *
 * The validator is the enforcement point for rules that would otherwise be
 * conventions in a policy document. In particular it refuses personal data in
 * the contributor registry: names, emails and signatures belong in the
 * contract store, not in Git, and a check that runs in CI is the only version
 * of that rule which survives contact with a deadline.
 */
import * as fs from 'fs';
import * as path from 'path';

export const DSD_SOURCE_SCOPES = [
  'inventory',
  'definition',
  'translation',
  'example',
  'pronunciation',
  'relation',
  'audio_model',
  'audio_training_data',
  'tool',
] as const;

export type DsdSourceScope = (typeof DSD_SOURCE_SCOPES)[number];

export const DSD_STATUSES = ['approved', 'candidate', 'blocked'] as const;
export type DsdStatus = (typeof DSD_STATUSES)[number];

export const DSD_CONTRIBUTOR_ROLES = [
  'author',
  'reviewer',
  'compliance_reviewer',
  'linguistic_reviewer',
  'product_owner',
  'legal_reviewer',
] as const;

/**
 * Fields that must never appear in a committed contributor record. Store an
 * evidence ID that points at the contract system instead.
 */
export const PERSONAL_DATA_FIELDS = [
  'name',
  'fullName',
  'email',
  'phone',
  'address',
  'signature',
  'nationalId',
  'taxId',
  'bankAccount',
  'dateOfBirth',
] as const;

const SHA256_RE = /^[0-9a-f]{64}$/;
/** A pseudonymous id: a stable prefix plus digits. Never a human name. */
const PSEUDONYM_RE = /^DSD-[A-Z]-\d{3,}$/;

export interface DsdSource {
  id: string;
  aliases?: string[];
  scopes: string[];
  status: string;
  approvedScopes?: string[];
  evidenceIds?: string[];
  blockedReason?: string;
  url?: string;
  revision?: string;
  sha256?: string;
  notes?: string;
}

export interface DsdTool extends DsdSource {
  sha256?: string;
}

export interface DsdContributor {
  id: string;
  roles: string[];
  languages?: string[];
  permissions?: string[];
  ipAssignmentEvidenceId?: string;
  status: string;
  [key: string]: unknown;
}

function requireEvidence(entry: DsdSource, label: string, errors: string[]): void {
  if (entry.status === 'approved' && (entry.evidenceIds ?? []).length === 0) {
    errors.push(`${label} '${entry.id}' is approved but has no evidence`);
  }
}

function checkPinnedUrl(entry: DsdSource, label: string, errors: string[]): void {
  // A bare URL is a moving target: whatever it served at review time is not
  // what it will serve later. Require a revision so the reference is fixed.
  if (entry.url && !entry.revision) {
    errors.push(`${label} '${entry.id}' has a url but no revision pinning it`);
  }
  if (entry.sha256 !== undefined && !SHA256_RE.test(entry.sha256)) {
    errors.push(`${label} '${entry.id}' has a malformed sha256`);
  }
}

function checkScopes(entry: DsdSource, label: string, errors: string[]): void {
  for (const scope of entry.scopes ?? []) {
    if (!(DSD_SOURCE_SCOPES as readonly string[]).includes(scope)) {
      errors.push(`${label} '${entry.id}' declares unknown scope '${scope}'`);
    }
  }

  const approved = entry.approvedScopes ?? [];

  if (entry.status === 'approved' && approved.length === 0) {
    errors.push(`${label} '${entry.id}' is approved but has no approved scope`);
  }

  if (entry.status === 'blocked' && approved.length > 0) {
    errors.push(
      `${label} '${entry.id}' is blocked but still lists approved scope(s): ${approved.join(', ')}`,
    );
  }

  for (const scope of approved) {
    if (!(entry.scopes ?? []).includes(scope)) {
      errors.push(
        `${label} '${entry.id}' has approved scope '${scope}' which is not declared in scopes`,
      );
    }
  }
}

function checkStatus(entry: DsdSource, label: string, errors: string[]): void {
  if (!(DSD_STATUSES as readonly string[]).includes(entry.status)) {
    errors.push(`${label} '${entry.id}' has unknown status '${entry.status}'`);
  }
  if (entry.status === 'blocked' && !(entry.blockedReason ?? '').trim()) {
    errors.push(`${label} '${entry.id}' is blocked but records no reason`);
  }
}

function checkDuplicateAliases(entries: DsdSource[], label: string, errors: string[]): void {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    for (const alias of [entry.id, ...(entry.aliases ?? [])]) {
      // Case-insensitive: differing casing must not smuggle a second claim on
      // the same name past the check.
      const key = alias.trim().toLowerCase();
      const owner = seen.get(key);
      if (owner && owner !== entry.id) {
        errors.push(`${label} duplicate alias '${alias}' claimed by '${owner}' and '${entry.id}'`);
      }
      seen.set(key, entry.id);
    }
  }
}

export function validateSourceRegistry(doc: { version?: number; sources?: DsdSource[] }): string[] {
  const errors: string[] = [];
  const sources = doc.sources ?? [];
  if (!Array.isArray(sources)) return ['source registry: sources must be an array'];

  checkDuplicateAliases(sources, 'source registry:', errors);
  for (const entry of sources) {
    checkStatus(entry, 'source', errors);
    checkScopes(entry, 'source', errors);
    checkPinnedUrl(entry, 'source', errors);
    requireEvidence(entry, 'source', errors);
  }
  return errors;
}

export function validateToolRegistry(doc: { version?: number; tools?: DsdTool[] }): string[] {
  const errors: string[] = [];
  const tools = doc.tools ?? [];
  if (!Array.isArray(tools)) return ['tool registry: tools must be an array'];

  checkDuplicateAliases(tools, 'tool registry:', errors);
  for (const entry of tools) {
    checkStatus(entry, 'tool', errors);
    checkScopes(entry, 'tool', errors);
    checkPinnedUrl(entry, 'tool', errors);
    requireEvidence(entry, 'tool', errors);
    // Every tool must be reproducible, not only approved ones — a candidate
    // whose output informed a decision has to be identifiable later.
    if (!entry.revision) {
      errors.push(`tool '${entry.id}' has no revision pin`);
    }
  }
  return errors;
}

export function validateContributorRegistry(doc: {
  version?: number;
  contributors?: DsdContributor[];
}): string[] {
  const errors: string[] = [];
  const contributors = doc.contributors ?? [];
  if (!Array.isArray(contributors)) return ['contributor registry: contributors must be an array'];

  const seen = new Set<string>();
  for (const entry of contributors) {
    if (seen.has(entry.id)) {
      errors.push(`contributor registry: duplicate contributor id '${entry.id}'`);
    }
    seen.add(entry.id);

    if (!PSEUDONYM_RE.test(entry.id)) {
      errors.push(
        `contributor '${entry.id}' is not a pseudonymous id (expected DSD-<LETTER>-<digits>)`,
      );
    }

    for (const field of PERSONAL_DATA_FIELDS) {
      if (entry[field] !== undefined) {
        errors.push(
          `contributor '${entry.id}' carries personal data in field '${field}'; store an evidence ID instead`,
        );
      }
    }

    for (const role of entry.roles ?? []) {
      if (!(DSD_CONTRIBUTOR_ROLES as readonly string[]).includes(role)) {
        errors.push(`contributor '${entry.id}' has unknown role '${role}'`);
      }
    }

    if (entry.status === 'active' && !(entry.ipAssignmentEvidenceId ?? '').trim()) {
      errors.push(`contributor '${entry.id}' is active with no IP-assignment evidence`);
    }
  }
  return errors;
}

export interface LoadedRegistries {
  sources: Array<DsdSource & { evidenceIds: string[] }>;
  tools: DsdTool[];
  contributors: DsdContributor[];
  errors: string[];
}

export function registryDir(): string {
  return path.resolve(__dirname, '../../../data/dsd');
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Load and validate all three committed registries. */
export function loadRegistries(dir = registryDir()): LoadedRegistries {
  const sourceDoc = readJson(path.join(dir, 'source-registry.json'));
  const toolDoc = readJson(path.join(dir, 'tool-registry.json'));
  const contributorDoc = readJson(path.join(dir, 'contributor-registry.json'));

  const errors = [
    ...validateSourceRegistry(sourceDoc),
    ...validateToolRegistry(toolDoc),
    ...validateContributorRegistry(contributorDoc),
  ];

  return {
    sources: (sourceDoc.sources ?? []).map((s: DsdSource) => ({
      ...s,
      evidenceIds: s.evidenceIds ?? [],
    })),
    tools: toolDoc.tools ?? [],
    contributors: contributorDoc.contributors ?? [],
    errors,
  };
}

if (require.main === module) {
  const { errors } = loadRegistries();
  if (errors.length > 0) {
    console.error('DSD registry validation FAILED:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log('DSD registry validation passed.');
}
