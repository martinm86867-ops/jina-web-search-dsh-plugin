/**
 * Archive.org transport for the Jina plugin.
 *
 * The two projects stay independent: this module does not reimplement any
 * archive logic. It invokes the archivist (Python, standalone) through its DSH
 * bridge and returns its JSON, so there is exactly one implementation of
 * full-text search, the corpus, the difference classifier and claim tracing.
 *
 * Why invoke rather than port
 * ---------------------------
 * Rewriting the archive side in JavaScript would produce a second
 * implementation, in a second language, of a body of work that already exists
 * and is tested — the duplication this project has already paid to remove once.
 * The cost is a runtime dependency on a checkout and an interpreter, which is
 * why both paths are configurable and the caller degrades to the live-web half
 * when the archivist is absent.
 *
 * What archive.org API keys do NOT do
 * -----------------------------------
 * S3 keys authorise writes (upload, metadata). They do not unlock
 * lending-restricted content: a restricted item returns 401 on its text and 403
 * on search-inside both anonymously and with the keys attached (verified).
 * Reading a borrowed book requires an Open Library session with an active
 * borrow, which is a different mechanism and is not implemented here.
 */

import { spawn } from 'node:child_process'
import { existsSync, accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

/** Environment override for the archivist interpreter. */
const PYTHON_ENV = 'DSH_ARCHIVE_PYTHON'

/** Known interpreter locations, most specific first. */
const PYTHON_CANDIDATES = [
  '/home/martin/dsh-plugins/dsh-archive-suite/.venv/bin/python',
  '/home/martin/archive/.venv/bin/python',
  '/usr/bin/python3',
  '/usr/local/bin/python3',
]

/**
 * Whether a path is an executable file.
 * @param {string} p absolute path
 * @returns {boolean}
 */
function isExecutable(p) {
  try {
    if (!existsSync(p)) return false
    accessSync(p, constants.X_OK)
    return true
  } catch (err) {
    return false
  }
}

/**
 * Resolve the Python interpreter without ever treating a bare command name as
 * a filesystem path.
 *
 * `existsSync('python3')` tests a *relative* path and is therefore always
 * false — the original fallback silently disabled the entire archive half
 * (`archiveAvailable()` returned false on every machine, bridge present or
 * not). Resolution is: explicit `DSH_ARCHIVE_PYTHON` → known absolute
 * locations → `PATH` lookup.
 *
 * @returns {string|undefined} an absolute path, or undefined when nothing is usable.
 */
export function resolvePython() {
  const explicit = process.env[PYTHON_ENV]
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
  const known = PYTHON_CANDIDATES.find(isExecutable)
  if (known !== undefined) return known
  const path = process.env.PATH || ''
  const names = process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python']
  for (const dir of path.split(delimiter)) {
    if (dir === '') continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (isExecutable(candidate)) return candidate
    }
  }
  return undefined
}

export const ARCHIVE_PYTHON = resolvePython() || 'python3'

export const ARCHIVE_BRIDGE = process.env.DSH_ARCHIVE_BRIDGE
  || '/home/martin/dsh-plugins/dsh-archive-suite/bridge.py'

export const ARCHIVE_TIMEOUT_MS = Number(process.env.DSH_ARCHIVE_TIMEOUT_MS || 180000)

/**
 * Whether the archivist backend is reachable.
 *
 * The bridge is the gate: an explicitly configured interpreter is trusted as
 * written (it may be a venv shim), otherwise the resolved interpreter must be a
 * real executable. A bare `python3` that could not be located no longer
 * masquerades as installed.
 */
export function archiveAvailable() {
  if (!existsSync(ARCHIVE_BRIDGE)) return false
  const explicit = process.env[PYTHON_ENV]
  if (typeof explicit === 'string' && explicit.trim() !== '') return true
  return isExecutable(ARCHIVE_PYTHON)
}

/**
 * Run one archivist bridge command and parse its JSON result.
 * @param {string} command bridge command name (e.g. 'claim_trace')
 * @param {object} args JSON payload written to the child's stdin
 * @returns {Promise<object>}
 */
export function archiveCall(command, args = {}, timeoutMs = ARCHIVE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!archiveAvailable()) {
      reject(new Error(`archivist not found (python: ${ARCHIVE_PYTHON}, bridge: ${ARCHIVE_BRIDGE})`))
      return
    }
    let child
    try {
      child = spawn(ARCHIVE_PYTHON, [ARCHIVE_BRIDGE, command], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      reject(err)
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (err, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(value)
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch (e) { /* already gone */ }
      finish(new Error(`archivist timed out after ${timeoutMs} ms: ${command}`))
    }, timeoutMs)

    child.stdout.on('data', (d) => { stdout += d.toString('utf8') })
    child.stderr.on('data', (d) => { stderr += d.toString('utf8') })
    child.on('error', (err) => finish(err))
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(`archivist exit ${code}: ${(stderr || stdout).slice(0, 300)}`))
        return
      }
      try {
        const parsed = JSON.parse(stdout)
        if (parsed && parsed.error) finish(new Error(String(parsed.error)))
        else finish(null, parsed)
      } catch (err) {
        finish(new Error(`archivist returned unparseable output: ${stdout.slice(0, 200)}`))
      }
    })

    try {
      child.stdin.write(JSON.stringify(args))
      child.stdin.end()
    } catch (err) {
      finish(err)
    }
  })
}
