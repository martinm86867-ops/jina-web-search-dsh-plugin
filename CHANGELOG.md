# Changelog

Full version history of `dsh-jina`.

### 1.0.1

- **fix** **`jina_fact_check` returned fabricated verdicts.** The primary path never called a fact-checking service: it ran a SEARCH query, concatenated the top snippets into one lowercase string, and derived a verdict from **hardcoded string matching**. Consequences, all reproduced and now covered by tests:
  - Every SUPPORTED verdict reported exactly **88.0%**, because `factuality = 0.88` was a literal constant in the `wordCoverage >= 0.85` branch; FALSE came from literal `0.15` / `0.12` / `0.20` or `wordCoverage * 0.40`.
  - A FALSE verdict was triggered by the mere **presence** of a negation word (`false`, `myth`, `debunk`) anywhere in a snippet, **without checking what was being negated** — so a page confirming a claim was read as refuting it, and any contested topic scored FALSE in both directions.
  - The word-overlap proxy **inverted specificity**: a claim full of dates, figures and proper nouns shares few tokens with any snippet, so the best-documented claims scored lowest while vague statements scored highest.
  - Scoring was further tuned to eval fixtures (`nova drift`, `path of exile`, `typescript`, `visuals are legible`, `gameplay is fun`) hardcoded into the production path.
  - The `g.jina.ai` Grounding call was unreachable except when search returned zero results.
- **feat** **`eval-grounded.js`** — new zero-dependency pure module owning the evaluation contract: relevance gate, explicit-refutation detection, attribution awareness, numeric-figure verification, and abstention. Verdicts are now `SUPPORTED` / `REFUTED` / `MIXED` / `UNKNOWN`, and UNKNOWN is the default whenever evidence is insufficient, attribution-only, contradictory, or does not contain the claim's stated figures.
- **fix** Confidence is computed from evidence coverage instead of a literal constant, so it is reproducible from the returned sources.
- **fix** Refutation must name the claim: a negation is only counted when the clause it negates shares content with the claim under test, and typographic quotes are normalised so headlines such as `Are Not "Genocide"` are matched.
- **fix** Titles are scanned alongside snippets, since the verdict often lives in the headline while the body text is neutral.
- **feat** Evidence and references are always returned with the verdict so it can be audited; the tool description no longer claims a Grounding-backed score.
- **test** `test/fact-check.test.js` (22 behaviour cases) replaces the previous coverage, which asserted only that the tool name appeared in the source file and could not fail on a wrong verdict. Includes the primary regression: the vague and dated forms of the same claim must both be SUPPORTED, where the old proxy returned TRUE for the vague form and FALSE for the dated one.

### 1.0.0 (2026-09-17)

- **feat** **Expanded 16-Tool Intelligence Suite**: Full coverage of web search, batch querying (`jina_search_batch`), structured extraction via ReaderLM-v2 (`jina_extract`), semantic markdown segmentation (`jina_chunk`), local air-gapped document processing (`jina_read_file`), fact verification via Grounding (`jina_fact_check`), dense embeddings (`jina_embed`), reranking (`jina_rerank`), zero-shot classification (`jina_classify`), and document OCR (`jina_pdf`).
- **feat** **Effective Extraction & Anti-Bot Defense**:
  - Native `removeOverlay` (`X-Remove-Overlay`): Server-side removal of modal interstitials, GDPR/CMP cookie walls, and soft paywalls.
  - Native `detachInvisibles` (`X-Detach-Invisibles`): Elimination of zero-pixel scraper honeypots and decoy tracking spans.
  - Native `withShadowDom` (`X-With-Shadow-Dom`) & `withIframe` (`X-With-Iframe`): Traversal of Web Components and embedded frame documents.
  - Automated Cloudflare Turnstile Bypass (`callJinaWithCfBypass`): Automatic retry with `cf-browser-rendering` on HTTP 403, 503, or Turnstile challenges across reader and extraction tools.
  - Offline fallback in `jina_read_file` for local plaintext, markdown, and source code files without requiring API credits.
