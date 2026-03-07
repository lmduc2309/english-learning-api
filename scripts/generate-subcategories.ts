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
 * Generate SEMANTIC subcategories for each parent category.
 * Uses definition-text keyword matching (same approach as categorize-words.ts).
 * Words that don't match any subcategory go into a "General" subcategory.
 */

interface SubcategoryRule {
  name: string;        // slug appended to parent: e.g. animals-land-mammals
  displayName: string; // shown in UI
  description: string;
  icon: string;
  keywords: string[];  // matched via ILIKE against definitions.definition_en
}

// ── Semantic subcategory definitions per parent category ──────────────

const SUBCATEGORY_MAP: Record<string, SubcategoryRule[]> = {

  // ═══════════════════ NATURE ═══════════════════

  animals: [
    {
      name: 'land-mammals',
      displayName: 'Land Mammals',
      description: 'Four-legged mammals and land animals',
      icon: '🦁',
      keywords: [
        'mammal', 'four-legged', 'quadruped', 'canine', 'feline', 'bovine',
        'equine', 'porcine', 'ovine', 'rodent', 'marsupial', 'primate',
        'breed of dog', 'breed of cat', 'wild cat', 'a large cat',
        'family felidae', 'family canidae', 'deer', 'bear', 'wolf', 'fox',
        'lion', 'tiger', 'elephant', 'giraffe', 'zebra', 'horse', 'donkey',
        'cattle', 'sheep', 'goat', 'pig', 'rabbit', 'hare', 'squirrel',
        'mouse', 'rat', 'bat', 'monkey', 'ape', 'gorilla', 'chimpanzee',
        'leopard', 'cheetah', 'panther', 'hyena', 'rhinoceros', 'hippopotamus',
        'buffalo', 'bison', 'camel', 'llama', 'antelope', 'gazelle',
        'domestic animal', 'domestic cat', 'domestic dog',
      ],
    },
    {
      name: 'birds',
      displayName: 'Birds',
      description: 'Birds and avian vocabulary',
      icon: '🐦',
      keywords: [
        'bird', 'avian', 'feather', 'beak', 'nest', 'wing',
        'eagle', 'hawk', 'falcon', 'owl', 'parrot', 'pigeon', 'dove',
        'sparrow', 'robin', 'crow', 'raven', 'swan', 'duck', 'goose',
        'penguin', 'flamingo', 'pelican', 'heron', 'stork', 'crane',
        'woodpecker', 'hummingbird', 'songbird', 'waterfowl', 'raptor',
        'a small bird', 'a type of bird', 'passerine', 'wading bird',
        'a large bird', 'flightless bird', 'migratory bird',
      ],
    },
    {
      name: 'fish-marine',
      displayName: 'Fish & Marine Life',
      description: 'Fish, sea creatures, and ocean animals',
      icon: '🐟',
      keywords: [
        'fish', 'marine', 'aquatic', 'sea creature', 'marine animal',
        'shark', 'whale', 'dolphin', 'octopus', 'squid', 'jellyfish',
        'coral', 'shellfish', 'lobster', 'crab', 'shrimp', 'oyster',
        'clam', 'mussel', 'starfish', 'sea urchin', 'seahorse',
        'a type of fish', 'species of fish', 'freshwater fish', 'saltwater',
        'crustacean', 'mollusk', 'mollusc', 'invertebrate',
        'salmon', 'tuna', 'trout', 'cod', 'herring', 'sardine',
        'eel', 'ray', 'stingray', 'swordfish', 'catfish',
        'sea turtle', 'seal', 'walrus', 'otter', 'manatee',
      ],
    },
    {
      name: 'insects-bugs',
      displayName: 'Insects & Bugs',
      description: 'Insects, spiders, and small creatures',
      icon: '🐛',
      keywords: [
        'insect', 'bug', 'beetle', 'ant', 'bee', 'wasp', 'hornet',
        'butterfly', 'moth', 'caterpillar', 'larva', 'larvae',
        'mosquito', 'fly', 'dragonfly', 'grasshopper', 'cricket',
        'cockroach', 'termite', 'flea', 'tick', 'louse', 'lice',
        'arachnid', 'spider', 'scorpion', 'centipede', 'millipede',
        'worm', 'earthworm', 'maggot', 'grub', 'pupa', 'cocoon',
        'locust', 'mantis', 'firefly', 'ladybug', 'ladybird',
      ],
    },
    {
      name: 'reptiles-amphibians',
      displayName: 'Reptiles & Amphibians',
      description: 'Reptiles, amphibians, and cold-blooded animals',
      icon: '🦎',
      keywords: [
        'reptile', 'amphibian', 'snake', 'lizard', 'turtle', 'tortoise',
        'crocodile', 'alligator', 'gecko', 'chameleon', 'iguana',
        'frog', 'toad', 'salamander', 'newt', 'tadpole',
        'viper', 'cobra', 'python', 'boa', 'rattlesnake',
        'cold-blooded', 'scales', 'venomous snake',
        'komodo', 'dinosaur', 'monitor lizard',
      ],
    },
  ],

  'plants-trees': [
    {
      name: 'flowers',
      displayName: 'Flowers',
      description: 'Flowering plants and blossoms',
      icon: '🌸',
      keywords: [
        'flower', 'blossom', 'bloom', 'petal', 'bouquet', 'floral',
        'rose', 'lily', 'tulip', 'daisy', 'sunflower', 'orchid',
        'violet', 'jasmine', 'lavender', 'carnation', 'chrysanthemum',
        'daffodil', 'iris', 'marigold', 'poppy', 'peony', 'hibiscus',
        'lotus', 'magnolia', 'gardenia', 'begonia', 'geranium',
        'genus of flowering', 'wildflower', 'perennial flower',
      ],
    },
    {
      name: 'trees-shrubs',
      displayName: 'Trees & Shrubs',
      description: 'Trees, shrubs, and woody plants',
      icon: '🌳',
      keywords: [
        'tree', 'shrub', 'bush', 'timber', 'lumber', 'wood',
        'oak', 'pine', 'maple', 'birch', 'willow', 'elm', 'cedar',
        'spruce', 'fir', 'cypress', 'beech', 'chestnut', 'walnut',
        'eucalyptus', 'palm', 'bamboo', 'redwood', 'sequoia',
        'evergreen', 'deciduous', 'conifer', 'hardwood', 'softwood',
        'bark', 'trunk', 'branch', 'canopy', 'sapling',
      ],
    },
    {
      name: 'grasses-ferns',
      displayName: 'Grasses, Ferns & Mosses',
      description: 'Grasses, ferns, mosses and non-flowering plants',
      icon: '🌿',
      keywords: [
        'grass', 'fern', 'moss', 'lichen', 'reed', 'sedge',
        'bamboo grass', 'lawn', 'meadow grass', 'turf',
        'seaweed', 'kelp', 'algae', 'aquatic plant', 'water plant',
        'ivy', 'vine', 'creeper', 'climber',
        'spore', 'frond', 'rhizome',
      ],
    },
    {
      name: 'fungi-mushrooms',
      displayName: 'Fungi & Mushrooms',
      description: 'Fungi, mushrooms, and related organisms',
      icon: '🍄',
      keywords: [
        'fungus', 'fungi', 'mushroom', 'toadstool', 'mold', 'mould',
        'yeast', 'truffle', 'spore', 'mycelium', 'lichen',
      ],
    },
    {
      name: 'seeds-fruits',
      displayName: 'Seeds, Fruits & Crops',
      description: 'Seeds, fruits, agriculture and crop plants',
      icon: '🌾',
      keywords: [
        'seed', 'grain', 'crop', 'harvest', 'agriculture', 'cultivate',
        'wheat', 'rice', 'corn', 'barley', 'oat', 'rye', 'sorghum',
        'pollen', 'pollination', 'germinate', 'sprout',
        'root', 'bulb', 'tuber', 'herb',
        'botanical', 'horticulture', 'garden', 'nursery',
        'genus of plant', 'family of plant', 'tropical plant',
        'vegetation', 'flora', 'photosynthesis',
      ],
    },
  ],

  'nature-environment': [
    {
      name: 'weather-climate',
      displayName: 'Weather & Climate',
      description: 'Weather phenomena and climate terms',
      icon: '🌦️',
      keywords: [
        'weather', 'climate', 'rain', 'snow', 'hail', 'sleet',
        'wind', 'storm', 'thunder', 'lightning', 'hurricane',
        'tornado', 'typhoon', 'cyclone', 'blizzard', 'drought',
        'fog', 'mist', 'cloud', 'sunshine', 'rainbow',
        'temperature', 'humidity', 'barometer', 'forecast',
        'monsoon', 'frost', 'ice', 'dew', 'atmosphere',
      ],
    },
    {
      name: 'water-bodies',
      displayName: 'Water Bodies',
      description: 'Oceans, rivers, lakes and water features',
      icon: '🌊',
      keywords: [
        'ocean', 'sea', 'lake', 'river', 'stream', 'creek', 'brook',
        'pond', 'waterfall', 'spring', 'bay', 'gulf', 'strait',
        'lagoon', 'estuary', 'delta', 'marsh', 'swamp', 'wetland',
        'tide', 'wave', 'current', 'flood', 'tributary',
        'reservoir', 'canal', 'dam', 'aquifer',
      ],
    },
    {
      name: 'landforms-terrain',
      displayName: 'Landforms & Terrain',
      description: 'Mountains, valleys, and terrain features',
      icon: '⛰️',
      keywords: [
        'mountain', 'hill', 'valley', 'canyon', 'gorge', 'cliff',
        'plateau', 'plain', 'prairie', 'mesa', 'butte',
        'volcano', 'crater', 'ridge', 'peak', 'summit',
        'cave', 'cavern', 'grotto', 'peninsula', 'cape',
        'island', 'archipelago', 'atoll', 'glacier',
        'desert', 'dune', 'oasis', 'tundra', 'steppe',
        'forest', 'jungle', 'woodland', 'savanna',
        'terrain', 'topography', 'landform', 'landscape',
      ],
    },
    {
      name: 'rocks-minerals',
      displayName: 'Rocks & Minerals',
      description: 'Rocks, minerals, gems, and geology',
      icon: '💎',
      keywords: [
        'rock', 'stone', 'mineral', 'crystal', 'gem', 'gemstone',
        'diamond', 'ruby', 'emerald', 'sapphire', 'quartz',
        'granite', 'marble', 'limestone', 'sandstone', 'basalt',
        'ore', 'fossil', 'sediment', 'stratum', 'geological',
        'geology', 'earthquake', 'seismic', 'tectonic',
        'soil', 'clay', 'sand', 'gravel', 'pebble',
      ],
    },
    {
      name: 'ecology-conservation',
      displayName: 'Ecology & Conservation',
      description: 'Ecosystems, conservation and environment',
      icon: '♻️',
      keywords: [
        'ecology', 'ecosystem', 'habitat', 'biome', 'biodiversity',
        'conservation', 'endangered', 'extinction', 'wildlife',
        'pollution', 'contamination', 'emission', 'carbon',
        'recycle', 'renewable', 'sustainable', 'organic',
        'deforestation', 'erosion', 'ozone', 'greenhouse',
        'nature reserve', 'national park', 'environment',
      ],
    },
  ],

  // ═══════════════════ FOOD & COOKING ═══════════════════

  'food-drink': [
    {
      name: 'fruits-vegetables',
      displayName: 'Fruits & Vegetables',
      description: 'Fresh produce and plant-based foods',
      icon: '🥗',
      keywords: [
        'fruit', 'vegetable', 'apple', 'banana', 'orange', 'grape',
        'strawberry', 'blueberry', 'raspberry', 'cherry', 'peach',
        'mango', 'pineapple', 'watermelon', 'melon', 'lemon', 'lime',
        'tomato', 'potato', 'carrot', 'onion', 'garlic', 'pepper',
        'broccoli', 'spinach', 'lettuce', 'cabbage', 'celery',
        'cucumber', 'beans', 'peas', 'corn', 'pumpkin', 'squash',
        'avocado', 'coconut', 'olive', 'berry', 'citrus',
      ],
    },
    {
      name: 'meat-seafood',
      displayName: 'Meat & Seafood',
      description: 'Meat, poultry, and seafood products',
      icon: '🥩',
      keywords: [
        'meat', 'beef', 'pork', 'lamb', 'veal', 'venison',
        'poultry', 'chicken', 'turkey', 'duck meat',
        'steak', 'sausage', 'bacon', 'ham', 'salami',
        'seafood', 'shrimp', 'lobster', 'crab meat', 'tuna',
        'salmon', 'cod', 'fillet', 'cutlet', 'roast',
      ],
    },
    {
      name: 'baked-desserts',
      displayName: 'Baked Goods & Desserts',
      description: 'Bread, pastries, cakes, and sweet treats',
      icon: '🍰',
      keywords: [
        'bread', 'cake', 'pastry', 'pie', 'cookie', 'biscuit',
        'dessert', 'candy', 'chocolate', 'ice cream', 'pudding',
        'doughnut', 'muffin', 'croissant', 'waffle', 'pancake',
        'tart', 'brownie', 'cupcake', 'confection', 'sweet',
        'sugar', 'syrup', 'honey', 'caramel', 'frosting',
      ],
    },
    {
      name: 'beverages',
      displayName: 'Beverages',
      description: 'Drinks, beverages, and liquid refreshments',
      icon: '🥤',
      keywords: [
        'beverage', 'drink', 'juice', 'water', 'milk',
        'coffee', 'tea', 'soda', 'lemonade', 'smoothie',
        'wine', 'beer', 'whiskey', 'vodka', 'rum', 'gin',
        'cocktail', 'champagne', 'ale', 'cider', 'brandy',
        'alcohol', 'alcoholic', 'liquor', 'liqueur', 'brew',
        'fermented', 'distilled', 'espresso', 'latte', 'cappuccino',
      ],
    },
    {
      name: 'dairy-grains',
      displayName: 'Dairy & Grains',
      description: 'Dairy products, grains, and staples',
      icon: '🧀',
      keywords: [
        'dairy', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt',
        'milk product', 'whey', 'curd', 'margarine',
        'grain', 'cereal', 'rice', 'wheat', 'oat', 'barley',
        'flour', 'pasta', 'noodle', 'dough',
        'egg', 'tofu', 'soy', 'legume', 'lentil', 'chickpea',
        'nut', 'almond', 'walnut', 'peanut', 'cashew',
      ],
    },
    {
      name: 'spices-condiments',
      displayName: 'Spices & Condiments',
      description: 'Spices, seasonings, sauces, and condiments',
      icon: '🌶️',
      keywords: [
        'spice', 'seasoning', 'condiment', 'sauce', 'dressing',
        'salt', 'pepper', 'cinnamon', 'ginger', 'turmeric',
        'oregano', 'basil', 'thyme', 'rosemary', 'parsley',
        'mustard', 'ketchup', 'mayonnaise', 'vinegar', 'soy sauce',
        'flavor', 'flavour', 'taste', 'savory', 'pungent',
        'herb', 'cumin', 'paprika', 'nutmeg', 'curry',
      ],
    },
  ],

  cooking: [
    {
      name: 'cooking-methods',
      displayName: 'Cooking Methods',
      description: 'Ways to prepare and cook food',
      icon: '🔥',
      keywords: [
        'cook', 'bake', 'fry', 'boil', 'roast', 'grill', 'broil',
        'steam', 'simmer', 'sauté', 'saute', 'stew', 'braise',
        'poach', 'blanch', 'marinate', 'ferment', 'smoke',
        'deep fry', 'stir fry', 'barbecue', 'char', 'sear',
        'blend', 'whisk', 'knead', 'chop', 'dice', 'slice', 'mince',
        'peel', 'grate', 'puree', 'culinary',
      ],
    },
    {
      name: 'kitchen-tools',
      displayName: 'Kitchen Tools & Equipment',
      description: 'Kitchen utensils, appliances, and equipment',
      icon: '🍽️',
      keywords: [
        'kitchen', 'oven', 'stove', 'pan', 'pot', 'knife', 'fork',
        'spoon', 'plate', 'bowl', 'cup', 'glass', 'mug',
        'blender', 'mixer', 'toaster', 'microwave', 'refrigerator',
        'cutting board', 'spatula', 'ladle', 'tongs', 'colander',
        'wok', 'skillet', 'saucepan', 'kettle', 'utensil',
      ],
    },
    {
      name: 'dining-restaurants',
      displayName: 'Dining & Restaurants',
      description: 'Eating out, restaurants, and dining',
      icon: '🍷',
      keywords: [
        'restaurant', 'dining', 'dine', 'menu', 'chef', 'waiter',
        'serve', 'meal', 'dish', 'cuisine', 'recipe',
        'appetizer', 'entrée', 'entree', 'dessert course',
        'cafe', 'bistro', 'buffet', 'banquet', 'feast',
        'reservation', 'takeaway', 'delivery',
      ],
    },
  ],

  // ═══════════════════ HEALTH & BODY ═══════════════════

  'body-anatomy': [
    {
      name: 'bones-skeleton',
      displayName: 'Bones & Skeleton',
      description: 'Skeletal system, bones, and joints',
      icon: '🦴',
      keywords: [
        'bone', 'skeleton', 'skeletal', 'joint', 'cartilage',
        'skull', 'spine', 'vertebra', 'rib', 'pelvis',
        'femur', 'tibia', 'fibula', 'humerus', 'radius', 'ulna',
        'fracture', 'marrow', 'tendon', 'ligament',
        'collarbone', 'kneecap', 'shoulder blade',
      ],
    },
    {
      name: 'organs-systems',
      displayName: 'Internal Organs',
      description: 'Internal organs and body systems',
      icon: '🫀',
      keywords: [
        'organ', 'heart', 'lung', 'liver', 'kidney', 'stomach',
        'intestine', 'bowel', 'pancreas', 'spleen', 'bladder',
        'gallbladder', 'appendix', 'diaphragm', 'esophagus',
        'cardiovascular', 'digestive', 'respiratory', 'circulatory',
        'blood', 'artery', 'vein', 'capillary', 'pulse',
      ],
    },
    {
      name: 'brain-nerves',
      displayName: 'Brain & Nervous System',
      description: 'Brain, nerves, and the nervous system',
      icon: '🧠',
      keywords: [
        'brain', 'nerve', 'neuron', 'nervous system', 'spinal cord',
        'cerebral', 'cortex', 'synapse', 'neurology', 'neural',
        'reflex', 'sensory', 'motor nerve', 'hemisphere',
        'cerebellum', 'hippocampus', 'cell',
      ],
    },
    {
      name: 'muscles-movement',
      displayName: 'Muscles & Movement',
      description: 'Muscles, movement, and the muscular system',
      icon: '💪',
      keywords: [
        'muscle', 'muscular', 'tissue', 'flex', 'contract',
        'bicep', 'tricep', 'abdomen', 'torso', 'limb',
        'anatomy', 'body part', 'physiology',
        'hand', 'foot', 'arm', 'leg', 'finger', 'toe',
        'head', 'neck', 'chest', 'back', 'hip', 'wrist',
        'elbow', 'ankle', 'knee', 'skin', 'hair', 'nail',
      ],
    },
  ],

  'medicine-health': [
    {
      name: 'diseases-conditions',
      displayName: 'Diseases & Conditions',
      description: 'Diseases, illnesses, and medical conditions',
      icon: '🦠',
      keywords: [
        'disease', 'illness', 'disorder', 'syndrome', 'condition',
        'infection', 'virus', 'bacteria', 'pathology', 'pathological',
        'chronic', 'acute', 'malignant', 'benign', 'tumor', 'tumour',
        'cancer', 'diabetes', 'asthma', 'allergy', 'inflammation',
        'fever', 'pneumonia', 'arthritis', 'anemia', 'anaemia',
        'congenital', 'hereditary', 'autoimmune',
      ],
    },
    {
      name: 'treatment-therapy',
      displayName: 'Treatment & Therapy',
      description: 'Medical treatments, therapies, and procedures',
      icon: '💊',
      keywords: [
        'treatment', 'therapy', 'cure', 'remedy', 'heal',
        'medicine', 'medication', 'prescription', 'drug', 'pharmaceutical',
        'vaccine', 'vaccination', 'immunization', 'antibiotic',
        'surgery', 'surgical', 'operation', 'transplant',
        'rehabilitation', 'recovery', 'dose', 'dosage',
      ],
    },
    {
      name: 'medical-professionals',
      displayName: 'Medical Professionals',
      description: 'Doctors, nurses, and healthcare workers',
      icon: '👨‍⚕️',
      keywords: [
        'doctor', 'physician', 'surgeon', 'nurse', 'dentist',
        'pharmacist', 'therapist', 'psychiatrist', 'psychologist',
        'pediatrician', 'cardiologist', 'dermatologist', 'neurologist',
        'hospital', 'clinic', 'patient', 'diagnosis', 'examine',
        'medical', 'clinical', 'healthcare', 'wellness',
      ],
    },
    {
      name: 'mental-health',
      displayName: 'Mental Health',
      description: 'Mental health, psychology, and wellbeing',
      icon: '🧘',
      keywords: [
        'mental health', 'psychology', 'psychiatric', 'depression',
        'anxiety', 'stress', 'trauma', 'phobia', 'obsessive',
        'bipolar', 'schizophrenia', 'dementia', 'insomnia',
        'counseling', 'counselling', 'mindfulness', 'meditation',
        'cognitive', 'behavioral', 'behavioural', 'psychotherapy',
      ],
    },
  ],

  // ═══════════════════ SCIENCE & TECHNOLOGY ═══════════════════

  science: [
    {
      name: 'physics',
      displayName: 'Physics',
      description: 'Physics concepts, forces, and energy',
      icon: '⚛️',
      keywords: [
        'physics', 'physical', 'force', 'gravity', 'momentum',
        'velocity', 'acceleration', 'mass', 'weight', 'density',
        'energy', 'kinetic', 'potential', 'thermodynamic',
        'magnetic', 'electromagnetic', 'electric', 'voltage',
        'quantum', 'nuclear', 'particle', 'photon', 'electron',
        'wavelength', 'frequency', 'radiation', 'optics',
        'friction', 'inertia', 'relativity', 'entropy',
      ],
    },
    {
      name: 'chemistry',
      displayName: 'Chemistry',
      description: 'Chemical elements, compounds, and reactions',
      icon: '🧪',
      keywords: [
        'chemistry', 'chemical', 'element', 'compound', 'molecule',
        'atom', 'ion', 'proton', 'neutron', 'isotope',
        'acid', 'base', 'alkaline', 'solution', 'solvent',
        'reaction', 'catalyst', 'oxidation', 'reduction',
        'organic chemistry', 'inorganic', 'polymer', 'bonding',
        'periodic table', 'hydrogen', 'oxygen', 'carbon', 'nitrogen',
      ],
    },
    {
      name: 'biology',
      displayName: 'Biology',
      description: 'Life sciences, cells, and organisms',
      icon: '🔬',
      keywords: [
        'biology', 'biological', 'organism', 'cell', 'cellular',
        'evolution', 'natural selection', 'adaptation', 'species',
        'genetic', 'dna', 'genome', 'chromosome', 'gene', 'mutation',
        'protein', 'enzyme', 'amino acid', 'metabolism',
        'mitosis', 'meiosis', 'photosynthesis', 'respiration',
        'microscope', 'specimen', 'taxonomy', 'classification',
        'bacteria', 'microorganism', 'microbiology',
      ],
    },
    {
      name: 'earth-space',
      displayName: 'Earth & Space Science',
      description: 'Astronomy, space, and earth sciences',
      icon: '🚀',
      keywords: [
        'astronomy', 'planet', 'star', 'galaxy', 'universe', 'cosmos',
        'solar system', 'sun', 'moon', 'orbit', 'satellite',
        'comet', 'asteroid', 'meteor', 'nebula', 'constellation',
        'telescope', 'space', 'rocket', 'astronaut',
        'black hole', 'supernova', 'light year', 'gravity',
      ],
    },
    {
      name: 'laboratory',
      displayName: 'Laboratory & Methods',
      description: 'Scientific methods, tools, and experiments',
      icon: '🔭',
      keywords: [
        'laboratory', 'experiment', 'hypothesis', 'theory',
        'research', 'study', 'observation', 'measurement',
        'formula', 'equation', 'data', 'analysis', 'result',
        'scientific method', 'peer review', 'publication',
        'beaker', 'flask', 'pipette', 'test tube', 'centrifuge',
      ],
    },
  ],

  technology: [
    {
      name: 'hardware-devices',
      displayName: 'Hardware & Devices',
      description: 'Computer hardware, electronics, and devices',
      icon: '🖥️',
      keywords: [
        'hardware', 'computer', 'laptop', 'desktop', 'tablet',
        'smartphone', 'phone', 'device', 'electronic', 'circuit',
        'processor', 'cpu', 'memory', 'ram', 'disk', 'drive',
        'keyboard', 'mouse', 'monitor', 'screen', 'display',
        'printer', 'scanner', 'camera', 'sensor', 'chip',
        'motherboard', 'gpu', 'controller', 'peripheral',
      ],
    },
    {
      name: 'software-programming',
      displayName: 'Software & Programming',
      description: 'Software, coding, and programming',
      icon: '💾',
      keywords: [
        'software', 'program', 'programming', 'code', 'coding',
        'algorithm', 'application', 'app', 'operating system',
        'database', 'server', 'debug', 'compile', 'runtime',
        'variable', 'function', 'loop', 'array', 'object',
        'interface', 'api', 'framework', 'library',
        'developer', 'engineer', 'artificial intelligence', 'machine learning',
        'robot', 'automation', 'virtual', 'simulation',
      ],
    },
    {
      name: 'internet-networks',
      displayName: 'Internet & Networks',
      description: 'Internet, web, and network technology',
      icon: '🌐',
      keywords: [
        'internet', 'web', 'website', 'online', 'browser',
        'network', 'wifi', 'wireless', 'broadband', 'bandwidth',
        'email', 'social media', 'download', 'upload', 'stream',
        'cloud', 'hosting', 'domain', 'url', 'http',
        'encryption', 'cyber', 'firewall', 'security', 'hacker',
        'digital', 'pixel', 'byte', 'data', 'protocol',
        'bluetooth', 'router', 'modem', 'fiber optic',
      ],
    },
  ],

  mathematics: [
    {
      name: 'numbers-arithmetic',
      displayName: 'Numbers & Arithmetic',
      description: 'Numbers, counting, and basic operations',
      icon: '🔢',
      keywords: [
        'number', 'integer', 'digit', 'count', 'arithmetic',
        'addition', 'subtraction', 'multiplication', 'division',
        'fraction', 'decimal', 'percentage', 'ratio', 'proportion',
        'prime', 'even', 'odd', 'negative', 'positive',
        'zero', 'infinity', 'absolute value',
      ],
    },
    {
      name: 'algebra-calculus',
      displayName: 'Algebra & Calculus',
      description: 'Algebra, calculus, and advanced math',
      icon: '📐',
      keywords: [
        'algebra', 'algebraic', 'equation', 'formula', 'variable',
        'coefficient', 'polynomial', 'quadratic', 'linear',
        'calculus', 'derivative', 'integral', 'limit', 'differential',
        'logarithm', 'exponential', 'matrix', 'vector',
        'theorem', 'proof', 'axiom', 'conjecture',
      ],
    },
    {
      name: 'geometry-shapes',
      displayName: 'Geometry & Shapes',
      description: 'Geometric shapes, measurements, and spatial math',
      icon: '📏',
      keywords: [
        'geometry', 'geometric', 'shape', 'circle', 'triangle',
        'square', 'rectangle', 'polygon', 'sphere', 'cube',
        'cylinder', 'cone', 'pyramid', 'angle', 'degree',
        'area', 'volume', 'perimeter', 'circumference', 'diameter',
        'radius', 'symmetry', 'parallel', 'perpendicular',
        'trigonometry', 'sine', 'cosine', 'tangent',
      ],
    },
    {
      name: 'statistics-probability',
      displayName: 'Statistics & Probability',
      description: 'Statistics, probability, and data analysis',
      icon: '📊',
      keywords: [
        'statistics', 'statistical', 'probability', 'random',
        'average', 'mean', 'median', 'mode', 'deviation',
        'distribution', 'variance', 'correlation', 'regression',
        'sample', 'population', 'survey', 'hypothesis test',
        'graph', 'chart', 'histogram', 'function',
      ],
    },
  ],

  // ═══════════════════ BUSINESS & WORK ═══════════════════

  business: [
    {
      name: 'finance-banking',
      displayName: 'Finance & Banking',
      description: 'Money, banking, and financial services',
      icon: '🏦',
      keywords: [
        'finance', 'financial', 'bank', 'banking', 'money',
        'currency', 'dollar', 'euro', 'pound', 'yen',
        'loan', 'mortgage', 'interest', 'credit', 'debit',
        'investment', 'stock', 'bond', 'share', 'dividend',
        'savings', 'deposit', 'withdrawal', 'transaction',
        'inflation', 'deflation', 'exchange rate', 'fiscal',
      ],
    },
    {
      name: 'trade-markets',
      displayName: 'Trade & Markets',
      description: 'Commerce, trade, and market economics',
      icon: '📈',
      keywords: [
        'trade', 'market', 'commerce', 'commercial', 'merchant',
        'buy', 'sell', 'purchase', 'sale', 'auction',
        'import', 'export', 'wholesale', 'retail', 'supply',
        'demand', 'price', 'cost', 'profit', 'revenue',
        'economy', 'economic', 'capitalism', 'enterprise',
        'competition', 'monopoly', 'commodity', 'goods',
      ],
    },
    {
      name: 'accounting-tax',
      displayName: 'Accounting & Tax',
      description: 'Accounting, taxation, and bookkeeping',
      icon: '🧾',
      keywords: [
        'accounting', 'accountant', 'bookkeeping', 'ledger',
        'tax', 'taxation', 'audit', 'budget', 'expense',
        'income', 'salary', 'wage', 'payroll', 'invoice',
        'balance sheet', 'asset', 'liability', 'equity',
        'depreciation', 'amortization', 'fiscal year',
      ],
    },
    {
      name: 'management-leadership',
      displayName: 'Management & Leadership',
      description: 'Business management and corporate leadership',
      icon: '👔',
      keywords: [
        'management', 'manager', 'executive', 'director', 'ceo',
        'company', 'corporation', 'organization', 'firm',
        'strategy', 'planning', 'decision', 'leadership',
        'entrepreneur', 'startup', 'business plan', 'venture',
        'industry', 'sector', 'conglomerate', 'franchise',
      ],
    },
  ],

  'work-career': [
    {
      name: 'occupations-jobs',
      displayName: 'Occupations & Jobs',
      description: 'Job titles, professions, and occupations',
      icon: '🧑‍💼',
      keywords: [
        'occupation', 'profession', 'career', 'job', 'vocation',
        'worker', 'technician', 'specialist', 'consultant',
        'engineer', 'architect', 'scientist', 'researcher',
        'accountant', 'lawyer', 'judge', 'pilot', 'mechanic',
        'plumber', 'electrician', 'carpenter', 'farmer',
        'artisan', 'craftsman', 'tradesman',
      ],
    },
    {
      name: 'workplace-office',
      displayName: 'Workplace & Office',
      description: 'Office environment and workplace vocabulary',
      icon: '🏢',
      keywords: [
        'office', 'workplace', 'desk', 'meeting', 'conference',
        'colleague', 'coworker', 'boss', 'supervisor', 'team',
        'project', 'deadline', 'schedule', 'agenda', 'report',
        'email', 'memo', 'presentation', 'document',
      ],
    },
    {
      name: 'employment-hiring',
      displayName: 'Employment & Hiring',
      description: 'Employment, job search, and HR',
      icon: '📋',
      keywords: [
        'employ', 'employee', 'employer', 'hire', 'firing',
        'interview', 'resume', 'cv', 'application', 'candidate',
        'salary', 'benefit', 'contract', 'promotion', 'demotion',
        'retirement', 'pension', 'union', 'labor', 'labour',
        'qualification', 'skill', 'experience', 'training',
      ],
    },
  ],

  // ═══════════════════ EDUCATION ═══════════════════

  education: [
    {
      name: 'schools-universities',
      displayName: 'Schools & Universities',
      description: 'Educational institutions and facilities',
      icon: '🏫',
      keywords: [
        'school', 'university', 'college', 'academy', 'institute',
        'campus', 'classroom', 'library', 'dormitory',
        'kindergarten', 'elementary', 'secondary', 'high school',
        'boarding school', 'seminary', 'gymnasium',
      ],
    },
    {
      name: 'teaching-learning',
      displayName: 'Teaching & Learning',
      description: 'Teaching methods and learning activities',
      icon: '📖',
      keywords: [
        'teach', 'teacher', 'professor', 'instructor', 'tutor',
        'learn', 'study', 'educate', 'education', 'lesson',
        'lecture', 'seminar', 'workshop', 'tutorial',
        'curriculum', 'course', 'syllabus', 'textbook',
        'homework', 'assignment', 'project', 'essay',
        'pedagogy', 'literacy', 'scholarship', 'student',
      ],
    },
    {
      name: 'exams-assessment',
      displayName: 'Exams & Assessment',
      description: 'Tests, grading, and academic assessment',
      icon: '📝',
      keywords: [
        'exam', 'examination', 'test', 'quiz', 'assessment',
        'grade', 'score', 'mark', 'pass', 'fail',
        'diploma', 'degree', 'certificate', 'graduation',
        'bachelor', 'master', 'doctorate', 'phd',
        'academic', 'gpa', 'evaluation', 'review',
      ],
    },
  ],

  'language-grammar': [
    {
      name: 'parts-of-speech',
      displayName: 'Parts of Speech',
      description: 'Nouns, verbs, adjectives, and grammar categories',
      icon: '🏷️',
      keywords: [
        'noun', 'verb', 'adjective', 'adverb', 'pronoun',
        'preposition', 'conjunction', 'article', 'determiner',
        'participle', 'gerund', 'infinitive', 'clause',
        'subject', 'predicate', 'object', 'complement',
        'tense', 'plural', 'singular', 'possessive',
        'grammar', 'syntax', 'sentence', 'phrase',
      ],
    },
    {
      name: 'sounds-phonetics',
      displayName: 'Sounds & Phonetics',
      description: 'Pronunciation, phonetics, and sounds of language',
      icon: '🔊',
      keywords: [
        'phonetic', 'phonology', 'vowel', 'consonant', 'syllable',
        'accent', 'intonation', 'pronunciation', 'tone',
        'diphthong', 'fricative', 'plosive', 'nasal',
        'stress', 'rhythm', 'sound', 'utterance',
      ],
    },
    {
      name: 'writing-composition',
      displayName: 'Writing & Composition',
      description: 'Writing, composition, and textual analysis',
      icon: '✍️',
      keywords: [
        'writing', 'write', 'composition', 'essay', 'paragraph',
        'word', 'vocabulary', 'diction', 'rhetoric', 'style',
        'suffix', 'prefix', 'etymology', 'root word',
        'language', 'linguistic', 'semantics', 'pragmatic',
        'dialect', 'slang', 'jargon', 'idiom', 'colloquial',
      ],
    },
  ],

  // ═══════════════════ DAILY LIFE ═══════════════════

  family: [
    {
      name: 'family-members',
      displayName: 'Family Members',
      description: 'Parents, siblings, and relatives',
      icon: '👨‍👩‍👧‍👦',
      keywords: [
        'parent', 'mother', 'father', 'mom', 'dad',
        'sibling', 'brother', 'sister', 'son', 'daughter',
        'grandparent', 'grandmother', 'grandfather',
        'uncle', 'aunt', 'cousin', 'nephew', 'niece',
        'family member', 'relative', 'kinship', 'kin',
        'ancestry', 'descendant', 'heir', 'genealogy',
      ],
    },
    {
      name: 'marriage-partnership',
      displayName: 'Marriage & Partnership',
      description: 'Marriage, weddings, and romantic relationships',
      icon: '💍',
      keywords: [
        'marriage', 'marry', 'wedding', 'bride', 'groom',
        'spouse', 'husband', 'wife', 'partner', 'fiancé',
        'engagement', 'honeymoon', 'anniversary', 'vow',
        'divorce', 'separation', 'relationship', 'romance',
        'dating', 'courtship', 'couple',
      ],
    },
    {
      name: 'social-bonds',
      displayName: 'Social Bonds',
      description: 'Friendships, social connections, and community',
      icon: '🤝',
      keywords: [
        'friend', 'friendship', 'companion', 'neighbor', 'neighbour',
        'community', 'social', 'bond', 'trust', 'loyalty',
        'acquaintance', 'ally', 'comrade', 'peer', 'mentor',
        'family', 'household', 'generation', 'tribe', 'clan',
      ],
    },
  ],

  'home-household': [
    {
      name: 'rooms-spaces',
      displayName: 'Rooms & Living Spaces',
      description: 'Rooms, areas, and residential spaces',
      icon: '🛋️',
      keywords: [
        'room', 'bedroom', 'bathroom', 'kitchen', 'living room',
        'dining room', 'garage', 'attic', 'basement', 'cellar',
        'hallway', 'corridor', 'porch', 'balcony', 'patio',
        'garden', 'yard', 'lawn', 'terrace', 'veranda',
        'apartment', 'flat', 'house', 'home', 'dwelling',
      ],
    },
    {
      name: 'furniture-decor',
      displayName: 'Furniture & Decor',
      description: 'Furniture, decoration, and home accessories',
      icon: '🪑',
      keywords: [
        'furniture', 'chair', 'table', 'desk', 'sofa', 'couch',
        'bed', 'mattress', 'pillow', 'blanket', 'curtain',
        'carpet', 'rug', 'shelf', 'cabinet', 'drawer',
        'lamp', 'mirror', 'vase', 'painting', 'decor',
        'wardrobe', 'closet', 'bookcase', 'armchair',
      ],
    },
    {
      name: 'appliances-tools',
      displayName: 'Appliances & Tools',
      description: 'Household appliances and maintenance tools',
      icon: '🔧',
      keywords: [
        'appliance', 'tool', 'hammer', 'screwdriver', 'wrench',
        'drill', 'saw', 'pliers', 'nail', 'screw', 'bolt',
        'vacuum', 'washer', 'dryer', 'dishwasher', 'heater',
        'air conditioning', 'fan', 'thermostat', 'plumbing',
        'domestic', 'household', 'cleaning', 'maintenance',
        'door', 'window', 'ceiling', 'floor', 'wall', 'roof',
        'building', 'fence', 'gate', 'stairs', 'elevator',
      ],
    },
  ],

  clothing: [
    {
      name: 'garments-outfits',
      displayName: 'Garments & Outfits',
      description: 'Clothing items and outfits',
      icon: '👕',
      keywords: [
        'garment', 'clothing', 'dress', 'shirt', 'blouse',
        'pants', 'trousers', 'jeans', 'shorts', 'skirt',
        'suit', 'jacket', 'coat', 'sweater', 'vest',
        'uniform', 'costume', 'gown', 'robe', 'tunic',
        'underwear', 'pajamas', 'pyjamas', 'swimsuit',
        'sleeve', 'collar', 'pocket', 'hem', 'cuff',
      ],
    },
    {
      name: 'fabrics-textiles',
      displayName: 'Fabrics & Textiles',
      description: 'Fabrics, textiles, and material types',
      icon: '🧵',
      keywords: [
        'fabric', 'textile', 'cloth', 'material', 'fiber', 'fibre',
        'silk', 'cotton', 'wool', 'leather', 'linen', 'denim',
        'polyester', 'nylon', 'cashmere', 'satin', 'velvet',
        'sew', 'stitch', 'knit', 'weave', 'tailor', 'embroider',
        'thread', 'yarn', 'needle', 'pattern', 'dye',
      ],
    },
    {
      name: 'footwear-accessories',
      displayName: 'Footwear & Accessories',
      description: 'Shoes, hats, jewelry, and accessories',
      icon: '👟',
      keywords: [
        'shoe', 'boot', 'sandal', 'slipper', 'sneaker', 'heel',
        'hat', 'cap', 'beanie', 'beret', 'helmet',
        'glove', 'mitten', 'scarf', 'tie', 'belt', 'buckle',
        'jewelry', 'jewellery', 'ring', 'necklace', 'bracelet',
        'earring', 'watch', 'glasses', 'sunglasses',
        'handbag', 'purse', 'wallet', 'umbrella',
        'fashion', 'style', 'trend', 'designer', 'boutique',
      ],
    },
  ],

  'time-calendar': [
    {
      name: 'time-units',
      displayName: 'Time Units & Measurement',
      description: 'Units of time and measurement',
      icon: '⏱️',
      keywords: [
        'hour', 'minute', 'second', 'millisecond', 'nanosecond',
        'day', 'week', 'month', 'year', 'decade', 'century',
        'millennium', 'instant', 'moment', 'duration', 'interval',
        'clock', 'watch', 'timer', 'stopwatch', 'sundial',
        'time', 'temporal', 'chronological', 'epoch',
      ],
    },
    {
      name: 'seasons-periods',
      displayName: 'Seasons & Periods',
      description: 'Seasons, days of week, and time periods',
      icon: '🗓️',
      keywords: [
        'season', 'spring', 'summer', 'autumn', 'fall', 'winter',
        'morning', 'afternoon', 'evening', 'night', 'midnight',
        'dawn', 'dusk', 'twilight', 'sunrise', 'sunset',
        'calendar', 'date', 'schedule', 'deadline', 'period',
        'holiday', 'weekend', 'weekday', 'semester', 'quarter',
      ],
    },
  ],

  // ═══════════════════ EMOTIONS & PERSONALITY ═══════════════════

  emotions: [
    {
      name: 'happiness-joy',
      displayName: 'Happiness & Joy',
      description: 'Words expressing happiness, joy, and delight',
      icon: '😄',
      keywords: [
        'happy', 'happiness', 'joy', 'joyful', 'delight', 'delightful',
        'pleasure', 'cheerful', 'merry', 'bliss', 'ecstasy',
        'elation', 'euphoria', 'glee', 'jubilant', 'content',
        'satisfied', 'grateful', 'thankful', 'optimistic', 'hopeful',
        'laugh', 'smile', 'celebration', 'triumph',
      ],
    },
    {
      name: 'sadness-grief',
      displayName: 'Sadness & Grief',
      description: 'Words expressing sadness, sorrow, and grief',
      icon: '😢',
      keywords: [
        'sad', 'sadness', 'sorrow', 'grief', 'mourn', 'mourning',
        'melancholy', 'despair', 'misery', 'woe', 'anguish',
        'heartbreak', 'lonely', 'loneliness', 'gloomy', 'dismal',
        'depressed', 'dejected', 'forlorn', 'bereft', 'lament',
        'weep', 'cry', 'tear', 'sob', 'suffering',
      ],
    },
    {
      name: 'anger-frustration',
      displayName: 'Anger & Frustration',
      description: 'Words expressing anger, irritation, and frustration',
      icon: '😠',
      keywords: [
        'angry', 'anger', 'rage', 'fury', 'furious', 'wrath',
        'irritate', 'irritation', 'annoy', 'annoyance', 'frustrat',
        'hostile', 'aggression', 'resentment', 'indignation',
        'outrage', 'bitter', 'hatred', 'spite', 'malice',
        'temper', 'tantrum', 'enrage', 'infuriate',
      ],
    },
    {
      name: 'fear-anxiety',
      displayName: 'Fear & Anxiety',
      description: 'Words expressing fear, anxiety, and worry',
      icon: '😰',
      keywords: [
        'fear', 'afraid', 'frighten', 'scare', 'terror', 'terrify',
        'anxiety', 'anxious', 'worry', 'nervous', 'dread',
        'panic', 'horror', 'phobia', 'apprehension', 'trepidation',
        'uneasy', 'distress', 'alarm', 'startle', 'shock',
      ],
    },
    {
      name: 'love-affection',
      displayName: 'Love & Affection',
      description: 'Words expressing love, affection, and tenderness',
      icon: '❤️',
      keywords: [
        'love', 'affection', 'fondness', 'adore', 'cherish',
        'devotion', 'passion', 'romantic', 'tender', 'caring',
        'empathy', 'sympathy', 'compassion', 'kindness', 'warmth',
        'embrace', 'hug', 'kiss', 'caress', 'gentle',
        'sentiment', 'emotion', 'feeling', 'mood',
      ],
    },
  ],

  personality: [
    {
      name: 'positive-traits',
      displayName: 'Positive Traits',
      description: 'Admirable and positive personality traits',
      icon: '⭐',
      keywords: [
        'brave', 'courage', 'courageous', 'generous', 'generosity',
        'honest', 'honesty', 'loyal', 'loyalty', 'trustworthy',
        'kind', 'gentle', 'humble', 'patient', 'diligent',
        'confident', 'ambitious', 'creative', 'intelligent', 'wise',
        'compassionate', 'empathetic', 'resilient', 'determined',
        'cheerful', 'optimistic', 'charismatic', 'gracious',
      ],
    },
    {
      name: 'negative-traits',
      displayName: 'Negative Traits',
      description: 'Undesirable and negative personality traits',
      icon: '⚠️',
      keywords: [
        'selfish', 'greedy', 'arrogant', 'stubborn', 'lazy',
        'coward', 'cruel', 'dishonest', 'deceitful', 'manipulative',
        'jealous', 'envious', 'prideful', 'vain', 'conceited',
        'reckless', 'impulsive', 'impatient', 'pessimist', 'cynic',
        'malicious', 'vindictive', 'petty', 'stingy',
      ],
    },
    {
      name: 'social-behavior',
      displayName: 'Social Behavior',
      description: 'Social traits, behavior, and temperament',
      icon: '🗣️',
      keywords: [
        'personality', 'character', 'trait', 'temperament', 'disposition',
        'introvert', 'extrovert', 'ambivert', 'shy', 'outgoing',
        'sociable', 'reserved', 'assertive', 'passive', 'aggressive',
        'behavior', 'behaviour', 'attitude', 'manners', 'etiquette',
        'charisma', 'charm', 'wit', 'humor', 'humour',
      ],
    },
  ],

  // ═══════════════════ TRAVEL & PLACES ═══════════════════

  travel: [
    {
      name: 'vehicles',
      displayName: 'Vehicles',
      description: 'Cars, buses, trains, and other vehicles',
      icon: '🚗',
      keywords: [
        'vehicle', 'car', 'automobile', 'truck', 'bus', 'van',
        'motorcycle', 'bicycle', 'scooter', 'taxi', 'cab',
        'train', 'locomotive', 'subway', 'metro', 'tram',
        'engine', 'wheel', 'tire', 'brake', 'accelerat',
        'fuel', 'gasoline', 'diesel', 'electric vehicle',
      ],
    },
    {
      name: 'air-travel',
      displayName: 'Air Travel',
      description: 'Aviation, flights, and air travel',
      icon: '✈️',
      keywords: [
        'airplane', 'aircraft', 'flight', 'pilot', 'aviation',
        'airport', 'runway', 'terminal', 'boarding', 'takeoff',
        'landing', 'altitude', 'turbulence', 'cockpit',
        'helicopter', 'jet', 'propeller', 'wing', 'fuselage',
        'airline', 'steward', 'cabin', 'passport',
      ],
    },
    {
      name: 'sea-travel',
      displayName: 'Sea Travel',
      description: 'Ships, boats, and maritime travel',
      icon: '🚢',
      keywords: [
        'ship', 'boat', 'vessel', 'sail', 'sailing', 'maritime',
        'port', 'harbor', 'harbour', 'dock', 'pier', 'wharf',
        'cruise', 'ferry', 'yacht', 'canoe', 'kayak',
        'captain', 'sailor', 'crew', 'anchor', 'mast',
        'voyage', 'navigate', 'navigation', 'compass', 'nautical',
      ],
    },
    {
      name: 'roads-railways',
      displayName: 'Roads & Infrastructure',
      description: 'Roads, highways, railways, and transport infrastructure',
      icon: '🛤️',
      keywords: [
        'road', 'highway', 'freeway', 'motorway', 'street',
        'lane', 'intersection', 'bridge', 'tunnel', 'overpass',
        'traffic', 'signal', 'sign', 'speed limit', 'parking',
        'railway', 'railroad', 'track', 'station', 'platform',
        'transport', 'transit', 'commute', 'route', 'path',
      ],
    },
    {
      name: 'tourism-lodging',
      displayName: 'Tourism & Lodging',
      description: 'Travel accommodation, tourism, and sightseeing',
      icon: '🏨',
      keywords: [
        'tourist', 'tourism', 'travel', 'journey', 'trip', 'tour',
        'hotel', 'motel', 'hostel', 'resort', 'lodge',
        'reservation', 'booking', 'vacation', 'holiday',
        'sightseeing', 'souvenir', 'guide', 'excursion',
        'luggage', 'suitcase', 'backpack', 'visa', 'itinerary',
        'destination', 'adventure', 'explore', 'expedition',
      ],
    },
  ],

  geography: [
    {
      name: 'countries-regions',
      displayName: 'Countries & Regions',
      description: 'Countries, states, and regional names',
      icon: '🗺️',
      keywords: [
        'country', 'nation', 'state', 'republic', 'kingdom',
        'province', 'region', 'territory', 'district', 'county',
        'continent', 'hemisphere', 'border', 'frontier',
        'colony', 'commonwealth', 'federation', 'union',
        'native of', 'inhabitant', 'citizen', 'nationality',
        'relating to', 'pertaining to',
      ],
    },
    {
      name: 'cities-towns',
      displayName: 'Cities & Towns',
      description: 'Cities, towns, and urban vocabulary',
      icon: '🏙️',
      keywords: [
        'city', 'town', 'village', 'suburb', 'urban', 'rural',
        'metropolitan', 'downtown', 'neighborhood', 'neighbourhood',
        'municipal', 'borough', 'parish', 'commune',
        'population', 'density', 'settlement', 'capital',
      ],
    },
    {
      name: 'maps-navigation',
      displayName: 'Maps & Navigation',
      description: 'Maps, coordinates, and geographic tools',
      icon: '🧭',
      keywords: [
        'map', 'atlas', 'globe', 'compass', 'coordinate',
        'latitude', 'longitude', 'altitude', 'elevation',
        'north', 'south', 'east', 'west', 'direction',
        'geography', 'geographical', 'cartography', 'topography',
        'survey', 'satellite', 'gps', 'terrain',
      ],
    },
  ],

  // ═══════════════════ ARTS & ENTERTAINMENT ═══════════════════

  music: [
    {
      name: 'instruments',
      displayName: 'Musical Instruments',
      description: 'Musical instruments and their families',
      icon: '🎸',
      keywords: [
        'instrument', 'guitar', 'piano', 'violin', 'cello',
        'flute', 'clarinet', 'trumpet', 'trombone', 'saxophone',
        'drum', 'percussion', 'harp', 'organ', 'accordion',
        'banjo', 'ukulele', 'harmonica', 'bagpipe', 'xylophone',
        'string', 'woodwind', 'brass', 'keyboard',
      ],
    },
    {
      name: 'music-theory',
      displayName: 'Music Theory',
      description: 'Musical notation, theory, and composition',
      icon: '🎼',
      keywords: [
        'chord', 'note', 'scale', 'pitch', 'tone', 'octave',
        'melody', 'harmony', 'rhythm', 'tempo', 'beat', 'measure',
        'key', 'signature', 'clef', 'staff', 'bar',
        'sharp', 'flat', 'natural', 'rest', 'duration',
        'music', 'musical', 'composition', 'arrange', 'notation',
      ],
    },
    {
      name: 'singing-performance',
      displayName: 'Singing & Performance',
      description: 'Singing, performing, and live music',
      icon: '🎤',
      keywords: [
        'sing', 'singer', 'vocal', 'voice', 'choir', 'chorus',
        'opera', 'soprano', 'alto', 'tenor', 'baritone', 'bass',
        'concert', 'recital', 'performance', 'stage', 'gig',
        'orchestra', 'symphony', 'band', 'ensemble', 'quartet',
        'conductor', 'musician', 'composer', 'maestro',
      ],
    },
  ],

  'art-literature': [
    {
      name: 'visual-arts',
      displayName: 'Visual Arts',
      description: 'Painting, sculpture, and visual art forms',
      icon: '🖼️',
      keywords: [
        'painting', 'sculpture', 'drawing', 'sketch', 'portrait',
        'landscape', 'abstract', 'impressionist', 'surrealist',
        'canvas', 'easel', 'palette', 'brush', 'pigment',
        'gallery', 'museum', 'exhibition', 'masterpiece',
        'art', 'artistic', 'painter', 'sculptor', 'illustrate',
        'ceramic', 'pottery', 'mosaic', 'mural', 'fresco',
      ],
    },
    {
      name: 'literature-writing',
      displayName: 'Literature & Writing',
      description: 'Novels, stories, and literary works',
      icon: '📚',
      keywords: [
        'literature', 'literary', 'novel', 'story', 'fiction',
        'nonfiction', 'biography', 'autobiography', 'memoir',
        'author', 'writer', 'narrative', 'plot', 'character',
        'chapter', 'manuscript', 'publish', 'publisher',
        'genre', 'thriller', 'mystery', 'romance', 'fantasy',
        'science fiction', 'fairy tale', 'fable', 'myth', 'legend',
      ],
    },
    {
      name: 'poetry-prose',
      displayName: 'Poetry & Prose',
      description: 'Poetry, verse, and literary devices',
      icon: '📜',
      keywords: [
        'poem', 'poetry', 'poet', 'verse', 'stanza', 'rhyme',
        'sonnet', 'haiku', 'limerick', 'ballad', 'epic',
        'prose', 'essay', 'critique', 'review',
        'metaphor', 'simile', 'allegory', 'irony', 'satire',
        'symbolism', 'imagery', 'alliteration', 'hyperbole',
      ],
    },
    {
      name: 'theater-drama',
      displayName: 'Theater & Drama',
      description: 'Theater, plays, and dramatic arts',
      icon: '🎭',
      keywords: [
        'theater', 'theatre', 'drama', 'dramatic', 'play',
        'act', 'scene', 'dialogue', 'monologue', 'script',
        'stage', 'backstage', 'curtain', 'prop', 'costume',
        'tragedy', 'comedy', 'farce', 'pantomime', 'musical',
        'audience', 'applause', 'premiere', 'rehearsal',
      ],
    },
  ],

  entertainment: [
    {
      name: 'film-cinema',
      displayName: 'Film & Cinema',
      description: 'Movies, filmmaking, and cinema',
      icon: '🎬',
      keywords: [
        'movie', 'film', 'cinema', 'director', 'actor', 'actress',
        'screenplay', 'scene', 'shot', 'camera', 'lens',
        'documentary', 'animation', 'animated', 'sequel',
        'blockbuster', 'premiere', 'box office', 'oscar',
        'editing', 'visual effects', 'soundtrack', 'trailer',
      ],
    },
    {
      name: 'tv-radio',
      displayName: 'Television & Radio',
      description: 'Television, radio, and broadcast media',
      icon: '📺',
      keywords: [
        'television', 'tv', 'broadcast', 'channel', 'station',
        'radio', 'podcast', 'series', 'episode', 'season',
        'news', 'newscast', 'anchor', 'journalist', 'reporter',
        'newspaper', 'magazine', 'publish', 'press', 'media',
        'advertisement', 'commercial', 'sponsor',
      ],
    },
    {
      name: 'games-recreation',
      displayName: 'Games & Recreation',
      description: 'Games, hobbies, and recreational activities',
      icon: '🎮',
      keywords: [
        'game', 'play', 'board game', 'card game', 'video game',
        'puzzle', 'chess', 'checkers', 'dice', 'poker',
        'hobby', 'recreation', 'leisure', 'entertainment',
        'amusement', 'park', 'carnival', 'festival', 'circus',
        'gamble', 'casino', 'bet', 'lottery', 'raffle',
        'toy', 'doll', 'kite', 'swing', 'playground',
      ],
    },
  ],

  // ═══════════════════ SPORTS & FITNESS ═══════════════════

  sports: [
    {
      name: 'ball-sports',
      displayName: 'Ball Sports',
      description: 'Football, basketball, tennis, and ball games',
      icon: '⚽',
      keywords: [
        'football', 'soccer', 'basketball', 'baseball', 'tennis',
        'volleyball', 'cricket', 'rugby', 'golf', 'bowling',
        'badminton', 'squash', 'ping pong', 'table tennis',
        'ball', 'goal', 'net', 'court', 'field', 'pitch',
        'kick', 'throw', 'catch', 'pass', 'dribble',
      ],
    },
    {
      name: 'water-sports',
      displayName: 'Water Sports',
      description: 'Swimming, diving, and water activities',
      icon: '🏊',
      keywords: [
        'swimming', 'swim', 'diving', 'dive', 'surf', 'surfing',
        'water polo', 'kayak', 'canoe', 'rowing', 'sailing',
        'snorkel', 'scuba', 'waterskiing', 'jet ski',
        'pool', 'lap', 'stroke', 'freestyle', 'backstroke',
      ],
    },
    {
      name: 'combat-sports',
      displayName: 'Combat Sports',
      description: 'Boxing, wrestling, and martial arts',
      icon: '🥊',
      keywords: [
        'boxing', 'wrestler', 'wrestling', 'martial art', 'karate',
        'judo', 'taekwondo', 'kung fu', 'fencing', 'sword',
        'punch', 'kick', 'grapple', 'pin', 'knockout',
        'ring', 'bout', 'referee', 'weight class',
      ],
    },
    {
      name: 'athletics-track',
      displayName: 'Athletics & Track',
      description: 'Running, jumping, and field events',
      icon: '🏃',
      keywords: [
        'athletic', 'athlete', 'running', 'sprint', 'marathon',
        'hurdle', 'relay', 'race', 'track', 'field event',
        'jump', 'high jump', 'long jump', 'pole vault',
        'javelin', 'discus', 'shot put', 'decathlon', 'triathlon',
        'olympic', 'medal', 'champion', 'record',
      ],
    },
    {
      name: 'exercise-gym',
      displayName: 'Exercise & Gym',
      description: 'Fitness, exercise, and workout vocabulary',
      icon: '🏋️',
      keywords: [
        'exercise', 'fitness', 'workout', 'gym', 'gymnasium',
        'training', 'cardio', 'aerobic', 'stretch', 'yoga',
        'pilates', 'weight', 'dumbbell', 'barbell', 'treadmill',
        'sport', 'competition', 'tournament', 'championship',
        'team', 'player', 'coach', 'score', 'win', 'lose',
        'stadium', 'arena', 'league', 'season',
      ],
    },
  ],

  // ═══════════════════ SOCIETY & CULTURE ═══════════════════

  'law-government': [
    {
      name: 'legal-system',
      displayName: 'Legal System',
      description: 'Courts, trials, and the justice system',
      icon: '⚖️',
      keywords: [
        'court', 'judge', 'jury', 'trial', 'verdict', 'sentence',
        'law', 'legal', 'lawyer', 'attorney', 'barrister', 'solicitor',
        'lawsuit', 'litigation', 'plaintiff', 'defendant',
        'evidence', 'testimony', 'witness', 'oath', 'appeal',
        'jurisdiction', 'constitution', 'statute', 'regulation',
        'legislation', 'ordinance', 'precedent',
      ],
    },
    {
      name: 'crime-punishment',
      displayName: 'Crime & Punishment',
      description: 'Criminal acts, law enforcement, and penalties',
      icon: '🚔',
      keywords: [
        'crime', 'criminal', 'felony', 'misdemeanor', 'offense',
        'theft', 'robbery', 'assault', 'murder', 'fraud',
        'prison', 'jail', 'inmate', 'parole', 'probation',
        'police', 'detective', 'arrest', 'handcuff', 'warrant',
        'punishment', 'penalty', 'fine', 'execution', 'death penalty',
      ],
    },
    {
      name: 'politics-government',
      displayName: 'Politics & Government',
      description: 'Political systems, governance, and public administration',
      icon: '🏛️',
      keywords: [
        'government', 'political', 'politics', 'parliament',
        'congress', 'senate', 'legislature', 'executive',
        'president', 'prime minister', 'governor', 'mayor',
        'democracy', 'republic', 'monarchy', 'dictatorship',
        'election', 'vote', 'ballot', 'campaign', 'candidate',
        'policy', 'reform', 'bureaucracy', 'administration',
        'diplomacy', 'ambassador', 'treaty', 'alliance',
      ],
    },
  ],

  'religion-philosophy': [
    {
      name: 'world-religions',
      displayName: 'World Religions',
      description: 'Major world religions and denominations',
      icon: '🕌',
      keywords: [
        'christianity', 'christian', 'islam', 'islamic', 'muslim',
        'buddhism', 'buddhist', 'hinduism', 'hindu', 'judaism', 'jewish',
        'catholic', 'protestant', 'orthodox', 'evangelical',
        'bible', 'quran', 'torah', 'veda', 'sutra',
        'church', 'mosque', 'temple', 'synagogue', 'pagoda',
        'religion', 'religious', 'denomination', 'sect',
      ],
    },
    {
      name: 'worship-rituals',
      displayName: 'Worship & Rituals',
      description: 'Religious practices, ceremonies, and worship',
      icon: '🙏',
      keywords: [
        'worship', 'prayer', 'pray', 'ritual', 'ceremony',
        'sacrament', 'baptism', 'communion', 'pilgrimage',
        'sacred', 'holy', 'divine', 'blessing', 'consecrate',
        'god', 'deity', 'angel', 'heaven', 'hell', 'salvation',
        'sin', 'repentance', 'confession', 'sermon', 'hymn',
        'spiritual', 'faith', 'belief', 'scripture', 'prophet',
      ],
    },
    {
      name: 'philosophy-ethics',
      displayName: 'Philosophy & Ethics',
      description: 'Philosophical thought and moral reasoning',
      icon: '🤔',
      keywords: [
        'philosophy', 'philosophical', 'philosopher', 'wisdom',
        'logic', 'logical', 'reason', 'reasoning', 'argument',
        'ethics', 'ethical', 'moral', 'morality', 'virtue',
        'justice', 'truth', 'existence', 'consciousness',
        'metaphysics', 'epistemology', 'ontology', 'aesthetics',
        'doctrine', 'ideology', 'principle', 'value',
        'theology', 'soul', 'spirit', 'transcendent',
      ],
    },
  ],

  'military-war': [
    {
      name: 'weapons-arms',
      displayName: 'Weapons & Arms',
      description: 'Weapons, armaments, and military equipment',
      icon: '🗡️',
      keywords: [
        'weapon', 'arms', 'armament', 'gun', 'rifle', 'pistol',
        'sword', 'knife', 'dagger', 'spear', 'bow', 'arrow',
        'cannon', 'artillery', 'missile', 'rocket', 'bomb',
        'grenade', 'explosive', 'ammunition', 'bullet', 'shell',
        'tank', 'warship', 'submarine', 'fighter jet',
        'armor', 'armour', 'shield', 'helmet',
      ],
    },
    {
      name: 'military-personnel',
      displayName: 'Military Personnel',
      description: 'Soldiers, officers, and military ranks',
      icon: '🎖️',
      keywords: [
        'soldier', 'warrior', 'troop', 'regiment', 'battalion',
        'army', 'navy', 'air force', 'marine', 'infantry',
        'general', 'colonel', 'captain', 'lieutenant', 'sergeant',
        'officer', 'commander', 'admiral', 'marshal',
        'veteran', 'recruit', 'cadet', 'conscript', 'militia',
      ],
    },
    {
      name: 'battles-strategy',
      displayName: 'Battles & Strategy',
      description: 'Warfare tactics, battles, and military operations',
      icon: '⚔️',
      keywords: [
        'battle', 'war', 'warfare', 'combat', 'fight', 'conflict',
        'siege', 'invasion', 'occupation', 'liberation', 'retreat',
        'strategy', 'tactics', 'maneuver', 'ambush', 'flank',
        'defense', 'defence', 'attack', 'assault', 'raid',
        'victory', 'defeat', 'surrender', 'ceasefire', 'truce',
        'military', 'campaign', 'front line', 'fortification',
        'fortress', 'barracks', 'base', 'outpost',
      ],
    },
  ],

  history: [
    {
      name: 'ancient-history',
      displayName: 'Ancient History',
      description: 'Ancient civilizations and prehistoric periods',
      icon: '🏛️',
      keywords: [
        'ancient', 'prehistoric', 'antiquity', 'classical',
        'roman', 'greek', 'egyptian', 'mesopotamia', 'persian',
        'pharaoh', 'emperor', 'gladiator', 'colosseum',
        'civilization', 'empire', 'dynasty', 'archaeology',
        'artifact', 'relic', 'excavation', 'ruin', 'fossil',
      ],
    },
    {
      name: 'medieval-period',
      displayName: 'Medieval Period',
      description: 'Middle Ages, feudalism, and medieval life',
      icon: '🏰',
      keywords: [
        'medieval', 'middle ages', 'feudal', 'feudalism',
        'knight', 'castle', 'kingdom', 'monarch', 'king', 'queen',
        'lord', 'vassal', 'serf', 'peasant', 'noble',
        'crusade', 'plague', 'guild', 'charter',
        'renaissance', 'reformation', 'inquisition',
      ],
    },
    {
      name: 'modern-history',
      displayName: 'Modern History',
      description: 'Modern era, revolutions, and contemporary history',
      icon: '📰',
      keywords: [
        'modern', 'contemporary', 'industrial revolution',
        'revolution', 'independence', 'colonial', 'colony',
        'world war', 'cold war', 'civil war',
        'republic', 'constitution', 'democracy',
        'globalization', 'immigration', 'migration',
        'history', 'historical', 'heritage', 'era', 'epoch',
        'century', 'decade', 'memorial', 'commemorate',
      ],
    },
  ],

  architecture: [
    {
      name: 'building-types',
      displayName: 'Building Types',
      description: 'Types of buildings and structures',
      icon: '🏢',
      keywords: [
        'building', 'structure', 'skyscraper', 'tower', 'monument',
        'cathedral', 'church', 'mosque', 'temple', 'palace',
        'castle', 'fortress', 'barn', 'warehouse', 'factory',
        'bridge', 'dam', 'lighthouse', 'stadium', 'arena',
        'pyramid', 'dome', 'spire', 'minaret',
      ],
    },
    {
      name: 'construction-materials',
      displayName: 'Construction Materials',
      description: 'Building materials and components',
      icon: '🧱',
      keywords: [
        'brick', 'concrete', 'steel', 'timber', 'wood', 'cement',
        'glass', 'stone', 'marble', 'granite', 'slate',
        'plaster', 'mortar', 'grout', 'insulation',
        'beam', 'pillar', 'column', 'arch', 'truss',
        'foundation', 'frame', 'scaffolding', 'rebar',
      ],
    },
    {
      name: 'design-planning',
      displayName: 'Design & Planning',
      description: 'Architectural design, blueprints, and planning',
      icon: '📐',
      keywords: [
        'architecture', 'architect', 'design', 'blueprint', 'plan',
        'layout', 'elevation', 'cross section', 'facade',
        'interior', 'exterior', 'renovation', 'restoration',
        'construct', 'demolition', 'excavation', 'surveyor',
        'carpenter', 'mason', 'plumber', 'electrician',
        'urban planning', 'zoning', 'permit', 'inspection',
      ],
    },
  ],

  colors: [
    {
      name: 'color-names',
      displayName: 'Color Names',
      description: 'Names of colors and color variations',
      icon: '🌈',
      keywords: [
        'red', 'blue', 'green', 'yellow', 'orange', 'purple',
        'violet', 'pink', 'brown', 'black', 'white', 'gray', 'grey',
        'crimson', 'scarlet', 'turquoise', 'cyan', 'magenta',
        'maroon', 'navy', 'olive', 'teal', 'coral', 'salmon',
        'beige', 'ivory', 'tan', 'khaki', 'indigo', 'amber',
        'color', 'colour', 'shade', 'tint', 'hue', 'pigment',
      ],
    },
    {
      name: 'light-shadow',
      displayName: 'Light & Shadow',
      description: 'Light, darkness, brightness, and visual qualities',
      icon: '💡',
      keywords: [
        'light', 'dark', 'bright', 'dim', 'glow', 'shine',
        'shadow', 'shade', 'illuminate', 'luminous', 'radiant',
        'brilliant', 'dazzle', 'sparkle', 'glitter', 'shimmer',
        'pale', 'vivid', 'dull', 'faded', 'muted',
        'transparent', 'translucent', 'opaque', 'reflect',
      ],
    },
    {
      name: 'appearance-texture',
      displayName: 'Appearance & Texture',
      description: 'Visual appearance, texture, and surface qualities',
      icon: '✨',
      keywords: [
        'appearance', 'texture', 'smooth', 'rough', 'soft', 'hard',
        'glossy', 'matte', 'shiny', 'polished', 'dye', 'stain',
        'pattern', 'stripe', 'spot', 'dot', 'plaid', 'checkered',
        'emboss', 'engrave', 'etch', 'carve',
        'beautiful', 'ugly', 'elegant', 'ornate', 'plain',
      ],
    },
  ],
};

