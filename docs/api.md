# Jina AI API Reference: Reader & Search

This document provides a comprehensive technical reference for the **Jina Reader API** (`https://r.jina.ai/`) and **Jina Search API** (`https://s.jina.ai/`), compiled from the official OpenAPI 3.0.0 specifications (`reader-api.json` and `search-api.json`) and mapped to the `dsh-jina` plugin toolset.

---

## Table of Contents
1. [Core Endpoints & Overview](#1-core-endpoints--overview)
2. [Authentication & Request Headers](#2-authentication--request-headers)
3. [Jina Reader API (`https://r.jina.ai/`)](#3-jina-reader-api-httpsrjinai)
4. [Jina Search API (`https://s.jina.ai/`)](#4-jina-search-api-httpssjinai)
5. [Advanced Extraction & Crawling Options](#5-advanced-extraction--crawling-options)
6. [Error Codes & Diagnostics](#6-error-codes--diagnostics)
7. [Mapping to `dsh-jina` Model Tools](#7-mapping-to-dsh-jina-model-tools)

---

## 1. Core Endpoints & Overview

| Service | Base URL | Primary Purpose | Default Format |
|---|---|---|---|
| **Reader API** | `https://r.jina.ai/` | Converts any web URL or document to LLM-optimized Markdown | Markdown (`text/markdown`) or JSON |
| **Search API** | `https://s.jina.ai/{query}` | Web search returning LLM-friendly clean content and source metadata | Markdown or JSON |
| **Primer / Info** | `https://r.jina.ai/` (Root) | Rate-limit, quota, IP, and key validation probe | JSON |

Both APIs support standard HTTP `GET` and `POST` methods. `GET` accepts parameters in query strings or custom headers; `POST` accepts parameters in JSON request bodies.

---

## 2. Authentication & Request Headers

### 2.1 Authentication
- **Header**: `Authorization: Bearer <JINA_API_KEY>`
- **Anonymous Access**: Supported with shared IP rate limits and standard free quota.
- **Keyed Access**: Unlocks higher concurrency, dedicated rate limits, and credit accounting.

### 2.2 Global Control Headers
| Header | Type | Description |
|---|---|---|
| `Accept` | `string` | `application/json` for structured JSON output; `text/event-stream` for streaming. |
| `X-Proxy-Url` | `string` | Custom proxy URL (e.g. `http://127.0.0.1:7897`) for egress. |
| `X-No-Cache` | `boolean` | Bypass Jina cache and force a live crawl. |
| `X-Timeout` | `integer` | Request timeout in seconds (1–180s). |
| `X-Token-Budget` | `integer` | Cap response payload to a specified token count. |

---

## 3. Jina Reader API (`https://r.jina.ai/`)

Converts any URL, raw HTML, PDF, or uploaded document into clean, LLM-ready markdown or structured data.

### 3.1 Primary Request Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | *Required* | Target URL to read (or path append: `https://r.jina.ai/https://example.com`). |
| `respondWith` | `enum` | `content` | Output format: `content`, `markdown`, `html`, `text`, `pageshot`, `screenshot`, `vlm`, `readerlm-v2`, `frontmatter`. |
| `preset` | `enum` | — | Tuning presets: `reader`, `index`, `research`, `agent`, `spider`, `ocr`, `ocr+`, `ocr++`, `pdf`, `pdf+`, `pdf++`. |
| `retainImages` | `enum` | `all` | Image handling: `none`, `all`, `alt`, `all_p`, `alt_p`. |
| `retainMedia` | `enum` | `link` | Media elements: `none`, `text`, `link`, `image`, `html`. |
| `retainLinks` | `enum` | `all` | Link retention: `none`, `all`, `text`, `gpt-oss`. |
| `withGeneratedAlt` | `boolean` | `false` | Use VLM to generate descriptive alt-text for images lacking captions. |
| `withLinksSummary` | `boolean` | `false` | Append a consolidated list of all discovered URLs at the end of output. |
| `withImagesSummary` | `boolean` | `false` | Append a consolidated list of all image URLs at the end of output. |

### 3.2 DOM Extraction & Cleanup
- **`targetSelector`**: CSS selector(s) to isolate specific page elements (e.g. `article`, `.main-content`).
- **`waitForSelector`**: Wait until a CSS selector appears before extraction (useful for SPAs).
- **`removeSelector`**: Remove unwanted elements (e.g. `.cookie-banner`, `nav`, `footer`).
- **`removeOverlay`** (`X-Remove-Overlay`): Excises modal overlays, consent popups, and paywall backdrops at the Chromium render layer.
- **`detachInvisibles`** (`X-Detach-Invisibles`): Detaches zero-pixel honeypots, hidden decoy elements, and scraper tracking traps.
- **`withIframe`** (`X-With-Iframe`): Inlines embedded iframe document content.
- **`withShadowDom`** (`X-With-Shadow-Dom`): Traverses and extracts content from open/closed Shadow DOM boundaries.
- **`cookies`** (`X-Set-Cookie`): Injects session cookies for authenticated requests and paywall bypass.

---

## 4. Jina Search API (`https://s.jina.ai/{query}`)

Combines web search with Reader extraction, returning full, clean markdown for the top search results in a single round-trip.

### 4.1 Primary Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` / Path | `string` | *Required* | Search query. |
| `page` | `number` | `1` | Pagination offset. |
| `engine` | `enum` | `google` | Search backend: `google`, `bing`, `reader`. |
| `time` / `t` | `enum` | — | Time filter: `h` (hour), `d` (day), `w` (week), `m` (month), `y` (year). |
| `loc` / `gl` | `string` | — | Country code filter (e.g. `us`, `de`, `jp`, `cn`). |
| `hl` | `string` | — | Language code (ISO 639-1, e.g. `en`, `zh-cn`). |
| `site` | `string` | — | Restrict results to a specific domain (e.g. `site:github.com`). |

### 4.2 Search Query Operators
Jina Search supports Google-style explicit operators:
- `site:<domain>`: Restrict search to domain.
- `intitle:<word>`: Require term in title.
- `filetype:<ext>` or `ext:<ext>`: Restrict by file extension (e.g. `filetype:pdf`).
- `lang:<code>`: Language restriction.

---

## 5. Advanced Extraction & Crawling Options

### 5.1 OCR & PDF Processing
- **`preset: ocr++`**: End-to-end multi-modal OCR for scanned PDFs, presentation slides, and charts.
- **`inlineFormula` / `blockFormula`**: Convert LaTeX mathematical notation into clean math blocks.
- **`table`**: Structure tabular raster blocks into Markdown tables.
- **`page`**: 1-indexed page selector for multi-page PDF documents.

### 5.2 Browser Execution & Anti-Bot Bypassing
- **`engine`**: `auto` (default), `browser` (headless Chromium), `curl` (fast HTTP), or `cf-browser-rendering` (Cloudflare anti-bot bypass).
- **`cookies` / `setCookies`**: Pass session cookies to access authenticated pages.
- **`storageState`**: Import Playwright/Puppeteer storage state JSON (cookies + localStorage).
- **`userAgent`**: Custom HTTP user agent override.

---

## 6. Error Codes & Diagnostics

Jina APIs return standard HTTP status codes supplemented by application error codes in `error.status`:

| HTTP Code | App Code | Error Name | Cause & Remediation |
|---|---|---|---|
| `400` | `40001` | `ParamValidationError` | Invalid query parameter or malformed request body. |
| `400` | `40003` | `DataStreamBrokenError` | Upstream connection dropped mid-transfer. |
| `401` | `40102` | `AuthenticationFailedError` | Invalid or expired `JINA_API_KEY`. |
| `401` | `40103` | `AuthenticationRequiredError` | Anonymous limit exceeded; API key required. |
| `402` | `40202` | `TierFeatureConstraintError` | Feature (e.g. `cf-browser-rendering`) requires higher account tier. |
| `402` | `40203` | `InsufficientBalanceError` | Account ran out of credits. |
| `403` | `40301` | `OperationNotAllowedError` | Target domain blocked or disallowed by policy. |
| `403` | `40305` | `AbuseAlleviationError` | Anti-abuse rate limiting triggered. |
| `404` | `40401` | `ResourceNotFoundError` | Target URL returned 404 or does not exist. |
| `413` | `41302` | `TargetFileTooLargeError` | Target page or PDF exceeded size bounds. |
| `429` | `42903` | `RateLimitTriggeredError` | Concurrency or requests-per-minute exceeded (`Retry-After` header present). |
| `500` | `50002` | `DownstreamServiceError` | Target server returned an unrecoverable 5xx error. |
| `503` | `50303` | `ServiceNodeResourceDrainError` | Worker node pool under transient high load. |

---

## 7. Mapping to `dsh-jina` Model Tools

The `dsh-jina` plugin (`index.js`) exposes twelve specialized model tools backed by these APIs:

| Tool Name | Backend API | Key Parameters | Model Purpose |
|---|---|---|---|
| `jina_web_search` | `https://s.jina.ai/{q}` | `query`, `type`, `time`, `gl`, `hl` | Current web and news search with official sources ranked first. |
| `jina_search_arxiv` | `https://s.jina.ai/{q}` | `query`, `time`, `num` | Direct academic paper discovery on arXiv. |
| `jina_search_ssrn` | `https://s.jina.ai/{q}` | `query`, `time`, `num` | Social Science Research Network paper search. |
| `jina_read` | `https://r.jina.ai/{url}` | `url`, `targetSelector`, `waitForSelector` | Full webpage text and article extraction in Markdown. |
| `jina_screenshot` | `https://r.jina.ai/{url}` | `url`, `respondWith: screenshot` | Visual raster capture of full web pages. |
| `jina_pdf` | `https://r.jina.ai/` | `url`, `pdf`, `page`, `preset: ocr++` | Native PDF reading with OCR formula and table extraction. |
| `jina_datetime` | `https://r.jina.ai/` | — | Real-time UTC and timezone calibration probe. |
| `jina_expand` | `https://s.jina.ai/` | `query` | Query expansion into related sub-queries for broad research. |
| `jina_embed` | `https://api.jina.ai/v1/embeddings` | `input`, `model` | Dense semantic vector generation. |
| `jina_rerank` | `https://api.jina.ai/v1/rerank` | `query`, `documents`, `top_n` | Cross-encoder relevance re-ranking for search hits. |
| `jina_classify` | `https://api.jina.ai/v1/classify` | `input`, `labels` | Zero-shot semantic text classification. |
| `jina_primer` | `https://r.jina.ai/` | — | Diagnostic tool: checks remaining credits, identity, and proxy connectivity. |
