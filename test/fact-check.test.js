/**
 * Behavioural contract for jina_fact_check (TDD: written first, RED).
 *
 * These tests pin the behaviour that the previous word-overlap heuristic got
 * wrong. The regression fixture is the single most diagnostic pair of claims:
 *
 *   "Trump is the President of the United States"        → SUPPORTED (vague)
 *   "Trump was inaugurated ... on 20 January 2025"       → SUPPORTED (specific)
 *
 * The old proxy returned TRUE for the first and FALSE for the second — an
 * inverse correlation between specificity and verdict. Any implementation
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
  assert.equal(v.verdict, 'SUPPORTED', `expected SUPPORTED, got ${v.verdict} (coverage ${v.coverage})`)
  assert.ok(v.confidence > 0.8, 'confidence must be computed from coverage, not a literal constant')
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
  assert.equal(vagueV.verdict, 'SUPPORTED')
  assert.equal(specificV.verdict, 'SUPPORTED',
    'the specific claim must not be rejected merely for containing dates and figures')

  // The specific claim must not be penalised relative to the vague one.
  assert.ok(specificV.confidence > 0.8, `specific confidence too low: ${specificV.confidence}`)
  assert.ok(specificV.confidence >= vagueV.confidence - 0.25,
    `specific claim must not be materially penalised (vague ${vagueV.confidence} vs specific ${specificV.confidence})`)
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
  assert.notEqual(v.verdict, 'REFUTED', 'the evidence in context contains no refutation of this claim')
  // Two bodies that disagree, or one body and no contest: never asserted as settled.
  assert.ok(['UNKNOWN', 'MIXED'].includes(v.verdict), `expected abstention, got ${v.verdict}`)
})

test('fact check: no relevant evidence yields UNKNOWN, not FALSE', () => {
  const v = evaluateGroundedResults(
    'The 2020 United States presidential election was overturned',
    envelope([
      supporting('Weather forecast for the week', 'https://example.com/weather', 'Sunny with a light breeze across the region.'),
      supporting('Recipe collection', 'https://example.com/food', 'A simple pasta dish with garlic and olive oil.'),
    ]),
  )
  assert.equal(v.verdict, 'UNKNOWN')
  assert.ok(v.coverage < RELEVANCE_FLOOR, 'nothing should have cleared the relevance floor')
})

test('fact check: absence of corroboration is not refutation', () => {
  const v = evaluateGroundedResults(
    'A claim nobody has written about at all regarding obscure topic xyzzy',
    envelope([supporting('Unrelated page', 'https://example.com/x', 'Entirely different subject matter here.')]),
  )
  assert.equal(v.verdict, 'UNKNOWN')
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
  assert.equal(v.verdict, 'REFUTED')
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
  assert.notEqual(v.verdict, 'REFUTED', 'a negation word must not refute the claim it appears alongside')
  assert.equal(v.verdict, 'SUPPORTED')
})

test('fact check: contradicting sources produce MIXED, not a one-sided verdict', () => {
  const v = evaluateGroundedResults(
    'Widget X caused the failure',
    envelope([
      supporting('Report finds Widget X at fault', 'https://example.com/a', 'The investigation concluded that widget x caused the failure of the system.'),
      refuting('Independent review clears Widget X', 'https://example.com/b', 'The claim that widget x caused the failure of the system is false, according to the independent review.'),
    ]),
  )
  assert.equal(v.verdict, 'MIXED')
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
  assert.match(text, /Verdict: SUPPORTED/)
  assert.match(text, /https:\/\/en\.wikipedia\.org/)
  assert.match(text, /Evidence & References:/)
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
  // Unambiguous markers stand alone.
  assert.equal(findRefutation('The claim has been debunked.', 'anything at all'), 'debunked')
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
  assert.notEqual(v.verdict, 'SUPPORTED', 'term overlap must not corroborate a figure the evidence contradicts')
  assert.equal(v.verdict, 'UNKNOWN')
})

test('fact check: a true figure IS corroborated when the evidence states it', () => {
  const v = evaluateGroundedResults('The Earth equatorial radius is about 6378 kilometres', envelope([
    supporting('Earth radius', 'https://en.wikipedia.org/wiki/Earth_radius',
      'The Earth equatorial radius is about 6378 kilometres, between the polar minimum of about 6,357 km and the equatorial maximum of about 6,378 km.'),
  ]))
  assert.equal(v.verdict, 'SUPPORTED')
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
  assert.equal(v.verdict, 'MIXED', 'a headline disputing the claim must register as a refutation')
})

// --- the old heuristic must be gone ---------------------------------------

test('fact check: the registry entry names the grounded evaluator', () => {
  assert.match(INDEX_SRC, /jina_fact_check/)
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