- **feat** **Extraction Presets & Web UI Controls**: Added `effective-stealth` preset and toggle switches in the Settings panel for modal stripping, honeypot detachment, shadow DOM, and iframes.
- **feat** **Modern DSH Plugins Page Integration**: Integrated `plugins.bundle.config` and `plugins.row.config` slots for DeepSeek Harness >= 0.1.6, rendering directly on the bundle and row pages while preserving backwards compatibility with `settings.plugin.item`.
- **fix** **Settings Service Resolution**: Declared `remote.settings` and `remote.credentials` in `exports.inject` and added multi-tier fallback resolution to eliminate "Settings service unavailable" error on save.
- **test** Added `test/effective-extraction.test.js` covering all extraction parameter mappings, selector resilience, and schema round-trip serialization (88 tests passing).

### 0.6.1 (2026-09-16)

- **fix** Fixed the browser-half crash 0.6.0 introduced, which made the whole **Jina Tools card disappear** (reported from a live console: `Error: cannot get property "remote.settings" without inject`, then `slot entry crashed in 'settings.plugin.item'`). The gateway mounts every Remote namespace as its **own cordis service** `remote.<ns>`, and a consumer must declare that service name in its `inject` before reading the property; 0.6.0 declared only `slots` / `remote` / `remote.credentials`, so the moment `settingsApi()` read `remote.settings` the property access itself threw, the error reached the slot boundary, and the card was replaced by an error boundary. Fix: `exports.inject` now declares `'remote.settings'` (the bundled `ui-settings` client declares `['remote','remote.settings']` too), and the read is wrapped in try/catch so a missing service degrades to the "settings Remote not mounted" notice instead of crashing the slot.
- **test** `test/client-bundle.test.js` gained two regression contracts: `exports.inject` must list **exactly** every Remote namespace service the card reads, and the settings read must sit inside try/catch. The mechanism was reproduced and re-verified against the real cordis runtime (injecting only `remote` reproduces the original error; adding `remote.settings` resolves).

### 0.6.0 (2026-09-15)

