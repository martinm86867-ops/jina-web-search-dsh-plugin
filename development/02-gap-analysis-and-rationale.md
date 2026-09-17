# 02. Gap Analysis & Rationale: What is Missing and Why It Matters

This document articulates the functional and architectural gaps between `dsh-jina` v0.6.1 and the official Jina OpenAPI specifications (`reader-api.json` and `search-api.json`). It explains **what** needs to be built and **why** each capability is critical to autonomous software engineering agents.

---

## 1. Structured Schema Extraction (`jina_extract`)

### What is Missing
The OpenAPI specifications expose two powerful parameters on `POST /` and `POST /search`:
- `instruction`: Natural language extraction guidance (e.g., *"Extract library name, latest release version, and breaking changes"*).
- `jsonSchema`: A standard JSON Schema defining the required output structure.

Currently, `dsh-jina` has no tool or parameter to trigger structured extraction.

### Why It Matters (The Rationale)
1. **Dramatic Token Economics**:
   - In standard `jina_read`, scraping a documentation page consumes **10,000 to 40,000 tokens** of raw markdown, which fills the agent's turn context window.
   - With `jina_extract`, Jina's server-side ReaderLM-v2 model extracts the information and returns **only the requested JSON object (~100–300 tokens)**.
   - **Result**: Up to 95% reduction in turn token consumption, lowering inference costs and preventing premature context compaction.
2. **Deterministic Output vs. Hallucinated Formats**:
   - Asking a general model to read 40 pages of raw HTML and output JSON often results in missing fields, markdown wrapper formatting (`json`), or hallucinated keys.
   - Server-side extraction guarantees strict conformance to the provided JSON Schema before returning to the harness.

---

## 2. Precision DOM Extraction & SPA Support on `jina_read`

### What is Missing
The Reader API supports precision DOM manipulation parameters that `jina_read` completely ignores:
- `targetSelector`: Extracts only elements matching CSS selectors (e.g., `article`, `.markdown-body`).
- `waitForSelector`: Pauses extraction until a specified selector mounts in the DOM.
- `removeSelector`: Strips elements matching CSS selectors (e.g., `.cookie-banner`, `header`, `footer`).

### Why It Matters (The Rationale)
1. **The SPA Blank-Page Problem**:
   - Modern documentation sites (React, Next.js, VitePress, Docusaurus) render content asynchronously via client-side JavaScript.
   - Without `waitForSelector`, a standard HTTP scrape frequently captures the pre-render HTML skeleton:
     ```html
     <div id="root">Loading application...</div>
     ```
   - The agent reads this, concludes the page is empty or broken, and fails the task.
2. **Signal-to-Noise Ratio**:
   - Web pages are 70% boilerplate: global navigation bars, sponsor banners, tracking footers, and cookie consents.
   - Passing `targetSelector: "article"` strips 100% of the peripheral boilerplate, presenting the agent with only load-bearing technical prose.

---

## 3. Parallel Multi-Query Search (`jina_search_batch`)

### What is Missing
`search-api.json` exposes batch query execution on `POST /search`, but `jina_web_search` currently takes only a single string query: `query: string`.

### Why It Matters (The Rationale)
1. **Latency in Multi-Faceted Research**:
   - Complex technical bugs are rarely solved by one query. An agent typically needs to investigate:
     - Query 1: Exact error message.
     - Query 2: Package version and migration guide.
     - Query 3: GitHub repository issue tracker.
   - With single-query tools, the agent must run **three sequential turns** (Turn 1 → search 1 → LLM response → Turn 2 → search 2 → LLM response → Turn 3). Each turn adds 5–15 seconds of roundtrip latency.
   - A batch search tool (`queries: string[]`) resolves all search vectors in a single turn, reducing research wall-clock time from 45 seconds to 4 seconds.
2. **Consistency with DSH Core Conventions**:
   - The built-in DeepSeek Harness tool `web_search` accepts `queries: string[]` (1 to 5 queries). `dsh-jina` should provide drop-in parity.

---

## 4. Hierarchical Semantic Chunking (`jina_chunk`)

### What is Missing
`reader-api.json` defines `markdownChunking: "h1" | "h2" | "h3" | "structured"`. The API can return an array of semantic chunks (`chunks: string[]`) rather than one monolithic markdown string.

### Why It Matters (The Rationale)
1. **Context Window Overflows**:
   - Comprehensive RFCs, SQLite specifications, or multi-chapter guides often exceed 150,000 words.
   - Attempting to return the entire document in one tool result exceeds model context limits or triggers extreme compaction penalties.
2. **Hierarchical Exploration**:
   - With chunking, an agent can request `markdownChunking: "h2"`: Jina returns an indexed table of headings and summaries.
   - The agent then selectively retrieves only chunk #4 and chunk #7, navigating huge technical repositories with surgical precision.

---

## 5. Local Workspace File & Document Ingestion (`jina_read_file`)

### What is Missing
The Reader API supports base64 file payloads (`pdf`, `file` using `FancyFile`) and ephemeral file endpoints (`/ephemeral/{encodedFid}`). Currently, `jina_read` and `jina_pdf` enforce a strict regex requiring URLs to begin with `http://` or `https://`:

```javascript
if (!/^https?:\/\//i.test(String(args.url))) return 'invalid url...'
```

### Why It Matters (The Rationale)
1. **Local Repository Documents**:
   - Software repositories frequently contain local design PDFs (`docs/specs/architecture.pdf`), offline HTML mockups, or exported spreadsheets.
   - Currently, an agent inside DeepSeek Harness has no native tool to read a local PDF with OCR, formula recognition, and table formatting.
2. **Security & Privacy**:
   - Developers cannot and should not upload proprietary internal design documents to public web servers just to obtain an HTTP URL for Jina.
   - Supporting `file_path` allows `dsh-jina` to read the file from the local workspace via `ctx.fs.readBinary`, encode it, and send it directly to Jina's ephemeral ingestion endpoint under the user's authenticated session.

---

## 6. DeepSeek Harness `AttachmentStore` Integration

### What is Missing
When `jina_screenshot` captures a webpage, it currently returns a remote URL or markdown image string.

### Why It Matters (The Rationale)
- In DeepSeek Harness, multimodal vision models (such as DeepSeek-VL or GPT-4o) do not fetch external image URLs from tool results during request assembly.
- They inspect images that have been recorded into the session's **`AttachmentStore`** (`SavedImageAttachment`), which manages downscaling, format normalization (WebP/PNG), and byte budgets.
- By saving screenshots directly into `ctx.attachment.saveImage()`, the captured raster becomes immediately visible to multimodal agents on the very next turn.
