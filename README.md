# Pythia — Document Retrieval System through Chat

A local, personal RAG (Retrieval-Augmented Generation) system. Upload documents, ask questions, get LLM answers grounded in your own knowledge base. No cloud indexing — everything runs on your machine.

---

## Features

- **Local embeddings** via `@xenova/transformers` (bge-base-en-v1.5, runs in-process, no API key needed)
- **Vector search** via Qdrant running locally
- **LLM answer generation** — configurable provider (Grok, Anthropic Claude, etc.)
- **Two answering modes:**
  - `default` — answers only from your documents; refuses to guess
  - `hybrid` — KB first, falls back to general knowledge, always labels the source
- **Auto-ingest** — drop files into `docsource/` and they are chunked, embedded, and indexed automatically
- **Subfolder snippets** — files inside `docsource/subfolder/` become named snippets of a virtual source
- **`%%` snippet markers** — structure a single file into named sections
- **PDF support** via `pdf-parse`
- **Web UI** — plain HTML/CSS/JS frontend served by the Node.js server
- **Smart buttons** — configurable one-click prompts in the UI
- **Personal mode** — single user, no auth layer

---

## Requirements

- Node.js 18+ (ESM)
- [Qdrant](https://qdrant.tech/) running on `localhost:6333`
- An LLM API key for your chosen provider (configured in `system.toml`)

---

## Setup

```bash
# Install dependencies
npm install

# Start Qdrant (example using Docker)
docker run -p 6333:6333 qdrant/qdrant

# Start Pythia
npm start
```

The server listens on `http://127.0.0.1:3000` by default (configurable in `system.toml`).

---

## Adding Documents

Drop any supported file into the `docsource/` folder. On the next startup (or sync cycle), Pythia will chunk, embed, and index it automatically.

Supported extensions (configurable): `txt`, `md`, `js`, `mjs`, `java`, `pdf`

### Subfolder organization

Files in subfolders become snippets of a virtual source named after the folder:

```
docsource/file.txt              → source="file.txt"
docsource/project/notes.txt     → source="project",  snippet="notes.txt"
docsource/project/api/spec.md   → source="project",  snippet="api-spec.md"
```

### `%%` snippet markers

Structure a flat file into named sections:

```
%%intro
This is the intro section.
%%end

%%setup
Installation steps here.
%%/
```

Each section is indexed as a separate named snippet.

---

## Configuration

All configuration lives in `system.toml`.

| Section | Key | Default | Description |
|---|---|---|---|
| `[server]` | `port` | `3000` | HTTP port |
| `[server]` | `host` | `127.0.0.1` | Bind address |
| `[llm]` | `provider` | `grok` | LLM provider (`grok`, `anthropic`, …) |
| `[llm]` | `mode` | `hybrid` | Answer mode (`default` or `hybrid`) |
| `[embeddings]` | `model` | `Xenova/bge-base-en-v1.5` | Local embedding model |
| `[embeddings]` | `dims` | `768` | Embedding dimensions |
| `[vectors]` | `url` | `http://localhost:6333` | Qdrant URL |
| `[vectors]` | `collection` | `pythia` | Qdrant collection name |
| `[chunker]` | `max_chars` | `1000` | Max characters per chunk |
| `[ingest]` | `docsource_dir` | `./docsource` | Watched document folder |
| `[ingest]` | `extensions` | `["txt","md",…]` | Indexed file extensions |
| `[personal]` | `snippet_marker` | `%%` | Marker for inline snippets |
| `[personal]` | `smart_buttons` | — | Quick-prompt buttons in the UI |

System prompts are configured separately in `prompting.toml`.

---

## Project Structure

```
src/
  main.mjs        — entry point, starts server and sync
  server.mjs      — HTTP API routes
  ingest.mjs      — chunk → embed → upsert pipeline
  sync.mjs        — docsource folder watcher
  chunker.mjs     — text splitting and %% marker parsing
  embedder.mjs    — @xenova/transformers wrapper
  retriever.mjs   — query embedding + Qdrant search
  vectors.mjs     — Qdrant client wrapper
  llm.mjs         — LLM call wrapper (via llamiga)
  snippets.mjs    — %% snippet parser/serializer
  storage.mjs     — flat-file storage for raw doc text
  config.mjs      — loads system.toml
www-static/       — frontend (HTML/CSS/JS)
docsource/        — drop documents here
data/             — runtime data (index, vector store cache)
system.toml       — main configuration
prompting.toml    — system prompt templates
```

---

## Forced Re-Ingest

If you change embedding logic (e.g. update chunk prefix format), delete the index file to force a full re-ingest:

```bash
rm data/ingest-index.json
npm start
```

---

## License

Copyright 2026 Dusty Wilhelm Murray / Semantic Tools

Licensed under the [Apache License, Version 2.0](LICENSE).
