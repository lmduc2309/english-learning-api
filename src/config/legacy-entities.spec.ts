import { PolishCorrectionEntity } from '../polish/entities/polish-correction.entity';
import { PolishPhrase } from '../polish/entities/polish-phrase.entity';
import { PolishSession } from '../polish/entities/polish-session.entity';
import { LEGACY_ENTITIES } from './legacy-entities';

describe('LEGACY_ENTITIES', () => {
  it('registers the polish entities on the primary connection', () => {
    expect(LEGACY_ENTITIES).toEqual(
      expect.arrayContaining([PolishSession, PolishCorrectionEntity, PolishPhrase]),
    );
  });
});
