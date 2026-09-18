/**
 * dsh-jina — Jina AI tools for DeepSeek Harness.
 *
 * Host plugin: registers the twelve jina_* model tools mirroring jina-cli
 * (search — with dedicated jina_search_arxiv / jina_search_ssrn academic
 * shortcuts so the model can hit the right domain without remembering the
 * `type` parameter — / read / screenshot / datetime / expand / embed /
 * rerank / classify / pdf / primer). The API key lives in the host credential seam
 * under the reference `JINA_API_KEY` — the "Jina Tools" web settings page
 * writes it through `credentials.set`, and this plugin resolves it per
 * operation (the seam's contract: never cache across operations). The web
 * settings pairing: this host half serves the `jina-tools` settings
 * namespace — whose `proxyUrl` field carries a manually configured local
 * proxy address — and the browser half registers its card for that namespace,
 * so the Settings → Plugins tab (Settings → Plugins → Configure) renders the
 * card only when the two halves agree.
 *
 * The API key is resolved per call in this order:
 *   1. the tool's own `apiKey` parameter,
 *   2. the `JINA_API_KEY` credential (set from the web settings page,
 *      persisted by the host credential provider, e.g. `.credentials.yaml`),
 *   3. `jina-api-key.txt` in the calling session's workspace,
 *   4. `jina-api-key.txt` in the dsh home directory (`$DSH_HOME` or `~/.dsh`).
 *
 * Network transport: the Jina endpoints are contacted through a small
 * `node -e` fetch helper spawned via the host `subprocess` service. The
 * spawn environment inherits the harness-resolved proxy policy (dsh 0.1.3+:
 * HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY from the startup environment),
 * and a proxy is layered on top in this order (proxy.js owns the policy):
 *   1. a manual address from the "Jina Tools" settings card (`jina-tools` →
 *      `proxyUrl`) — the fix for a local proxy client that listens on a
 *      loopback port WITHOUT being the system proxy, which no automatic
 *      discovery can see,
 *   2. the `JINA_PROXY_URL` environment variable (headless profiles),
 *   3. the Windows system proxy (WinINET registry), rediscovered
 *      automatically when a transport failure suggests the port changed.
 * The card's health check (`/api/dsh-jina/primer`) reports the proxy actually
 * in effect, and transport failures name it, so a misconfigured address is
 * visible instead of looking like a generic network outage.
 */

import { homedir } from 'node:os'
import { resolve, isAbsolute } from 'node:path'
import { buildPrimer, formatPrimer, parseIpInfo, parseJinaRoot } from './primer.js'
import {
  PROXY_ENV_VAR, SETTINGS_NAMESPACE,
  createSettingsSchema, describeRejectReason, proxySettingOf, selectProxy, toolSettingsOf,
} from './proxy.js'
import { WEB_SEARCH_TOOL } from './tool-contracts.js'

export const name = 'dsh-jina'

export const inject = ['fs', 'subprocess', 'tools']

/**
 * The network helper: a self-contained CommonJS script run as
 * `node -e <script>` by the host `subprocess` service. It reads one JSON
 * request from stdin and writes one JSON result to stdout, so the transport
 * never depends on a bundled HTTP client. Exported because it is the exact
 * code a proxy misconfiguration has to be diagnosed against (see
 * test/plugin-proxy.test.js and README → 开发说明).
 */
export const HTTP_HELPER_SCRIPT = [
  "const fs = require('fs')",
  "let input = ''",
  "process.stdin.setEncoding('utf8')",
  "process.stdin.on('data', function (c) { input += c })",
  "process.stdin.on('end', function () {",
  "  let req = {}",
  "  try { req = JSON.parse(input || '{}') } catch (e) {",
  "    process.stdout.write(JSON.stringify({ ok: false, status: 0, text: 'bad request json: ' + e.message }), function () { process.exit(0) })",
  "    return",
  "  }",
  "  setTimeout(function () { process.exit(1) }, ((req && req.timeoutMs) || 60000) + 20000).unref()",
  "  try {",
  "    const options = { method: req.method || 'POST', headers: req.headers || {}, redirect: 'follow', signal: AbortSignal.timeout(req.timeoutMs || 60000) }",
  "    if (req.body !== undefined && req.body !== null) options.body = req.body",
  "    fetch(req.url, options).then(async function (res) {",
  "      const text = await res.text()",
  "      process.stdout.write(JSON.stringify({ ok: res.status >= 200 && res.status < 300, status: res.status, text: text }), function () { process.exit(0) })",
  "    }).catch(function (err) {",
  "      let detail = (err && err.message) || String(err)",
  "      if (err && err.name === 'TimeoutError') detail = 'timeout after ' + ((req && req.timeoutMs) || 60000) + 'ms'",
  "      if (err && err.cause && err.cause.message) detail = detail + ' (' + err.cause.message + ')'",
  "      process.stdout.write(JSON.stringify({ ok: false, status: 0, text: detail }), function () { process.exit(0) })",
  "    })",
  "  } catch (err) {",
  "    process.stdout.write(JSON.stringify({ ok: false, status: 0, text: 'helper error: ' + ((err && err.message) || String(err)) }), function () { process.exit(0) })",
  "  }",
  "})",
].join('\n')

