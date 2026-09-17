**English** | [简体中文](README.md)

# dsh-jina

A [Jina AI](https://jina.ai/) plugin (bundle) for DeepSeek Harness: it exposes the full jina-cli API surface to the model as tool calls, and adds a **Jina Tools** card under **Plugins → Configuration** in the Web settings (the same standard plugin configuration location as Terminal / Agent Loop / Web Search) to configure your API key and a **local proxy address**.

## Changelog

> Only the latest release is listed here; the full version history lives in [change-log.en.md](./change-log.en.md).

### 1.0.0 (2026-09-17)

- **feat** **Expanded 16-Tool Intelligence Suite**: Full coverage of web search, batch querying (`jina_search_batch`), structured extraction via ReaderLM-v2 (`jina_extract`), semantic markdown segmentation (`jina_chunk`), local air-gapped document processing (`jina_read_file`), fact verification via Grounding (`jina_fact_check`), dense embeddings (`jina_embed`), reranking (`jina_rerank`), zero-shot classification (`jina_classify`), and document OCR (`jina_pdf`).
- **feat** **Adversarial Extraction & Anti-Bot Armor**:
  - Native `removeOverlay` (`X-Remove-Overlay`): Server-side removal of modal interstitials, GDPR/CMP cookie walls, and soft paywalls.
  - Native `detachInvisibles` (`X-Detach-Invisibles`): Elimination of zero-pixel scraper honeypots and decoy tracking spans.
  - Native `withShadowDom` (`X-With-Shadow-Dom`) & `withIframe` (`X-With-Iframe`): Traversal of Web Components and embedded frame documents.
  - Automated Cloudflare Turnstile Bypass (`callJinaWithCfBypass`): Automatic retry with `cf-browser-rendering` on HTTP 403, 503, or Turnstile challenges.
  - Offline fallback in `jina_read_file` for local plaintext, markdown, and source code files.
- **feat** **Adversarial Presets & Web UI Controls**: Added `adversarial-stealth` preset and toggle switches in the Settings panel for modal stripping, honeypot detachment, shadow DOM, and iframes.

## Features

Once installed, every session (all agent presets) gets 16 `jina_*` tools:

| Tool | Corresponding API / Engine | Description |
| --- | --- | --- |
| `jina_web_search` | `s.jina.ai` | General web search with site/filetype/intitle operators, recency time filters, and official-source prioritization |
| `jina_search_batch` | `s.jina.ai` | Concurrent multi-query search (1–5 queries in a single turn) |
| `jina_search_arxiv` | `s.jina.ai` / arXiv | arXiv preprint search with optional automated full-text reading (`readFullText: true`) |
| `jina_search_ssrn` | `s.jina.ai` / SSRN | SSRN paper search across economics, finance, law, and social sciences |
| `jina_read` | `r.jina.ai` | Web-to-Markdown with CSS selectors, overlay stripping, honeypot removal, Shadow DOM traversal, and Cloudflare bypass |
| `jina_extract` | ReaderLM-v2 | Schema-governed JSON extraction directly from web pages with zero prompt token waste |
| `jina_chunk` | `r.jina.ai` | Semantic document chunking by heading boundaries (`h1`–`h5` or `structured`) |
| `jina_read_file` | Local / OCR++ | Ingestion of local workspace files (PDF, HTML, text, code) with offline plaintext decoding and remote OCR |
| `jina_screenshot` | Viewport / Pageshot | Full-page or element-targeted screenshots with automatic storage in DeepSeek Harness `AttachmentStore` |
| `jina_pdf` | Search extract-pdf | Extraction of figures, tables, and equations from PDFs with LaTeX math blocks and page steering |
| `jina_fact_check` | `g.jina.ai` Grounding | Verification of factual assertions against real-time web evidence with credibility scoring |
| `jina_embed` | `api.jina.ai` / v5 | Dense text embeddings with Matryoshka dimension scaling |
| `jina_rerank` | `api.jina.ai` / v3.5 | Document relevance reranking against a target query |
| `jina_classify` | `api.jina.ai` / Classify | Zero-shot text classification into candidate categories |
| `jina_datetime` | `r.jina.ai` | Publish and modification timestamp estimation |
| `jina_expand` | `s.jina.ai` | Search query expansion into related query vectors |
| `jina_primer` | Diagnosis / Probe | Live context inspection: clock, public IP/location, active proxy, and credit balance |

## Field tests (cross-checked against the built-in web_search)

So the model **doesn't have to memorize parameters** to pick the right search domain, academic search was split into two dedicated tools, `jina_search_arxiv` / `jina_search_ssrn` (backed by `jina search --arxiv` / `--ssrn`) — the tool name says it all, and the model calls them directly when the user asks for papers. The table below is a sampled comparison from 2026-08-13 on the same machine with a real network environment (VPN system proxy): the same query was run through this plugin and dsh's built-in `web_search`, then the results were manually verified.

| Scenario | This plugin (dsh-jina) | Built-in web_search | Verdict |
| --- | --- | --- | --- |
| Academic search (arXiv) | `jina_search_arxiv` "retrieval augmented generation survey" → **9/9 all canonical arxiv.org links**: 2312.10997 (classic RAG survey), 2506.00054, 2410.12837, 2501.09136 (Agentic RAG), 2405.07437, 2504.08748, etc. — every result on-topic with accurate abstracts | Same query returned arXiv **mirror sites** (ezproxy.obspm.fr, ar5iv, sinoxiv.napstic.cn) and BibTeX links; no canonical links | ✅ jina wins: canonical links + precise recall |
| Academic search (SSRN) | `jina_search_ssrn` "large language models financial markets" → **9/9 all papers.ssrn.com originals**: market sentiment prediction, LLM-simulated trading, AI herding, investor disagreement, etc. — highly relevant | No SSRN-specific search capability | ✅ jina wins: exclusive SSRN domain |
| Chinese news / community / official sources | `jina_web_search` puts official sources (government / company sites) first, plus `time` filtering | Relevant results, but official sources not ranked first | ✅ jina better: authoritative sources first + time filter |
| General academic search (no domain specified) | Default web domain covers Springer / IEEE / ACL moderately (use the dedicated tools above for academic search) | Broad coverage of Springer / IEEE / ACL | ✅ web_search better: use it for general academic search |

**Conclusion / division of labor**: academic papers → `jina_search_arxiv` / `jina_search_ssrn`; time-sensitive Chinese news → `jina_web_search` (+ `time`); general academic / engineering docs → built-in `web_search`. They complement each other and cover all search scenarios.

> Note: the table is a one-round sampled comparison (not a strict benchmark); results depend on that day's network and query choices. Both toolchains work in practice; treat the conclusions as selection guidance.

## Extraction Presets & Settings Configuration

The plugin provides six curated presets configurable directly in Web settings (**Plugins → Configuration → Jina Tools**) or via `settings.yaml` under `jina-tools`:

| Preset | Target Engine | Token Budget | Images | Key Characteristics |
|---|---|---|---|---|
| `balanced` (Default) | `auto` | 8,000 | `none` | High signal extraction for daily coding, documentation reading, and web search. Cleans headers, footers, ads, and cookie banners. |
| `research` | `auto` | 16,000 | `alt` | Deep academic and technical investigation; generates image descriptions; enables Shadow DOM and iframe inlining. |
| `clean-read` | `auto` | 10,000 | `none` | Aggressive boilerplate excision; isolates strictly `article`, `main`, or `.markdown-body`. |
| `fast-index` | `auto` | 4,000 | `none` | Token-capped for rapid multi-turn search indexing and fast RAG query pipelines. |
| `spa-resilient` | `browser` | 12,000 | `none` | Waits for client-side JavaScript mounting (Next.js, React, Vue, Docusaurus); traverses Shadow DOM. |
| `adversarial-stealth` | `cf-browser-rendering` | 12,000 | `none` | Anti-bot armor: server-side Cloudflare bypass, modal overlay removal, zero-pixel honeypot detachment, and cache bypass. |

### Configurable Parameters in `settings.yaml`

```yaml
jina-tools:
  defaultPreset: balanced              # balanced | research | clean-read | fast-index | spa-resilient | adversarial-stealth
  defaultSearchNum: 5                 # 1 to 10 search results per query
  defaultTokenBudget: 8000            # token cap per read operation
  defaultEngine: auto                 # auto | browser | curl | cf-browser-rendering
  defaultRetainImages: none           # none | alt | all
  autoBypassCloudflare: true          # automatically retries blocked requests via cf-browser-rendering
  defaultRemoveOverlay: true          # strips popups, cookie consent walls, and paywall backdrops
  defaultDetachInvisibles: true       # detaches zero-pixel honeypots, hidden text, and decoy tracking spans
  defaultWithShadowDom: false         # traverses Web Components and encapsulated shadow roots
  defaultWithIframe: false            # extracts and inlines embedded child documents
  defaultTargetSelector: 'article, main, [role="main"], [role="article"], .markdown-body, .content, #content, .main-content, #main-content, .post-content, .article-body, .entry-content, [itemprop="articleBody"], [itemprop="text"], [data-testid*="article"], [data-testid*="content"]'
  defaultRemoveSelector: 'header, footer, nav, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .navbar, .site-header, .site-footer, .cookie-banner, #cookie-banner, .consent-banner, #onetrust-banner-sdk, #onetrust-consent-sdk, .cookiebot, #CookiebotWidget, .didomi-popup-container, .ads, .ad, .advertisement, [id^="google_ads"], [id^="ad-"], [class*="-ad-"], .sidebar, #sidebar, .aside, .social-share, .comments, #comments, .menu, .breadcrumbs, .related-posts, .author-bio, .footer-nav, .popup, .modal, .overlay, .paywall, .paywall-overlay, .premium-gate, .subscription-gate, .newsletter-signup'
```

---

## Adversarial Extraction & Anti-Bot Armor

Modern websites deploy sophisticated anti-scraping layers, including consent walls, soft paywalls, obfuscated CSS class hashes, and Cloudflare Turnstile challenges. `dsh-jina` v1.0 implements multi-layered countermeasures:

1. **Server-Side Overlay Stripping (`X-Remove-Overlay: true`)**:
   - Rather than relying solely on post-render CSS deletion, the remote Chromium renderer dynamically detects and unmounts modal overlays, cookie consent dialogs (OneTrust, Cookiebot, Didomi), and subscription gates before serializing the DOM tree.
2. **Scraper Honeypot Detachment (`X-Detach-Invisibles: true`)**:
   - Computes layout-tree visibility and removes elements with `display: none`, `visibility: hidden`, `opacity: 0`, zero dimensions (`1x1`), or off-viewport coordinates. Neutralizes scraper traps and prompt-injection canaries.
3. **Shadow DOM Traversal (`X-With-Shadow-Dom: true`)**:
   - Penetrates encapsulated Shadow DOM roots, enabling complete text extraction from Web Components, Lit, Stencil, and Shoelace frontends.
4. **Automated Cloudflare Turnstile Escalation (`callJinaWithCfBypass`)**:
   - Outbound requests default to fast lightweight transports. If an HTTP 403, 503, or Cloudflare challenge signature (`cf-chl`, `turnstile`, `Attention Required`) is detected, the engine transparently escalates the request to `X-Engine: cf-browser-rendering` with an extended timeout.
5. **Air-Gapped Offline Document Reading**:
   - `jina_read_file` detects local plaintext, code, and markdown documents (`.md`, `.txt`, `.json`, `.py`, `.js`, `.ts`, `.rs`, `.go`, `.yaml`). When no external OCR is needed or when the user operates offline without an API key, the tool reads the file locally via `ctx.fs` without consuming API credits.

---

## Installation

Repository: https://github.com/minatoAI/jina-web-search-dsh-plugin

The plugin is distributed as a [bundle](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.md) and installed into a profile with `dsh plugin` (use `pnpm dsh` instead of `dsh` when running from a source checkout):

> install from GitHub (no build script, so no allowBuilds grant needed)

```sh
dsh plugin --profile web add github:minatoAI/jina-web-search-dsh-plugin
```

> more robust: pin to a commit so later pushes don't change the installed code

```sh
dsh plugin --profile web add github:minatoAI/jina-web-search-dsh-plugin#<commit-sha>
```

> or install from a local folder (development)

```sh
dsh plugin --profile web add ./jina-dsh-plugin
```

**Restart** dsh after installing (new bundles take effect on next startup):

```sh
dsh --profile web
```

Then open the Web UI → Settings → **Plugins** → **Configuration** tab → expand the **Jina Tools** card → paste your API key → Save. Get a free key at https://jina.ai/.

The same card carries **Local proxy (optional)**: if your proxy client only listens on a loopback port (no system proxy, no `HTTP_PROXY` environment variable), type its address there — e.g. `http://127.0.0.1:7897` (the scheme is optional) → Save, and the next tool call uses it. When the proxy moves to another port, update this field; no dsh restart required.

The card's **API key / connection check** section shows the current key's identity (Jina account) and balance (credits), marks the key's source (saved on this page / key file / anonymous quota), and reports **the proxy address the check actually ran through**; click **Refresh** to re-check (saving or clearing the key or the proxy also triggers an automatic re-check). This data is served by the host-side plugin through the `/api/dsh-jina/primer` route (the same endpoint the `jina_primer` tool uses); **the plaintext key never leaves the host**, while the proxy address is plaintext configuration and is displayed on the page.

## API key resolution order

Each tool call looks up the key in the following order (first hit wins):

1. The `apiKey` tool-call parameter
2. The key saved on the settings page (credential reference `JINA_API_KEY`, persisted by dsh's credential store, e.g. `~/.dsh/.credentials.yaml`)
3. `jina-api-key.txt` in the session workspace
4. `jina-api-key.txt` in the dsh home directory (`$DSH_HOME`, default `~/.dsh`)

A key saved on the settings page takes effect immediately (no restart needed; resolved on every call). On HTTP 401 the plugin re-reads the file and retries once. Credential values are only ever sent up through `credentials.set`; no read endpoint returns the plaintext. You can also clear the key with one click on the page.

## Local proxy (a local proxy client)

Jina domains are blocked on direct connections and need a proxy. The plugin resolves a proxy on every call (changes take effect immediately):

| Priority | Source | Notes |
| --- | --- | --- |
| 1 | The card's "Local proxy" | the `proxyUrl` field of the `jina-tools` namespace — the recommended manual path |
| 2 | `JINA_PROXY_URL` environment variable | for profiles without a settings provider (e.g. headless) |
| 3 | Windows system proxy | discovered from the WinINET registry (when `ProxyEnable=1`); re-discovered once after a transport failure, so a VPN port change self-heals |
| 4 | Startup environment | the harness-resolved `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`, handed to the network helper by `subprocess` |

Rules and caveats:

- **Only `http://` and `https://` proxies are supported.** The network helper is `node -e` plus the global `fetch`, which honors proxy variables under `NODE_USE_ENV_PROXY`; any other scheme makes Node exit at startup, so such an address is refused with an explanation instead of being ignored or breaking the helper.
- **When the proxy client only listens on a port without being the system proxy** (WinINET `ProxyEnable=0x0`), priority 3 cannot see it — that is exactly the case the manual field exists for.
- A manually configured address **outranks** automatic discovery, and a transport failure never silently swaps it for a discovered one: the error names the address in use so a wrong port is obvious.
- The scheme may be omitted (`127.0.0.1:7897` equals `http://127.0.0.1:7897`), credentials are allowed (`http://user:pass@127.0.0.1:7897`), and any path/query is dropped.
- The address is stored in plaintext in dsh's settings document (the `jina-tools` section of `settings.yaml`) and is readable by the Web page — **use it only on a trusted local machine** and never commit an address carrying credentials.
- **Clear** returns to automatic detection (priority 3 → 4).

## Uninstall

```sh
dsh plugin --profile web remove dsh-jina
```

## Repository structure

```
jina-dsh-plugin/
├── package.json       # manifest: "dsh": { "bundle": {"patch": ...}, "client": {"platform": "web"} }; the browser half is exported via exports["./client"] → ui/client.js
├── cordis.patch.yml   # composition layer: one dual-face row dsh-jina (host tools + browser card; exact package name matches client-modules scan)
├── index.js           # host plugin: full 16-tool intelligence suite + transport + Cloudflare bypass + AttachmentStore + jina-tools proxy & presets
├── proxy.js           # pure module: proxy precedence, extraction presets, selector defaults, and schemastery settings schema (zero deps)
├── primer.js          # pure module: jina_primer diagnostic formatting logic (zero deps, unit-testable)
├── test/
│   ├── adversarial-extraction.test.js # adversarial extraction parameters, stealth presets, and schema tests
│   ├── client-bundle.test.js          # browser-bundle contract tests (syntax, registration id, settings transport)
│   ├── milestone5.test.js             # local file reading & attachments integration tests
│   ├── plugin-proxy.test.js           # mock-host proxy integration tests (incl. opt-in live proxy)
│   ├── presets-defaults.test.js       # selector constants & preset schema tests
│   ├── primer.test.js                 # jina_primer parsing/formatting tests
│   ├── proxy.test.js                  # proxy normalization & resolution hierarchy tests
│   ├── tools-extended.test.js         # extended tool contracts & parameter validations
│   └── tools.test.js                  # jina_web_search model-facing contract tests (TDD)
├── ui/
│   ├── package.json   # subpackage manifest (exports["./client"])
│   ├── index.js       # empty host half for subpackage compatibility
│   └── client.js      # prebuilt browser bundle: "Jina Tools" card (API key, local proxy, presets & toggles)
├── docs/
│   ├── api.md         # Jina API endpoints, headers, error codes, and extraction options
│   ├── agents.md      # LLM engineering principles and prompt guide for Jina APIs
│   ├── reader-api.json# OpenAPI specification for Jina Reader API
│   └── search-api.json# OpenAPI specification for Jina Search API
├── change-log.md      # full changelog (Simplified Chinese)
├── change-log.en.md   # full changelog (English)
├── README.md          # Simplified Chinese README
└── README.en.md       # this file
```

## Development notes

- The host plugin only depends on Node built-ins and dsh host services (`fs`, `subprocess`, `tools`, `credentials`, `settings`, `webServer`, `attachments`) — no third-party npm dependencies; credentials go through dsh's native credential seam (referencing `JINA_API_KEY`) and the proxy setting through the plugin's own `jina-tools` namespace (`proxyUrl`, a zero-dependency duck-typed schemastery node built by `createSettingsSchema` in `proxy.js`), so it works with any profile composition out of the box.
- The client bundle is committed directly (`ui/client.js`), no build step — git installs work as-is. To change the UI, edit that file and restart. The registration id in the bundle's top-level `window.__ModuleLoader__.load` MUST equal the graph row id (the exact package name `dsh-jina`) — the module system matches registrations only by row id (a trailing `/client` excepted); registering under any other key (e.g. the old row name `dsh-jina/ui`) fails the whole page with `loaded without registering "dsh-jina"` + `Failed to load plugins`. The card registers into the `settings.plugin.item` slot declared by the Web settings package (Settings → Plugins → Configuration), the standard place for third-party plugin configuration.
- **The `remote.<ns>` injection rule**: the gateway's `$mount` registers every Remote namespace as its **own cordis service**, so a client plugin must declare `remote.<ns>` (e.g. `remote.credentials`, `remote.settings`) in its own `inject` before reading that property — declaring only `'remote'` is not enough, the property access itself throws `cannot get property "remote.settings" without inject`, and the error reaching the `settings.plugin.item` slot boundary makes the whole card disappear (the 0.6.0 regression, now pinned by `test/client-bundle.test.js`). This plugin declares `inject = ['slots','remote','remote.credentials','remote.settings']`, and the read sites keep a try/catch so a missing service degrades to a notice instead of crashing the slot.
- The key is managed through the credentials Remote namespace (`credentials.describe/set/unset`, with `credentials/reference-updated` forwarded by `remote`); the proxy field rides the `settings` Remote namespace (`remote.settings.describe/mutate`, each write fenced by the `revision` the page read, with external edits arriving as the forwarded `settings/document-updated`).
- The composition layer follows dsh conventions: one dual-face row `dsh-jina` carries both the host half and the browser half. The browser half is declared by the ROOT manifest's `dsh.client` (platform: web, graph edge `@deepseek-ai/dsh-api-remotes`) plus `exports["./client"]`; the host's client-modules service locates the root manifest by the row name (an exact package name) and wires it into the Web boot graph. Note the client-modules scan accepts only exact-package-name rows: subpath rows (e.g. `dsh-jina/ui`) are never scanned as client rows — the browser half must be declared at the package root.

## Tests

Pure logic (proxy policy, primer parsing/formatting, adversarial extraction, etc.) is covered by the Node built-in test runner with zero dependencies:

```sh
npm test   # same as node --test (auto-discovers test/*.test.js)
```

- `test/proxy.test.js`, `test/primer.test.js`, `test/tools.test.js`: pure functions and the model-facing contract.
- `test/adversarial-extraction.test.js`: verifies `X-Remove-Overlay`, `X-Detach-Invisibles`, `X-With-Shadow-Dom`, `X-With-Iframe`, `X-Set-Cookie`, `callJinaWithCfBypass`, and stealth presets.
- `test/presets-defaults.test.js` & `test/tools-extended.test.js`: selector defaults, token budgets, and parameter contracts.
- `test/plugin-proxy.test.js`: drives the host half through a fake Cordis context and asserts settings-namespace registration, proxy precedence, the environment the network helper receives, and the `/api/dsh-jina/primer` payload.
- `test/client-bundle.test.js`: parses the prebuilt `ui/client.js` in a clean VM script context and validates syntax, registration id, `jina-tools` key, settings transport, and revision fencing.

Fixtures use real captured r.jina.ai / ipinfo.io response shapes; tests cover
parse tolerance, time-fact derivation, text/JSON rendering and the
"never prints undefined" contract.
