# 01. Current State Audit: `dsh-jina` v0.6.1

This document provides a comprehensive inventory and architectural audit of `dsh-jina` as it exists today, covering its host plugin, transport layer, proxy resolution, credential management, browser UI, and tool catalog.

---

## 1. Package Architecture

`dsh-jina` is structured as a dual-face package linking into DeepSeek Harness profiles:

```text
jina-web-search-dsh-plugin/
├── package.json         # Package configuration & DSH client/bundle metadata
├── cordis.patch.yml     # Host patch row mounting `jina-tools`
├── index.js             # Host plugin: registers 12 model tools & settings schema
├── proxy.js             # Multi-tier outbound proxy resolution
├── primer.js            # Primer probe and diagnostics builder
├── tool-contracts.js    # Model-visible parameters for web search
├── ui/
│   ├── client.js        # Browser bundle: renders Jina Tools settings card
│   └── index.js         # Client host-half stub
└── test/                # Node --test regression test suite (68 tests)
```

---

## 2. Host Plugin & Runtime Services (`index.js`)

- **Cordis Service Injections**: `inject = ['fs', 'subprocess', 'tools']`
- **Optional Service Consumptions**:
  - `ctx.get('credentials')`: Resolves `JINA_API_KEY` per operation from the host credential store.
  - `ctx.get('settings')`: Serves the `jina-tools` settings namespace for manual proxy configuration (`proxyUrl`).
  - `ctx.get('webServer')`: Taps web routes for diagnostics.

### Subprocess Network Transport
- Rather than importing external dependencies or using Node `fetch` (which bypasses custom loopback proxy configurations and system registries), `dsh-jina` executes network requests through `ctx.subprocess`:
- A lightweight CommonJS worker is executed via `node -e` that uses Node's native `node:http` and `node:https`.
- It reads a JSON payload from `stdin` (`url`, `method`, `headers`, `body`, `proxy`, `timeoutMs`) and writes JSON results to `stdout`.
- This ensures clean timeout cancellation (`AbortSignal`), proxy routing, and zero pollution of the main harness event loop.

---

## 3. Proxy Resolution Hierarchy (`proxy.js`)

To accommodate developers operating in restricted network environments (e.g. Mainland China, enterprise corporate firewalls, or local VPN sidecars):

1. **Card Setting (`proxyUrl`)**: Manually configured address in Settings → Plugins → Jina Tools (saved in `settings.yaml`).
2. **Environment Variable (`JINA_PROXY_URL`)**: Fallback for headless CLI environments.
3. **Windows WinINET Discovery**: Auto-detects system proxies via native registry inspection; self-heals across port changes.
4. **Process Environment**: Inherited `HTTP_PROXY` / `HTTPS_PROXY`.
5. **Direct Connection**: Used when no proxy is detected or required.

---

## 4. Current Tool Inventory (12 Tools)

| Tool Name | Parameters | Capabilities | Limitations |
|---|---|---|---|
| `jina_web_search` | `query`, `type`, `num`, `time`, `location`, `gl`, `hl`, `json`, `apiKey` | Searches web via `s.jina.ai`; ranks official domains first; time filtering. | Single query only; cannot filter by filetype or site without manual query hacks. |
| `jina_search_arxiv` | `query`, `time`, `num`, `json`, `apiKey` | Targets arXiv academic papers. | Hardcoded shortcut; lacks author, category, or citation filters. |
| `jina_search_ssrn` | `query`, `time`, `num`, `json`, `apiKey` | Targets SSRN academic papers. | Hardcoded shortcut; no field-specific query filtering. |
| `jina_read` | `url`, `links`, `images`, `json`, `apiKey` | Converts URL to Markdown via `r.jina.ai`. | No DOM selectors, no SPA wait timers, no token budgeting, no anti-bot engine options. |
| `jina_screenshot` | `url`, `apiKey` | Captures webpage screenshot via `r.jina.ai`. | Returns URL/Markdown text only; does not save into DSH `AttachmentStore`. |
| `jina_datetime` | `apiKey` | Returns server UTC time, day of week, and timezone offset. | Read-only diagnostic probe. |
| `jina_expand` | `query`, `apiKey` | Generates 3–5 related sub-queries for query expansion. | Text array only; does not execute the expanded queries. |
| `jina_embed` | `input` (string or array), `model`, `apiKey` | Generates dense vector embeddings via Jina Embeddings API. | Basic single-call vector return; no cosine similarity or search helpers. |
| `jina_rerank` | `query`, `documents` (array), `top_n`, `model`, `apiKey` | Cross-encoder relevance re-ranking of text documents. | Requires agent to pass raw text array in tool arguments. |
| `jina_classify` | `input` (array), `labels` (array), `model`, `apiKey` | Zero-shot text classification. | Text-only classification. |
| `jina_pdf` | `url`, `apiKey` | Extracts text from online PDF files. | Online URLs only; cannot read local PDFs; no formula or table OCR controls. |
| `jina_primer` | `json`, `apiKey` | Probes account balance, key validity, IP, and proxy connectivity. | System diagnostic tool. |

---

## 5. Strengths and Current Architectural Bottlenecks

### Key Strengths:
- **Resilient Transport**: Outbound calls execute in isolated subprocesses that respect proxy rules without hanging the host process.
- **Fail-Safe Credentials**: Resolves keys from credential stores, workspace files, or environment variables.
- **High Test Coverage**: 68 unit and contract tests verifying proxy parsing, error formatting, and tool schemas.

### Critical Bottlenecks:
1. **Context Window Waste**: All web pages and search results are returned as raw full-page Markdown. For long technical documentation (100k+ tokens), this blows the agent's context window.
2. **Brittle SPA Scraping**: Modern React/Vue applications render client-side. Because `jina_read` lacks `waitForSelector` or `targetSelector`, scraping often returns empty `<div id="root"></div>` shells.
3. **Sequential Research Latency**: Investigating complex engineering problems requires multiple search angles. `jina_web_search` forces the agent into serial turn-by-turn roundtrips.
4. **Air-Gapped Document Inaccessibility**: Local workspace files (`.pdf`, `.html`, `.docx`) cannot be parsed because tools only accept `http(s)://` URLs.
