import { DataSource } from 'typeorm';
import { Word } from '../src/dictionary/entities/word.entity';
import { Definition } from '../src/dictionary/entities/definition.entity';
import { Example } from '../src/dictionary/entities/example.entity';
import { Pronunciation } from '../src/dictionary/entities/pronunciation.entity';
import { WordForm } from '../src/dictionary/entities/word-form.entity';
import { Synonym } from '../src/dictionary/entities/synonym.entity';
import { Category } from '../src/category/entities/category.entity';
import { CategoryWord } from '../src/category/entities/category-word.entity';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Auto-categorize all words in the database.
 * Uses definition text keyword matching to assign words to categories.
 * Words that don't match any category go into "Others".
 */

// Category definitions with keyword patterns to match against definitions
const CATEGORY_RULES: Array<{
  name: string;
  displayName: string;
  description: string;
  icon: string;
  topic: string;
  displayOrder: number;
  // Keywords to search in definition_en (case-insensitive)
  keywords: string[];
  // Additional POS-based filter (optional)
  posFilter?: string[];
}> = [
  // ===== Nature =====
  {
    name: 'animals',
    displayName: 'Animals',
    description: 'Animal names and related vocabulary',
    icon: '🐾',
    topic: 'Nature',
    displayOrder: 1,
    keywords: [
      'animal', 'mammal', 'reptile', 'amphibian', 'insect', 'arachnid',
      'bird', 'species of fish', 'breed of dog', 'breed of cat',
      'primate', 'rodent', 'marsupial', 'crustacean', 'mollusk', 'mollusc',
      'invertebrate', 'vertebrate', 'predator', 'prey',
      'canine', 'feline', 'bovine', 'equine', 'porcine', 'ovine',
      'a large cat', 'a small bird', 'a type of fish', 'a type of bird',
      'wild cat', 'sea creature', 'marine animal', 'domestic animal',
      'family felidae', 'family canidae', 'genus ',
    ],
  },
  {
    name: 'plants-trees',
    displayName: 'Plants & Trees',
    description: 'Plant, tree, and flower vocabulary',
    icon: '🌱',
    topic: 'Nature',
    displayOrder: 2,
    keywords: [
      'plant', 'tree', 'flower', 'shrub', 'herb', 'grass', 'fern',
      'moss', 'algae', 'fungus', 'fungi', 'mushroom', 'botanical',
      'genus of flowering', 'genus of plant', 'family of plant',
      'tropical plant', 'evergreen', 'deciduous', 'conifer',
      'seed', 'pollen', 'petal', 'leaf', 'root', 'stem', 'bark',
      'photosynthesis', 'vegetation', 'flora',
    ],
  },
  {
    name: 'nature-environment',
    displayName: 'Nature & Environment',
    description: 'Natural world and environmental vocabulary',
    icon: '🌿',
    topic: 'Nature',
    displayOrder: 3,
    keywords: [
      'nature', 'environment', 'ecosystem', 'habitat', 'climate',
      'weather', 'rain', 'snow', 'wind', 'storm', 'thunder',
      'river', 'ocean', 'sea', 'lake', 'mountain', 'valley',
      'forest', 'desert', 'island', 'volcano', 'earthquake',
      'atmosphere', 'geology', 'mineral', 'rock', 'soil',
      'conservation', 'pollution', 'ecology', 'biodiversity',
    ],
  },

  // ===== Food & Cooking =====
  {
    name: 'food-drink',
    displayName: 'Food & Drink',
    description: 'Food, beverages, and ingredients',
    icon: '🍔',
    topic: 'Food & Cooking',
    displayOrder: 1,
    keywords: [
      'food', 'dish', 'meal', 'cuisine', 'recipe', 'ingredient',
      'fruit', 'vegetable', 'meat', 'beef', 'pork', 'poultry',
      'bread', 'cheese', 'butter', 'sauce', 'soup', 'salad',
      'dessert', 'cake', 'pastry', 'candy', 'chocolate',
      'beverage', 'drink', 'wine', 'beer', 'coffee', 'tea',
      'spice', 'seasoning', 'flavor', 'flavour', 'taste',
      'edible', 'delicious', 'nutritious', 'fermented',
    ],
  },
  {
    name: 'cooking',
    displayName: 'Cooking & Kitchen',
    description: 'Cooking methods and kitchen items',
    icon: '🍳',
    topic: 'Food & Cooking',
    displayOrder: 2,
    keywords: [
      'cook', 'bake', 'fry', 'boil', 'roast', 'grill',
      'kitchen', 'oven', 'stove', 'pan', 'pot', 'knife',
      'culinary', 'chef', 'restaurant', 'dining',
    ],
  },

  // ===== Health & Body =====
  {
    name: 'body-anatomy',
    displayName: 'Body & Anatomy',
    description: 'Human body parts and anatomy',
    icon: '💪',
    topic: 'Health & Body',
    displayOrder: 1,
    keywords: [
      'body part', 'anatomy', 'organ', 'muscle', 'bone', 'joint',
      'tissue', 'cell', 'blood', 'nerve', 'brain', 'heart',
      'lung', 'liver', 'kidney', 'stomach', 'intestine',
      'skeletal', 'muscular', 'cardiovascular', 'digestive',
      'respiratory', 'nervous system',
    ],
  },
  {
    name: 'medicine-health',
    displayName: 'Medicine & Health',
    description: 'Medical terms and health vocabulary',
    icon: '🏥',
    topic: 'Health & Body',
    displayOrder: 2,
    keywords: [
      'medicine', 'medical', 'disease', 'illness', 'symptom',
      'diagnosis', 'treatment', 'therapy', 'surgery', 'surgical',
      'doctor', 'physician', 'nurse', 'hospital', 'clinic',
      'prescription', 'drug', 'pharmaceutical', 'vaccine',
      'infection', 'virus', 'bacteria', 'pathology', 'pathological',
      'chronic', 'acute', 'clinical', 'patient',
      'inflammation', 'disorder', 'syndrome', 'condition',
      'healthcare', 'wellness', 'mental health',
    ],
  },

  // ===== Science & Technology =====
  {
    name: 'science',
    displayName: 'Science',
    description: 'Scientific terms and concepts',
    icon: '🔬',
    topic: 'Science & Technology',
    displayOrder: 1,
    keywords: [
      'science', 'scientific', 'physics', 'chemistry', 'biology',
      'chemical', 'element', 'compound', 'molecule', 'atom',
      'energy', 'force', 'gravity', 'magnetic', 'electric',
      'experiment', 'hypothesis', 'theory', 'laboratory',
      'quantum', 'nuclear', 'particle', 'wavelength',
      'evolution', 'genetic', 'dna', 'genome', 'chromosome',
      'microscope', 'specimen', 'formula',
    ],
  },
  {
    name: 'technology',
    displayName: 'Technology & Computing',
    description: 'Technology, computers, and digital vocabulary',
    icon: '💻',
    topic: 'Science & Technology',
    displayOrder: 2,
    keywords: [
      'computer', 'software', 'hardware', 'program', 'programming',
      'internet', 'digital', 'electronic', 'device', 'technology',
      'algorithm', 'data', 'database', 'server', 'network',
      'website', 'app', 'application', 'code', 'coding',
      'artificial intelligence', 'machine learning', 'robot',
      'cyber', 'virtual', 'online', 'download', 'upload',
      'pixel', 'byte', 'bandwidth', 'encryption',
    ],
  },
  {
    name: 'mathematics',
    displayName: 'Mathematics',
    description: 'Mathematical terms and concepts',
    icon: '🔢',
    topic: 'Science & Technology',
    displayOrder: 3,
    keywords: [
      'mathematics', 'mathematical', 'arithmetic', 'algebra',
      'geometry', 'calculus', 'equation', 'formula', 'theorem',
      'number', 'integer', 'fraction', 'decimal', 'percentage',
      'trigonometry', 'logarithm', 'probability', 'statistics',
      'graph', 'function', 'variable', 'coefficient',
    ],
  },

  // ===== Business & Work =====
  {
    name: 'business',
    displayName: 'Business & Commerce',
    description: 'Business, finance, and commerce vocabulary',
    icon: '💼',
    topic: 'Business & Work',
    displayOrder: 1,
    keywords: [
      'business', 'company', 'corporation', 'enterprise',
      'finance', 'financial', 'economy', 'economic', 'market',
      'trade', 'commerce', 'commercial', 'profit', 'revenue',
      'investment', 'stock', 'bank', 'banking', 'currency',
      'accounting', 'budget', 'tax', 'salary', 'wage',
      'management', 'executive', 'entrepreneur', 'industry',
      'import', 'export', 'wholesale', 'retail',
    ],
  },
  {
    name: 'work-career',
    displayName: 'Work & Careers',
    description: 'Occupations, jobs, and workplace vocabulary',
    icon: '👔',
    topic: 'Business & Work',
    displayOrder: 2,
    keywords: [
      'occupation', 'profession', 'career', 'job', 'employ',
      'worker', 'employee', 'employer', 'office', 'workplace',
      'colleague', 'boss', 'manager', 'supervisor',
      'hire', 'interview', 'resume', 'skill', 'qualification',
    ],
  },

  // ===== Education =====
  {
    name: 'education',
    displayName: 'Education & Learning',
    description: 'School, university, and academic vocabulary',
    icon: '🎓',
    topic: 'Education',
    displayOrder: 1,
    keywords: [
      'education', 'school', 'university', 'college', 'academy',
      'student', 'teacher', 'professor', 'lecture', 'lesson',
      'study', 'learn', 'curriculum', 'course', 'class',
      'exam', 'test', 'grade', 'diploma', 'degree',
      'academic', 'research', 'scholarship', 'textbook',
      'literacy', 'pedagogy', 'tutor',
    ],
  },

  // ===== Daily Life =====
  {
    name: 'family',
    displayName: 'Family & Relationships',
    description: 'Family members and relationships',
    icon: '👪',
    topic: 'Daily Life',
    displayOrder: 1,
    keywords: [
      'family', 'relative', 'parent', 'mother', 'father',
      'sibling', 'brother', 'sister', 'son', 'daughter',
      'marriage', 'wedding', 'spouse', 'husband', 'wife',
      'kinship', 'ancestry', 'descendant', 'genealogy',
    ],
  },
  {
    name: 'home-household',
    displayName: 'Home & Household',
    description: 'House, furniture, and household items',
    icon: '🏠',
    topic: 'Daily Life',
    displayOrder: 2,
    keywords: [
      'house', 'home', 'room', 'furniture', 'household',
      'apartment', 'building', 'domestic', 'dwelling',
      'bedroom', 'bathroom', 'kitchen', 'garage',
      'door', 'window', 'ceiling', 'floor',
      'appliance', 'utensil',
    ],
  },
  {
    name: 'clothing',
    displayName: 'Clothing & Fashion',
    description: 'Clothes, fabrics, and fashion vocabulary',
    icon: '👗',
    topic: 'Daily Life',
    displayOrder: 3,
    keywords: [
      'clothing', 'garment', 'fabric', 'textile', 'fashion',
      'dress', 'shirt', 'pants', 'trousers', 'skirt',
      'shoe', 'boot', 'hat', 'coat', 'jacket',
      'silk', 'cotton', 'wool', 'leather', 'linen',
      'sew', 'tailor', 'stitch', 'weave', 'knit',
    ],
  },
  {
    name: 'time-calendar',
    displayName: 'Time & Calendar',
    description: 'Time, dates, and calendar vocabulary',
    icon: '⏰',
    topic: 'Daily Life',
    displayOrder: 4,
    keywords: [
      'time', 'calendar', 'clock', 'hour', 'minute', 'second',
      'day', 'week', 'month', 'year', 'century', 'decade',
      'season', 'morning', 'afternoon', 'evening', 'midnight',
      'schedule', 'deadline', 'duration', 'period',
    ],
  },

  // ===== Emotions & Personality =====
  {
    name: 'emotions',
    displayName: 'Emotions & Feelings',
    description: 'Words describing emotions and feelings',
    icon: '😊',
    topic: 'Emotions & Personality',
    displayOrder: 1,
    keywords: [
      'emotion', 'feeling', 'mood', 'sentiment',
      'happy', 'sad', 'angry', 'fear', 'anxiety', 'anxious',
      'joy', 'sorrow', 'grief', 'delight', 'pleasure',
      'love', 'hatred', 'jealousy', 'envy', 'pride',
      'shame', 'guilt', 'empathy', 'sympathy', 'compassion',
      'excitement', 'boredom', 'frustration', 'contentment',
    ],
  },
  {
    name: 'personality',
    displayName: 'Personality & Character',
    description: 'Personality traits and character descriptions',
    icon: '🧠',
    topic: 'Emotions & Personality',
    displayOrder: 2,
    keywords: [
      'personality', 'character', 'trait', 'temperament',
      'brave', 'coward', 'generous', 'selfish', 'honest',
      'stubborn', 'gentle', 'cruel', 'kind', 'arrogant',
      'humble', 'confident', 'shy', 'introvert', 'extrovert',
      'optimist', 'pessimist', 'ambitious', 'lazy',
    ],
  },

  // ===== Travel & Places =====
  {
    name: 'travel',
    displayName: 'Travel & Transport',
    description: 'Travel, vehicles, and transportation',
    icon: '✈️',
    topic: 'Travel & Places',
    displayOrder: 1,
    keywords: [
      'travel', 'journey', 'trip', 'voyage', 'tour',
      'vehicle', 'car', 'bus', 'train', 'airplane', 'ship',
      'transport', 'traffic', 'road', 'highway', 'railway',
      'airport', 'station', 'port', 'harbor', 'harbour',
      'passport', 'visa', 'luggage', 'tourist', 'tourism',
      'navigation', 'route', 'destination',
    ],
  },
  {
    name: 'geography',
    displayName: 'Geography & Places',
    description: 'Countries, cities, and geographical terms',
    icon: '🌍',
    topic: 'Travel & Places',
    displayOrder: 2,
    keywords: [
      'geography', 'geographical', 'country', 'nation', 'state',
      'city', 'town', 'village', 'region', 'province',
      'continent', 'territory', 'border', 'capital',
      'population', 'map', 'latitude', 'longitude',
      'inhabitant', 'native of', 'resident of',
      'relating to', 'pertaining to',
    ],
  },

  // ===== Arts & Entertainment =====
  {
    name: 'music',
    displayName: 'Music',
    description: 'Musical terms and instruments',
    icon: '🎵',
    topic: 'Arts & Entertainment',
    displayOrder: 1,
    keywords: [
      'music', 'musical', 'song', 'melody', 'harmony',
      'rhythm', 'tempo', 'instrument', 'guitar', 'piano',
      'violin', 'drum', 'orchestra', 'symphony', 'concert',
      'singer', 'musician', 'composer', 'conductor',
      'chord', 'note', 'scale', 'pitch', 'tone',
    ],
  },
  {
    name: 'art-literature',
    displayName: 'Art & Literature',
    description: 'Visual arts, writing, and literature',
    icon: '🎨',
    topic: 'Arts & Entertainment',
    displayOrder: 2,
    keywords: [
      'art', 'artistic', 'painting', 'sculpture', 'drawing',
      'literature', 'literary', 'novel', 'poem', 'poetry',
      'author', 'writer', 'artist', 'painter', 'sculptor',
      'fiction', 'narrative', 'drama', 'theater', 'theatre',
      'gallery', 'museum', 'exhibition', 'canvas',
      'prose', 'verse', 'metaphor', 'allegory',
    ],
  },
  {
    name: 'entertainment',
    displayName: 'Entertainment & Media',
    description: 'Movies, TV, games, and media',
    icon: '🎬',
    topic: 'Arts & Entertainment',
    displayOrder: 3,
    keywords: [
      'movie', 'film', 'cinema', 'television', 'broadcast',
      'media', 'news', 'newspaper', 'magazine', 'publish',
      'entertainment', 'perform', 'performance', 'show',
      'comedy', 'tragedy', 'actor', 'actress', 'director',
      'game', 'gamble', 'casino', 'card game', 'board game',
    ],
  },

  // ===== Sports & Fitness =====
  {
    name: 'sports',
    displayName: 'Sports & Fitness',
    description: 'Sports, exercise, and physical activities',
    icon: '⚽',
    topic: 'Sports & Fitness',
    displayOrder: 1,
    keywords: [
      'sport', 'athletic', 'athlete', 'exercise', 'fitness',
      'football', 'soccer', 'basketball', 'baseball', 'tennis',
      'swimming', 'running', 'boxing', 'wrestling', 'golf',
      'championship', 'tournament', 'competition', 'medal',
      'team', 'player', 'coach', 'referee', 'score',
      'gymnasium', 'stadium', 'olympic',
    ],
  },

  // ===== Society & Culture =====
  {
    name: 'law-government',
    displayName: 'Law & Government',
    description: 'Legal, political, and governmental terms',
    icon: '⚖️',
    topic: 'Society & Culture',
    displayOrder: 1,
    keywords: [
      'law', 'legal', 'court', 'judge', 'lawyer', 'attorney',
      'government', 'political', 'politics', 'parliament',
      'constitution', 'legislation', 'statute', 'regulation',
      'crime', 'criminal', 'prison', 'police', 'arrest',
      'democracy', 'republic', 'election', 'vote', 'president',
      'jurisdiction', 'verdict', 'trial', 'lawsuit',
    ],
  },
  {
    name: 'religion-philosophy',
    displayName: 'Religion & Philosophy',
    description: 'Religious and philosophical vocabulary',
    icon: '🙏',
    topic: 'Society & Culture',
    displayOrder: 2,
    keywords: [
      'religion', 'religious', 'spiritual', 'sacred', 'holy',
      'god', 'deity', 'worship', 'prayer', 'church', 'temple',
      'bible', 'quran', 'scripture', 'faith', 'belief',
      'philosophy', 'philosophical', 'ethics', 'moral',
      'theology', 'doctrine', 'ritual', 'ceremony',
      'buddhism', 'christianity', 'islam', 'hinduism',
      'soul', 'divine', 'salvation', 'sin',
    ],
  },
  {
    name: 'military-war',
    displayName: 'Military & War',
    description: 'Military, warfare, and defense vocabulary',
    icon: '⚔️',
    topic: 'Society & Culture',
    displayOrder: 3,
    keywords: [
      'military', 'army', 'navy', 'soldier', 'warrior',
      'war', 'battle', 'combat', 'weapon', 'sword', 'gun',
      'defense', 'defence', 'attack', 'siege', 'invasion',
      'general', 'officer', 'rank', 'regiment', 'troop',
      'missile', 'bomb', 'artillery', 'ammunition',
      'fortress', 'barracks', 'strategy', 'tactics',
    ],
  },
  {
    name: 'history',
    displayName: 'History',
    description: 'Historical terms and periods',
    icon: '📜',
    topic: 'Society & Culture',
    displayOrder: 4,
    keywords: [
      'history', 'historical', 'ancient', 'medieval', 'renaissance',
      'empire', 'dynasty', 'kingdom', 'colony', 'colonial',
      'civilization', 'era', 'epoch', 'century', 'prehistoric',
      'archaeology', 'artifact', 'relic', 'heritage',
      'revolution', 'independence', 'monarchy',
    ],
  },

  // ===== Communication =====
  {
    name: 'language-grammar',
    displayName: 'Language & Grammar',
    description: 'Linguistic and grammatical terms',
    icon: '📝',
    topic: 'Education',
    displayOrder: 2,
    keywords: [
      'language', 'linguistic', 'grammar', 'syntax', 'semantics',
      'word', 'sentence', 'paragraph', 'phrase', 'clause',
      'noun', 'verb', 'adjective', 'adverb', 'pronoun',
      'vowel', 'consonant', 'syllable', 'phonetic',
      'dialect', 'slang', 'jargon', 'vocabulary',
      'suffix', 'prefix', 'etymology',
    ],
  },

  // ===== Architecture & Construction =====
  {
    name: 'architecture',
    displayName: 'Architecture & Construction',
    description: 'Building, architecture, and construction',
    icon: '🏗️',
    topic: 'Society & Culture',
    displayOrder: 5,
    keywords: [
      'architecture', 'building', 'construct', 'structure',
      'design', 'blueprint', 'foundation', 'column', 'arch',
      'brick', 'concrete', 'steel', 'timber', 'cement',
      'cathedral', 'tower', 'bridge', 'monument',
      'carpenter', 'mason', 'plumber', 'electrician',
    ],
  },

  // ===== Colors & Descriptions =====
  {
    name: 'colors',
    displayName: 'Colors & Appearance',
    description: 'Colors and visual descriptions',
    icon: '🎨',
    topic: 'Arts & Entertainment',
    displayOrder: 4,
    keywords: [
      'color', 'colour', 'shade', 'tint', 'hue', 'pigment',
      'red', 'blue', 'green', 'yellow', 'purple', 'orange',
      'bright', 'dark', 'light', 'pale', 'vivid',
      'transparent', 'opaque', 'dye', 'stain',
    ],
  },
];

