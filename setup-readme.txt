==============================================================
  PYTHIA — SETUP GUIDE
  Local RAG knowledge base with LLM assistance
==============================================================


OVERVIEW
--------
Pythia requires three things to run:

  1. Node.js (v18+)
  2. Qdrant — vector database (runs as a Docker container)
  3. An LLM API key — cloud provider OR a local Ollama instance

The embedding model (bge-base-en-v1.5, ~130 MB) is downloaded
automatically from HuggingFace on first startup. No manual
model download is needed.


--------------------------------------------------------------
STEP 1 — Node.js
--------------------------------------------------------------

Requires Node.js v18 or later (v18+ has built-in fetch).

Check your version:
  node --version

Install via your OS package manager, or use nvm:
  https://github.com/nvm-sh/nvm

  nvm install 20
  nvm use 20


--------------------------------------------------------------
STEP 2 — Qdrant (Vector Store)
--------------------------------------------------------------

The easiest way is Docker. Install Docker first if needed:
  https://docs.docker.com/get-docker/

Then run Qdrant:

  docker run -d \
    --name qdrant \
    --restart unless-stopped \
    -p 6333:6333 \
    -v $(pwd)/qdrant_storage:/qdrant/storage \
    qdrant/qdrant

This starts Qdrant on localhost:6333 and persists data in
./qdrant_storage relative to wherever you run the command.
Run it from the pythia project root to keep things tidy, or
use an absolute path for the volume.

Verify Qdrant is running:
  curl http://localhost:6333/readyz
  # should return: {"status":"ok"}

To stop/start Qdrant later:
  docker stop qdrant
  docker start qdrant

The Qdrant URL and collection name are configured in system.toml
under [vectors]. Default is http://localhost:6333, collection "pythia".
Pythia creates the collection automatically on first run.


--------------------------------------------------------------
STEP 3 — Install Node dependencies
--------------------------------------------------------------

From the pythia project root:

  npm install

This installs all packages including @xenova/transformers (the
local embedding model runner) and pdf-parse.

NOTE — pdf-parse version:
  package.json pins pdf-parse to exactly 1.1.1. Do not upgrade
  it. pdf-parse 2.x pulls in pdfjs-dist 5.x which requires a
  DOMMatrix/canvas API not available in plain Node.js. On Windows
  (and Linux without the @napi-rs/canvas native binary) this
  causes a crash at startup. Version 1.1.1 uses pdfjs-dist 2.x
  and works in Node.js without any native dependencies.


--------------------------------------------------------------
STEP 4 — Configure the LLM provider
--------------------------------------------------------------

Pythia uses the llamiga package which supports:

  Provider     | system.toml value | Env var needed
  -------------|-------------------|------------------------
  xAI Grok     | grok              | GROK_API_KEY
  Anthropic    | anthropic         | ANTHROPIC_API_KEY
  OpenAI       | openai            | OPENAI_API_KEY
  Google Gemini| gemini            | GEMINI_API_KEY
  Mistral      | mistral           | MISTRAL_API_KEY
  Ollama       | ollama            | OLLAMA_API_BASE

The current default provider in system.toml is "grok".

Edit system.toml to change provider:

  [llm]
  provider = "grok"          # change this to your provider
  # model = "grok-3-latest"  # optional, provider default used if omitted

Set the API key — copy .env and fill in your key(s):

  cp .env.example .env      # if an example exists, else edit .env directly

The .env file uses shell export syntax:

  export GROK_API_KEY=your-key-here
  export ANTHROPIC_API_KEY=your-key-here

Source .env before starting (or add to your shell profile):

  source .env

For Ollama (fully local, no API key needed):

  1. Install Ollama: https://ollama.com
  2. Pull a model: ollama pull llama3
  3. In system.toml:  provider = "ollama"
  4. In .env:         export OLLAMA_API_BASE=http://localhost:11434
  5. In system.toml:  model = "llama3"


--------------------------------------------------------------
STEP 5 — Review system.toml
--------------------------------------------------------------

Key settings to check for a new machine:

  [server]
  port = 3000
  host = "127.0.0.1"    # localhost only; change to 0.0.0.0 to expose on LAN

  [personal]
  username = "superuser@local"   # change to your name/identifier
  banner   = "PYTHIA"            # displayed in the header

  [ingest]
  extensions = ["txt", "md", "js", "mjs", "java"]   # file types to ingest

Full config reference is in README.md.


--------------------------------------------------------------
STEP 6 — First run (embedding model download)
--------------------------------------------------------------

On the very first startup, @xenova/transformers downloads the
embedding model:

  Model:   Xenova/bge-base-en-v1.5
  Size:    ~130 MB
  Cache:   ~/.cache/huggingface/  (or TRANSFORMERS_CACHE env var)

This only happens once. Subsequent starts use the cached model
and are fast.

To start Pythia:

  # Foreground (see logs directly):
  npm start

  # Background daemon (recommended for daily use):
  source .env
  bash script/start.sh

  # Stop the daemon:
  bash script/stop.sh

Pythia is ready when you see:
  Server running at http://127.0.0.1:3000

Open http://localhost:3000 in your browser.


--------------------------------------------------------------
STEP 7 — Adding documents
--------------------------------------------------------------

Drop files into the docsource/ folder. Supported by default:
  .txt  .md  .js  .mjs  .java  (configurable in system.toml)
  .pdf  (always supported via pdf-parse)

On startup, Pythia auto-ingests any new or changed files.
While running, the docsource/ folder is watched for changes.

Subfolders become named snippet groups:
  docsource/file.txt            → source="file.txt"
  docsource/myproject/notes.md  → source="myproject", snippet="notes"


--------------------------------------------------------------
FORCE RE-INGEST (if needed)
--------------------------------------------------------------

If you change embedding logic or the path prefix config,
delete the index to force a full re-ingest on next start:

  rm data/ingest-index.json

Also delete and recreate the Qdrant collection if vectors changed:

  curl -X DELETE http://localhost:6333/collections/pythia

Pythia will recreate the collection and re-ingest everything.


--------------------------------------------------------------
DATA LOCATIONS
--------------------------------------------------------------

  data/ingest-index.json    mtime-based change detection index
  data/links.json           saved links (link mode)
  data/tmp/doc-ingest/      raw stored document text
  qdrant_storage/           Qdrant vector data (Docker volume)
  docsource/                your documents


--------------------------------------------------------------
QUICK START CHECKLIST
--------------------------------------------------------------

  [ ] Node.js v18+ installed
  [ ] docker run qdrant (verify with curl localhost:6333/readyz)
  [ ] npm install
  [ ] .env configured with your LLM API key
  [ ] system.toml: provider set to match your key
  [ ] source .env && npm start
  [ ] First run: wait for embedding model download (~130 MB)
  [ ] Open http://localhost:3000
  [ ] Drop .txt or .pdf files into docsource/

==============================================================
