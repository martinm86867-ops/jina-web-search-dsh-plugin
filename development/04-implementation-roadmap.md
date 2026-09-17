# 04. Implementation Roadmap: Phased Execution Plan

This document details the milestone-driven execution plan for upgrading `dsh-jina` from v0.6.1 to v1.0.0, prioritizing high-leverage capabilities first while ensuring continuous backwards compatibility.

---

## Milestone Timeline & Dependencies

```text
Milestone 1: Core Tool Parameter Expansion (Existing tools)
    │
    ▼
Milestone 2: Structured Schema Extraction (`jina_extract`)
    │
    ▼
Milestone 3: Parallel Multi-Query Search (`jina_search_batch`)
    │
    ▼
Milestone 4: Semantic Document Chunking (`jina_chunk`)
    │
    ▼
Milestone 5: Local File Ingestion (`jina_read_file`) & Attachment Store
    │
    ▼
Milestone 6: Test Suite Hardening, Documentation & Release
```

---

## Milestone 1: High-Impact Parameter Expansions (Existing Tools)
**Focus**: Unlock latent OpenAPI capabilities in `jina_read`, `jina_web_search`, and `jina_pdf` with zero breaking changes.

### Deliverables:
1. **Enhance `jina_read`**:
   - `targetSelector`: CSS selector array/string (`X-Target-Selector`).
   - `waitForSelector`: Wait timer selector for SPAs (`X-Wait-For-Selector`).
   - `removeSelector`: Unwanted element stripper (`X-Remove-Selector`).
   - `tokenBudget`: Hard cap on returned token size (`X-Token-Budget`).
   - `engine`: Support `cf-browser-rendering` to bypass Cloudflare turnstile (`X-Engine`).
   - `noCache`: Bypass CDN cache (`X-No-Cache`).
2. **Enhance `jina_web_search`**:
   - `site`: Domain restriction filter.
   - `filetype`: File extension filter (`pdf`, `doc`, `csv`).
   - `intitle`: Require terms in page headline.
   - `engine`: Support `google`, `bing`, `reader`.
   - `nfpr`: Disallow misspelled query auto-correction.
3. **Enhance `jina_pdf`**:
   - `preset`: Enable `ocr++` for scanned raster documents.
   - `inlineFormula` / `blockFormula`: LaTeX math block conversion.
   - `table`: Preserve tabular markdown formatting.
4. **Verification**:
   - Add unit tests in `test/tools.test.js` validating parameter-to-header mappings.
   - Run `npm test` verifying 100% pass rate.

---

## Milestone 2: Server-Side Schema Extraction (`jina_extract`)
**Focus**: Eliminate model context bloat by having Jina's ReaderLM extract structured JSON on the server.

### Deliverables:
1. **Tool Definition**:
   ```javascript
   name: 'jina_extract',
   parameters: {
     url: { type: 'string', required: true },
     instruction: { type: 'string', required: true, description: 'Extraction guidance' },
     schema: { type: 'object', required: true, description: 'Target JSON Schema' },
     apiKey: { type: 'string' }
   }
   ```
2. **Transport Serialization**:
   - Send `POST https://r.jina.ai/` with JSON body `{ url, instruction, jsonSchema }` and `Accept: application/json`.
3. **Error Handling**:
   - Handle `ParamValidationError` (40001) and schema mismatch gracefully.
4. **Verification**:
   - Unit test simulating mock schema extraction response.

---

## Milestone 3: Parallel Multi-Query Search (`jina_search_batch`)
**Focus**: Enable agents to investigate multiple hypotheses in parallel in a single turn.

### Deliverables:
1. **Tool Definition**:
   ```javascript
   name: 'jina_search_batch',
   parameters: {
     queries: {
       type: 'array',
       items: { type: 'string' },
       required: true,
       description: '1 to 5 distinct search queries to execute in parallel'
     },
     time: { type: 'string', enum: ['h', 'd', 'w', 'm', 'y'] },
     gl: { type: 'string' },
     hl: { type: 'string' }
   }
   ```
2. **Concurrent Dispatch**:
   - Execute sub-queries concurrently via `Promise.all` inside the subprocess transport.
   - Return structured, query-attributed search hits grouped by input query.
3. **Verification**:
   - Test verifying concurrent resolution and result grouping.

---

## Milestone 4: Hierarchical Semantic Chunking (`jina_chunk`)
**Focus**: Enable navigation of large specifications, RFCs, and manuals without context overflow.

### Deliverables:
1. **Tool Definition**:
   ```javascript
   name: 'jina_chunk',
   parameters: {
     url: { type: 'string', required: true },
     chunkBy: { type: 'string', enum: ['h1', 'h2', 'h3', 'structured'], default: 'h2' },
     tokenBudget: { type: 'number' }
   }
   ```
2. **Response Formatting**:
   - Map `chunks: string[]` from the API into an indexed array with title headers and character counts.
3. **Verification**:
   - Test verifying chunk splitting and indexing.

---

## Milestone 5: Local File Ingestion & Attachment Integration
**Focus**: Bridge local workspace repository files and native DeepSeek Harness multimodal attachments.

### Deliverables:
1. **Local File Reader (`jina_read_file`)**:
   - Inject `ctx.fs`.
   - Read local files (`.pdf`, `.html`, `.docx`) using `ctx.fs.readBinary`.
   - Base64 encode and transmit as `FancyFile` to `POST https://r.jina.ai/`.
2. **AttachmentStore Integration for `jina_screenshot`**:
   - Inject optional `ctx.attachment`.
   - When screenshot capture succeeds, store raw PNG bytes into `ctx.attachment.saveImage()` to produce a `SavedImageAttachment`.
   - Return both the markdown link and the durable attachment reference for multimodal agents.
3. **Verification**:
   - Test reading local file fixtures and validating base64 payload construction.

---

## Milestone 6: Quality Assurance, Documentation & Release
**Focus**: Full regression audit and production deployment.

### Deliverables:
1. **Regression Testing**:
   - Expand `test/` suite to cover all 16 tools, ensuring 100% test passage.
2. **Documentation**:
   - Update `README.md` and `README.en.md` with complete tool catalogs, examples, and when-to-use triggers.
   - Synchronize `docs/api.md` with release notes.
3. **Release Tag**:
   - Bump version to `1.0.0` in `package.json`.
