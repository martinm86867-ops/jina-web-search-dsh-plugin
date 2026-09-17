# Jina AI DSH Plugin: Evolution Roadmap & Architecture

This directory houses the comprehensive strategic roadmap, gap analysis, architectural blueprint, and phased implementation plans for upgrading **`dsh-jina`** from a baseline search/read wrapper into an enterprise-grade **Autonomous Web Intelligence & Document Engine** for DeepSeek Harness.

---

## Document Index

1. **[01-current-state-audit.md](01-current-state-audit.md)**: Exhaustive inventory of what exists today in `dsh-jina` v0.6.1 (the 12 tools, proxy layer, credential resolution, and Web UI settings card).
2. **[02-gap-analysis-and-rationale.md](02-gap-analysis-and-rationale.md)**: Detailed breakdown of what is missing, backed by the OpenAPI specifications (`reader-api.json` and `search-api.json`), explaining **what** is needed and **why** it transforms agent performance and token economics.
3. **[03-target-architecture.md](03-target-architecture.md)**: Target component design for `dsh-jina` v1.0, including Node.js helper execution, DeepSeek Harness `AttachmentStore` integration, and Code Mode (PTC) concurrency.
4. **[04-implementation-roadmap.md](04-implementation-roadmap.md)**: Phased, milestone-driven execution plan with concrete task lists, test requirements, and acceptance criteria.

---

## Executive Summary: Current State vs. Target State

| Dimension | Current State (`dsh-jina` v0.6.1) | Target State (`dsh-jina` v1.0) |
|---|---|---|
| **Tools Offered** | 12 tools (mostly 1:1 basic CLI mirrors) | 16 tools + expanded capability envelopes |
| **OpenAPI Utilization** | ~12% of available schema parameters | >85% of high-leverage capabilities exposed |
| **Information Extraction** | Unstructured Markdown only (wastes turn tokens) | Server-side structured JSON extraction (`jina_extract`) matching exact user/agent schemas |
| **SPA / Dynamic Pages** | Scrapes empty shells when JS takes time to render | Precision DOM extraction via `targetSelector`, `waitForSelector`, and `removeSelector` |
| **Search Concurrency** | Single-query only (requires serial tool turns) | Multi-query batch execution (`jina_search_batch`) reducing research latency by 5x |
| **Long Document Handling**| Raw dump up to 120s timeout (can blow context) | Deterministic `tokenBudget` caps + hierarchical semantic chunking (`jina_chunk`) |
| **Local File Support** | HTTP/HTTPS URLs only; cannot read local files | Local file ingestion (`pdf`, `html`, `docs`) via base64 bridge with multi-modal OCR |
| **Image Persistence** | Returns remote URL or inline string | Persists screenshots directly into DeepSeek Harness `AttachmentStore` for vision models |
| **Anti-Bot Resiliency** | Standard cURL engine; blocked by Cloudflare | Support for `cf-browser-rendering` engine to bypass anti-bot challenges |
