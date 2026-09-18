import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  toolSettingsOf,
  createSettingsSchema,
  DEFAULT_TARGET_SELECTORS,
  DEFAULT_REMOVE_SELECTORS,
  EXTRACTION_PRESETS,
  DEFAULT_REMOVE_OVERLAY_FIELD,
  DEFAULT_DETACH_INVISIBLES_FIELD,
  DEFAULT_WITH_SHADOW_DOM_FIELD,
  DEFAULT_WITH_IFRAME_FIELD,
} from '../proxy.js'

test('proxy.js exports effective extraction fields and constants', () => {
  assert.equal(DEFAULT_REMOVE_OVERLAY_FIELD, 'defaultRemoveOverlay')
  assert.equal(DEFAULT_DETACH_INVISIBLES_FIELD, 'defaultDetachInvisibles')
  assert.equal(DEFAULT_WITH_SHADOW_DOM_FIELD, 'defaultWithShadowDom')
  assert.equal(DEFAULT_WITH_IFRAME_FIELD, 'defaultWithIframe')
})

test('DEFAULT_TARGET_SELECTORS includes high-signal microdata and QA test attributes', () => {
  assert.ok(DEFAULT_TARGET_SELECTORS.includes('itemprop="articleBody"'))
  assert.ok(DEFAULT_TARGET_SELECTORS.includes('itemprop="text"'))
  assert.ok(DEFAULT_TARGET_SELECTORS.includes('data-testid*="article"'))
  assert.ok(DEFAULT_TARGET_SELECTORS.includes('article'))
  assert.ok(DEFAULT_TARGET_SELECTORS.includes('main'))
})

test('DEFAULT_REMOVE_SELECTORS includes enterprise CMPs, paywalls, and ad containers', () => {
  assert.ok(DEFAULT_REMOVE_SELECTORS.includes('#onetrust-consent-sdk'))
  assert.ok(DEFAULT_REMOVE_SELECTORS.includes('.cookiebot'))
  assert.ok(DEFAULT_REMOVE_SELECTORS.includes('.paywall'))
  assert.ok(DEFAULT_REMOVE_SELECTORS.includes('.premium-gate'))
  assert.ok(DEFAULT_REMOVE_SELECTORS.includes('.subscription-gate'))
  assert.ok(DEFAULT_REMOVE_SELECTORS.includes('google_ads'))
})

test('EXTRACTION_PRESETS contains effective-stealth and hardened preset configurations', () => {
  const stealth = EXTRACTION_PRESETS['effective-stealth']
  assert.ok(stealth, 'effective-stealth preset must exist')
  assert.equal(stealth.defaultEngine, 'cf-browser-rendering')
  assert.equal(stealth.autoBypassCloudflare, true)
  assert.equal(stealth.defaultRemoveOverlay, true)
  assert.equal(stealth.defaultDetachInvisibles, true)
  assert.equal(stealth.defaultWithShadowDom, true)
  assert.equal(stealth.defaultWithIframe, false)

  // Verify backward-compatibility alias
  assert.equal(EXTRACTION_PRESETS['adversarial-stealth'], stealth)

  assert.equal(EXTRACTION_PRESETS.balanced.defaultRemoveOverlay, true)
  assert.equal(EXTRACTION_PRESETS.balanced.defaultDetachInvisibles, true)
})

test('toolSettingsOf extracts and defaults effective extraction configuration', () => {
  const defaults = toolSettingsOf({})
  assert.equal(defaults.defaultRemoveOverlay, true)
  assert.equal(defaults.defaultDetachInvisibles, true)
  assert.equal(defaults.defaultWithShadowDom, false)
  assert.equal(defaults.defaultWithIframe, false)

  const custom = toolSettingsOf({
    defaultRemoveOverlay: false,
    defaultDetachInvisibles: false,
    defaultWithShadowDom: true,
    defaultWithIframe: true,
  })
  assert.equal(custom.defaultRemoveOverlay, false)
  assert.equal(custom.defaultDetachInvisibles, false)
  assert.equal(custom.defaultWithShadowDom, true)
  assert.equal(custom.defaultWithIframe, true)
})

test('createSettingsSchema round-trips effective options', () => {
  const schema = createSettingsSchema()
  const val = schema({
    defaultRemoveOverlay: true,
    defaultDetachInvisibles: true,
    defaultWithShadowDom: true,
    defaultWithIframe: true,
  })
  assert.equal(val.defaultRemoveOverlay, true)
  assert.equal(val.defaultDetachInvisibles, true)
  assert.equal(val.defaultWithShadowDom, true)
  assert.equal(val.defaultWithIframe, true)
})

test('index.js registers effective extraction parameters across tools', () => {
  const indexSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

  // jina_read checks
  assert.match(indexSource, /name:\s*'jina_read'/)
  assert.match(indexSource, /removeOverlay:\s*\{\s*type:\s*'boolean'/)
  assert.match(indexSource, /detachInvisibles:\s*\{\s*type:\s*'boolean'/)
  assert.match(indexSource, /withShadowDom:\s*\{\s*type:\s*'boolean'/)
  assert.match(indexSource, /withIframe:\s*\{\s*type:\s*'boolean'/)
  assert.match(indexSource, /cookies:\s*\{\s*type:\s*'string'/)
  assert.match(indexSource, /X-Remove-Overlay/)
  assert.match(indexSource, /X-Detach-Invisibles/)
  assert.match(indexSource, /X-With-Shadow-Dom/)
  assert.match(indexSource, /X-With-Iframe/)
  assert.match(indexSource, /X-Set-Cookie/)

  // jina_extract checks
  assert.match(indexSource, /name:\s*'jina_extract'/)
  assert.match(indexSource, /removeSelector:\s*\{\s*type:\s*'string'/)

  // jina_screenshot checks
  assert.match(indexSource, /name:\s*'jina_screenshot'/)
  assert.match(indexSource, /targetSelector:\s*\{\s*type:\s*'string'/)
  assert.match(indexSource, /waitForSelector:\s*\{\s*type:\s*'string'/)

  // jina_pdf checks
  assert.match(indexSource, /name:\s*'jina_pdf'/)
  assert.match(indexSource, /page:\s*\{\s*type:\s*'number'/)

  // jina_read_file checks
  assert.match(indexSource, /name:\s*'jina_read_file'/)
  assert.match(indexSource, /localOnly:\s*\{\s*type:\s*'boolean'/)
  assert.match(indexSource, /jina-ocr/)
  assert.match(indexSource, /preferEndToEnd/)

  // Centralized CF bypass
  assert.match(indexSource, /function callJinaWithCfBypass/)

  // DEF-001 & DEF-012: classify uses jina-embeddings-v2-base-en
  assert.match(indexSource, /jina-embeddings-v2-base-en/)

  // DEF-003: X-Max-Tokens for non-rejecting budget trimming
  assert.match(indexSource, /X-Max-Tokens/)

  // DEF-004: readerlm-v2 respondWith
  assert.match(indexSource, /respondWith:\s*'readerlm-v2'/)

  // DEF-011: usage footer tracking
  assert.match(indexSource, /function extractUsageFooter/)
})
