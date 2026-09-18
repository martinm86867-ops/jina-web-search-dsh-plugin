# dsh-jina

**Comprehensive Web Intelligence, High-Signal Extraction & Dense Reasoning Suite for DeepSeek Harness**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/Tests-88%20passing-brightgreen.svg)](./test)
[![DeepSeek Harness](https://img.shields.io/badge/DSH-0.1.6%2B-purple.svg)](https://github.com/deepseek-ai/deepseek-harness)

A production-grade, zero-npm-dependency DeepSeek Harness (DSH) bundle that delivers the full power of [Jina AI](https://jina.ai/) directly into model sessions. Equipped with 16 model-facing tools, six customizable extraction presets, automated Cloudflare Turnstile bypass, and native browser settings integration on modern DSH Plugins pages.

---

## Origin & Acknowledgments

This project is an extensive architectural evolution of the original [jina-web-search-dsh-plugin](https://github.com/minatoAI/jina-web-search-dsh-plugin) created by **minatoAI**. 

While retaining the rock-solid proxy precedence and isolated subprocess transport pioneered by the original author, this edition heavily enhances the suite to version 1.0.0 with:
- Expansion from 12 tools to a complete 16-tool intelligence suite.
- Effective content extraction layers (`X-Remove-Overlay`, `X-Detach-Invisibles`, `X-With-Shadow-Dom`, `X-With-Iframe`).
- Re-architected settings integration supporting DeepSeek Harness $\ge 0.1.6$ first-class plugin slots (`plugins.bundle.config` and `plugins.row.config`).
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
        │ 16 Model-Facing Tools   │               │ DSH >= 0.1.6 Plugin Slot│
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
2. **First-Class Plugins Page Integration**: Natively registers into DSH 0.1.6+ `plugins.bundle.config` (bundle page) and `plugins.row.config` (row configuration page), while maintaining backwards compatibility with legacy `settings.plugin.item`.
3. **Multi-Tier Service Bus**: Settings and credentials resolve seamlessly across four progressive tiers (`props` $\to$ `ctx.get('remote.*')` $\to$ `remote.*` $\to$ connection API), guaranteeing dependable persistence to `settings.yaml`.

---

## 16-Tool Intelligence Catalog

Every model session receives access to 16 specialized `jina_*` tools:

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
| `jina_fact_check` | Search evidence + evaluator | Verifies a claim against retrieved web evidence, returning SUPPORTED / REFUTED / MIXED / UNKNOWN. UNKNOWN is returned whenever evidence is insufficient, attribution-only or contradictory; the sources behind every verdict are always included. (`g.jina.ai` Grounding is the fallback when search yields nothing usable.) |
| `jina_embed` | `api.jina.ai` / v5 | Dense text embeddings with Matryoshka dimension scaling (default: `jina-embeddings-v5-text-small`). |
| `jina_rerank` | `api.jina.ai` / v3.5 | Document relevance reranking against a target query (default: `jina-reranker-v3.5`). |
| `jina_classify` | `api.jina.ai` / Classify | Zero-shot text classification into candidate label categories. |
| `jina_datetime` | `r.jina.ai` | Publication and modification timestamp estimation for any URL. |
| `jina_primer` | Diagnosis / Probe | Current environment context: host clock, public IP/location, active proxy, and Jina credit balance. |

---

## Effective Extraction & Anti-Bot Defense

Modern websites deploy aggressive mechanisms that degrade automated readers, including full-screen consent walls, soft paywalls, obfuscated CSS-in-JS class names, zero-pixel honeypots, and Cloudflare Turnstile challenges. `dsh-jina` v1.0 implements multi-tiered countermeasures:

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

```yaml
jina-tools:
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
  defaultTargetSelector: 'article, main, [role="main"], [role="article"], .markdown-body, .content, #content, .main-content, #main-content, .post-content, .article-body, .entry-content, [itemprop="articleBody"], [itemprop="text"], [data-testid*="article"], [data-testid*="content"]'
  defaultRemoveSelector: 'header, footer, nav, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .navbar, .site-header, .site-footer, .cookie-banner, #cookie-banner, .consent-banner, #onetrust-banner-sdk, #onetrust-consent-sdk, .cookiebot, #CookiebotWidget, .didomi-popup-container, .ads, .ad, .advertisement, [id^="google_ads"], [id^="ad-"], [class*="-ad-"], .sidebar, #sidebar, .aside, .social-share, .comments, #comments, .menu, .breadcrumbs, .related-posts, .author-bio, .footer-nav, .popup, .modal, .overlay, .paywall, .paywall-overlay, .premium-gate, .subscription-gate, .newsletter-signup'
```

---

## Local Proxy & Network Precedence

If your proxy client listens only on a loopback port (e.g. Clash, v2ray, Surge) without modifying the system proxy or injecting `HTTP_PROXY`, outbound requests will bypass it unless configured.

`dsh-jina` resolves proxies using a deterministic 5-level precedence ladder:

$$\text{Tool-level Parameter Override} \succ \text{Settings Card } (proxyUrl) \succ \text{JINA\_PROXY\_URL} \succ \text{WinINET Registry} \succ \text{Startup Environment}$$

- **Zero Restart Requirement**: Updating `proxyUrl` in the Settings panel takes effect immediately on the next tool call.
- **Protocol Safety**: Only `http://` and `https://` proxy URLs reach the Node fetch helper; invalid schemes are rejected cleanly with actionable error messages.

---

## Installation & Setup

### Install via DeepSeek Harness CLI
```sh
# Install directly from GitHub into active DSH profile
dsh plugin add https://github.com/martinm86867-ops/jina-web-search-dsh-plugin.git

# Restart DeepSeek Harness to load the bundle
dsh restart
```

### Configure Credentials
1. Navigate to the Web UI $\to$ **Plugins** $\to$ **Installed** $\to$ **dsh-jina**.
2. Under **Jina Tools**, enter your API key (obtain a free key with 10M tokens from [jina.ai](https://jina.ai/)).
3. Click **Save**. The key is stored in DSH's native credential store (`JINA_API_KEY`).
4. Optionally configure a **Local Proxy** address (e.g. `http://127.0.0.1:7897`) and adjust your preferred extraction preset.

---

## Development & Testing

The plugin is architected with zero npm dependencies beyond the DSH host runtime. Testing uses the Node.js built-in test runner:

```sh
npm test
```

### Test Suite Inventory (88 Tests Total)
- `test/effective-extraction.test.js`: Verifies `X-Remove-Overlay`, `X-Detach-Invisibles`, `X-With-Shadow-Dom`, `X-With-Iframe`, `callJinaWithCfBypass`, and stealth presets.
- `test/client-bundle.test.js`: Validates browser bundle syntax, DSH 0.1.6+ slot registrations (`plugins.bundle.config`, `plugins.row.config`), and remote service injection contracts.
- `test/presets-defaults.test.js`: Verifies default selectors, Schemastery normalization, and preset definitions.
- `test/tools.test.js` & `test/tools-extended.test.js`: TDD contracts for all 16 tool interfaces and JSON Schemas.
- `test/plugin-proxy.test.js`: Integration tests driving the host half through a simulated Cordis context.
- `test/primer.test.js` & `test/proxy.test.js`: Unit tests for diagnostic primer formatting and proxy address normalization.

---

## Repository Structure

```
jina-web-search-dsh-plugin/
├── package.json       # Manifest: bundle composition & client module exports
├── cordis.patch.yml   # Cordis composition patch inserting dsh-jina row
├── index.js           # Host plugin: 16 tools, Cloudflare auto-bypass, attachments
├── proxy.js           # Pure module: proxy precedence, presets, Schemastery schema
├── primer.js          # Pure module: diagnostic primer formatting
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