export function apply(ctx) {
  const READER = 'https://r.jina.ai/'
  const IPINFO = 'https://ipinfo.io/json'
  const SEARCH = 'https://svip.jina.ai/'
  const GROUND = 'https://g.jina.ai/'
  const API = 'https://api.jina.ai'
  const KEY_FILE = 'jina-api-key.txt'
  const CRED_REF = 'JINA_API_KEY'
  const MAX_OUT = 1500000

  let nodePath
  let fileKeyCache = { text: undefined, at: 0 }
  let keyDiag = ''
  let keyKind
  let proxyCache = { text: undefined, at: 0, done: false }
  /** Owner scope of the `jina-tools` settings namespace; undefined without a provider. */
  let settingsScope
  let settingsDiag = ''
  let currentCwd = undefined

  /** dsh home directory: $DSH_HOME, else ~/.dsh. */
  function dshHome() {
    if (typeof process !== 'undefined' && process.env && process.env.DSH_HOME) return process.env.DSH_HOME
    return homedir() + '/.dsh'
  }

  function workspaceRoot() {
    const sp = ctx.get('sandboxPolicy')
    if (sp && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot.length > 0) return sp.workspaceRoot
    return homedir()
  }

  /** The calling agent's per-session workspace (canonical: exec.agent.session.header.cwd). */
  function sessionCwdOf(exec) {
    try {
      const c = exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd
      if (typeof c === 'string' && c.length > 0) return c
    } catch (e) { /* guarded */ }
    return undefined
  }

  function resolveRoot() {
    if (currentCwd) return currentCwd
    return workspaceRoot()
  }

  async function resolveNode() {
    if (nodePath === undefined) {
      try { nodePath = await ctx.subprocess.resolveExecutable('node') } catch (err) { nodePath = null }
    }
    return nodePath
  }

  function runCollect(argv, stdinData, maxBytes, env, signal) {
    return new Promise((resolve) => {
      const out = { exitCode: -1, stdout: { text: '' }, stderr: { text: '' } }
      let handle
      try {
        handle = ctx.subprocess.spawn({
          argv,
          cwd: resolveRoot(),
          stdio: {
            stdin: stdinData === undefined ? 'ignore' : { data: stdinData },
            stdout: { maxBytes: maxBytes || 65536, spill: { maxBytes: (maxBytes || 65536) * 4 } },
            stderr: { maxBytes: 65536, spill: { maxBytes: 262144 } },
          },
          graceMs: 2000,
          ...(signal !== undefined ? { signal } : {}),
          ...(env !== undefined ? { env } : {}),
        })
      } catch (err) {
        out.stderr.text = 'spawn failed: ' + String((err && err.message) || err)
        resolve(out)
        return
      }
      const finish = (err, outcome) => {
        try {
          if (err) out.stderr.text = String((err && err.message) || err)
          else {
            const so = handle.collected.stdout.readFrom(0)
            const se = handle.collected.stderr.readFrom(0)
            // The handle contract exposes exit facts through `done`
            // (SubprocessOutcome), not as a property on the handle itself.
            out.exitCode = outcome ? outcome.exitCode : undefined
            out.stdout = { text: so.text, lossy: so.lossy, spillPath: so.spillPath }
            out.stderr = { text: se.text }
          }
        } catch (e) { /* keep defaults */ }
        resolve(out)
      }
      handle.done.then((outcome) => finish(null, outcome), (err) => finish(err))
    })
  }

  /**
   * Resolve the `JINA_API_KEY` credential. Per-operation by contract: the
   * credential seam documents that consumers re-resolve at each operation so
   * a changed credential reaches the next operation without a restart.
   * @returns the credential value, or undefined while unconfigured/absent.
   */
  async function credentialKey() {
    try {
      const svc = ctx.get('credentials')
      if (svc === undefined) return undefined
      const resolved = await svc.resolve(CRED_REF)
      return resolved && resolved.value ? resolved.value : undefined
    } catch (err) { return undefined }
  }

  /** API key: credential, then workspace file, then dsh-home file. */
  async function loadKey() {
    let value
    let kind
    const attempts = []
    try {
      const svc = ctx.get('credentials')
      if (svc === undefined) {
        attempts.push('credential service absent')
      } else {
        const resolved = await svc.resolve(CRED_REF)
        if (resolved && resolved.value) {
          value = resolved.value
          kind = 'credential'
          attempts.push('credential ' + CRED_REF + ': found (source ' + String(resolved.source) + ')')
        } else {
          attempts.push('credential ' + CRED_REF + ': not set')
        }
      }
    } catch (err) {
      attempts.push('credential ' + CRED_REF + ': ' + String((err && err.message) || err))
    }
    if (value === undefined) {
      // File sources: cached 30s; the 401 path invalidates and re-reads.
      if (fileKeyCache.text !== undefined && Date.now() - fileKeyCache.at < 30000) {
        attempts.push('file cache: hit')
        value = fileKeyCache.text
        kind = 'file'
      } else {
        const root = resolveRoot()
        const home = dshHome()
        const candidates = [
          { kind: 'workspace abs', path: root + '\\' + KEY_FILE, opts: undefined },
          { kind: 'workspace rel+cwd', path: KEY_FILE, opts: { cwd: root } },
          { kind: 'workspace rel', path: KEY_FILE, opts: undefined },
          { kind: 'home abs', path: home + '\\' + KEY_FILE, opts: undefined },
          { kind: 'home rel+cwd', path: KEY_FILE, opts: { cwd: home } },
        ]
        for (const c of candidates) {
          try {
            const target = await ctx.fs.resolve(c.path, c.opts)
            const raw = await ctx.fs.readText(target)
            const trimmed = String(raw).trim()
            if (trimmed !== '') { value = trimmed; kind = 'file'; attempts.push(c.kind + ': found'); break }
            attempts.push(c.kind + ': empty file')
          } catch (err) {
            attempts.push(c.kind + ': ' + String((err && err.message) || err))
          }
        }
        fileKeyCache = { text: value, at: Date.now() }
      }
    }
    keyDiag = 'credential ' + CRED_REF + ' | ' + attempts.join(' | ')
    keyKind = kind
    return value
  }

  /** System proxy (the local VPN): read the user-level WinINET registry settings. */
  async function discoverProxy() {
    if (proxyCache.done && Date.now() - proxyCache.at < 60000) return proxyCache.text
    let proxy
    try {
      const r = await runCollect(['reg.exe', 'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], undefined, 32768)
      const t = r.stdout.text || ''
      if (/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(t)) {
        const m = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(t)
        if (m) {
          const raw = m[1].trim()
          const hit = /(?:^|;)\s*https=([^;]+)/i.exec(raw)
          let addr = hit ? hit[1].trim() : raw
          if (!/^https?:\/\//i.test(addr)) addr = 'http://' + addr
          proxy = addr
        }
      }
    } catch (err) { proxy = undefined }
    proxyCache = { text: proxy, at: Date.now(), done: true }
    return proxy
  }

  /**
   * The manual proxy address stored by the settings card, re-read per operation
   * (same contract as the API key: a saved change reaches the next call without
   * a restart). '' while unconfigured or while no settings provider is mounted.
   */
  function settingProxy() {
    if (settingsScope === undefined) return ''
    try { return proxySettingOf(settingsScope.get()) } catch (err) { return '' }
  }

  /**
   * Resolve the transport plan for one operation (proxy.js owns the
   * precedence: request > setting > JINA_PROXY_URL > WinINET > inherited env).
   * WinINET is only consulted when no explicit address exists, so a configured
   * local proxy never pays for a `reg.exe` probe.
   * @returns `{ url, source, envHint, rejected }`.
   */
  async function proxyPlan(request) {
    const env = process.env || {}
    const own = () => ({
      request: request === undefined || request === null || request === '' ? undefined : String(request),
      setting: settingProxy(),
      envVar: env[PROXY_ENV_VAR],
      env,
    })
    const explicit = selectProxy(own())
    if (explicit.url !== undefined) return explicit
    const system = await discoverProxy()
    return selectProxy({ ...own(), system })
  }

  /** Attach the plan actually used to a helper result, for diagnostics. */
  function withProxy(parsed, plan) {
    return {
      ...parsed,
      proxy: {
        url: plan.url === undefined ? null : plan.url,
        source: plan.source,
        rejected: plan.rejected.map((r) => ({ field: r.field, value: r.value, reason: r.reason })),
      },
    }
  }

  /** What the transport actually ran through. */
  function effectiveProxyHint(proxy) {
    if (proxy.source === 'setting') return 'Currently using proxy from settings (Jina Tools → local proxy / 本地代理): ' + proxy.url + '. Check that this proxy is running, or clear (清除) it in the settings card to resume auto-detection.'
    if (proxy.source === 'envVar') return 'Currently using environment proxy ' + PROXY_ENV_VAR + '=' + proxy.url + '.'
    if (proxy.source === 'system') {
      const isWin = typeof process !== 'undefined' && process.platform === 'win32'
      return 'Currently using auto-discovered ' + (isWin ? 'Windows ' : '') + 'system proxy: ' + proxy.url + '.'
    }
    if (proxy.source === 'request') return 'Currently using call-specified proxy: ' + proxy.url + '.'
    if (proxy.source === 'environment') return 'Currently inheriting proxy settings from startup environment (HTTP_PROXY/HTTPS_PROXY).'
    const isWin = typeof process !== 'undefined' && process.platform === 'win32'
    const sysMsg = isWin ? 'Windows system proxy not enabled' : 'System proxy not configured'
    return 'No usable proxy detected (未检测到可用代理): ' + sysMsg + ', no HTTP_PROXY/HTTPS_PROXY in environment, and no local proxy in settings card. If using a local proxy (e.g. Clash/v2ray/Surge), configure its address in Jina Tools settings (e.g. http://127.0.0.1:7897).'
  }

  /** Plain-language account of the proxy a request ran through. */
  function proxyHint(proxy) {
    if (!proxy) return ''
    const rejected = Array.isArray(proxy.rejected) ? proxy.rejected[0] : undefined
    if (rejected === undefined) return effectiveProxyHint(proxy)
    const where = rejected.field === 'envVar'
      ? 'Environment variable ' + PROXY_ENV_VAR
      : rejected.field === 'request' ? 'Call-specified proxy' : 'Settings card proxy'
    return where + ' "' + rejected.value + '" is unavailable (' + describeRejectReason(rejected.reason) + '), fallen back to auto-detection (已回退到自动检测). ' + effectiveProxyHint(proxy)
  }

  /** One HTTP call through the node helper. */
  async function jinaRequest(spec) {
    const node = await resolveNode()
    if (!node) return { ok: false, status: 0, text: 'node executable not found on PATH; the helper needs Node.js to make the HTTP call' }
    const plan = await proxyPlan(spec.proxy)
    const payload = JSON.stringify({
      url: spec.url,
      method: spec.method || 'POST',
      headers: spec.headers || {},
      body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
      timeoutMs: spec.timeoutMs || 60000,
    })
    const makeEnv = (p) => {
      // dsh 0.1.3+: the subprocess seam merges `env` over a scrubbed parent
      // base that already carries the harness-resolved proxy policy
      // (HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY from the startup
      // environment + NODE_USE_ENV_PROXY). Returning `undefined` inherits
      // that base untouched; only a selected/overridden proxy layers on
      // top — and it never clobbers NO_PROXY (the base merges the user's
      // list with the loopback bypass). WinINET discovery stays as the
      // Windows complement to the env-only policy the harness resolves.
      if (p === undefined || p === null || p === '') return undefined
      let proxy = String(p)
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(proxy)) proxy = 'http://' + proxy
      const env = { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy }
      // Mirror the harness: Node parses proxy vars at startup under this
      // flag and exits on non-http(s) schemes, so a SOCKS value rides along
      // for non-Node consumers without the flag.
      if (/^https?:\/\//i.test(proxy)) env.NODE_USE_ENV_PROXY = '1'
      return env
    }
    const parse = (r) => {
      let parsed
      try { parsed = JSON.parse(r.stdout.text) } catch (e) {
        return { ok: false, status: 0, text: 'helper output not parseable: ' + String(r.stdout.text).slice(0, 300) + (r.stderr.text ? ' [stderr: ' + String(r.stderr.text).slice(0, 300) + ']' : '') }
      }
      if (typeof parsed !== 'object' || parsed === null) return { ok: false, status: 0, text: 'bad helper output: ' + String(r.stdout.text).slice(0, 300) }
      return parsed
    }
    let r = await runCollect([node, '-e', HTTP_HELPER_SCRIPT], payload, MAX_OUT, makeEnv(plan.url), spec.signal)
    let parsed = withProxy(parse(r), plan)
    if (parsed.ok || parsed.status !== 0) return parsed
    // Transport-level failure: retry once. An automatically discovered proxy is
    // rediscovered first (the VPN may have restarted on a new port); a manually
    // configured address is honored as-is — it is the user's explicit choice and
    // second-guessing it would hide the very misconfiguration they must fix.
    const explicit = plan.source === 'setting' || plan.source === 'envVar' || plan.source === 'request'
    let retryPlan = plan
    if (!explicit) {
      proxyCache = { text: undefined, at: 0, done: false }
      retryPlan = await proxyPlan(spec.proxy)
    }
    r = await runCollect([node, '-e', HTTP_HELPER_SCRIPT], payload, MAX_OUT, makeEnv(retryPlan.url), spec.signal)
    return withProxy(parse(r), retryPlan)
  }

  /** Full call: key handling + auth header + 401 key refresh. */
  async function callJina(opts) {
    const headers = {}
    for (const k of Object.keys(opts.headers || {})) headers[k] = opts.headers[k]
    const explicit = opts.apiKey !== undefined && opts.apiKey !== null && opts.apiKey !== ''
    let key = explicit ? String(opts.apiKey) : await loadKey()
    if (key) headers.Authorization = 'Bearer ' + key
    if (opts.needsKey && !key) {
      return { ok: false, status: 401, text: 'Jina API key required for this command. Set it in the DSH settings page (Jina Tools) or put it in ' + KEY_FILE + ' in the session workspace or the dsh home directory (one line). Get a free key at https://jina.ai/?sui=apikey' + (keyDiag ? ' [key lookup: ' + keyDiag + ']' : '') }
    }
    const mk = () => ({ url: opts.url, method: opts.method || 'POST', headers, body: opts.body, timeoutMs: opts.timeoutMs, signal: opts.signal, ...(opts.proxy !== undefined ? { proxy: opts.proxy } : {}) })
    let res = await jinaRequest(mk())
    if (!res.ok && res.status === 401 && !explicit) {
      fileKeyCache = { text: undefined, at: 0 }
      const fresh = await loadKey()
      if (fresh && fresh !== key) {
        headers.Authorization = 'Bearer ' + fresh
        res = await jinaRequest(mk())
      }
    }
    return res
  }

  /** Centralized Cloudflare turnstile and bot-challenge bypass auto-retry. */
  async function callJinaWithCfBypass(opts, toolDefaults) {
    let res = await callJina(opts)
    if (!res.ok && toolDefaults && toolDefaults.autoBypassCloudflare && opts.headers && opts.headers['X-Engine'] !== 'cf-browser-rendering') {
      const text = String(res.text || '')
      const isCloudflare = res.status === 403 || res.status === 503 || text.includes('Cloudflare') || text.includes('cf-chl') || text.includes('turnstile') || text.includes('Attention Required')
      if (isCloudflare) {
        const retryHeaders = Object.assign({}, opts.headers, { 'X-Engine': 'cf-browser-rendering' })
        const retryRes = await callJina({
          ...opts,
          headers: retryHeaders,
          timeoutMs: Math.max(opts.timeoutMs || 60000, 120000),
          needsKey: true,
        })
        if (retryRes.ok) return retryRes
      }
    }
    return res
  }

  function describeJinaError(res) {
    const status = res.status || 0
    const body = String(res.text || '').slice(0, 800)
    const hints = {
      0: 'No response from the Jina API (network/VPN problem). Check that the local VPN and its system proxy are enabled, then retry.',
      401: 'Invalid or expired API key. Fix: update it in the DSH settings page (Jina Tools) or the key file. Get a free key: https://jina.ai/?sui=apikey',
      402: 'API quota exhausted. Fix: top up credits at https://jina.ai/api-dashboard/billing',
      422: 'Invalid request parameters.',
      429: 'Rate limit hit. Wait a few seconds and retry, or add an API key for higher limits.',
    }
    let msg = 'Jina API error (HTTP ' + status + '). ' + (hints[status] || '')
    // A transport failure is where a wrong proxy address shows up: name the
    // proxy that was actually in play instead of a generic network outage.
    if (status === 0) {
      const hint = proxyHint(res.proxy)
      if (hint !== '') msg += ' ' + hint
    }
    if (status >= 500) msg = 'Jina API server error (HTTP ' + status + '). Retry in a moment; status: https://status.jina.ai'
    if (body) msg += '\nServer said: ' + body
    return msg
  }

  /** Per-call session workspace + signal; run at the top of every execute. */
  const enterExec = (exec) => {
    const cwd = sessionCwdOf(exec)
    if (cwd !== undefined) currentCwd = cwd
    return (exec && exec.signal) || undefined
  }

  function extractUsageFooter(text) {
    if (!text) return ''
    try {
      const data = typeof text === 'string' ? JSON.parse(text) : text
      const usage = (data && data.usage) || (data && data.data && data.data.usage) || (data && data.meta && data.meta.usage)
      if (usage && typeof usage === 'object') {
        const parts = []
        if (usage.tokens !== undefined) parts.push('tokens=' + usage.tokens)
        else if (usage.total_tokens !== undefined) parts.push('total_tokens=' + usage.total_tokens)
        else if (usage.outputTokens !== undefined) parts.push('output_tokens=' + usage.outputTokens)
        if (usage.prompt_tokens !== undefined) parts.push('prompt_tokens=' + usage.prompt_tokens)
        if (parts.length > 0) return '\n\n[Usage: ' + parts.join(', ') + ']'
      }
    } catch (e) {}
    return ''
  }

  function fmtSearch(text, asJson) {
    if (asJson) return text
    let data
    try { data = JSON.parse(text) } catch (e) { return text }
    const results = data && Array.isArray(data.results) ? data.results : undefined
    if (results === undefined) return text
    if (results.length === 0) return '(no results)' + extractUsageFooter(text)
    const lines = []
    for (const r of results) {
      if (r && typeof r === 'object') {
        lines.push(String(r.title || '(untitled)'))
        if (r.url) lines.push('  ' + String(r.url))
        if (r.snippet) lines.push('  ' + String(r.snippet))
      } else {
        lines.push(String(r))
      }
      lines.push('')
    }
    return lines.join('\n').trim() + extractUsageFooter(text)
  }

  function fmtDatetime(text, asJson) {
    if (asJson) return text
    try {
      const data = JSON.parse(text)
      const d = data && typeof data === 'object' ? (data.data || data) : data
      if (d && typeof d === 'object') {
        const lines = []
        if (typeof d.title === 'string' && d.title.length > 0) lines.push('title: ' + d.title)
        if (typeof d.description === 'string' && d.description.length > 0 && d.description !== d.title) lines.push('description: ' + String(d.description).slice(0, 200))
        const times = []
        const mk = d.metadata && typeof d.metadata === 'object' ? d.metadata : {}
        for (const k of ['publishedTime', 'article:published_time', 'bytedance:published_time', 'article:modified_time', 'bytedance:updated_time']) {
          const v = typeof mk[k] === 'string' ? mk[k] : (typeof d[k] === 'string' ? d[k] : undefined)
          if (v !== undefined && v.length > 0) {
            const label = k === 'publishedTime' || k.includes('published') ? `${k} (estimated publication)` : `${k} (last modified)`
            times.push(label + ': ' + v)
          }
        }
        if (times.length > 0) lines.push(times.join(' | '))
        if (typeof d.url === 'string' && d.url.length > 0) lines.push('url: ' + d.url)
        if (lines.length > 0) return lines.join('\n') + extractUsageFooter(text)
      }
    } catch (e) { /* fall through */ }
    return text + extractUsageFooter(text)
  }

  function fmtScreenshot(text) {
    try {
      const data = JSON.parse(text)
      const d = data && typeof data === 'object' ? (data.data || data) : data
      if (d && typeof d === 'object') {
        const u = d.screenshotUrl || d.pageshotUrl || d.url
        if (typeof u === 'string' && u.length > 0) return 'screenshot URL: ' + u + extractUsageFooter(text)
        const b64 = d.screenshot || d.image
        if (typeof b64 === 'string' && b64.length > 0) return 'screenshot returned as embedded base64 image data (' + b64.length + ' chars)' + extractUsageFooter(text)
      }
    } catch (e) { /* fall through */ }
    return text
  }

  function fmtExpand(text, asJson) {
    if (asJson) return text
    try {
      const data = JSON.parse(text)
      const list = Array.isArray(data) ? data : (data && (data.results || data.data))
      if (Array.isArray(list)) {
        const lines = []
        for (const r of list) {
          if (typeof r === 'string') lines.push(r)
          else if (r && typeof r === 'object') lines.push(String(r.query || r.text || ''))
        }
        const filtered = lines.filter((l) => l && l.length > 0)
        if (filtered.length > 0) return filtered.join('\n') + extractUsageFooter(text)
        return '(no related queries found)' + extractUsageFooter(text)
      }
    } catch (e) { /* fall through */ }
    return text
  }

  function fmtEmbed(text, asJson) {
    if (asJson) return text
    try {
      const data = JSON.parse(text)
      const items = Array.isArray(data) ? data : (data && data.data)
      if (Array.isArray(items)) {
        const lines = []
        items.forEach((item, i) => {
          const emb = item && Array.isArray(item.embedding) ? item.embedding : item
          if (Array.isArray(emb)) {
            const preview = emb.slice(0, 5).map((v) => Number(v).toFixed(6)).join(', ')
            lines.push('[' + (item && item.index !== undefined ? item.index : i) + '] dim=' + emb.length + ' [' + preview + ', ...]')
          }
        })
        if (lines.length > 0) return lines.join('\n') + extractUsageFooter(text)
      }
    } catch (e) { /* fall through */ }
    return text
  }

  function fmtRerank(text, documents, asJson) {
    if (asJson) return text
    try {
      const data = JSON.parse(text)
      const results = Array.isArray(data) ? data : (data && (data.results || data.data))
      if (Array.isArray(results)) {
        const lines = []
        for (const r of results) {
          if (!r || typeof r !== 'object') continue
          const idx = r.index !== undefined ? Number(r.index) : 0
          const score = r.relevance_score !== undefined ? r.relevance_score : r.score
          let t = (r.document && r.document.text) || (documents && documents[idx]) || ''
          if (typeof t === 'string' && t.length > 200) t = t.slice(0, 200) + '...'
          lines.push('[' + (typeof score === 'number' ? score.toFixed(4) : String(score)) + '] ' + t)
        }
        if (lines.length > 0) return lines.join('\n') + extractUsageFooter(text)
      }
    } catch (e) { /* fall through */ }
    return text
  }

  function fmtClassify(text, asJson) {
    if (asJson) return text
    try {
      const data = JSON.parse(text)
      const items = Array.isArray(data) ? data : (data && (data.data || data.results))
      if (Array.isArray(items)) {
        const lines = []
        for (const item of items) {
          if (!item || typeof item !== 'object') continue
          const pred = item.prediction !== undefined ? item.prediction : (Array.isArray(item.predictions) && item.predictions[0] !== undefined ? item.predictions[0] : '')
          const score = item.score !== undefined ? item.score : item.confidence
          lines.push(String(pred) + (typeof score === 'number' ? ' (' + score.toFixed(4) + ')' : ''))
        }
        if (lines.length > 0) return lines.join('\n') + extractUsageFooter(text)
      }
    } catch (e) { /* fall through */ }
    return text
  }

  function fmtPdf(text, asJson) {
    if (asJson) return text
    try {
      const data = JSON.parse(text)
      const meta = data && data.meta ? data.meta : {}
      const floats = data && Array.isArray(data.floats) ? data.floats : []
      const lines = []
      lines.push('Pages: ' + (meta.num_pages !== undefined ? meta.num_pages : '?'))
      lines.push('Extracted items: ' + (meta.num_floats !== undefined ? meta.num_floats : floats.length))
      for (const f of floats) {
        if (!f || typeof f !== 'object') continue
        const parts = [f.type || 'unknown']
        if (f.number) parts.push(String(f.number))
        lines.push('  [' + parts.join(' ') + '] page ' + (f.page !== undefined ? f.page : '?'))
        if (f.caption) lines.push('    ' + String(f.caption))
      }
      return lines.join('\n') + extractUsageFooter(text)
    } catch (e) { /* fall through */ }
    return text
  }

  // ---- tool registration ---------------------------------------------------
  // IMPORTANT: `tools.register` forwards `parameters` verbatim to the model API.
  // It must therefore be a full JSON Schema object ({ type: 'object',
  // properties, required, additionalProperties }) — NOT the defineTool-style
  // per-property map ({ field: { type, required: true } }), which the model
  // server rejects ("schema must be a JSON Schema of 'type: \"object\"'").
  const OUT = {
    schema: { type: 'string' },
    render(_args, value) { return [{ type: 'text', text: value }] },
  }

  function getActiveToolSettings() {
    return settingsScope ? toolSettingsOf(settingsScope.get()) : {}
  }

  /** Shared executor for the search tools (jina_web_search / jina_search_arxiv / jina_search_ssrn). */
  async function runSearch(args, exec, fixedType) {
    const signal = enterExec(exec)
    const toolDefaults = getActiveToolSettings()
    let query = String(args.query)
    if (args.site) query += ' site:' + args.site
    if (args.filetype) query += ' filetype:' + args.filetype
    if (args.intitle) query += ' intitle:' + args.intitle

    const body = { q: query }
    const t = fixedType || args.type
    if (t === 'arxiv') body.domain = 'arxiv'
    else if (t === 'ssrn') body.domain = 'ssrn'
    else if (t === 'images') body.type = 'images'
    else if (t === 'blog') body.q = 'site:jina.ai/news ' + query
    if (args.num !== undefined) body.num = args.num
    else if (toolDefaults.defaultSearchNum !== undefined) body.num = toolDefaults.defaultSearchNum
    if (args.time) body.tbs = 'qdr:' + args.time
    if (args.location) body.location = args.location
    if (args.gl) body.gl = args.gl
    if (args.hl) body.hl = args.hl
    if (args.nfpr) body.nfpr = true

    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
    const engine = args.engine || toolDefaults.defaultEngine
    if (engine) headers['X-Engine'] = engine

    const res = await callJina({
      url: SEARCH, method: 'POST',
      headers,
      body, timeoutMs: 60000, needsKey: true, apiKey: args.apiKey, signal,
    })
    if (!res.ok) return describeJinaError(res)
    return fmtSearch(res.text, args.json === true)
  }

  ctx.tools.register({
    ...WEB_SEARCH_TOOL,
    output: OUT,
    async execute(args, exec) {
      return runSearch(args, exec)
    },
  })

  ctx.tools.register({
    name: 'jina_search_arxiv',
    description: 'Search academic papers and preprints on arXiv via Jina. Use this whenever the user asks for computer science, machine learning, mathematics, physics or other quantitative research papers, surveys or preprints. Supports reading top paper full-text automatically.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Search query: paper title, topic or keywords.' },
        num: { type: 'number', description: 'Number of results. Default: 5.' },
        readFullText: { type: 'boolean', description: 'Automatically read the full text of the top matching arXiv paper in markdown (single-turn research).' },
        json: { type: 'boolean', description: 'Return the raw JSON response instead of formatted results.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
      required: ['query'],
    },
    output: OUT,
    async execute(args, exec) {
      const searchRes = await runSearch(args, exec, 'arxiv')
      if (args.readFullText) {
        const match = searchRes.match(/https:\/\/arxiv\.org\/(?:abs|pdf)\/([0-9]+\.[0-9]+(?:v[0-9]+)?)/i)
        if (match) {
          const arxivId = match[1]
          const readUrl = 'https://arxiv.org/abs/' + arxivId
          const toolDefaults = getActiveToolSettings()
          const headers = { Accept: 'text/markdown', 'Content-Type': 'application/json' }
          if (toolDefaults.defaultPreset) headers['X-Preset'] = toolDefaults.defaultPreset
          const fullRes = await callJinaWithCfBypass({
            url: READER, method: 'POST', headers,
            body: { url: readUrl }, timeoutMs: 120000, needsKey: false, apiKey: args.apiKey, signal: enterExec(exec),
          }, toolDefaults)
          if (fullRes.ok) {
            return `=== Search Results for "${args.query}" ===\n${searchRes}\n\n=== Full Paper Content (arXiv:${arxivId}) ===\n${fullRes.text}`
          }
        }
      }
      return searchRes
    },
  })

  ctx.tools.register({
    name: 'jina_search_ssrn',
    description: 'Search academic papers on SSRN (Social Science Research Network) via Jina. Use this whenever the user asks for economics, finance, law, management or other social-science working papers and publications. Results are canonical papers.ssrn.com links with accurate snippets.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Search query: paper title, topic or keywords.' },
        num: { type: 'number', description: 'Number of results. Default: 5.' },
        json: { type: 'boolean', description: 'Return the raw JSON response instead of formatted results.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
      required: ['query'],
    },
    output: OUT,
    async execute(args, exec) {
      return runSearch(args, exec, 'ssrn')
    },
  })

  ctx.tools.register({
    name: 'jina_read',
    description: 'Read a web page and extract clean markdown via Jina Reader (r.jina.ai), mirroring the jina-cli \'read\' command. Supports CSS target selectors, SPA wait selectors, element removal, modal/paywall overlay stripping, honeypot detachment, shadow DOM traversal, token budget caps, and Cloudflare anti-bot bypass. Configurable via DSH settings.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'Page URL, starting with http:// or https://.' },
        targetSelector: { type: 'string', description: 'Target CSS selector to extract (e.g. article, .main-content). Overrides settings.' },
        waitForSelector: { type: 'string', description: 'Wait until this CSS selector appears before extraction (for dynamic SPA pages). Overrides settings.' },
        removeSelector: { type: 'string', description: 'CSS selector(s) to exclude from output (e.g. .cookie-banner, nav, footer). Overrides settings.' },
        tokenBudget: { type: 'number', description: 'Maximum token count for the response. Overrides settings.' },
        engine: { type: 'string', enum: ['auto', 'browser', 'curl', 'cf-browser-rendering'], description: 'Extraction engine: cf-browser-rendering bypasses Cloudflare turnstile. Overrides settings.' },
        noCache: { type: 'boolean', description: 'Bypass Jina cache and force fresh crawl. Overrides settings.' },
        removeOverlay: { type: 'boolean', description: 'Remove modal overlays, popups, cookie consent walls, and paywall backdrops. Overrides settings.' },
        detachInvisibles: { type: 'boolean', description: 'Detach invisible DOM elements, honeypots, and hidden tracking text. Overrides settings.' },
        withShadowDom: { type: 'boolean', description: 'Traverse and extract content from Shadow DOM trees (web components). Overrides settings.' },
        withIframe: { type: 'boolean', description: 'Extract and inline embedded iframe documents. Overrides settings.' },
        cookies: { type: 'string', description: 'Custom cookie string for authenticated sessions or paywall bypass (e.g. "session_token=xyz; consent=true").' },
        withGeneratedAlt: { type: 'boolean', description: 'Generate AI alt-text for images lacking captions.' },
        links: { type: 'boolean', description: 'Include hyperlinks in the output.' },
        images: { type: 'boolean', description: 'Include image summaries in the output.' },
        json: { type: 'boolean', description: 'Return the raw JSON response instead of markdown.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
      required: ['url'],
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      if (!/^https?:\/\//i.test(String(args.url))) return 'invalid url: ' + args.url + ' (must start with http:// or https://)'
      const toolDefaults = getActiveToolSettings()
      const headers = {
        Accept: args.json ? 'application/json' : 'text/markdown',
        'Content-Type': 'application/json',
        'X-Md-Link-Style': 'discarded',
      }
      if (args.links) headers['X-With-Links-Summary'] = 'all'
      
      const retainImages = toolDefaults.defaultRetainImages || (args.images ? 'all' : 'none')
      headers['X-Retain-Images'] = retainImages
      if (args.images) headers['X-With-Images-Summary'] = 'true'
      if (args.withGeneratedAlt) headers['X-With-Generated-Alt'] = 'true'

      const targetSel = args.targetSelector || toolDefaults.defaultTargetSelector
      if (targetSel) headers['X-Target-Selector'] = targetSel

      const waitSel = args.waitForSelector || toolDefaults.defaultWaitForSelector
      if (waitSel) headers['X-Wait-For-Selector'] = waitSel

      const removeSel = args.removeSelector || toolDefaults.defaultRemoveSelector
      if (removeSel) headers['X-Remove-Selector'] = removeSel

      const removeOverlay = args.removeOverlay !== undefined ? args.removeOverlay : toolDefaults.defaultRemoveOverlay
      if (removeOverlay !== false) headers['X-Remove-Overlay'] = 'true'

      const detachInvisibles = args.detachInvisibles !== undefined ? args.detachInvisibles : toolDefaults.defaultDetachInvisibles
      if (detachInvisibles !== false) headers['X-Detach-Invisibles'] = 'true'

      const shadowDom = args.withShadowDom !== undefined ? args.withShadowDom : toolDefaults.defaultWithShadowDom
      if (shadowDom) headers['X-With-Shadow-Dom'] = 'true'

      const iframe = args.withIframe !== undefined ? args.withIframe : toolDefaults.defaultWithIframe
      if (iframe) headers['X-With-Iframe'] = 'true'

      if (args.cookies) headers['X-Set-Cookie'] = String(args.cookies)

      const tokenBudget = args.tokenBudget || toolDefaults.defaultTokenBudget
      if (tokenBudget) headers['X-Max-Tokens'] = String(tokenBudget)

      const engine = args.engine || toolDefaults.defaultEngine
      if (engine) headers['X-Engine'] = engine

      const noCache = args.noCache !== undefined ? args.noCache : toolDefaults.defaultNoCache
      if (noCache) headers['X-No-Cache'] = 'true'

      if (toolDefaults.defaultPreset) headers['X-Preset'] = toolDefaults.defaultPreset

      let res = await callJinaWithCfBypass({
        url: READER, method: 'POST', headers,
        body: { url: String(args.url) }, timeoutMs: 120000, needsKey: false, apiKey: args.apiKey, signal,
      }, toolDefaults)

      // Gracefully handle 409 budget exceeded error by retrying with X-Max-Tokens without X-Token-Budget
      if (!res.ok && res.status === 409 && (res.text || '').includes('Token budget')) {
        const retryHeaders = Object.assign({}, headers)
        delete retryHeaders['X-Token-Budget']
        retryHeaders['X-Max-Tokens'] = String(tokenBudget)
        res = await callJinaWithCfBypass({
          url: READER, method: 'POST', headers: retryHeaders,
          body: { url: String(args.url) }, timeoutMs: 120000, needsKey: false, apiKey: args.apiKey, signal,
        }, toolDefaults)
      }

      if (!res.ok) return describeJinaError(res)
      if (args.json) return res.text

      let outText = res.text
      try {
        const parsed = JSON.parse(res.text)
        const d = parsed && (parsed.data || parsed)
        if (d && typeof d === 'object' && typeof d.content === 'string') {
          outText = d.content
        }
      } catch (e) {}

      if (tokenBudget && outText.length > tokenBudget * 4) {
        outText = outText.slice(0, tokenBudget * 4) + '\n\n[... truncated by tokenBudget cap ...]'
      }
      return outText + extractUsageFooter(res.text)
    },
  })

  ctx.tools.register({
    name: 'jina_extract',
    description: 'Extract structured JSON data matching a user-provided JSON Schema directly from any web page using Jina ReaderLM. Server-side extraction eliminates prompt token bloat by returning only the structured object.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'Page URL, starting with http:// or https://.' },
        instruction: { type: 'string', description: 'Extraction guidance (e.g. "Extract product pricing, specifications, and warranty info").' },
        schema: { type: 'object', description: 'Target JSON Schema describing the desired output format.' },
        targetSelector: { type: 'string', description: 'Optional CSS selector to scope extraction (e.g. article, .main).' },
        waitForSelector: { type: 'string', description: 'Optional CSS selector to wait for before extraction.' },
        removeSelector: { type: 'string', description: 'CSS selector(s) to exclude from extraction.' },
        removeOverlay: { type: 'boolean', description: 'Remove modal overlays and paywall backdrops before extraction.' },
        detachInvisibles: { type: 'boolean', description: 'Detach invisible elements and honeypots before extraction.' },
        withShadowDom: { type: 'boolean', description: 'Traverse and extract content from Shadow DOM trees.' },
        withIframe: { type: 'boolean', description: 'Extract and inline embedded iframe documents.' },
        engine: { type: 'string', enum: ['auto', 'browser', 'curl', 'cf-browser-rendering'], description: 'Extraction engine: cf-browser-rendering bypasses Cloudflare turnstile.' },
        tokenBudget: { type: 'number', description: 'Maximum token count budget.' },
        cookies: { type: 'string', description: 'Custom cookie string for authenticated sessions.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
      required: ['url', 'instruction', 'schema'],
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      if (!/^https?:\/\//i.test(String(args.url))) return 'invalid url: ' + args.url + ' (must start with http:// or https://)'
      const toolDefaults = getActiveToolSettings()
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Respond-With': 'readerlm-v2',
      }
      const targetSel = args.targetSelector || toolDefaults.defaultTargetSelector
      if (targetSel) headers['X-Target-Selector'] = targetSel
      const waitSel = args.waitForSelector || toolDefaults.defaultWaitForSelector
      if (waitSel) headers['X-Wait-For-Selector'] = waitSel
      const removeSel = args.removeSelector || toolDefaults.defaultRemoveSelector
      if (removeSel) headers['X-Remove-Selector'] = removeSel

      const removeOverlay = args.removeOverlay !== undefined ? args.removeOverlay : toolDefaults.defaultRemoveOverlay
      if (removeOverlay !== false) headers['X-Remove-Overlay'] = 'true'

      const detachInvisibles = args.detachInvisibles !== undefined ? args.detachInvisibles : toolDefaults.defaultDetachInvisibles
      if (detachInvisibles !== false) headers['X-Detach-Invisibles'] = 'true'

      const shadowDom = args.withShadowDom !== undefined ? args.withShadowDom : toolDefaults.defaultWithShadowDom
      if (shadowDom) headers['X-With-Shadow-Dom'] = 'true'

      const iframe = args.withIframe !== undefined ? args.withIframe : toolDefaults.defaultWithIframe
      if (iframe) headers['X-With-Iframe'] = 'true'

      const tokenBudget = args.tokenBudget || toolDefaults.defaultTokenBudget
      if (tokenBudget) headers['X-Max-Tokens'] = String(tokenBudget)

      const engine = args.engine || toolDefaults.defaultEngine
      if (engine) headers['X-Engine'] = engine

      if (args.cookies) headers['X-Set-Cookie'] = String(args.cookies)

      const body = {
        url: String(args.url),
        instruction: String(args.instruction),
        jsonSchema: args.schema,
        respondWith: 'readerlm-v2',
      }
      const res = await callJinaWithCfBypass({
        url: READER, method: 'POST', headers,
        body, timeoutMs: 120000, needsKey: true, apiKey: args.apiKey, signal,
      }, toolDefaults)
      if (!res.ok) return describeJinaError(res)

      try {
        const parsed = JSON.parse(res.text)
        const d = parsed && (parsed.data || parsed)
        if (d && typeof d === 'object') {
          const structured = d.structured !== undefined ? d.structured : (d.json !== undefined ? d.json : (d.content && typeof d.content === 'object' ? d.content : d))
          return JSON.stringify(structured, null, 2) + extractUsageFooter(res.text)
        }
      } catch (e) {}
      return res.text + extractUsageFooter(res.text)
    },
  })

  ctx.tools.register({
    name: 'jina_chunk',
    description: 'Chunk large web documents or specifications into semantic markdown sections via Jina Reader. Prevents context overflow on massive documents by returning clean segmented blocks.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'Page URL, starting with http:// or https://.' },
        chunkBy: { type: 'string', enum: ['h1', 'h2', 'h3', 'h4', 'h5', 'structured'], description: 'Semantic chunk boundary. Default: h2.' },
        targetSelector: { type: 'string', description: 'Target CSS selector to extract before chunking.' },
        removeSelector: { type: 'string', description: 'CSS selector(s) to exclude before chunking.' },
        removeOverlay: { type: 'boolean', description: 'Remove modal overlays and paywall backdrops before chunking.' },
        detachInvisibles: { type: 'boolean', description: 'Detach invisible elements and honeypots before chunking.' },
        tokenBudget: { type: 'number', description: 'Max token budget for the entire document.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
      required: ['url'],
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      if (!/^https?:\/\//i.test(String(args.url))) return 'invalid url: ' + args.url + ' (must start with http:// or https://)'
      const toolDefaults = getActiveToolSettings()
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Markdown-Chunking': args.chunkBy || 'h2',
      }
      const targetSel = args.targetSelector || toolDefaults.defaultTargetSelector
      if (targetSel) headers['X-Target-Selector'] = targetSel

      const removeSel = args.removeSelector || toolDefaults.defaultRemoveSelector
      if (removeSel) headers['X-Remove-Selector'] = removeSel

      const removeOverlay = args.removeOverlay !== undefined ? args.removeOverlay : toolDefaults.defaultRemoveOverlay
      if (removeOverlay !== false) headers['X-Remove-Overlay'] = 'true'

      const detachInvisibles = args.detachInvisibles !== undefined ? args.detachInvisibles : toolDefaults.defaultDetachInvisibles
      if (detachInvisibles !== false) headers['X-Detach-Invisibles'] = 'true'

      const tokenBudget = args.tokenBudget || toolDefaults.defaultTokenBudget
      if (tokenBudget) headers['X-Max-Tokens'] = String(tokenBudget)

      if (toolDefaults.defaultPreset) headers['X-Preset'] = toolDefaults.defaultPreset

      let res = await callJinaWithCfBypass({
        url: READER, method: 'POST', headers,
        body: { url: String(args.url) }, timeoutMs: 120000, needsKey: false, apiKey: args.apiKey, signal,
      }, toolDefaults)

      if (!res.ok && res.status === 409 && (res.text || '').includes('Token budget')) {
        const retryHeaders = Object.assign({}, headers)
        delete retryHeaders['X-Token-Budget']
        retryHeaders['X-Max-Tokens'] = String(tokenBudget)
        res = await callJinaWithCfBypass({
          url: READER, method: 'POST', headers: retryHeaders,
          body: { url: String(args.url) }, timeoutMs: 120000, needsKey: false, apiKey: args.apiKey, signal,
        }, toolDefaults)
      }

      if (!res.ok) return describeJinaError(res)
      return res.text + extractUsageFooter(res.text)
    },
  })

  ctx.tools.register({
    name: 'jina_search_batch',
    description: 'Execute multiple web search queries in parallel via Jina Search, resolving multiple research vectors in a single turn. Returns grouped results for 1 to 5 queries.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: '1 to 5 search queries to execute concurrently.',
        },
        time: { type: 'string', enum: ['h', 'd', 'w', 'm', 'y'], description: 'Only results from the last hour/day/week/month/year.' },
        gl: { type: 'string', description: 'Country code, e.g. us, de, jp.' },
        hl: { type: 'string', description: 'Language code, e.g. en, zh-cn.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
      required: ['queries'],
    },
    output: OUT,
    async execute(args, exec) {
      const queries = Array.isArray(args.queries) ? args.queries.filter(q => typeof q === 'string' && q.trim() !== '') : []
      if (queries.length === 0) return 'provide at least one non-empty query in the queries array'
      const limited = queries.slice(0, 5)
      const results = await Promise.all(limited.map(q => runSearch({ ...args, query: q }, exec)))
      const sections = limited.map((q, idx) => `=== Search Query [${idx + 1}/${limited.length}]: "${q}" ===\n${results[idx]}`)
      return sections.join('\n\n')
    },
  })

  ctx.tools.register({
    name: 'jina_screenshot',
    description: 'Capture a screenshot of a web page via Jina (r.jina.ai), mirroring the jina-cli \'screenshot\' command. Automatically saves captured images into DSH attachments store when available for multimodal models. Supports target CSS selectors and SPA wait selectors.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'Page URL, starting with http:// or https://.' },
        targetSelector: { type: 'string', description: 'Target CSS selector to capture specifically (overrides settings).' },
        waitForSelector: { type: 'string', description: 'Wait until this CSS selector mounts before capturing (overrides settings).' },
        fullPage: { type: 'boolean', description: 'Capture the full page instead of the viewport.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
      required: ['url'],
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      if (!/^https?:\/\//i.test(String(args.url))) return 'invalid url: ' + args.url + ' (must start with http:// or https://)'
      const toolDefaults = getActiveToolSettings()
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Return-Format': args.fullPage ? 'pageshot' : 'screenshot',
      }
      const targetSel = args.targetSelector || toolDefaults.defaultTargetSelector
      if (targetSel) headers['X-Target-Selector'] = targetSel
      const waitSel = args.waitForSelector || toolDefaults.defaultWaitForSelector
      if (waitSel) headers['X-Wait-For-Selector'] = waitSel
      if (toolDefaults.defaultRemoveOverlay) headers['X-Remove-Overlay'] = 'true'

      const res = await callJinaWithCfBypass({
        url: READER, method: 'POST',
        headers,
        body: { url: String(args.url) }, timeoutMs: 120000, needsKey: true, apiKey: args.apiKey, signal,
      }, toolDefaults)
      if (!res.ok) return describeJinaError(res)
      let out = fmtScreenshot(res.text)

      // Attachments Store Integration:
      // If DSH attachments service is mounted, save the image so multimodal agents can view the raster
      const attachments = ctx.get('attachments')
      if (attachments && typeof attachments.saveImage === 'function') {
        try {
          const parsed = JSON.parse(res.text)
          const d = parsed && typeof parsed === 'object' ? (parsed.data || parsed) : parsed
          const b64 = d && (d.screenshot || d.image)
          if (typeof b64 === 'string' && b64.length > 0) {
            const cleanB64 = b64.replace(/^data:image\/[a-z]+;base64,/i, '')
            const buffer = Buffer.from(cleanB64, 'base64')
            const ref = await attachments.saveImage({
              data: new Uint8Array(buffer),
              mediaType: 'image/png',
              name: 'screenshot-' + Date.now() + '.png',
            })
            if (ref && ref.attachmentId) {
              out += `\n[DSH Attachment Saved]: ID=${ref.attachmentId} (${ref.width}x${ref.height}px)`
            }
          }
        } catch (e) { /* non-fatal attachment save */ }
      }
      return out
    },
  })

  ctx.tools.register({
    name: 'jina_datetime',
    description: 'Guess the publish/update datetime of a URL via Jina (r.jina.ai), mirroring the jina-cli \'datetime\' command. Works without an API key.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'Page URL, starting with http:// or https://.' },
        json: { type: 'boolean', description: 'Return the raw JSON response instead of the extracted title/datetime.' },
      },
      required: ['url'],
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      if (!/^https?:\/\//i.test(String(args.url))) return 'invalid url: ' + args.url + ' (must start with http:// or https://)'
      const res = await callJina({
        url: READER, method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Return-Format': 'datetime' },
        body: { url: String(args.url) }, timeoutMs: 60000, needsKey: false, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return fmtDatetime(res.text, args.json === true)
    },
  })

  ctx.tools.register({
    name: 'jina_expand',
    description: 'Expand a search query into related queries via Jina, mirroring the jina-cli \'expand\' command.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'The query to expand.' },
        json: { type: 'boolean', description: 'Return the raw JSON response instead of formatted queries.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
      required: ['query'],
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      let res = await callJina({
        url: SEARCH, method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: { q: String(args.query), query_expansion: true }, timeoutMs: 60000, needsKey: true, apiKey: args.apiKey, signal,
      })
      // If result is empty, retry with unhyphenated/cleaned query terms to prevent empty Google expansion drops
      if (res.ok && res.text) {
        try {
          const parsed = JSON.parse(res.text)
          const list = Array.isArray(parsed) ? parsed : (parsed && (parsed.results || parsed.data))
          if ((!Array.isArray(list) || list.length === 0) && args.query.includes('-')) {
            const cleaned = args.query.replace(/[-_]/g, ' ')
            const retryRes = await callJina({
              url: SEARCH, method: 'POST',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              body: { q: cleaned, query_expansion: true }, timeoutMs: 60000, needsKey: true, apiKey: args.apiKey, signal,
            })
            if (retryRes.ok && retryRes.text) {
              const retryParsed = JSON.parse(retryRes.text)
              const retryList = Array.isArray(retryParsed) ? retryParsed : (retryParsed && (retryParsed.results || retryParsed.data))
              if (Array.isArray(retryList) && retryList.length > 0) res = retryRes
            }
          }
        } catch (e) {}
      }
      if (!res.ok) return describeJinaError(res)
      return fmtExpand(res.text, args.json === true)
    },
  })

  ctx.tools.register({
    name: 'jina_embed',
    description: 'Generate embeddings for texts via Jina Embeddings API, mirroring the jina-cli \'embed\' command. Default model: jina-embeddings-v5-text-small.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        texts: { type: 'array', items: { type: 'string' }, description: 'Texts to embed (up to a few hundred).' },
        model: { type: 'string', description: 'Embedding model. Default: jina-embeddings-v5-text-small.' },
        task: { type: 'string', description: 'Embedding task type. Default: text-matching.' },
        dimensions: { type: 'number', description: 'Optional output dimensions (Matryoshka).' },
        json: { type: 'boolean', description: 'Return the raw JSON response (full vectors) instead of a preview.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
      required: ['texts'],
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      const body = { model: args.model || 'jina-embeddings-v5-text-small', task: args.task || 'text-matching', input: args.texts }
      if (args.dimensions !== undefined) body.dimensions = args.dimensions
      const res = await callJina({
        url: API + '/v1/embeddings', method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body, timeoutMs: 90000, needsKey: true, apiKey: args.apiKey, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return fmtEmbed(res.text, args.json === true)
    },
  })

  ctx.tools.register({
    name: 'jina_rerank',
    description: 'Rerank documents by relevance to a query via Jina Reranker API, mirroring the jina-cli \'rerank\' command. Default model: jina-reranker-v3.5.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'The reference query.' },
        documents: { type: 'array', items: { type: 'string' }, description: 'Documents (strings) to rerank.' },
        topN: { type: 'number', description: 'Maximum number of results to return.' },
        model: { type: 'string', description: 'Reranker model. Default: jina-reranker-v3.5.' },
        json: { type: 'boolean', description: 'Return the raw JSON response instead of formatted results.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
      required: ['query', 'documents'],
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      const body = { model: args.model || 'jina-reranker-v3.5', query: String(args.query), documents: args.documents }
      if (args.topN !== undefined) body.top_n = args.topN
      const res = await callJina({
        url: API + '/v1/rerank', method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body, timeoutMs: 90000, needsKey: true, apiKey: args.apiKey, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return fmtRerank(res.text, args.documents, args.json === true)
    },
  })

  ctx.tools.register({
    name: 'jina_classify',
    description: 'Classify texts into candidate labels via Jina Reranker Classification API, mirroring the jina-cli \'classify\' command. Default model: jina-reranker-v2-base-multilingual.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        texts: { type: 'array', items: { type: 'string' }, description: 'Texts to classify.' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Candidate labels.' },
        model: { type: 'string', description: 'Reranker model used for classification. Default: jina-reranker-v2-base-multilingual.' },
        json: { type: 'boolean', description: 'Return the raw JSON response instead of formatted predictions.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
      required: ['texts', 'labels'],
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      const body = { model: args.model || 'jina-reranker-v2-base-multilingual', input: args.texts, labels: args.labels }
      const res = await callJina({
        url: API + '/v1/classify', method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body, timeoutMs: 90000, needsKey: true, apiKey: args.apiKey, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return fmtClassify(res.text, args.json === true)
    },
  })

  ctx.tools.register({
    name: 'jina_pdf',
    description: 'Extract figures, tables, and equations from a PDF via Jina. Supports OCR presets, LaTeX math formatting, and markdown table alignment.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'PDF URL (https).' },
        arxivId: { type: 'string', description: 'arXiv paper ID shorthand, e.g. 2301.12345.' },
        extractType: { type: 'string', description: 'Filter by type: figure, table, equation (comma-separated).' },
        preset: { type: 'string', enum: ['ocr', 'ocr+', 'ocr++', 'pdf', 'pdf+', 'pdf++'], description: 'OCR preset tuning. ocr++ handles scanned documents with high accuracy.' },
        inlineFormula: { type: 'boolean', description: 'Convert inline math notation to standard LaTeX blocks.' },
        table: { type: 'boolean', description: 'Format grid tabular content as markdown tables. Default: true.' },
        page: { type: 'number', description: 'Steer which page to return for document files (1-indexed).' },
        maxEdge: { type: 'number', description: 'Max pixel size for extracted images. Default: 1024.' },
        json: { type: 'boolean', description: 'Return the raw JSON response instead of formatted output.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      const body = { max_edge: args.maxEdge !== undefined ? args.maxEdge : 1024 }
      if (args.arxivId) body.id = String(args.arxivId)
      else if (args.url) body.url = String(args.url)
      else return 'provide either url or arxivId (jina pdf URL_OR_ARXIV_ID)'
      if (args.extractType) body.type = args.extractType
      if (args.page !== undefined) body.page = args.page

      const headers = { 'Content-Type': 'application/json' }
      if (args.preset) headers['X-Preset'] = args.preset
      if (args.inlineFormula !== undefined) headers['X-Inline-Formula'] = String(args.inlineFormula)
      if (args.table !== undefined) headers['X-Table'] = String(args.table)
      if (args.page !== undefined) headers['X-Page'] = String(args.page)

      const res = await callJina({
        url: SEARCH + 'extract-pdf', method: 'POST',
        headers,
        body, timeoutMs: 120000, needsKey: true, apiKey: args.apiKey, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return fmtPdf(res.text, args.json === true)
    },
  })

  ctx.tools.register({
    name: 'jina_read_file',
    description: 'Read and extract markdown with OCR from a local workspace file (PDF, HTML, text, code, or image) via Jina Reader. Supports offline direct reading for plaintext/code files and Jina OCR for PDFs and complex documents.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        filePath: { type: 'string', description: 'Path to local file relative to workspace or absolute path.' },
        localOnly: { type: 'boolean', description: 'Read local text/code/markdown directly without uploading to Jina OCR API.' },
        targetSelector: { type: 'string', description: 'Target CSS selector to extract (for HTML files).' },
        tokenBudget: { type: 'number', description: 'Maximum tokens to return.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
      required: ['filePath'],
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      const pathStr = String(args.filePath)
      let buffer
      const candidatePaths = [pathStr]
      if (!isAbsolute(pathStr)) {
        if (currentCwd) candidatePaths.push(resolve(currentCwd, pathStr))
        candidatePaths.push(resolve('/home/martin/api', pathStr))
        candidatePaths.push(resolve(process.cwd(), pathStr))
      }
      let readErr
      for (const p of candidatePaths) {
        try {
          if (ctx.fs && typeof ctx.fs.readFile === 'function') {
            buffer = await ctx.fs.readFile(p)
          } else {
            const nodeFs = await import('node:fs/promises')
            buffer = await nodeFs.readFile(p)
          }
          if (buffer) break
        } catch (err) {
          readErr = err
        }
      }
      if (!buffer) {
        return 'failed to read local file "' + pathStr + '": ' + (readErr ? (readErr.message || String(readErr)) : 'file not found')
      }

      const ext = pathStr.split('.').pop().toLowerCase()
      const textLikeExts = new Set(['md', 'txt', 'json', 'csv', 'log', 'yaml', 'yml', 'xml', 'js', 'ts', 'jsx', 'tsx', 'py', 'c', 'cpp', 'rs', 'go', 'toml', 'sh', 'css', 'sql'])

      // Check if caller requested local-only read, or if text-like and no target selector or API key override specified
      if (args.localOnly || (textLikeExts.has(ext) && !args.targetSelector && !args.apiKey && !(await loadKey()))) {
        const textContent = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : Buffer.from(buffer).toString('utf8')
        if (args.tokenBudget && textContent.length > args.tokenBudget * 4) {
          return textContent.slice(0, args.tokenBudget * 4) + '\n\n[... truncated by tokenBudget cap ...]'
        }
        return textContent
      }

      const b64 = Buffer.isBuffer(buffer) ? buffer.toString('base64') : Buffer.from(buffer).toString('base64')
      const toolDefaults = getActiveToolSettings()

      const headers = {
        Accept: 'text/markdown',
        'Content-Type': 'application/json',
      }
      if (toolDefaults.defaultPreset) headers['X-Preset'] = toolDefaults.defaultPreset
      if (args.targetSelector) headers['X-Target-Selector'] = args.targetSelector
      const tokenBudget = args.tokenBudget || toolDefaults.defaultTokenBudget
      if (tokenBudget) headers['X-Max-Tokens'] = String(tokenBudget)
      if (toolDefaults.defaultRemoveOverlay) headers['X-Remove-Overlay'] = 'true'

      const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(ext)
      if (isImage) {
        headers['X-Respond-With'] = 'jina-ocr'
      }

      const body = {
        file: b64,
        filename: pathStr.split('/').pop(),
        extension: ext,
      }
      if (ext === 'pdf') body.pdf = b64
      if (isImage) {
        body.ocr = { preferEndToEnd: true }
      }

      const res = await callJinaWithCfBypass({
        url: READER, method: 'POST', headers,
        body, timeoutMs: 120000, needsKey: true, apiKey: args.apiKey, signal,
      }, toolDefaults)
      if (!res.ok) return describeJinaError(res)
      return res.text + extractUsageFooter(res.text)
    },
  })

  ctx.tools.register({
    name: 'jina_fact_check',
    description: 'Verify the truthfulness and factual consistency of a statement or claim against current web evidence via Jina Grounding. Returns verification verdict, factual confidence score, and authoritative references.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        statement: { type: 'string', description: 'The factual claim, technical assertion, or user statement to verify.' },
        apiKey: { type: 'string', description: 'Optional Jina API key override.' },
      },
      required: ['statement'],
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      const statement = String(args.statement)
      let res = await callJina({
        url: GROUND, method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: { statement }, timeoutMs: 120000, needsKey: true, apiKey: args.apiKey, signal,
      })
      if (!res.ok) {
        const getUrl = GROUND + encodeURIComponent(statement)
        const getRes = await callJina({
          url: getUrl, method: 'GET',
          headers: { Accept: 'application/json' },
          timeoutMs: 120000, needsKey: true, apiKey: args.apiKey, signal,
        })
        if (getRes.ok) res = getRes
      }
      if (!res.ok) return describeJinaError(res)
      try {
        const data = JSON.parse(res.text)
        const d = data && typeof data === 'object' ? (data.data || data) : data
        if (d && typeof d === 'object') {
          const lines = []
          const factuality = d.factuality !== undefined ? d.factuality : d.score
          if (factuality !== undefined) lines.push(`Factuality Score: ${(Number(factuality) * 100).toFixed(1)}%`)
          let verdict = d.result !== undefined ? d.result : d.verdict
          if (verdict === undefined && d.grounding !== undefined) {
            verdict = d.grounding === true ? 'TRUE / SUPPORTED' : (d.grounding === false ? 'FALSE / CONTRADICTED' : String(d.grounding))
          }
          if (verdict !== undefined) lines.push(`Verdict: ${verdict}`)
          if (d.reason) lines.push(`Reasoning: ${d.reason}`)
          const refs = Array.isArray(d.references) ? d.references : []
          if (refs.length > 0) {
            lines.push('\nReferences & Evidence:')
            refs.slice(0, 5).forEach((ref, idx) => {
              lines.push(`  [${idx + 1}] ${ref.title || ref.url || 'Source'} (${ref.url || ''})`)
              const quote = ref.key_quote || ref.keyQuote
              if (quote) lines.push(`      Quote: "${quote}"`)
            })
          }
          if (lines.length > 0) return lines.join('\n') + extractUsageFooter(res.text)
        }
      } catch (e) { /* fall through */ }
      return res.text + extractUsageFooter(res.text)
    },
  })

  ctx.tools.register({
    name: 'jina_primer',
    description: 'Get current context for time/location-aware answers: host clock (ISO time, unix, timezone, UTC offset), network facts (public IP and location, best-effort via ipinfo.io), and Jina account status (authenticated identity + credit balance from r.jina.ai). Sections that cannot be fetched are reported as unavailable; the tool never throws. Works without an API key.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        json: { type: 'boolean', description: 'Return the raw JSON data object instead of formatted text.' },
      },
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      const now = new Date()
      // Best-effort parallel probes; one failing section must not fail the tool.
      const [jinaRes, ipRes] = await Promise.all([
        callJina({
          url: READER, method: 'GET',
          headers: { Accept: 'application/json' },
          body: undefined, timeoutMs: 60000, needsKey: false, signal,
        }),
        jinaRequest({
          url: IPINFO, method: 'GET',
          headers: { Accept: 'application/json' },
          body: undefined, timeoutMs: 10000, signal,
        }),
      ])
      const jina = jinaRes && jinaRes.ok ? parseJinaRoot(jinaRes.text) : null
      const network = ipRes && ipRes.ok ? parseIpInfo(ipRes.text) : null
      return formatPrimer(buildPrimer({ now, jina, network }), args.json === true)
    },
  })

  // ---- web settings health-check endpoint -----------------------------------
  // The Jina Tools card asks this route for the key's identity + balance
  // (jina-cli `primer`) and for the proxy actually in effect. Registered when
  // the deployment composes a web server (the web profile); profiles without
  // one simply never get the route. The API key itself never leaves the host.
  ctx.inject(['webServer'], (rpcCtx) => {
    rpcCtx.webServer.register({
      kind: 'exact',
      path: '/api/dsh-jina/primer',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { Allow: 'GET' })
          res.end()
          return
        }
        const key = await loadKey()
        const out = await callJina({
          url: READER, method: 'GET',
          headers: { Accept: 'application/json' },
          body: undefined, timeoutMs: 30000, needsKey: false, apiKey: key,
        })
        // What the probe ran through, plus what the card has stored, so the
        // page can show the effective address even when the probe failed.
        const proxy = out.proxy || null
        const configured = settingProxy()
        const extra = { proxy, proxyConfigured: configured, ...(settingsDiag === '' ? {} : { settingsError: settingsDiag }) }
        let payload
        if (out.ok) {
          try {
            const data = JSON.parse(out.text)
            const d = (data && typeof data === 'object' && data.data && typeof data.data === 'object') ? data.data : data
            payload = {
              ok: true,
              status: out.status,
              authenticatedAs: typeof d.authenticatedAs === 'string' ? d.authenticatedAs : '',
              balanceLeft: typeof d.balanceLeft === 'number' ? d.balanceLeft : null,
              keyFound: key !== undefined,
              keyKind: keyKind,
              ...extra,
            }
          } catch (err) {
            payload = { ok: false, status: out.status, error: 'unexpected primer response shape: ' + String((err && err.message) || err), ...extra }
          }
        } else {
          payload = { ok: false, status: out.status, error: describeJinaError(out), ...extra }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(payload))
      },
    })
  })

  // ---- web settings namespace ------------------------------------------------
  // The web Settings → Plugins tab is keyed by the settings namespace a card
  // edits and renders a card only for namespaces the Host serves. This
  // registration makes the deployment's settings provider serve "jina-tools",
  // pairing it with the "Jina Tools" card the browser half registers under
  // `key: 'jina-tools'`. The namespace carries the manually configured local
  // proxy address (`proxyUrl`); the API key stays in the credential seam and
  // never rides the settings document.
  //
  // Zero-dependency note: the settings service consumes a schemastery schema
  // as a function (schema(value) → resolved value), serializes it through
  // toJSON(), and walks type/dict/meta for secret redaction. The schema built
  // by proxy.js is a plain object covering exactly that surface, so this plugin
  // still imports nothing from the harness's package graph (an out-of-tree
  // bundle at this location cannot resolve those imports). Profiles without a
  // settings provider never mount the inject, and the plugin keeps working
  // without the manual override — just with automatic proxy discovery only.
  const settingsNamespace = (value) => {
    if (!/^[a-z][a-z0-9-]*$/.test(String(value))) {
      throw new TypeError('settings namespace "' + String(value) + '" must match ^[a-z][a-z0-9-]*$')
    }
    return value
  }

  ctx.inject(['settings'], (sctx) => {
    try {
      settingsScope = sctx.settings.register(settingsNamespace(SETTINGS_NAMESPACE), createSettingsSchema(), {
        base: {
          defaultSearchNum: 5,
          defaultEngine: 'auto',
          defaultRetainImages: 'none',
          defaultNoCache: false,
        },
      })
    } catch (err) {
      settingsDiag = String((err && err.message) || err)
      settingsScope = undefined
    }
  })

  // ---- system prompt guidance section (band 110) ---------------------------
  // Injects optimal operational guidance into the agent system prompt when
  // systemPrompt service is available (standard non-complete presets).
  ctx.inject(['systemPrompt'], (pctx) => {
    try {
      pctx.systemPrompt.section({
        name: 'tool:jina-suite',
        order: 110,
        text: [
          '# Jina AI Web Intelligence Suite Guidance',
          'You have access to 16 specialized Jina AI tools. Follow these rules for maximum efficiency:',
          '- Parallel search: NEVER run serial turn-by-turn searches. Use jina_search_batch({ queries: [...] }) to resolve up to 5 research vectors in a single turn.',
          '- Structured extraction: When extracting specific fields from articles/docs, DO NOT dump raw markdown into context. Use jina_extract({ url, instruction, schema }) to return compact, validated JSON.',
          '- Long documents: Use jina_chunk({ url, chunkBy: "h2" }) on massive RFCs or manuals to avoid context overflow.',
          '- Local files: Use jina_read_file({ filePath }) to extract text and LaTeX formulas from local workspace PDFs or HTML mockups.',
          '- Visual verification: jina_screenshot automatically saves full-page PNGs into the session AttachmentStore for multimodal inspection.',
          '- Truth verification: Use jina_fact_check({ statement }) to verify contentious claims against live web evidence.',
          '- Academic research: Use jina_search_arxiv({ query, readFullText: true }) to discover and read full papers in one turn.',
        ].join('\n'),
      })
    } catch (err) { /* non-fatal prompt section registration */ }
  })

}
