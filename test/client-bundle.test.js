/**
 * Contract tests for the browser bundle (ui/client.js).
 *
 * The bundle is committed prebuilt — there is no build step — so a hand edit
 * is what ships. These tests parse it (a syntax error would otherwise only
 * surface as "Failed to load plugins" in the running Web UI) and pin the
 * registration facts the module system and the settings tab depend on:
 *
 *   - `window.__ModuleLoader__.load({ id: 'dsh-jina' })` — the id MUST equal
 *     the graph row id (the exact package name); anything else makes the module
 *     system report `loaded without registering "dsh-jina"` and the whole page
 *     fails to load its plugins.
 *   - the card registers under `key: 'jina-tools'` — the settings namespace the
 *     host half serves, which is also what the configuration tab dispatches on.
 *   - the manual proxy field (`proxyUrl`) rides the standard `remote.settings`
 *     transport (`describe` / `mutate`), and external edits arrive through
 *     `settings/document-updated`.
 */

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

test('client bundle: injects the credentials and remote planes it consumes', () => {
  assert.match(SOURCE, /exports\.inject\s*=\s*\[[^\]]*'slots'[^\]]*'remote'[^\]]*'remote\.credentials'/)
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
  assert.match(SOURCE, /本次检测所用代理/)
  assert.match(SOURCE, /proxyConfigured/)
})

test('client bundle: a non-http(s) address is refused before it can be saved', () => {
  assert.match(SOURCE, /只支持 http:\/\/ 或 https:\/\/ 代理/)
})
