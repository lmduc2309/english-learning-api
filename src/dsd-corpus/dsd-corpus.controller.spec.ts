import { NotFoundException } from '@nestjs/common';
import { DsdCorpusConfig, DsdReleaseChannel } from './dsd-corpus.config';
import { DsdCorpusController } from './dsd-corpus.controller';
import { DsdEntryAggregate, DsdQueryService } from './dsd-query.service';

const PUBLIC_RELEASE = 'DSD-REL-V1-5000-a1b2c3d4';
const PILOT_RELEASE = 'DSD-REL-PILOT-20260803-a1b2c3d4';

function aggregate(): DsdEntryAggregate {
  return {
    entry: {
      id: '11111111-1111-1111-1111-111111111111',
      headword: 'rehearse',
      headwordNormalized: 'rehearse',
      language: 'en',
      updatedAt: new Date('2026-08-03T09:00:00.000Z'),
    },
    senses: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        senseOrder: 1,
        partOfSpeech: 'verb',
        definitionEn: 'To practise beforehand.',
        usageLabels: [],
        translations: [{ id: 't1', locale: 'vi', text: 'diễn tập' }],
        examples: [{ id: 'x1', exampleOrder: 1, exampleEn: 'They rehearse.', exampleVi: 'Họ diễn tập.' }],
        relations: [],
      },
    ],
    pronunciations: [
      { id: 'p1', accent: 'en-US', ipa: 'rɪˈhɜːrs', priority: 1, audio: [] },
    ],
  };
}

function config(
  channel: DsdReleaseChannel,
  releaseId = channel === 'off' ? '' : PUBLIC_RELEASE,
): DsdCorpusConfig {
  return {
    database: 'dsd_corpus_db',
    releaseChannel: channel,
    activeReleaseId: releaseId,
    connections: {},
    errors: [],
  };
}

function build(
  channel: DsdReleaseChannel,
  found: DsdEntryAggregate | null = aggregate(),
  releaseId?: string,
) {
  const queryService = {
    available: channel !== 'off',
    findCompleteEntry: jest.fn(async () => found),
    search: jest.fn(async () =>
      found
        ? [
            {
              id: found.entry.id,
              headword: found.entry.headword,
              partOfSpeech: 'verb',
              definitionEn: 'To practise beforehand.',
              translationVi: 'diễn tập',
            },
          ]
        : [],
    ),
  } as unknown as DsdQueryService;

  return {
    controller: new DsdCorpusController(queryService, config(channel, releaseId)),
    queryService,
  };
}

describe('channel off', () => {
  it('serves nothing', () => {
    expect(build('off').controller.canServe('public')).toBe(false);
    expect(build('off').controller.canServe('reviewer')).toBe(false);
  });

  it('returns 404 for a lookup without querying at all', async () => {
    const { controller, queryService } = build('off');
    await expect(controller.lookup('rehearse')).rejects.toThrow(NotFoundException);
    expect(queryService.findCompleteEntry).not.toHaveBeenCalled();
  });

  it('returns an empty search with no release id', async () => {
    const { controller, queryService } = build('off');
    expect(await controller.search('reh')).toEqual({ results: [], corpus_release_id: null });
    expect(queryService.search).not.toHaveBeenCalled();
  });

  it('reports the channel honestly on health', () => {
    expect(build('off').controller.health()).toEqual({
      channel: 'off',
      release_id: null,
      serving: false,
      connected: false,
    });
  });
});

