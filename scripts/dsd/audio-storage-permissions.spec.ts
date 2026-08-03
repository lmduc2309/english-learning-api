/**
 * Measure what each audio-storage role can actually do.
 *
 * A policy document says what was intended. This says what the store permits,
 * which is the only version that matters — an over-broad grant reads the same as
 * a correct one until something exercises it.
 *
 * Skipped unless credentials for all three roles are present. Provision them
 * with `zsh scripts/dsd/provision-audio-storage.sh apply` against MinIO, or
 * point the same variables at a real AWS account.
 */
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';

const ENDPOINT = process.env.DSD_AUDIO_S3_ENDPOINT;
const BUCKET = process.env.DSD_AUDIO_S3_BUCKET;
const REGION = process.env.AWS_DEFAULT_REGION ?? 'us-east-1';

interface Role {
  name: string;
  accessKey?: string;
  secretKey?: string;
}

const ROLES: Role[] = [
  {
    name: 'generator',
    accessKey: process.env.DSD_AUDIO_GENERATOR_KEY,
    secretKey: process.env.DSD_AUDIO_GENERATOR_SECRET,
  },
  {
    name: 'api',
    accessKey: process.env.DSD_AUDIO_API_KEY,
    secretKey: process.env.DSD_AUDIO_API_SECRET,
  },
  {
    name: 'operator',
    accessKey: process.env.DSD_AUDIO_OPERATOR_KEY,
    secretKey: process.env.DSD_AUDIO_OPERATOR_SECRET,
  },
];

const configured = ENDPOINT && BUCKET && ROLES.every((role) => role.accessKey && role.secretKey);
const describeLive = configured ? describe : describe.skip;

/** The capabilities each role must have, and must not have. */
const EXPECTED: Record<string, Record<string, boolean>> = {
  generator: { put: true, get: true, list: true, delete: false, bucketPolicy: false, lifecycle: false },
  api: { put: false, get: true, list: false, delete: false, bucketPolicy: false, lifecycle: false },
  operator: { put: false, get: true, list: true, delete: false, bucketPolicy: false, lifecycle: false },
};

function wav(): Buffer {
  const sampleRate = 22050;
  const data = Buffer.alloc(sampleRate * 2);
  for (let i = 0; i < sampleRate; i++) {
    data.writeInt16LE(Math.round(Math.sin((i / sampleRate) * 2 * Math.PI * 300) * 12000), i * 2);
  }
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE(sampleRate * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const header = Buffer.alloc(8);
  header.write('data', 0, 'ascii');
  header.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([fmt, header, data]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write('WAVE', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

const BYTES = wav();
const HASH = crypto.createHash('sha256').update(BYTES).digest('hex');
const KEY = `dsd/audio/en-aria/${HASH}.wav`;
const TEMP = `/tmp/dsd-permissions-${process.pid}.wav`;

function attempt(role: Role, args: string[]): boolean {
  try {
    execFileSync('aws', ['--region', REGION, '--endpoint-url', ENDPOINT!, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: role.accessKey!,
        AWS_SECRET_ACCESS_KEY: role.secretKey!,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function capabilities(role: Role): Record<string, boolean> {
  return {
    put: attempt(role, ['s3api', 'put-object', '--bucket', BUCKET!, '--key', KEY, '--body', TEMP]),
    get: attempt(role, ['s3api', 'get-object', '--bucket', BUCKET!, '--key', KEY, '/dev/null']),
    list: attempt(role, ['s3api', 'list-objects-v2', '--bucket', BUCKET!]),
    delete: attempt(role, ['s3api', 'delete-object', '--bucket', BUCKET!, '--key', KEY]),
    bucketPolicy: attempt(role, [
      's3api', 'put-bucket-policy', '--bucket', BUCKET!,
      '--policy',
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: 's3:GetObject',
            Resource: `arn:aws:s3:::${BUCKET}/*`,
          },
        ],
      }),
    ]),
    lifecycle: attempt(role, [
      's3api', 'put-bucket-lifecycle-configuration', '--bucket', BUCKET!,
      '--lifecycle-configuration',
      JSON.stringify({
        Rules: [{ ID: 'probe', Status: 'Enabled', Filter: { Prefix: '' }, Expiration: { Days: 1 } }],
      }),
    ]),
  };
}

describeLive('audio storage role permissions', () => {
  const measured: Record<string, Record<string, boolean>> = {};

  beforeAll(() => {
    fs.writeFileSync(TEMP, BYTES);
    // Seed the object with admin credentials so the read probes are meaningful.
    execFileSync('aws', [
      '--region', REGION, '--endpoint-url', ENDPOINT!,
      's3api', 'put-object', '--bucket', BUCKET!, '--key', KEY, '--body', TEMP,
    ]);
    for (const role of ROLES) measured[role.name] = capabilities(role);
  }, 300_000);

  afterAll(() => {
    try {
      fs.unlinkSync(TEMP);
    } catch {
      /* best effort */
    }
  });

  for (const role of ROLES) {
    describe(role.name, () => {
      for (const [capability, allowed] of Object.entries(EXPECTED[role.name])) {
        it(`${allowed ? 'can' : 'cannot'} ${capability}`, () => {
          expect(measured[role.name][capability]).toBe(allowed);
        });
      }
    });
  }

  it('gives no role the power to delete an object', () => {
    // Content-addressed keys are never rewritten and superseded audio is
    // quarantined, so no application role needs deletion at all.
    for (const role of ROLES) {
      expect(measured[role.name].delete).toBe(false);
    }
  });

  it('gives no role the power to set a bucket policy or a lifecycle rule', () => {
    // A lifecycle rule is how audio quietly disappears months later; a bucket
    // policy is how it quietly becomes public.
    for (const role of ROLES) {
      expect(measured[role.name].bucketPolicy).toBe(false);
      expect(measured[role.name].lifecycle).toBe(false);
    }
  });

  it('denies the API listing, so it cannot serve from a listing', () => {
    // The serving role fetches an exact key from the database and has no way to
    // discover an unreviewed or rejected object.
    expect(measured.api.list).toBe(false);
    expect(measured.api.get).toBe(true);
  });

  it('gives only the generator write access', () => {
    expect(measured.generator.put).toBe(true);
    expect(measured.api.put).toBe(false);
    expect(measured.operator.put).toBe(false);
  });
});
