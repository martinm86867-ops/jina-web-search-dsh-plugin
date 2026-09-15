/**
 * dsh-jina — proxy policy (pure helpers, zero dependencies).
 *
 * The Jina endpoints are unreachable from mainland China without a proxy. A
 * local proxy client (Clash / v2ray / Surge / …) that is deliberately NOT
 * enabled as the system proxy listens on a loopback port only: the Windows
 * WinINET registry discovery in index.js cannot see it, and neither can any
 * other system-level probe. This module owns the manual override and the
 * precedence the transport applies, so the user can simply type the address
 * of their own local proxy and have every Jina call ride it.
 *
 * Precedence (first usable candidate wins):
 *   1. `request` — transport-level override for one call (internal)
 *   2. `setting` — Settings → Plugins → Jina Tools → 本地代理地址
 *                  (the `proxyUrl` field of the `jina-tools` namespace)
 *   3. `envVar`  — the `JINA_PROXY_URL` environment variable, for headless
 *                  profiles that never mount a settings provider
 *   4. `system`  — the Windows system proxy discovered from WinINET
 *   5. (none)    — the harness-resolved proxy the subprocess seam already
 *                  carries (HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY)
 *
 * Only http(s) proxies are usable: the network helper is a `node -e` script
 * using the global `fetch`, which honors proxy variables under
 * `NODE_USE_ENV_PROXY` — and Node exits at startup when that flag sees a
 * non-http(s) scheme. A SOCKS value is therefore reported as unusable instead
 * of being passed on silently.
 *
 * Kept free of Cordis / ctx / network dependencies so the policy is
 * unit-testable without a running harness (see test/proxy.test.js).
 */

/** Settings namespace the "Jina Tools" card edits; the host half serves it. */
export const SETTINGS_NAMESPACE = 'jina-tools'

/** Settings field holding the manually configured local proxy address. */
export const PROXY_SETTING_FIELD = 'proxyUrl'

/** Environment variable carrying a deployment-wide manual proxy address. */
export const PROXY_ENV_VAR = 'JINA_PROXY_URL'

/**
 * Proxy variables a harness-resolved environment may carry, in inspection
 * order. Both cases are listed because Windows tooling and dsh itself differ.
 */
export const PROXY_ENV_VARS = [
  'HTTPS_PROXY', 'https_proxy',
  'HTTP_PROXY', 'http_proxy',
  'ALL_PROXY', 'all_proxy',
]

/** Human-readable reason a candidate address was rejected. */
const REJECT_REASONS = {
  empty: '地址为空',
  type: '地址不是字符串',
  invalid: '不是有效的主机:端口地址',
  scheme: '不支持的协议（网络 helper 只支持 http:// 与 https:// 代理）',
}

/** Explain one rejection reason (the plugin's user-facing language). */
export function describeRejectReason(reason) {
  return REJECT_REASONS[reason] || String(reason)
}

/**
 * Parse one proxy address into a transport-usable URL.
 *
 * Accepts `127.0.0.1:7897` (scheme defaults to http), `http://host:port`,
 * `https://host:port` and credentials-bearing forms. A path, query, or
 * fragment is dropped — a proxy address is an origin. Anything without a host,
 * or with a scheme the Node helper cannot use, comes back `usable: false`
 * with the normalized-or-raw URL preserved for display.
 *
 * @param raw - the user/config-supplied address.
 * @returns `{ url, usable, reason }`; `url` is '' when nothing parsed at all.
 */
export function parseProxyAddress(raw) {
  if (typeof raw !== 'string') {
    return { url: '', usable: false, reason: raw === undefined || raw === null || raw === '' ? 'empty' : 'type' }
  }
  const value = raw.trim()
  if (value === '') return { url: '', usable: false, reason: 'empty' }
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : 'http://' + value
  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    return { url: '', usable: false, reason: 'invalid' }
  }
  if (parsed.hostname === '') return { url: '', usable: false, reason: 'invalid' }
  const scheme = parsed.protocol.toLowerCase()
  const auth = parsed.username === ''
    ? ''
    : parsed.username + (parsed.password === '' ? '' : ':' + parsed.password) + '@'
  const url = scheme + '//' + auth + parsed.host
  if (scheme !== 'http:' && scheme !== 'https:') return { url, usable: false, reason: 'scheme' }
  return { url, usable: true, reason: 'ok' }
}

