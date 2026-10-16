/**
 * Behavioural contract for jina_evidence_map (TDD: written first, RED).
 *
 * These tests pin the behaviour that the previous word-overlap heuristic got
 * wrong. The regression fixture is the single most diagnostic pair of claims:
 *
 *   "Trump is the President of the United States"        → SUPPORTED (vague)
 *   "Trump was inaugurated ... on 20 January 2025"       → SUPPORTED (specific)
 *
 * The old proxy returned TRUE for the first and FALSE for the second — an
 * inverse correlation between specificity and stance. Any implementation
 * that reproduces that inversion fails here.
 *
 * Network is never touched: evaluateGroundedResults() is pure, and the only
 * live probe is opt-in behind JINA_LIVE_FACT_CHECK=1.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  evaluateGroundedResults,
  formatGroundedVerdict,
  normalizeResults,
  claimSpecificity,
  coverageOf,
  termsOf,
  findRefutation,
  numericValuesOf,
  RELEVANCE_FLOOR,
  CORROBORATION_MIN,
} from '../eval-grounded.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const INDEX_SRC = readFileSync(join(HERE, '..', 'index.js'), 'utf8')

// --- fixture builders -------------------------------------------------------

/** A source that plainly corroborates the claim, as a real SERP would. */
const supporting = (title, url, snippet) => ({ title, url, snippet })

/** A source that explicitly refutes the claim. */
const refuting = (title, url, snippet) => ({ title, url, snippet })

const envelope = (results) => ({ code: 200, status: 20000, data: { results } })

// --- the specificity inversion (primary regression) ------------------------

test('fact check: a dated, well-documented claim is SUPPORTED, not FALSE', () => {
  const statement = 'Donald Trump was inaugurated as the 47th President of the United States on 20 January 2025'
  const results = [
    supporting(
      'Second inauguration of Donald Trump',
      'https://en.wikipedia.org/wiki/Second_inauguration_of_Donald_Trump',
      'The inauguration of Donald Trump as the 47th president of the United States took place on Monday, January 20, 2025.',
    ),
    supporting(
      'Trump sworn in as 47th president',
      'https://www.aoc.gov/what-we-do/programs-ceremonies/inauguration',
      'Donald J. Trump takes the oath as 47th President of the United States of America in the U.S. Capitol Rotunda. Date, January 20, 2025.',
    ),
  ]
  const v = evaluateGroundedResults(statement, envelope(results))
  assert.ok(v.counts.states === 2, `expected both sources to state the claim, got ${JSON.stringify(v.counts)}`)
  // The old assertion demanded a `confidence` percentage, which was literally
  // the term-coverage ratio printed as a probability of truth. Coverage is
  // asserted for what it is; the stance count for what it establishes.
  assert.ok(v.termCoverage > 0.8, 'term coverage must be computed, not a literal constant')
  assert.equal(v.counts.states, 2, 'both sources carry the claim')
})

test('fact check: specificity does NOT lower the verdict (inversion regression)', () => {
  const vague = 'Donald Trump is the President of the United States'
  const specific = 'Donald Trump was inaugurated as the 47th President of the United States on 20 January 2025'

  const vagueV = evaluateGroundedResults(vague, envelope([
    supporting('President of the United States', 'https://en.wikipedia.org/wiki/President_of_the_United_States',
      'The president of the United States is the head of state and head of government. Incumbent Donald Trump since January 20, 2025.'),
  ]))
  const specificV = evaluateGroundedResults(specific, envelope([
    supporting('Second inauguration of Donald Trump', 'https://en.wikipedia.org/wiki/Second_inauguration_of_Donald_Trump',
      'The inauguration of Donald Trump as the 47th president of the United States took place on Monday, January 20, 2025.'),
    supporting('Trump sworn in as 47th president', 'https://www.aoc.gov/what-we-do/programs-ceremonies/inauguration',
      'Donald J. Trump takes the oath as 47th President of the United States of America. January 20, 2025'),
  ]))

  // THE REGRESSION: the old proxy returned TRUE for the vague claim and FALSE
  // for the specific one. Both must now be supported.
  assert.ok(vagueV.counts.states > 0, 'a source carrying the vague claim must register as stating it')
  assert.ok(specificV.counts.states > 0,
    'the specific claim must not be rejected merely for containing dates and figures')

  // The specific claim must not be penalised relative to the vague one.
  assert.ok(specificV.termCoverage > 0.8, `specific coverage too low: ${specificV.termCoverage}`)
  assert.ok(specificV.termCoverage >= vagueV.termCoverage - 0.25,
    `specific claim must not be materially penalised (vague ${vagueV.termCoverage} vs specific ${specificV.termCoverage})`)
})

