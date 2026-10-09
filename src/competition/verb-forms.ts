// "base past participle"; slashes separate accepted alternatives.
const IRREGULAR_VERBS = `
arise arose arisen
awake awoke awoken
be was/were been
bear bore borne/born
beat beat beaten
become became become
begin began begun
bend bent bent
bet bet bet
bind bound bound
bite bit bitten
bleed bled bled
blow blew blown
break broke broken
breed bred bred
bring brought brought
broadcast broadcast broadcast
build built built
burn burned/burnt burned/burnt
burst burst burst
buy bought bought
catch caught caught
choose chose chosen
cling clung clung
come came come
cost cost cost
creep crept crept
cut cut cut
deal dealt dealt
dig dug dug
do did done
draw drew drawn
dream dreamed/dreamt dreamed/dreamt
drink drank drunk
drive drove driven
eat ate eaten
fall fell fallen
feed fed fed
feel felt felt
fight fought fought
find found found
flee fled fled
fly flew flown
forbid forbade forbidden
forecast forecast forecast
forget forgot forgotten
forgive forgave forgiven
freeze froze frozen
get got got/gotten
give gave given
go went gone
grind ground ground
grow grew grown
hang hung/hanged hung/hanged
have had had
hear heard heard
hide hid hidden
hit hit hit
hold held held
hurt hurt hurt
keep kept kept
kneel knelt/kneeled knelt/kneeled
know knew known
lay laid laid
lead led led
lean leaned/leant leaned/leant
leap leaped/leapt leaped/leapt
learn learned/learnt learned/learnt
leave left left
lend lent lent
let let let
lie lay/lied lain/lied
light lit/lighted lit/lighted
lose lost lost
make made made
mean meant meant
meet met met
mislead misled misled
mistake mistook mistaken
overcome overcame overcome
overtake overtook overtaken
pay paid paid
prove proved proved/proven
put put put
quit quit quit
read read read
ride rode ridden
ring rang rung
rise rose risen
run ran run
say said said
see saw seen
seek sought sought
sell sold sold
send sent sent
set set set
sew sewed sewn/sewed
shake shook shaken
shed shed shed
shine shone/shined shone/shined
shoot shot shot
show showed shown/showed
shrink shrank shrunk
shut shut shut
sing sang sung
sink sank sunk
sit sat sat
sleep slept slept
slide slid slid
speak spoke spoken
speed sped/speeded sped/speeded
spell spelled/spelt spelled/spelt
spend spent spent
spill spilled/spilt spilled/spilt
spin spun spun
spit spat spat
split split split
spoil spoiled/spoilt spoiled/spoilt
spread spread spread
spring sprang sprung
stand stood stood
steal stole stolen
stick stuck stuck
sting stung stung
stink stank stunk
strike struck struck
strive strove/strived striven/strived
swear swore sworn
sweep swept swept
swim swam swum
swing swung swung
take took taken
teach taught taught
tear tore torn
tell told told
think thought thought
throw threw thrown
understand understood understood
undertake undertook undertaken
upset upset upset
wake woke woken
wear wore worn
weave wove woven
weep wept wept
win won won
wind wound wound
withdraw withdrew withdrawn
write wrote written
`;

const IRREGULAR_FORMS = new Map<string, Set<string>>(
  IRREGULAR_VERBS.trim().split('\n').map((line) => {
    const [base, past, participle] = line.split(' ');
    return [base, new Set([...past.split('/'), ...participle.split('/')])];
  }),
);

function regularPastForms(base: string): string[] {
  const forms = [`${base}ed`];
  if (base.endsWith('e')) forms.push(`${base}d`);
  if (/[^aeiou]y$/.test(base)) forms.push(`${base.slice(0, -1)}ied`);
  if (/[^aeiou][aeiou][b-df-hj-np-tvz]$/.test(base)) forms.push(`${base}${base.at(-1)}ed`);
  if (base.endsWith('c')) forms.push(`${base}ked`);
  return forms;
}

/**
 * Whether `form` is `word` itself or its past / past participle. For phrasal
 * verbs only the first word may change ("give up" → "gave up").
 */
export function isAllowedVerbForm(word: string, form: string): boolean {
  const [base, ...rest] = word.trim().toLowerCase().split(/\s+/);
  const [inflected, ...formRest] = form.trim().toLowerCase().split(/\s+/);
  if (rest.join(' ') !== formRest.join(' ')) return false;
  if (inflected === base) return true;
  const irregular = IRREGULAR_FORMS.get(base);
  if (irregular) return irregular.has(inflected);
  return regularPastForms(base).includes(inflected);
}
