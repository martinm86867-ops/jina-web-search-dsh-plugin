import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Script } from 'node:vm'

const SOURCE = await readFile(new URL('../ui/client.js', import.meta.url), 'utf8')

test('client bundle: parses as a script (no build step to catch typos)', () => {
  assert.doesNotThrow(() => new Script(SOURCE, { filename: 'ui/client.js' }))
})

test('client bundle: registers under the graph row id (exact package name)', () => {
  assert.match(SOURCE, /__ModuleLoader__\.load\(/)
  assert.match(SOURCE, /id:\s*'dsh-jina'/)
  assert.doesNotMatch(SOURCE, /id:\s*'dsh-jina\/ui'/)
})

test('client bundle: card is keyed by the settings namespace the host serves', () => {
  assert.match(SOURCE, /name:\s*'settings\.plugin\.item'/)
  assert.match(SOURCE, /key:\s*'jina-tools'/)
  assert.match(SOURCE, /NS\s*=\s*'jina-tools'/)
})

test('client bundle: injects the slots plane it consumes', () => {
  assert.match(SOURCE, /exports\.inject\s*=\s*\[[^\]]*'slots'/)
})

test('client bundle: declares the services it reads', () => {
  const declared = /exports\.inject\s*=\s*\[([^\]]*)\]/.exec(SOURCE)
  assert.ok(declared, 'exports.inject must be declared')
  const names = declared[1].split(',').map((part) => part.trim().replace(/^'|'$/g, '')).filter((part) => part !== '')
  assert.deepEqual(names, ['slots', 'connection', 'remote'])
})

test('client bundle: the settings face is read defensively, never crashing a slot', () => {
  assert.match(SOURCE, /var settingsApi = function \(\) \{/)
  assert.match(SOURCE, /try \{\s*return remote && remote\.settings/)
  assert.match(SOURCE, /catch \(err\) \{\s*return undefined\s*\}/)
})

test('client bundle: the manual proxy rides the settings Remote namespace', () => {
  assert.match(SOURCE, /PROXY_FIELD\s*=\s*'proxyUrl'/)
  assert.match(SOURCE, /remote\.settings/)
  assert.match(SOURCE, /\.describe\(\)/)
  assert.match(SOURCE, /\.mutate\(/)
  assert.match(SOURCE, /settings\/document-updated/)
})

test('client bundle: proxy writes are fenced by the revision the card read', () => {
  assert.match(SOURCE, /mutate\(NS,\s*ops,\s*proxyView\.revision\)/)
})

test('client bundle: the card shows the proxy the probe actually used', () => {
  assert.match(SOURCE, /JINA_PROXY_URL/)
  assert.match(SOURCE, /Proxy used for this probe/)
  assert.match(SOURCE, /proxyConfigured/)
})

test('client bundle: a non-http(s) address is refused before it can be saved', () => {
  assert.match(SOURCE, /Only http:\/\/ or https:\/\/ proxies are supported/)
})