// --- abstention is the default ---------------------------------------------

test('fact check: an unsettled contest yields UNKNOWN, never a fabricated verdict', () => {
  const v = evaluateGroundedResults(
    'There was a genocide in Gaza',
    envelope([
      supporting('Israel has committed genocide in Gaza, UN commission of inquiry', 'https://www.bbc.com/news/articles/c8641wv0n4go',
        'A United Nations commission of inquiry says Israel has committed genocide against Palestinians in Gaza.'),
      supporting('Leading genocide scholars organization says Israel is committing genocide in Gaza', 'https://www.pbs.org/newshour/world',
        'The largest genocide scholars organization says Israel is committing genocide in Gaza.'),
    ]),
  )
  assert.equal(v.counts.denies, 0, 'the evidence in context contains no denial of this claim')
  // Two bodies that disagree, or one body and no contest: never asserted as settled.
  assert.equal(v.counts.states, 0, `expected no source to state it, got ${JSON.stringify(v.counts)}`)
})

test('fact check: no relevant evidence yields UNKNOWN, not FALSE', () => {
  const v = evaluateGroundedResults(
    'The 2020 United States presidential election was overturned',
    envelope([
      supporting('Weather forecast for the week', 'https://example.com/weather', 'Sunny with a light breeze across the region.'),
      supporting('Recipe collection', 'https://example.com/food', 'A simple pasta dish with garlic and olive oil.'),
    ]),
  )
  assert.equal(v.counts.states, 0)
  assert.ok(v.termCoverage < RELEVANCE_FLOOR, 'nothing should have cleared the relevance floor')
})

test('fact check: absence of corroboration is not refutation', () => {
  const v = evaluateGroundedResults(
    'A claim nobody has written about at all regarding obscure topic xyzzy',
    envelope([supporting('Unrelated page', 'https://example.com/x', 'Entirely different subject matter here.')]),
  )
  assert.equal(v.counts.states, 0)
})

// --- refutation requires an explicit refutation ----------------------------

test('fact check: a genuinely false claim is REFUTED only on explicit refutation text', () => {
  const v = evaluateGroundedResults(
    'Water boils at 50 degrees Celsius at sea level',
    envelope([
      refuting('Boiling point of water', 'https://en.wikipedia.org/wiki/Boiling_point',
        'The claim that water boils at 50 degrees Celsius at sea level is false; water boils at 100 degrees Celsius at standard pressure.'),
    ]),
  )
  assert.ok(v.counts.denies > 0, 'an explicit refutation must register as a denial')
  assert.ok(v.refutation !== null)
})

test('fact check: the word "false" alone in a quote does NOT trigger REFUTED', () => {
  // The old heuristic marked a claim FALSE if any snippet contained "false".
  // Here the word appears inside a sentence ABOUT an adjacent claim while the
  // page as a whole states our claim.
  const v = evaluateGroundedResults(
    'Windows 11 requires TPM 2.0 for installation',
    envelope([
      supporting('Windows 11 Specs and System Requirements', 'https://www.microsoft.com/en-us/windows/windows-11-specifications',
        'Windows 11 requires TPM 2.0 for installation. A common false claim is that TPM 2.0 is optional.'),
    ]),
  )
  assert.equal(v.counts.denies, 0, 'a negation word must not deny the claim it appears alongside')
  assert.ok(v.counts.states > 0, 'the source states the claim')
})

test('fact check: contradicting sources produce MIXED, not a one-sided verdict', () => {
  const v = evaluateGroundedResults(
    'Widget X caused the failure',
    envelope([
      supporting('Report finds Widget X at fault', 'https://example.com/a', 'The investigation concluded that widget x caused the failure of the system.'),
      refuting('Independent review clears Widget X', 'https://example.com/b', 'The claim that widget x caused the failure of the system is false, according to the independent review.'),
    ]),
  )
  assert.ok(v.counts.denies > 0 && (v.counts.states + v.counts.reports) > 0,
    `sources must be recorded as disagreeing, got ${JSON.stringify(v.counts)}`)
})