// ── Main script ──────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Generating semantic subcategories...\n');

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

  const queryRunner = dataSource.createQueryRunner();
  const categoryRepo = dataSource.getRepository(Category);

  // Step 1: Get all parent categories (no parentId) with word counts
  const parentCategories = await queryRunner.query(`
    SELECT c.id, c.name, c.display_name, c.icon, c.topic, c.display_order,
           COUNT(cw.id) as word_count
    FROM categories c
    LEFT JOIN category_words cw ON cw.category_id = c.id
    WHERE c.parent_id IS NULL
    GROUP BY c.id
    ORDER BY c.topic, c.display_order
  `);

  console.log(`📁 Found ${parentCategories.length} parent categories\n`);

  // Step 2: Clean up existing subcategories (re-run safe)
  const existingSubs = await queryRunner.query(
    `SELECT id FROM categories WHERE parent_id IS NOT NULL`
  );
  if (existingSubs.length > 0) {
    console.log(`🧹 Removing ${existingSubs.length} existing subcategories...`);
    await queryRunner.query(`
      DELETE FROM category_words 
      WHERE category_id IN (SELECT id FROM categories WHERE parent_id IS NOT NULL)
    `);
    await queryRunner.query(`DELETE FROM categories WHERE parent_id IS NOT NULL`);
    console.log('   Done.\n');
  }

  let totalSubcategories = 0;

  // Step 3: For each parent category, generate semantic subcategories
  for (const parent of parentCategories) {
    const wordCount = parseInt(parent.word_count);
    const rules = SUBCATEGORY_MAP[parent.name];

    if (!rules || rules.length === 0) {
      console.log(`   ⏭️  ${parent.icon} ${parent.display_name}: ${wordCount.toLocaleString()} words (no subcategory rules, skipping)`);
      continue;
    }

    console.log(`\n   📂 ${parent.icon} ${parent.display_name}: ${wordCount.toLocaleString()} words`);
    console.log(`      Creating ${rules.length} semantic subcategories...`);

    let subOrder = 1;
    let subCount = 0;
    let assignedWordIds: Set<string> = new Set();

    for (const rule of rules) {
      // Build ILIKE conditions from keywords
      const conditions = rule.keywords
        .map((kw) => `d.definition_en ILIKE '%${kw.replace(/'/g, "''")}%'`)
        .join(' OR ');

      const subName = `${parent.name}-${rule.name}`;

      // Create the subcategory
      const subCategory = categoryRepo.create({
        name: subName,
        displayName: rule.displayName,
        description: rule.description,
        icon: rule.icon,
        topic: parent.topic,
        displayOrder: subOrder++,
        parentId: parent.id,
      });

      const saved = await categoryRepo.save(subCategory);

      // Assign words: must be in parent category AND match definition keywords
      const insertResult = await queryRunner.query(`
        INSERT INTO category_words (category_id, word_id, display_order, added_at)
        SELECT DISTINCT $1::bigint, cw.word_id, 0, NOW()
        FROM category_words cw
        JOIN words w ON w.id = cw.word_id
        JOIN definitions d ON d.word_id = w.id
        WHERE cw.category_id = $2
          AND (${conditions})
        ON CONFLICT (category_id, word_id) DO NOTHING
      `, [saved.id, parent.id]);

      // Count how many words were assigned
      const countResult = await queryRunner.query(
        `SELECT COUNT(*) as cnt FROM category_words WHERE category_id = $1`,
        [saved.id]
      );
      const assignedCount = parseInt(countResult[0].cnt);

      if (assignedCount > 0) {
        // Track assigned word IDs to determine "General" leftovers
        const wordIds = await queryRunner.query(
          `SELECT word_id FROM category_words WHERE category_id = $1`,
          [saved.id]
        );
        wordIds.forEach((row: any) => assignedWordIds.add(row.word_id.toString()));

        subCount++;
        console.log(`      📄 ${rule.icon} ${rule.displayName}: ${assignedCount.toLocaleString()} words`);
      } else {
        // Remove empty subcategory
        await categoryRepo.remove(saved);
        console.log(`      ⏭️  ${rule.icon} ${rule.displayName}: 0 words (removed)`);
      }
    }

    // Create "General" subcategory for unmatched words in this parent
    const allParentWordIds = await queryRunner.query(
      `SELECT word_id FROM category_words WHERE category_id = $1`,
      [parent.id]
    );
    const unmatchedWordIds = allParentWordIds
      .map((row: any) => row.word_id.toString())
      .filter((id: string) => !assignedWordIds.has(id));

    if (unmatchedWordIds.length > 0) {
      const generalName = `${parent.name}-general`;
      const generalSub = categoryRepo.create({
        name: generalName,
        displayName: `General ${parent.display_name}`,
        description: `Other ${parent.display_name.toLowerCase()} words`,
        icon: parent.icon,
        topic: parent.topic,
        displayOrder: subOrder++,
        parentId: parent.id,
      });
      const savedGeneral = await categoryRepo.save(generalSub);

      // Batch insert unmatched words (in chunks to avoid query size limits)
      const chunkSize = 5000;
      for (let i = 0; i < unmatchedWordIds.length; i += chunkSize) {
        const chunk = unmatchedWordIds.slice(i, i + chunkSize);
        const values = chunk.map((id: string) => `(${savedGeneral.id}, ${id}, 0, NOW())`).join(',');
        await queryRunner.query(`
          INSERT INTO category_words (category_id, word_id, display_order, added_at)
          VALUES ${values}
          ON CONFLICT (category_id, word_id) DO NOTHING
        `);
      }

      subCount++;
      console.log(`      📄 ${parent.icon} General ${parent.display_name}: ${unmatchedWordIds.length.toLocaleString()} words`);
    }

    totalSubcategories += subCount;
    console.log(`      ✅ Created ${subCount} subcategories`);
  }

  // ── Final Summary ──
  console.log('\n' + '='.repeat(60));
  console.log('📊 SEMANTIC SUBCATEGORY GENERATION SUMMARY');
  console.log('='.repeat(60));

  const summary = await queryRunner.query(`
    SELECT 
      p.display_name as parent_name,
      p.icon as parent_icon,
      p.topic,
      COUNT(DISTINCT s.id) as sub_count,
      (SELECT COUNT(*) FROM category_words WHERE category_id = p.id) as parent_words
    FROM categories p
    LEFT JOIN categories s ON s.parent_id = p.id
    WHERE p.parent_id IS NULL
    GROUP BY p.id, p.display_name, p.icon, p.topic, p.display_order
    ORDER BY p.topic, p.display_order
  `);

  let currentTopic = '';
  for (const row of summary) {
    if (row.topic !== currentTopic) {
      currentTopic = row.topic;
      console.log(`\n  📂 ${currentTopic}`);
    }
    const subCount = parseInt(row.sub_count);
    const parentWords = parseInt(row.parent_words);
    const subLabel = subCount > 0 ? ` → ${subCount} subcategories` : '';
    console.log(`     ${row.parent_icon} ${row.parent_name}: ${parentWords.toLocaleString()} words${subLabel}`);
  }

  // Show subcategory details
  console.log('\n' + '-'.repeat(60));
  console.log('📋 SUBCATEGORY DETAILS');
  console.log('-'.repeat(60));

  const subDetails = await queryRunner.query(`
    SELECT 
      p.display_name as parent_name,
      p.icon as parent_icon,
      s.display_name as sub_name,
      s.icon as sub_icon,
      COUNT(cw.id) as word_count
    FROM categories s
    JOIN categories p ON p.id = s.parent_id
    LEFT JOIN category_words cw ON cw.category_id = s.id
    GROUP BY p.id, p.display_name, p.icon, p.display_order, s.id, s.display_name, s.icon, s.display_order
    ORDER BY p.display_order, s.display_order
  `);

  let lastParent = '';
  for (const row of subDetails) {
    if (row.parent_name !== lastParent) {
      lastParent = row.parent_name;
      console.log(`\n  ${row.parent_icon} ${row.parent_name}:`);
    }
    console.log(`     ${row.sub_icon} ${row.sub_name}: ${parseInt(row.word_count).toLocaleString()} words`);
  }

  const totalSubs = await queryRunner.query(
    `SELECT COUNT(*) as count FROM categories WHERE parent_id IS NOT NULL`
  );
  console.log(`\n  Total subcategories created: ${parseInt(totalSubs[0].count)}`);
  console.log('\n✅ Semantic subcategory generation complete!');

  await queryRunner.release();
  await dataSource.destroy();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
