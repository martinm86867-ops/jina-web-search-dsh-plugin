import test from 'node:test'
import assert from 'node:assert/strict'
import {
  toolSettingsOf,
  createSettingsSchema,
  DEFAULT_TARGET_SELECTORS,
  DEFAULT_REMOVE_SELECTORS,
  EXTRACTION_PRESETS,
} from '../proxy.js'

test('default selectors are exported and non-empty', () => {
  assert.ok(DEFAULT_TARGET_SELECTORS.includes('article'))
  assert.ok(DEFAULT_TARGET_SELECTORS.includes('main'))
  assert.ok(DEFAULT_REMOVE_SELECTORS.includes('.cookie-banner'))
  assert.ok(DEFAULT_REMOVE_SELECTORS.includes('nav'))
  assert.ok(DEFAULT_REMOVE_SELECTORS.includes('footer'))
})

test('extraction presets exist and contain balanced, research, and clean-read', () => {
  assert.ok(EXTRACTION_PRESETS.balanced)
  assert.ok(EXTRACTION_PRESETS.research)
  assert.ok(EXTRACTION_PRESETS['clean-read'])
  assert.ok(EXTRACTION_PRESETS['fast-index'])
})

test('toolSettingsOf populates default selectors when empty', () => {
  const result = toolSettingsOf({})
  assert.equal(result.defaultTargetSelector, DEFAULT_TARGET_SELECTORS)
  assert.equal(result.defaultRemoveSelector, DEFAULT_REMOVE_SELECTORS)
  assert.equal(result.defaultPreset, 'agent')
})