async function main() {
  console.log('🚀 Starting word categorization...\n');

  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'dictionary_user',
    password: process.env.DB_PASSWORD || 'dictionary_pass',
    database: process.env.DB_DATABASE || 'english_learning_db',
    entities: [Word, Definition, Example, Pronunciation, WordForm, Synonym, Category, CategoryWord],
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  console.log('✅ Database connected\n');

  const categoryRepo = dataSource.getRepository(Category);
  const categoryWordRepo = dataSource.getRepository(CategoryWord);
  const queryRunner = dataSource.createQueryRunner();

  // Step 1: Get total word count
  const totalWords = await dataSource.getRepository(Word).count();
  console.log(`📊 Total words in database: ${totalWords.toLocaleString()}\n`);

  // Step 2: Clear existing category_words (start fresh for full categorization)
  console.log('🧹 Clearing existing category-word mappings...');
  await queryRunner.query('DELETE FROM category_words');
  console.log('   Done.\n');

  // Step 3: Ensure all categories exist
  console.log('📁 Creating/updating categories...');
  const categoryMap = new Map<string, number>(); // name -> id

  for (const rule of CATEGORY_RULES) {
    let category = await categoryRepo.findOne({ where: { name: rule.name } });
    if (!category) {
      category = categoryRepo.create({
        name: rule.name,
        displayName: rule.displayName,
        description: rule.description,
        icon: rule.icon,
        topic: rule.topic,
        displayOrder: rule.displayOrder,
      });
      category = await categoryRepo.save(category);
      console.log(`   ✅ Created: ${rule.displayName}`);
    } else {
      // Update existing
      category.displayName = rule.displayName;
      category.description = rule.description;
      category.icon = rule.icon;
      category.topic = rule.topic;
      category.displayOrder = rule.displayOrder;
      await categoryRepo.save(category);
    }
    categoryMap.set(rule.name, Number(category.id));
  }

  // Create "Others" category
  let othersCategory = await categoryRepo.findOne({ where: { name: 'others' } });
  if (!othersCategory) {
    othersCategory = categoryRepo.create({
      name: 'others',
      displayName: 'Others',
      description: 'Words that do not belong to a specific category',
      icon: '📦',
      topic: 'Others',
      displayOrder: 99,
    });
    othersCategory = await categoryRepo.save(othersCategory);
    console.log('   ✅ Created: Others');
  }
  categoryMap.set('others', Number(othersCategory.id));

  // Remove old seed-only categories that are now replaced
  const oldCategories = ['greetings', 'actions', 'home', 'body', 'health',
    'work', 'colors-shapes', 'time', 'nature'];
  for (const oldName of oldCategories) {
    if (!CATEGORY_RULES.find(r => r.name === oldName)) {
      await categoryRepo.delete({ name: oldName });
    }
  }

  console.log(`   Total categories: ${categoryMap.size}\n`);

  // Step 4: Categorize words using SQL for performance
  console.log('🏷️  Categorizing words by definition keywords...\n');

  for (const rule of CATEGORY_RULES) {
    const categoryId = categoryMap.get(rule.name)!;

    // Build a SQL ILIKE query for keyword matching against definitions
    const conditions = rule.keywords.map((kw, i) => `d.definition_en ILIKE $${i + 2}`);
    const params = [categoryId, ...rule.keywords.map(kw => `%${kw}%`)];

    // Find words whose definitions match any keyword and insert
    const query = `
      INSERT INTO category_words (category_id, word_id, display_order, added_at)
      SELECT DISTINCT $1::bigint, w.id, 0, NOW()
      FROM words w
      INNER JOIN definitions d ON d.word_id = w.id
      WHERE (${conditions.join(' OR ')})
      ON CONFLICT (category_id, word_id) DO NOTHING
    `;

    await queryRunner.query(query, params);

    // Count words for this category
    const countResult = await queryRunner.query(
      `SELECT COUNT(*) as count FROM category_words WHERE category_id = $1`,
      [categoryId]
    );
    const catWordCount = parseInt(countResult[0].count);
    console.log(`   ${rule.icon} ${rule.displayName}: ${catWordCount.toLocaleString()} words`);
  }

  // Count how many unique words are categorized
  const categorizedCount = await queryRunner.query(
    `SELECT COUNT(DISTINCT word_id) as count FROM category_words`
  );
  console.log(`\n📊 Words categorized so far: ${parseInt(categorizedCount[0].count).toLocaleString()} / ${totalWords.toLocaleString()}`);

  // Step 5: Put remaining words into "Others" using NOT EXISTS (faster than NOT IN)
  const othersId = categoryMap.get('others')!;
  console.log('\n📦 Assigning uncategorized words to "Others"...');

  await queryRunner.query(`
    INSERT INTO category_words (category_id, word_id, display_order, added_at)
    SELECT $1::bigint, w.id, 0, NOW()
    FROM words w
    WHERE NOT EXISTS (
      SELECT 1 FROM category_words cw WHERE cw.word_id = w.id
    )
    ON CONFLICT (category_id, word_id) DO NOTHING
  `, [othersId]);

  const othersCount = await queryRunner.query(`
    SELECT COUNT(*) as count FROM category_words WHERE category_id = $1
  `, [othersId]);
  console.log(`   📦 Others: ${parseInt(othersCount[0].count).toLocaleString()} words`);

  // Step 6: Final summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(60));

  const summary = await queryRunner.query(`
    SELECT c.display_name, c.icon, c.topic, COUNT(cw.id) as word_count
    FROM categories c
    LEFT JOIN category_words cw ON cw.category_id = c.id
    GROUP BY c.id, c.display_name, c.icon, c.topic, c.display_order
    ORDER BY c.topic, c.display_order
  `);

  let grandTotal = 0;
  let currentTopic = '';
  for (const row of summary) {
    if (row.topic !== currentTopic) {
      currentTopic = row.topic;
      console.log(`\n  📂 ${currentTopic}`);
    }
    const count = parseInt(row.word_count);
    grandTotal += count;
    console.log(`     ${row.icon} ${row.display_name}: ${count.toLocaleString()} words`);
  }

  // Check for words with multiple categories
  const multiCatCount = await queryRunner.query(`
    SELECT COUNT(*) as count FROM (
      SELECT word_id FROM category_words GROUP BY word_id HAVING COUNT(*) > 1
    ) sub
  `);

  console.log(`\n  Total word-category mappings: ${grandTotal.toLocaleString()}`);
  console.log(`  Words in multiple categories: ${parseInt(multiCatCount[0].count).toLocaleString()}`);
  console.log(`  Total unique words: ${totalWords.toLocaleString()}`);

  // Verify every word has at least one category
  const uncategorized = await queryRunner.query(`
    SELECT COUNT(*) as count FROM words w
    WHERE w.id NOT IN (SELECT DISTINCT word_id FROM category_words)
  `);
  console.log(`  Uncategorized words: ${parseInt(uncategorized[0].count)}`);

  console.log('\n✅ Categorization complete!');

  await queryRunner.release();
  await dataSource.destroy();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
