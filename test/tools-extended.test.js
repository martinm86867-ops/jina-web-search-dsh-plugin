import test from 'node:test'
import assert from 'node:assert/strict'
import { toolSettingsOf, createSettingsSchema } from '../proxy.js'
import { WEB_SEARCH_TOOL } from '../tool-contracts.js'

test('toolSettingsOf extracts configured defaults', () => {
  const section = {
    proxyUrl: 'http://127.0.0.1:7897',
    defaultSearchNum: 10,
    defaultTokenBudget: 5000,
    defaultEngine: 'cf-browser-rendering',
    defaultRetainImages: 'all',
    defaultWaitForSelector: 'article',
    defaultTargetSelector: '.markdown-body',
    defaultRemoveSelector: '.nav',
    defaultNoCache: true,
  }
  const extracted = toolSettingsOf(section)
  assert.equal(extracted.proxyUrl, 'http://127.0.0.1:7897')
  assert.equal(extracted.defaultSearchNum, 10)
  assert.equal(extracted.defaultTokenBudget, 5000)
  assert.equal(extracted.defaultEngine, 'cf-browser-rendering')
  assert.equal(extracted.defaultRetainImages, 'all')
  assert.equal(extracted.defaultWaitForSelector, 'article')
  assert.equal(extracted.defaultTargetSelector, '.markdown-body')
  assert.equal(extracted.defaultRemoveSelector, '.nav')
  assert.equal(extracted.defaultNoCache, true)
})

test('toolSettingsOf defaults gracefully on empty input', () => {
  const extracted = toolSettingsOf(null)
  assert.equal(extracted.proxyUrl, '')
  assert.equal(extracted.defaultSearchNum, 5)
  assert.equal(extracted.defaultNoCache, false)
})

test('createSettingsSchema accepts and round-trips tool options', () => {
  const schema = createSettingsSchema()
  const val = schema({
    defaultSearchNum: 8,
    defaultTokenBudget: 4000,
    defaultEngine: 'bing',
    defaultNoCache: true,
  })
  assert.equal(val.defaultSearchNum, 8)
  assert.equal(val.defaultTokenBudget, 4000)
  assert.equal(val.defaultEngine, 'bing')
  assert.equal(val.defaultNoCache, true)
})

test('web search tool contract contains site, filetype, intitle, engine, nfpr', () => {
  const props = WEB_SEARCH_TOOL.parameters.properties
  assert.ok(props.site, 'site parameter must be present')
  assert.ok(props.filetype, 'filetype parameter must be present')
  assert.ok(props.intitle, 'intitle parameter must be present')
  assert.ok(props.engine, 'engine parameter must be present')
  assert.ok(props.nfpr, 'nfpr parameter must be present')
})