- **feat** **Manual local-proxy configuration**: the Jina Tools card (Settings → Plugins → Configure) gains a "Local proxy (optional)" block — type the address (`http://127.0.0.1:7897`, the scheme may be omitted), save, and the next tool call uses it; one click clears it back to automatic detection. The value is stored in the `proxyUrl` field of the plugin's own `jina-tools` settings namespace (persisted in the settings document, hand-editable via `settings.yaml`). This is the fix for the common setup where the proxy client listens on a loopback port without being the Windows system proxy: WinINET reports `ProxyEnable = 0x0`, automatic discovery cannot see it, and earlier versions went direct and failed.
- **feat** Proxy precedence (`proxy.js`, pure and unit-tested): tool-level override > card `proxyUrl` > `JINA_PROXY_URL` environment variable > WinINET system-proxy discovery (port-change self-healing kept) > the inherited startup environment (`HTTP_PROXY` / `HTTPS_PROXY`). A configured manual address skips the registry probe entirely, and a transport failure never silently swaps it for an auto-discovered one — the error names it instead.
- **feat** Visible diagnostics: `/api/dsh-jina/primer` (the card's health check) now reports **the proxy the probe actually ran through** plus any saved-but-unusable address with its reason (e.g. `socks://` is not usable by the Node fetch helper); transport failures name the proxy in play and state the next step (check the port / clear to re-enable auto-detection / fill in the local proxy).
- **fix** Only `http://` / `https://` proxies reach the network helper: Node's `fetch` exits at startup when `NODE_USE_ENV_PROXY` sees a non-http(s) scheme, so a `socks5://` address is now refused with an explanation instead of being silently ignored or breaking the helper.
- **refactor** The proxy policy and the settings schema moved into a zero-dependency pure module (`proxy.js`); the network helper script is exported as `HTTP_HELPER_SCRIPT` so the transport can be verified end to end.
- **test** New `test/proxy.test.js` (20 pure-function contract cases), `test/plugin-proxy.test.js` (13 mock-host integration cases: namespace registration, precedence, helper environment construction, error text, primer payload, plus an opt-in live case that really spawns the helper through `http://127.0.0.1:7897` with `JINA_LIVE_PROXY=1`), and `test/client-bundle.test.js` (8 browser-bundle contract cases: registration id / namespace key / settings transport / revision fencing — the bundle has no build step, so a syntax error would otherwise surface only at runtime).
- **verify** Checked against the real components (not mocks): `createSettingsSchema()` was registered with a real `@deepseek-ai/dsh-settings-file` provider through the real `settings.register` / `mutate` / `describe({redactSecrets:true})` (the address lands in `settings.yaml`, the revision advances, `secrets: []` treats it as plain configuration), and the emitted schema was rehydrated with the real schemastery 3.18.2 `new Schema(serialized)` exactly as the browser does (accepts a string, rejects a number). Driving the plugin off that real settings service then showed the stored address on the helper environment (both casings + `NODE_USE_ENV_PROXY=1`) with no registry probe, and `undefined` again after clearing (full inheritance of the harness environment). Separately, the shipped helper ran in a clean process: `HTTPS_PROXY=http://127.0.0.1:7897` + `NODE_USE_ENV_PROXY=1` → `r.jina.ai` answered 200; `127.0.0.1:1` → `fetch failed (connect ECONNREFUSED 127.0.0.1:1)`, the path whose error message names the configured address.
- **docs** README gains a "Local proxy" section (steps, precedence, `JINA_PROXY_URL`, trust boundary) and the development notes cover `proxy.js` and the new tests.

### 0.5.3 (2026-09-05)

- **compat** Verified against dsh v0.1.3-alpha.1 ([releases](https://github.com/deepseek-ai/deepseek-harness/releases)): the breaking changes (Session persistence API now owned by lifecycle-scoped `SessionHandle`s; async `agentLoop.create()`; new session lock holding each session in at most one process; Session format v2) are all host-internal — the plugin only uses `tools` / `subprocess` / `fs` / `credentials` / `webServer` / `settings` / `sandboxPolicy` plus `exec.agent.session.header.cwd` / `exec.signal`, and each face was checked against the 0.1.3 sources with no migration needed: `tools.register` parameter normalization (`normalizeRegisteredParameters`), `output {schema, render}`, `credentials.resolve`, the standalone `remote.credentials` service injection, the `credentials/reference-updated` event (still forwarded by `remote`), `webServer.register` (exact route), the empty-namespace `settings.register`, the keyed `settings.plugin.item` slot (`key: 'jina-tools'`), the `window.__ModuleLoader__` registration id (graph row id = exact package name `dsh-jina`), and `subprocess.spawn` (`SubprocessOutcome` via `handle.done` + offset-based `collected` reads + `resolveExecutable`) are all unchanged.
- **fix** Proxy environment aligned with the 0.1.3 outbound proxy policy: `subprocess` merges `env` over a scrubbed base that already carries the harness-resolved proxy (`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` from the startup environment + `NODE_USE_ENV_PROXY`); the old `makeEnv` always wrote `NO_PROXY: ''` (wiping the base bypass including loopback) and unconditionally set `NODE_USE_ENV_PROXY=1` (which breaks the Node helper startup under a SOCKS proxy). Fix: return `undefined` when there is no discovered/overridden proxy (fully inherit the harness policy); with a proxy, write both env-name casings, never touch `NO_PROXY`, and only carry the flag for http(s). Windows system-proxy discovery (WinINET, with port-change self-healing) stays as the complement to the env policy.

### 0.5.2 (2026-08-29)

- **fix** Fix the `Failed to load plugins` page after installing the plugin: the registration id is now the graph row id `dsh-jina`.
- **fix** The credential namespace now uses standard Cordis injection: `remote.credentials`.

### 0.5.1 (2026-08-29)

- **fix** Move browser-half declaration to root manifest for client-modules scan compatibility.

### 0.5.0 (2026-08-29)

- **fix** Adapt to dsh 0.1.2-alpha.1 apiproxy refactor: use `ctx.remote.credentials` Remote service.

### 0.4.0 (2026-08-18)

- **feat** Rename `jina_search` to `jina_web_search` and add task-first description.
- **refactor** Extract tool contract into pure data module `tool-contracts.js`.

### 0.3.0 (2026-08-15)

- **feat** Add `jina_primer` with real environment context (clock, IP, location, quota balance).

### 0.2.0 (2026-08-14)

- **feat** Add dedicated academic search tools `jina_search_arxiv` and `jina_search_ssrn`.
- **feat** Live balance/identity health checks on the settings card.

### 0.1.0 (2026-08-14)

- **feat** Initial release: dsh-jina bundle with 10 tools and settings-page API key UI.