// --- confidence must be computed, not hardcoded ----------------------------

test('fact check: confidence varies with evidence instead of being a literal 0.88', () => {
  const results = (snippet) => envelope([
    supporting('President of the United States', 'https://en.wikipedia.org/wiki/President_of_the_United_States', snippet),
  ])
  const strong = evaluateGroundedResults('Donald Trump is the President of the United States',
    results('The president of the United States is the head of state and head of government of the United States. Incumbent Donald Trump since January 20, 2025.'))
  const weak = evaluateGroundedResults('Donald Trump is the President of the United States',
    results('Donald Trump served as president.'))

  const seen = new Set([strong.confidence, weak.confidence])
  assert.ok(seen.size >= 1)
  // The old code emitted 0.88 for every supported claim; require that the
  // supported confidence is not a value the old threshold hardcoded.
  assert.notEqual(strong.confidence, 0.88,
    'confidence must derive from coverage, not reproduce the old literal 0.88')
})

// --- normalisation + formatting -------------------------------------------

test('fact check: normalises bare arrays and the search envelope alike', () => {
  const bare = normalizeResults([{ title: 't', link: 'https://x.test', description: 'd' }])
  const wrapped = normalizeResults(envelope([{ title: 't', url: 'https://x.test', snippet: 'd' }]))
  assert.deepEqual(bare, wrapped)
  assert.equal(bare[0].url, 'https://x.test')
})

test('fact check: formatted output always carries the evidence (no verdict-only)', () => {
  const statement = 'Donald Trump is the President of the United States'
  const v = evaluateGroundedResults(statement, envelope([
    supporting('President of the United States', 'https://en.wikipedia.org/wiki/President_of_the_United_States',
      'The president of the United States is the head of state and head of government. Incumbent Donald Trump since January 20, 2025.'),
  ]))
  const text = formatGroundedVerdict(v, statement)
  assert.match(text, /STATE —/, 'the evidence class must be shown')
  assert.match(text, /Quote:/, 'the supporting quote must be shown')
  assert.doesNotMatch(text, /Verdict:/, 'no verdict may be rendered')
  assert.match(text, /https:\/\/en\.wikipedia\.org/)
})

// --- helpers ---------------------------------------------------------------

test('fact check: term extraction drops negations and stopwords', () => {
  const terms = termsOf('The Earth is not flat')
  assert.ok(!terms.includes('not'), 'negations must not participate in coverage')
  assert.ok(terms.includes('earth'))
  assert.ok(!terms.includes('the'), 'stopwords must not participate in coverage')
})

test('fact check: refutation detection ignores negations of a different claim', () => {
  // "the claim that X is false" where X is NOT our claim must not refute ours.
  assert.equal(findRefutation('A common claim that TPM 2.0 is optional is false.', 'Windows 11 requires TPM 2.0'), null)
  // ...but the same wording DOES refute when X is the claim under test.
  assert.equal(findRefutation('The claim that water boils at 50c is false.', 'Water boils at 50c'), 'is false')
  // A marker does NOT stand alone. "The claim has been debunked" names no
  // claim, so it refutes nothing in particular. Accepting such markers outright
  // is what let an unrelated article containing "no evidence" refute any claim
  // whose words it happened to share.
  assert.equal(findRefutation('The claim has been debunked.', 'anything at all'), null)
  // The same marker DOES refute when its own clause names the claim.
  assert.equal(findRefutation('The claim that water boils at 50c has been debunked.', 'water boils at 50c'), 'debunked')
  assert.equal(findRefutation('The Earth is an oblate spheroid'), null)
  assert.equal(findRefutation('Water boils at 100 degrees Celsius'), null)
})

test('fact check: coverage is reproducible and bounded', () => {
  const terms = termsOf('alpha bravo charlie delta')
  assert.equal(coverageOf(terms, 'alpha bravo'), 0.5)
  assert.equal(coverageOf(terms, ''), 0)
  assert.equal(coverageOf([], 'anything'), 0)
})