describe('channel internal', () => {
  it('behaves as off for a public request, so a pilot is not discoverable', () => {
    expect(build('internal').controller.canServe('public')).toBe(false);
  });

  it('serves a reviewer', () => {
    expect(build('internal').controller.canServe('reviewer')).toBe(true);
  });

  it('returns 404 to a public lookup even though the entry exists', async () => {
    const { controller, queryService } = build('internal');
    await expect(controller.lookup('rehearse')).rejects.toThrow(NotFoundException);
    expect(queryService.findCompleteEntry).not.toHaveBeenCalled();
  });

  it('accepts a pilot release id, unlike the public channel', () => {
    const { controller } = build('internal', aggregate(), PILOT_RELEASE);
    expect(controller.health().release_id).toBe(PILOT_RELEASE);
  });

  it('serves the authenticated reviewer endpoint from the active pilot', async () => {
    const { controller, queryService } = build('internal', aggregate(), PILOT_RELEASE);
    const result = await controller.internalLookup('rehearse');
    expect(result.corpus_release_id).toBe(PILOT_RELEASE);
    expect(queryService.findCompleteEntry).toHaveBeenCalledWith('rehearse', PILOT_RELEASE);
  });

  it('serves internal search only with the pilot release id', async () => {
    const { controller, queryService } = build('internal', aggregate(), PILOT_RELEASE);
    const result = await controller.internalSearch('reh');
    expect(result.corpus_release_id).toBe(PILOT_RELEASE);
    expect(queryService.search).toHaveBeenCalledWith('reh', 20, PILOT_RELEASE);
  });
});

describe('channel public', () => {
  it('serves everyone', () => {
    expect(build('public').controller.canServe('public')).toBe(true);
  });

  it('returns a presented entry', async () => {
    const presented = await build('public').controller.lookup('rehearse');
    expect(presented.word).toBe('rehearse');
    expect(presented.data_source).toBe('dsd');
    expect(presented.corpus_release_id).toBe(PUBLIC_RELEASE);
  });

  it('returns search results stamped with the release', async () => {
    const result = await build('public').controller.search('reh');
    expect(result.results[0].word).toBe('rehearse');
    expect(result.corpus_release_id).toBe(PUBLIC_RELEASE);
  });

  it('returns 404 for a DSD miss, and never falls back', async () => {
    // The controller has no legacy connection, so a miss is the whole answer.
    const { controller } = build('public', null);
    await expect(controller.lookup('rehearse')).rejects.toThrow(NotFoundException);
  });

  it('gives the same 404 whether the entry is absent, unpublished or incomplete', async () => {
    // Distinguishing them would tell an outsider what exists in the corpus.
    const { controller } = build('public', null);
    await expect(controller.lookup('rehearse')).rejects.toThrow('not_found');
    await expect(controller.lookup('11111111-1111-1111-1111-111111111111')).rejects.toThrow(
      'not_found',
    );
  });

  it('passes the identifier through unchanged, so a UUID resolves as a UUID', async () => {
    const { controller, queryService } = build('public');
    await controller.lookup('11111111-1111-1111-1111-111111111111');
    expect(queryService.findCompleteEntry).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      PUBLIC_RELEASE,
    );
  });

  it('defaults the search limit', async () => {
    const { controller, queryService } = build('public');
    await controller.search('reh');
    expect(queryService.search).toHaveBeenCalledWith('reh', 20, PUBLIC_RELEASE);
  });
});

describe('access cannot be raised by the caller', () => {
  it.each(['reviewer', 'internal', 'admin', 'true'])(
    'ignores access=%s on the internal channel',
    async (access) => {
      // Reviewer access is asserted by authentication, not a query parameter.
      // Until that route exists everything is public, which fails closed.
      const { controller } = build('internal');
      await expect(controller.lookup('rehearse', access)).rejects.toThrow(NotFoundException);
    },
  );

  it('ignores access on the off channel too', async () => {
    const { controller } = build('off');
    expect(await controller.search('reh', '20', 'reviewer')).toEqual({
      results: [],
      corpus_release_id: null,
    });
  });
});

describe('health exposes nothing internal', () => {
  it.each(['off', 'internal', 'public'] as const)('on channel %s', (channel) => {
    const health = build(channel).controller.health();
    expect(Object.keys(health).sort()).toEqual([
      'channel',
      'connected',
      'release_id',
      'serving',
    ]);
    expect(JSON.stringify(health)).not.toMatch(/postgres|password|dsd_app|database/i);
  });
});
