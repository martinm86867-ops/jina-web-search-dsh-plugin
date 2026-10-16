/**
 * unified.js — archivist interpreter resolution.
 *
 * The regression guarded here is the one that silently disabled the archive
 * half of jina_fact_check / jina_rank_archive on every machine:
 * `['/venv/bin/python', 'python3'].find(existsSync)` tests a relative path for
 * the bare name, so `existsSync('python3')` was always false and
 * `archiveAvailable()` reported "not installed" with the bridge sitting right
 * there. Resolution must yield an absolute interpreter or the explicit
 * environment value, never a bare command name treated as a path.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let caseId = 0

/**
 * Run `fn` with a fresh copy of the module imported under `env`, so both the
 * module-level reads and any later `archiveAvailable()` call see that
 * environment. Environment is restored afterwards.
 */
async function withModule(env, fn) {
  caseId += 1
  const saved = {}
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    const mod = await import('../unified.js?case=' + caseId)
    return await fn(mod)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/** Run `fn` with a throwaway bridge.py that exists. */
async function withTempBridge(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-archive-'))
  const bridge = join(dir, 'bridge.py')
  writeFileSync(bridge, '# stub\n')
  try {
    return await fn(bridge)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('resolvePython never returns a bare command name', async () => {
  await withModule({ DSH_ARCHIVE_PYTHON: undefined }, (mod) => {
    const resolved = mod.resolvePython()
    if (resolved === undefined) return // no interpreter on PATH: nothing to assert
    assert.ok(resolved.includes('/') || resolved.includes('\\'), 'expected an absolute path, got ' + resolved)
  })
})

test('DSH_ARCHIVE_PYTHON is honored verbatim (a venv shim need not exist yet)', async () => {
  await withModule({ DSH_ARCHIVE_PYTHON: '/opt/venv/bin/python' }, (mod) => {
    assert.equal(mod.ARCHIVE_PYTHON, '/opt/venv/bin/python')
  })
})

test('a missing bridge is the only reason the archive is unavailable', async () => {
  await withModule({ DSH_ARCHIVE_BRIDGE: '/nonexistent/bridge.py' }, (mod) => {
    assert.equal(mod.archiveAvailable(), false)
  })
})

test('a present bridge plus a resolvable interpreter makes the archive available', async () => {
  await withTempBridge((bridge) => withModule({ DSH_ARCHIVE_BRIDGE: bridge, DSH_ARCHIVE_PYTHON: undefined }, (mod) => {
    if (mod.resolvePython() === undefined) return // no interpreter installed here
    assert.equal(mod.archiveAvailable(), true, 'bridge ' + bridge + ' with ' + mod.ARCHIVE_PYTHON)
  }))
})

test('an explicit interpreter is trusted even when it is a bare command name', async () => {
  await withTempBridge((bridge) => withModule({ DSH_ARCHIVE_BRIDGE: bridge, DSH_ARCHIVE_PYTHON: 'python3' }, (mod) => {
    assert.equal(mod.archiveAvailable(), true)
  }))
})