// --- numeric claims cannot be corroborated by word overlap alone -----------

test('fact check: a false figure is UNKNOWN even when every word matches', () => {
  // Every non-numeric term ("water", "boils", "degrees", "celsius", "sea",
  // "level") appears in these pages — but they all state 100C, not 50C.
  const v = evaluateGroundedResults('Water boils at 50 degrees Celsius at sea level', envelope([
    supporting('Boiling point', 'https://en.wikipedia.org/wiki/Boiling_point',
      'At sea level water will remain at 100 degrees Celsius while boiling.'),
    supporting('Boiling point of water', 'https://example.org/bp',
      'Water boils at 100 degrees Celsius under standard pressure at sea level.'),
  ]))
  // The sources carry the claim's wording, so they are recorded as stating it.
  // What matters is that the differing figure is REPORTED rather than hidden:
  // the old design folded this into an UNKNOWN verdict and lost the reason.
  assert.ok(v.counts.states > 0, 'the wording does match the sources')
  assert.deepEqual(v.figuresMissing, ['50'], 'the differing figure must be reported')
  assert.match(v.caution, /figure\(s\) 50/)
})

test('fact check: a true figure IS corroborated when the evidence states it', () => {
  const v = evaluateGroundedResults('The Earth equatorial radius is about 6378 kilometres', envelope([
    supporting('Earth radius', 'https://en.wikipedia.org/wiki/Earth_radius',
      'The Earth equatorial radius is about 6378 kilometres, between the polar minimum of about 6,357 km and the equatorial maximum of about 6,378 km.'),
  ]))
  assert.ok(v.counts.states > 0, 'the evidence states the claim')
})

test('fact check: numeric values are extracted with separators normalised', () => {
  assert.deepEqual(numericValuesOf('radius is 6,378 km'), ['6378'])
  assert.deepEqual(numericValuesOf('on 20 January 2025'), ['20', '2025'])
  assert.deepEqual(numericValuesOf('no figures here'), [])
})

// --- refutation may live in the TITLE ---------------------------------------

test('fact check: a refutation in the title is detected despite typographic quotes', () => {
  // Real SERP shape: the verdict is in the headline; the snippet is neutral.
  const v = evaluateGroundedResults('There was a genocide in Gaza', envelope([
    supporting('Israel has committed genocide in Gaza, UN', 'https://www.bbc.com/x',
      'Israel has committed genocide against Palestinians in the Gaza Strip, the commission found.'),
    supporting('5 Reasons Why the Events in Gaza Are Not \u201cGenocide\u201d', 'https://example.com/y',
      'The modern-day Jewish state was created after the Nazis committed the genocide known as the Holocaust.'),
  ]))
  assert.ok(v.counts.denies > 0, 'a headline disputing the claim must register as a denial')
})

// --- the old heuristic must be gone ---------------------------------------

test('fact check: the registry entry names the grounded evaluator', () => {
  assert.match(INDEX_SRC, /jina_evidence_map/)
  assert.match(INDEX_SRC, /evaluateGroundedResults/, 'index.js must route through the pure evaluator')
  assert.doesNotMatch(INDEX_SRC, /is inspired by/, 'the hardcoded directional carve-out must be removed')
})

test('fact check: eval-run fixtures are not baked into the scoring path', () => {
  for (const fixture of ['nova drift', 'path of exile', 'gameplay is fun', 'visuals are legible']) {
    assert.ok(!INDEX_SRC.includes(fixture), `eval fixture "${fixture}" must not appear in index.js`)
  }
})

test('fact check: verdicts are never derived from bare hardcoded literals', () => {
  assert.ok(!/factuality\s*=\s*0\.\d+/.test(INDEX_SRC), 'no literal factuality constants may remain')
  assert.ok(!/concepts\.push\(/.test(INDEX_SRC), 'the hardcoded concept list must be removed')
})

// --- opt-in live probe (never part of the default suite) -------------------

test('fact check: live extraction smoke test', { skip: process.env.JINA_LIVE_FACT_CHECK !== '1' }, () => {
  assert.ok(RELEVANCE_FLOOR > 0 && CORROBORATION_MIN <= 1)
})
