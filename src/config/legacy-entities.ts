import { User } from '../auth/entities/user.entity';
import { Category } from '../category/entities/category.entity';
import { CategoryWord } from '../category/entities/category-word.entity';
import { Definition } from '../dictionary/entities/definition.entity';
import { Example } from '../dictionary/entities/example.entity';
import { LearnerEntry } from '../dictionary/entities/learner-entry.entity';
import { LearnerExample } from '../dictionary/entities/learner-example.entity';
import { LearnerPronunciation } from '../dictionary/entities/learner-pronunciation.entity';
import { LearnerSense } from '../dictionary/entities/learner-sense.entity';
import { LearnerSenseTranslation } from '../dictionary/entities/learner-sense-translation.entity';
import { Pronunciation } from '../dictionary/entities/pronunciation.entity';
import { Synonym } from '../dictionary/entities/synonym.entity';
import { Word } from '../dictionary/entities/word.entity';
import { WordForm } from '../dictionary/entities/word-form.entity';
import { LookupHistory } from '../learning/entities/lookup-history.entity';
import { WordFolder } from '../learning/entities/word-folder.entity';
import { VerbalMappingAttempt } from '../verbal-mapping/entities/verbal-mapping-attempt.entity';
import { VerbalMappingSession } from '../verbal-mapping/entities/verbal-mapping-session.entity';
import { WordList } from '../word-list/entities/word-list.entity';

/**
 * Entities owned by the primary application database.
 *
 * Keep this list explicit so retired/operational entity modules cannot be
 * registered on the production connection accidentally.
 */
export const LEGACY_ENTITIES = [
  User,
  Category,
  CategoryWord,
  Definition,
  Example,
  LearnerEntry,
  LearnerExample,
  LearnerPronunciation,
  LearnerSense,
  LearnerSenseTranslation,
  Pronunciation,
  Synonym,
  Word,
  WordForm,
  LookupHistory,
  WordFolder,
  VerbalMappingAttempt,
  VerbalMappingSession,
  WordList,
];
