import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('index.js exports jina_read_file and jina_fact_check', () => {
  const indexSource = readFileSync('/home/martin/dsh-plugins/jina-web-search-dsh-plugin/index.js', 'utf8')
  assert.match(indexSource, /name:\s*'jina_read_file'/)
  assert.match(indexSource, /name:\s*'jina_fact_check'/)
})

test('index.js jina_pdf supports preset, inlineFormula, and table', () => {
  const indexSource = readFileSync('/home/martin/dsh-plugins/jina-web-search-dsh-plugin/index.js', 'utf8')
  assert.match(indexSource, /preset:\s*\{\s*type:\s*'string'/)
  assert.match(indexSource, /inlineFormula/)
  assert.match(indexSource, /table/)
})

test('index.js jina_search_arxiv supports readFullText', () => {
  const indexSource = readFileSync('/home/martin/dsh-plugins/jina-web-search-dsh-plugin/index.js', 'utf8')
  assert.match(indexSource, /readFullText/)
})

test('index.js injects optional attachments service', () => {
  const indexSource = readFileSync('/home/martin/dsh-plugins/jina-web-search-dsh-plugin/index.js', 'utf8')
  assert.match(indexSource, /ctx\.get\('attachments'\)/)
})
