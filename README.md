# @martinm86867-ops/dsh-jina

**Comprehensive Web Intelligence, High-Signal Extraction & Dense Reasoning Suite for DeepSeek Harness**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/Tests-108%20passing-brightgreen.svg)](./test)
[![DeepSeek Harness](https://img.shields.io/badge/DSH-0.2.1%2B-purple.svg)](https://github.com/deepseek-ai/deepseek-harness)

A production-grade, zero-npm-dependency DeepSeek Harness (DSH) bundle that delivers the full power of [Jina AI](https://jina.ai/) directly into model sessions. Equipped with 19 model-facing tools, six customizable extraction presets, automated Cloudflare Turnstile bypass, and native browser settings integration on modern DSH Plugins pages.

---

## Origin & Acknowledgments

This project is an extensive architectural evolution of the original [jina-web-search-dsh-plugin](https://github.com/minatoAI/jina-web-search-dsh-plugin) created by **minatoAI**. 

While retaining the rock-solid proxy precedence and isolated subprocess transport pioneered by the original author, this edition heavily enhances the suite to version 1.0.0 with:
- Expansion from 12 tools to a complete 19-tool intelligence suite.
- Effective content extraction layers (`X-Remove-Overlay`, `X-Detach-Invisibles`, `X-With-Shadow-Dom`, `X-With-Iframe`).
- Settings served the way DSH 0.2.1 expects: a module-level `Config` on the `jina-tools` entry (no registrar API), projected into the card's form, plus first-class plugin slots (`plugins.bundle.config` and `plugins.row.config`).
- Automated Cloudflare Turnstile detection and browser-rendering escalation.
- Offline direct decoding for local workspace source code and markdown files.

---

## Architecture & System Design

```
                                 DeepSeek Harness Host
                                          │
                     ┌────────────────────┴────────────────────┐
                     ▼                                         ▼
            index.js (Host Plugin)                   ui/client.js (Web UI)
        ┌─────────────────────────┐               ┌─────────────────────────┐
        │ 19 Model-Facing Tools   │               │ DSH >= 0.2.1 Plugin Slot│
        │ - Search, Read, Extract │               │ - plugins.bundle.config │
        │ - Embed, Rerank, PDF    │               │ - plugins.row.config    │
        │ Subprocess Transport    │               │ Multi-Tier Remote Bus   │
        │ - Isolated node worker  │               │ - remote.settings       │
        │ - Memory leak firewall  │               │ - remote.credentials    │
        └────────────┬────────────┘               └─────────────────────────┘
                     │ (HTTP / HTTPS)
                     ▼
          Jina AI Cloud Gateways (r.jina.ai, s.jina.ai, api.jina.ai, g.jina.ai)
```

1. **Subprocess Transport Isolation**: Network calls are executed through an isolated worker script dispatched via `ctx.subprocess.spawn`. Transport delays, socket timeouts, or TLS handshakes never block the main Cordis event loop.
2. **First-Class Plugins Page Integration**: Registers into the DSH Plugins page's `plugins.bundle.config` (bundle page) and `plugins.row.config` (row configuration page), while maintaining backwards compatibility with the legacy `settings.plugin.item` slot.
3. **Multi-Tier Service Bus**: Settings and credentials resolve seamlessly across four progressive tiers (`props` $\to$ `ctx.get('remote.*')` $\to$ `remote.*` $\to$ connection API), guaranteeing dependable persistence to `settings.yaml`.

---

## 19-Tool Intelligence Catalog

Every model session receives access to 19 specialized `jina_*` tools:

### Web Intelligence & Search
| Tool | Target Gateway | Purpose & Differentiators |
|---|---|---|
| `jina_web_search` | `s.jina.ai` | General web search with site/filetype/intitle operators, recency time filters, and official-source prioritization. |
| `jina_search_batch` | `s.jina.ai` | Concurrent multi-query retrieval (1–5 queries in a single turn) to eliminate turn-by-turn latency. |
| `jina_search_arxiv` | `s.jina.ai` / arXiv | Specialized arXiv preprint discovery with optional automated full-text reading (`readFullText: true`). |
| `jina_search_ssrn` | `s.jina.ai` / SSRN | Social Science Research Network paper search for economics, finance, law, and management papers. |
| `jina_expand` | `s.jina.ai` | Algorithmic expansion of search queries into related semantic query vectors. |

### Deep Extraction & Reading
| Tool | Target Gateway | Purpose & Differentiators |
|---|---|---|
| `jina_read` | `r.jina.ai` | Web-to-Markdown with CSS selector scoping, overlay stripping, honeypot detachment, and Cloudflare bypass. |
| `jina_extract` | ReaderLM-v2 | Zero-prompt-waste server-side JSON extraction matching a user-defined JSON Schema. |
| `jina_chunk` | `r.jina.ai` | Semantic document chunking by heading boundaries (`h1`–`h5` or `structured`) to prevent context overflow. |
| `jina_read_file` | Local / OCR++ | Ingestion of local workspace files (PDF, HTML, text, code) with offline plaintext parsing and remote OCR. |
| `jina_screenshot` | Viewport / Pageshot | Element-focused or full-page capture with automatic saving to DSH `AttachmentStore` for vision models. |
| `jina_pdf` | Search extract-pdf | Extraction of figures, tables, and equations from PDFs with LaTeX math blocks and page steering. |

### Dense AI, Reranking & Truth Verification
| Tool | Target Gateway | Purpose & Differentiators |
|---|---|---|
| `jina_evidence_map` | Search evidence + stance classifier | Maps what retrieved sources **do** with a claim — state it, report it as an assertion, deny it, or mention the subject only — with the source and quote behind each classification. Renders **no verdict** by design: a snippet scan cannot establish truth. Pair with `archive_claim_trace` for the archived record. |
| `jina_embed` | `api.jina.ai` / v5 | Dense text embeddings with Matryoshka dimension scaling (default: `jina-embeddings-v5-text-small`). |
| `jina_rerank` | `api.jina.ai` / v3.5 | Document relevance reranking against a target query (default: `jina-reranker-v3.5`). |
| `jina_classify` | `api.jina.ai` / Classify | Zero-shot text classification into candidate label categories. |
| `jina_datetime` | `r.jina.ai` | Publication and modification timestamp estimation for any URL. |
| `jina_primer` | Diagnosis / Probe | Current environment context: host clock, public IP/location, active proxy, and Jina credit balance. |

### Archive Integration (requires the archivist backend)
| Tool | Target Gateway | Purpose & Differentiators |
|---|---|---|
| `jina_fact_check` | Archivist bridge + live web | Sweeps the archive for a claim's footprint (documents, years, primary-record share, 4-axis triangulation) and the live web for its stance, quoting each side. Works both WITH and WITHOUT a Jina API key (gracefully operating in standalone Archive-Only mode when no Jina key is set). |
| `jina_rank_archive` | Archivist bridge + `api.jina.ai` / v3.5 | Reranks archive search hits against a question via Jina Reranker v3.5, or automatically falls back to offline lexical + `T1`/`T2` provenance-tier ranking when running without a Jina key. |

The archive half resolves the interpreter from `DSH_ARCHIVE_PYTHON` (explicit), then `/home/martin/dsh-plugins/dsh-archive-suite/.venv/bin/python`, `/home/martin/archive/.venv/bin/python`, `/usr/bin/python3`, `/usr/local/bin/python3`, then a `PATH` lookup; the bridge is `DSH_ARCHIVE_BRIDGE` or `/home/martin/dsh-plugins/dsh-archive-suite/bridge.py`. When `@martinm86867-ops/dsh-archive-suite` is present alongside `@martinm86867-ops/dsh-jina`, all 43 native Archive.org & Wayback Machine tools (including `archive_epistemic_dossier`, `archive_forensic_compare`, `archive_fact_check`, `wayback_read`, and `archive_iiif_image`) and the `archivist-research-agent` skill are mounted automatically.

---

## Effective Extraction & Anti-Bot Defense

Modern websites deploy aggressive mechanisms that degrade automated readers, including full-screen consent walls, soft paywalls, obfuscated CSS-in-JS class names, zero-pixel honeypots, and Cloudflare Turnstile challenges. `@martinm86867-ops/dsh-jina` v1.0 implements multi-tiered countermeasures:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    EFFECTIVE EXTRACTION PIPELINE                        │
├──────────────────────────┬──────────────────────────────────────────────┤
│ Defense Vector           │ Countermeasure / Mechanism                   │
├──────────────────────────┼──────────────────────────────────────────────┤
│ 1. CMP & Cookie Walls    │ Server-side X-Remove-Overlay: true unmounts  │
│    (OneTrust, Cookiebot) │ modal backdrops at the Chromium render layer.│
├──────────────────────────┼──────────────────────────────────────────────┤
│ 2. Scraper Honeypots &   │ X-Detach-Invisibles: true purges display:none│
│    Canary Tokens         │ zero-opacity spans and prompt injection text.│
├──────────────────────────┼──────────────────────────────────────────────┤
│ 3. Web Components &      │ X-With-Shadow-Dom: true traverses open and   │
│    Shadow DOM Roots      │ closed shadow roots (Lit, Shoelace, etc.).   │
├──────────────────────────┼──────────────────────────────────────────────┤
│ 4. Embedded Documents    │ X-With-Iframe: true inlines content inside   │
│                          │ embedded child frames into markdown.         │
├──────────────────────────┼──────────────────────────────────────────────┤
│ 5. Cloudflare Turnstile  │ callJinaWithCfBypass automatically escalates │
│    & 403/503 Challenges  │ blocked requests to cf-browser-rendering.    │
├──────────────────────────┼──────────────────────────────────────────────┤
│ 6. Air-Gapped Code /     │ Offline fallback in jina_read_file reads     │
│    Markdown Files        │ local text files directly via ctx.fs.        │
└──────────────────────────┴──────────────────────────────────────────────┘
```

---

## Extraction Presets & Configuration

The plugin provides six curated presets configurable directly in Web settings (**Plugins → Configuration → Jina Tools**) or via `@/home/martin/.dsh/settings.yaml` under `jina-tools`:

| Preset | Target Engine | Token Budget | Images | Key Characteristics |
|---|---|---|---|---|
| `balanced` (Default) | `auto` | 8,000 | `none` | High-signal extraction for daily development, docs, and search. Cleans headers, footers, ads, and CMPs. |
| `research` | `auto` | 16,000 | `alt` | Deep academic and technical investigation; generates image captions; enables Shadow DOM and iframe inlining. |
| `clean-read` | `auto` | 10,000 | `none` | Aggressive boilerplate excision; isolates strictly `article`, `main`, or `.markdown-body`. |
| `fast-index` | `auto` | 4,000 | `none` | Token-capped for rapid multi-turn search indexing and fast RAG pipelines. |
| `spa-resilient` | `browser` | 12,000 | `none` | Waits for client-side JavaScript mounting (Next.js, React, Vue, Docusaurus); traverses Shadow DOM. |
| `effective-stealth` | `cf-browser-rendering` | 12,000 | `none` | Resilient defense mode: server-side Cloudflare bypass, modal overlay removal, zero-pixel honeypot detachment, and cache bypass. |

### Complete `settings.yaml` Reference

These are the fields of the `jina-tools` entry. They live in the profile's patch for that row (the `config:` block documented in `cordis.patch.yml`), are edited from the "Jina Tools" card, and can also be seeded from a legacy `settings.yaml` section of the same name, which the harness imports into the entry on first start.

```yaml
jina-tools:
  proxyUrl: ''                        # manual local proxy address, e.g. http://127.0.0.1:7890
  defaultPreset: balanced              # balanced | research | clean-read | fast-index | spa-resilient | effective-stealth
  defaultSearchNum: 5                 # 1 to 10 search results per query
  defaultTokenBudget: 8000            # token cap per read operation
  defaultEngine: auto                 # auto | browser | curl | cf-browser-rendering
  defaultRetainImages: none           # none | alt | all
  autoBypassCloudflare: true          # automatically retries blocked requests via cf-browser-rendering
  defaultRemoveOverlay: true          # strips popups, cookie consent walls, and paywall backdrops
  defaultDetachInvisibles: true       # detaches zero-pixel honeypots, hidden text, and decoy tracking spans
  defaultWithShadowDom: false         # traverses Web Components and encapsulated shadow roots
  defaultWithIframe: false            # extracts and inlines embedded child documents
  # NOTE: a target selector is a preference. When the configured (or requested)
  # selector matches nothing, the call is retried unscoped and the returned page
  # says which selector was dropped — instead of failing with a 422.
  defaultTargetSelector: 'article, main, [role="main"], [role="article"], .markdown-body, .content, #content, .main-content, #main-content, .post-content, .article-body, .entry-content, [itemprop="articleBody"], [itemprop="text"], [data-testid*="article"], [data-testid*="content"]'
  defaultRemoveSelector: 'header, footer, nav, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .navbar, .site-header, .site-footer, .cookie-banner, #cookie-banner, .consent-banner, #onetrust-banner-sdk, #onetrust-consent-sdk, .cookiebot, #CookiebotWidget, .didomi-popup-container, .ads, .ad, .advertisement, [id^="google_ads"], [id^="ad-"], [class*="-ad-"], .sidebar, #sidebar, .aside, .social-share, .comments, #comments, .menu, .breadcrumbs, .related-posts, .author-bio, .footer-nav, .popup, .modal, .overlay, .paywall, .paywall-overlay, .premium-gate, .subscription-gate, .newsletter-signup'
```

---

## Local Proxy & Network Precedence

If your proxy client listens only on a loopback port (e.g. Clash, v2ray, Surge) without modifying the system proxy or injecting `HTTP_PROXY`, outbound requests will bypass it unless configured.

`@martinm86867-ops/dsh-jina` resolves proxies using a deterministic 5-level precedence ladder:

$$\text{Tool-level Parameter Override} \succ \text{Settings Card } (proxyUrl) \succ \text{JINA\_PROXY\_URL} \succ \text{WinINET Registry} \succ \text{Startup Environment}$$

- **Zero Restart Requirement**: Updating `proxyUrl` in the Settings panel takes effect immediately on the next tool call.
- **Protocol Safety**: Only `http://` and `https://` proxy URLs reach the Node fetch helper; invalid schemes are rejected cleanly with actionable error messages.

---

## Installation & Setup

### Install via DeepSeek Harness CLI
```sh
# Install directly from GitHub into active DSH profile
dsh plugin --profile web add github:martinm86867-ops/jina-web-search-dsh-plugin

# Restart the harness: stop the running `dsh web` and start it again
dsh web
```

The plugin may also be pointed at a local checkout while developing:
`dsh plugin --profile web add link:/path/to/jina-web-search-dsh-plugin` (the bundle row is added to the
profile's bundle list; a code change is picked up on the next start).

### Configure Credentials
1. Navigate to the Web UI $\to$ **Plugins** $\to$ **Installed** $\to$ **`@martinm86867-ops/dsh-jina`**.
2. Under **Jina Tools**, enter your API key (obtain a free key with 10M tokens from [jina.ai](https://jina.ai/)).
3. Click **Save**. The key is stored in DSH's native credential store (`JINA_API_KEY`).
4. Optionally configure a **Local Proxy** address (e.g. `http://127.0.0.1:7897`) and adjust your preferred extraction preset.

---

## Development & Testing

The plugin is architected with zero npm dependencies beyond the DSH host runtime. Testing uses the Node.js built-in test runner:

```sh
npm test
```

### Test Suite Inventory (110 Tests: 108 Run, 2 Opt-In Live)
- `test/effective-extraction.test.js`: Verifies `X-Remove-Overlay`, `X-Detach-Invisibles`, `X-With-Shadow-Dom`, `X-With-Iframe`, `callJinaWithCfBypass`, and stealth presets.
- `test/client-bundle.test.js`: Validates browser bundle syntax, Plugins-page slot registrations (`plugins.bundle.config`, `plugins.row.config`), and remote service injection contracts.
- `test/presets-defaults.test.js`: Verifies default selectors, settings normalization, and preset definitions.
- `test/tools.test.js` & `test/tools-extended.test.js`: TDD contracts for all 19 tool interfaces and JSON Schemas.
- `test/plugin-proxy.test.js`: Integration tests driving the host half through a simulated Cordis context.
- `test/primer.test.js` & `test/proxy.test.js`: Unit tests for diagnostic primer formatting and proxy address normalization.

The two skipped tests are live gates: `JINA_LIVE_FACT_CHECK=1` and `JINA_LIVE_PROXY=1` opt into real network/proxy round-trips.

---

## Repository Structure

```
jina-web-search-dsh-plugin/
├── package.json       # Manifest: bundle composition & client module exports
├── cordis.patch.yml   # Cordis composition patch inserting the @martinm86867-ops/dsh-jina row
├── index.js           # Host plugin: 19 tools, Config schema, Cloudflare auto-bypass, attachments
├── proxy.js           # Pure module: proxy precedence, presets, the `jina-tools` Config schema
├── primer.js          # Pure module: diagnostic primer formatting
├── unified.js         # Archive bridge transport (spawns the archivist's Python bridge)
├── CHANGELOG.md       # Comprehensive version history
├── LICENSE            # MIT License
├── README.md          # Comprehensive English documentation (this file)
├── docs/
│   ├── api.md         # Jina API endpoints, headers, and error codes
│   ├── agents.md      # LLM prompt engineering guide for Jina tools
│   ├── reader-api.json# Jina Reader OpenAPI specification
│   └── search-api.json# Jina Search OpenAPI specification
├── test/
│   ├── effective-extraction.test.js # Anti-bot and extraction tests
│   ├── client-bundle.test.js        # Browser bundle contract tests
│   ├── milestone5.test.js           # Local file & attachment tests
│   ├── plugin-proxy.test.js         # Proxy resolution integration tests
│   ├── presets-defaults.test.js     # Presets and selector tests
│   ├── primer.test.js               # Diagnostic primer tests
│   ├── proxy.test.js                # Proxy address normalization tests
│   ├── tools-extended.test.js       # Extended tool parameter tests
│   └── tools.test.js                # Search tool contract tests
└── ui/
    ├── package.json   # Subpackage manifest for client module exports
    ├── index.js       # Host-half stub for loader compatibility
    └── client.js      # Prebuilt browser bundle (DSH 0.1.6+ Plugins page card)
```

---

## License

Distributed under the [MIT License](./LICENSE).  
Copyright (c) 2026 minatoAI & contributors.

## Fact checking — `jina_fact_check`

*The unified search: one call, both records. It renders no verdict — it establishes what is knowable, which is what a knowledgeable finding is built on.*

Sweeps the **archive** and the **live web** together for a claim or phrase and
reports both, judging neither. The archive half gives the documentary footprint
(documents carrying the phrasing, year span, and how many sit in the primary
record) with dated, page-anchored quotes; the live half gives what retrieved
pages *do* with it — state, report, deny, mention.

The contrast is the output: heavy circulation with a thin primary record is a
finding, and neither side is a verification.

**Architecture.** The two projects stay independent. This plugin does not
reimplement archive logic — it invokes the archivist (Python) through its DSH
bridge and consumes its JSON, so there is exactly one implementation of
full-text search, the corpus and claim tracing. Paths are configurable:

| variable | default | purpose |
|---|---|---|
| `DSH_ARCHIVE_PYTHON` | the archivist venv, else `python3` | interpreter for the bridge |
| `DSH_ARCHIVE_BRIDGE` | `/home/martin/dsh-plugins/dsh-archive-suite/bridge.py` | the archivist's DSH adapter |
| `DSH_ARCHIVE_TIMEOUT_MS` | `180000` | bridge timeout |

Without the archivist the live half is returned alone, and says so.

### Archive.org API keys do not unlock restricted content

Verified: a lending-restricted item returns **401** on its text and **403** on
search-inside, both anonymously and with the S3 keys attached — identical
responses. S3 keys authorise *writes*. Reading a borrowed book requires an Open
Library session with an active borrow, which this plugin does not implement.

## Ranking archive candidates — `jina_rank_archive`

Given a research question, one archive call retrieves many candidates **with
their matched snippets**, and Jina reranks those snippets — so a large candidate
set is ordered without downloading a document. Harvest only the winners.

Measured: 40 candidates retrieved in 3.3 s, reranked in 0.3–0.5 s.

**Two limits, both reported in the output rather than hidden:**

1. **Ranking is over snippets, not full texts.** Sufficient to shortlist, not to
   conclude.
2. **Relevance is not provenance.** A document that mentions the right authority
   can outrank the record itself. Measured on *"the original Joint Chiefs of Staff
   memorandum, not a later compilation"*: scores collapse to 0.19 / 0.08 / 0.06 /
   **−0.008** and the top pick is still a compilation. A collapsed distribution is
   therefore surfaced explicitly as *"no candidate is a strong fit"* — the
   reranker cannot manufacture the document that is missing from the set, and a
   ranked list without that statement reads as an answer.

To identify the primary layer, scope the query to a collection or use
`archive_claim_trace` with `primary_only`.

**Privacy note:** this step sends the retrieved snippets to Jina's cloud for
scoring. Everything else in this workflow — retrieval, the corpus, the difference
classifier — stays local.
