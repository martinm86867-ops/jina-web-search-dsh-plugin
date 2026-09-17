# 03. Target Architecture: `dsh-jina` v1.0

This document defines the target architectural blueprint for `dsh-jina` v1.0, establishing a modular design that scales across all Jina API capabilities while honoring the DeepSeek Harness plugin and security model.

---

## 1. Architectural Principles

1. **Zero Host Event-Loop Blocking**: All network I/O, proxy connections, and TLS handshakes must run inside isolated worker subprocesses via `ctx.subprocess`. The main DSH Cordis loop never executes external network fetch directly.
2. **First-Class Harness Seam Integration**:
   - Filesystem: Use `ctx.fs` to resolve and read local workspace files.
   - Credentials: Use `ctx.get('credentials')` per operation (never cache API keys across turns).
   - Attachments: Use `ctx.get('attachment')` to store screenshots as native DSH image attachments.
3. **Strict JSON-Schema Tool Contracts**: Every tool parameter must be statically typed, fully documented with task-first descriptions, and optimized for both standard JSON tool-calling and Code Mode (PTC).
4. **Resilient Network Degradation**: Graceful fallbacks from manual proxies to system proxies to direct connections, accompanied by actionable error diagnostics.

---

## 2. Target Component Diagram

```text
DeepSeek Harness Process (Node.js)
┌────────────────────────────────────────────────────────────────────────┐
│ dsh-jina (Cordis Plugin)                                               │
│                                                                        │
│  ┌───────────────────┐    ┌───────────────────┐   ┌─────────────────┐ │
│  │   Search Family   │    │   Reader Family   │   │  AI / Embed     │ │
│  │ - jina_web_search │    │ - jina_read       │   │ - jina_embed    │ │
│  │ - jina_search_batch│   │ - jina_read_file  │   │ - jina_rerank   │ │
│  │ - jina_search_arxiv│   │ - jina_extract    │   │ - jina_classify │ │
│  │ - jina_search_ssrn│    │ - jina_chunk      │   │                 │ │
│  │ - jina_expand     │    │ - jina_screenshot │   │ - jina_datetime │ │
│  │                   │    │ - jina_pdf        │   │ - jina_primer   │ │
│  └─────────┬─────────┘    └─────────┬─────────┘   └────────┬────────┘ │
│            │                        │                      │          │
│            └────────────────────────┼──────────────────────┘          │
│                                     ▼                                 │
│                       ┌───────────────────────────┐                   │
│                       │    Jina Client Core       │                   │
│                       │ - Proxy Resolution        │                   │
│                       │ - Credential Seam Binding │                   │
│                       │ - Error Code Mapping      │                   │
│                       └─────────────┬─────────────┘                   │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │ ctx.subprocess Worker     │
                        │ (Isolated Node Transport) │
                        └─────────────┬─────────────┘
                                      │ HTTP / HTTPS
                                      ▼
                        ┌───────────────────────────┐
                        │      Jina AI APIs         │
                        │  r.jina.ai  |  s.jina.ai  │
                        │      api.jina.ai          │
                        └───────────────────────────┘
```

---

## 3. Tool Suite Taxonomy (16 Tools)

### A. Web Search & Intelligence
1. **`jina_web_search`**: Single query web search with official-source-first ranking, time filters (`h/d/w/m/y`), and language/location targeting.
2. **`jina_search_batch`** *(NEW)*: Parallel multi-query search accepting `queries: string[]` to resolve multiple research vectors in a single turn.
3. **`jina_search_arxiv`**: Direct arXiv academic paper search with author/category hints.
4. **`jina_search_ssrn`**: Social Science Research Network paper discovery.
5. **`jina_expand`**: Query expansion returning related research queries.

### B. Deep Content Extraction & Reading
6. **`jina_read`**: Web page reader with CSS selectors (`targetSelector`, `waitForSelector`, `removeSelector`), anti-bot engine (`cf-browser-rendering`), and `tokenBudget`.
7. **`jina_read_file`** *(NEW)*: Local workspace file reader supporting `.pdf`, `.html`, `.docx`, and images through base64 ingestion.
8. **`jina_extract`** *(NEW)*: Server-side structured data extraction using ReaderLM-v2 and user-defined JSON Schemas.
9. **`jina_chunk`** *(NEW)*: Hierarchical semantic document chunking returning indexed markdown blocks.
10. **`jina_screenshot`**: Full-page raster capture with direct persistence into DSH `AttachmentStore`.
11. **`jina_pdf`**: Specialized PDF reader with formula recognition (`LaTeX`) and tabular markdown parsing (`preset: ocr++`).

### C. Dense AI & Semantic Operations
12. **`jina_embed`**: Dense vector embeddings generation for text snippets.
13. **`jina_rerank`**: Cross-encoder relevance re-ranking for search hits or candidate chunks.
14. **`jina_classify`**: Zero-shot text classification against candidate labels.

### D. System & Diagnostics
15. **`jina_datetime`**: Real-time UTC clock and timezone calibration probe.
16. **`jina_primer`**: Diagnostic check for key validity, remaining credits, and active proxy routing.

---

## 4. Code Mode / Programmatic Tool Calling (PTC) Optimization

In DeepSeek Harness Code Mode (`run_code`), agents construct programs that orchestrate tools in TypeScript or Python. 

`dsh-jina` v1.0 tools will be optimized for Code Mode:
- **Pure Async JSON**: All tools return lossless JSON structures.
- **Concurrent Overlapping**: Safe read tools (`jina_read`, `jina_web_search`, `jina_rerank`) can be executed concurrently inside `Promise.all` or `asyncio.gather`:
  ```typescript
  // Example Code Mode Program
  const [docA, docB] = await Promise.all([
    tools.jina_read({ url: "https://docs.a.org", targetSelector: "article" }),
    tools.jina_read({ url: "https://docs.b.org", targetSelector: "article" })
  ]);
  const ranked = await tools.jina_rerank({
    query: "authentication flow",
    documents: [docA, docB]
  });
  return ranked;
  ```