/**
 * Read the manual proxy field out of a resolved `jina-tools` section.
 * @param section - the resolved settings value (any shape).
 * @returns the stored string, or '' when unset/non-string.
 */
export function proxySettingOf(section) {
  if (section === null || typeof section !== 'object') return ''
  const value = section[PROXY_SETTING_FIELD]
  return typeof value === 'string' ? value : ''
}

/**
 * First non-empty proxy variable in an environment-like object.
 * @param env - `process.env` or any plain object.
 * @returns the raw variable value, or ''.
 */
export function envProxyValue(env) {
  if (env === null || typeof env !== 'object') return ''
  for (const name of PROXY_ENV_VARS) {
    const value = env[name]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

/**
 * Apply the precedence above to one operation's candidate addresses.
 *
 * A candidate that is present but unusable never wins; it is recorded in
 * `rejected` so the UI and the error text can report it rather than pretend
 * the user configured nothing.
 *
 * @param input - `{ request?, setting?, envVar?, system?, env? }`.
 * @returns `{ url, source, envHint, rejected }`; `url` is undefined when no
 *   candidate is usable, and `source` then names the inherited layer
 *   (`'environment'`) or nothing at all (`'none'`).
 */
export function selectProxy(input) {
  const env = (input && input.env) || {}
  const envHint = envProxyValue(env)
  const rejected = []
  const consider = (field, raw) => {
    if (typeof raw !== 'string' || raw.trim() === '') return undefined
    const parsed = parseProxyAddress(raw)
    if (parsed.usable) return { url: parsed.url, source: field }
    rejected.push({ field, value: raw.trim(), reason: parsed.reason, message: describeRejectReason(parsed.reason) })
    return undefined
  }
  const hit = consider('request', input && input.request)
    || consider('setting', input && input.setting)
    || consider('envVar', input && input.envVar)
    || consider('system', input && input.system)
  if (hit) return { url: hit.url, source: hit.source, envHint, rejected }
  return { url: undefined, source: envHint === '' ? 'none' : 'environment', envHint, rejected }
}

/**
 * Build the `jina-tools` settings schema.
 *
 * The plugin runs out of tree and cannot import the harness's schemastery
 * package, so this is a duck-typed node covering exactly the surface the
 * runtime touches: the call form (`schema(value) -> resolved value`, used by
 * `settings.register`/`resolve`) and `toJSON()` (used by `settings.describe`
 * and rehydrated by the browser as `new Schema(serialized)`).
 *
 * The resolved value is normalized to `{}` or `{ proxyUrl: <string> }`, so a
 * hand-edited `settings.yaml` cannot make registration fail: whatever the
 * stored section says, this returns a well-formed section and the transport
 * reports an unusable address through its own diagnostics.
 *
 * Shape note (verified against vendored schemastery 3.18.2): a dict entry must
 * carry `meta`, otherwise the rehydrated `string` resolver dereferences
 * `meta.pattern` on undefined (`new Schema(serialized)` assigns the serialized
 * dict verbatim — plain objects are never converted into nodes).
 *
 * @returns a schemastery-compatible schema node for the `jina-tools` namespace.
 */
export function createSettingsSchema() {
  const dict = { [PROXY_SETTING_FIELD]: { type: 'string', meta: {} } }
  const serialized = () => ({ type: 'object', dict: { [PROXY_SETTING_FIELD]: { type: 'string', meta: {} } } })
  const node = (value) => {
    const section = value !== null && typeof value === 'object' ? value : {}
    const raw = proxySettingOf(section)
    return raw === '' ? {} : { [PROXY_SETTING_FIELD]: raw }
  }
  return Object.assign(node, {
    type: 'object',
    dict,
    meta: {},
    inner: undefined,
    toJSON() { return serialized() },
  })
}
