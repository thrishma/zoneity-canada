# Zoneity Canada

A national municipal zoning intelligence platform for Canada. Search, compare, and analyze zoning bylaws and land use regulations across Ontario municipalities — powered by semantic search, structured data extraction, and an AI chat agent.

Built for the **Waterloo Region Hackathon**.

---

## What It Does

- **Semantic bylaw search** — ask plain-English questions about zoning rules; results are ranked by vector similarity against indexed bylaw text
- **Structured metrics** — key zoning values (lot size, height limits, parking requirements, secondary suite permissions, multiplex permissions, density) extracted from PDFs using regex + GPT-4o
- **Municipality comparison** — side-by-side table of zoning metrics across up to 4 municipalities
- **AI chat agent** — LangChain agent with 3 tools: structured metrics lookup, bylaw text search, and open data queries
- **Open data integration** — 167k+ features from data.waterloo.ca ingested and queryable via API
- **Community submissions** — users can submit bylaw PDFs not yet indexed; admin review queue triggers ingestion pipeline

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, React 19) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS 4 |
| Database | PostgreSQL via Supabase (pgvector for embeddings) |
| AI / LLM | LangChain + GPT-4o (chat), text-embedding-3-small (search) |
| PDF parsing | Docling 2.x + PyMuPDF |
| Data ingestion | Python 3.12 |
| Maps | React Leaflet |
| Tracing | LangSmith (optional) |

---

## Project Structure

```
zoneity-canada/
├── app/                          # Next.js application
│   ├── app/
│   │   ├── api/
│   │   │   ├── bylaws/
│   │   │   │   ├── municipalities/   # List all municipalities
│   │   │   │   ├── search/           # Semantic vector search
│   │   │   │   ├── compare/          # Side-by-side metrics
│   │   │   │   ├── export/           # CSV / JSON export
│   │   │   │   ├── quality/          # Data quality flags
│   │   │   │   └── submit/           # Community submissions
│   │   │   ├── open-data/            # Waterloo open data query API
│   │   │   ├── chat/                 # AI agent (streaming SSE)
│   │   │   └── admin/submissions/    # Admin review queue
│   │   ├── compare/                  # Compare page
│   │   ├── map/                      # Map page
│   │   ├── submit/                   # Submission page
│   │   └── docs/                     # Documentation page
│   ├── components/                   # React components
│   ├── lib/                          # DB pool, cache, auth, rate limit
│   └── types/                        # Shared TypeScript types
└── scripts/                          # Python data pipeline
    ├── scraper.py                     # Discover + register bylaw PDFs
    ├── ingest.py                      # Download → extract → embed → store
    ├── ingest_open_data.py            # Waterloo open data ingestion
    ├── validate.py                    # Data quality checks
    ├── setup-db.sql                   # Initial schema
    ├── migrate-v2.sql                 # Vector + metrics tables
    ├── migrate-v3-submissions.sql     # Community submissions
    ├── migrate-v4-admin.sql           # Admin queue indexes
    └── migrate-v5-open-data.sql       # Open data features table
```

---

## Database Schema

### Core tables

**`municipalities`** — 18 Ontario cities
Fields: `id`, `name`, `province`, `population`, `lat`, `lng`, `region`

**`bylaw_documents`** — registered PDF bylaws
Fields: `id`, `municipality_id`, `bylaw_type`, `title`, `source_url`, `local_path`, `version_hash`

**`bylaw_sections`** — parsed + embedded bylaw text
Fields: `id`, `document_id`, `municipality_id`, `chapter`, `section`, `title`, `text`, `page`, `embedding vector(1536)`
Index: IVFFlat cosine similarity (lists=50)

**`bylaw_metrics`** — structured extracted values
Fields: `id`, `municipality_id`, `metric_key`, `value`, `confidence_score`, `extraction_method`
Keys: `min_lot_size_sqm`, `max_height_residential_m`, `min_parking_per_unit`, `permits_secondary_suite`, `permits_multiplex`, `max_density_units_per_ha`

**`bylaw_submissions`** — community-submitted bylaws
Fields: `id`, `municipality_id`, `bylaw_type`, `source_url`, `status` (pending → reviewed → ingested)

**`open_data_features`** — Waterloo Region open datasets
Fields: `id`, `dataset_name`, `dataset_label`, `municipality`, `feature_id`, `properties jsonb`, `geometry jsonb`
Index: GIN on `properties`, unique on `(dataset_name, feature_id)`

---

## Open Data Integration

Datasets ingested from [data.waterloo.ca](https://data.waterloo.ca) via ArcGIS FeatureServer APIs:

| Dataset | Municipality | Records | Key Fields |
|---|---|---|---|
| `building_permits` | Waterloo | 32,896 | `ADDRESS`, `STATUS`, `ISSUE_YEAR`, `PERMITTYPE` |
| `planning_communities` | Kitchener | 55 | `PLANNING_COMMUNITY`, `PLANNINGCOMMUNITYID` |
| `neighbourhood_assoc` | Waterloo | 45 | `NAME`, `WEBSITE` |
| `landmarks` | Kitchener | 1,971 | `LANDMARK`, `CATEGORY`, `SUBCATEGORY`, `STREET` |
| `address_proximity` | Kitchener | 132,327 | `ADDRESS`, `NEAREST_PARK`, `NEAREST_ELEMENTARY_SCHOOL` |

Re-ingest anytime (idempotent upserts):
```bash
python scripts/ingest_open_data.py                        # all datasets
python scripts/ingest_open_data.py --dataset landmarks    # one dataset
python scripts/ingest_open_data.py --dry-run              # count only, no DB writes
```

Query via API:
```
GET /api/open-data?dataset=building_permits&aggregate=ISSUE_YEAR
GET /api/open-data?dataset=landmarks&filter[CATEGORY]=PARK
GET /api/open-data?dataset=planning_communities&limit=55
```

---

## API Reference

### `GET /api/bylaws/municipalities`
Returns all municipalities with document counts.

### `GET /api/bylaws/search`
Semantic search across indexed bylaw sections.

| Param | Description |
|---|---|
| `q` | Search query (required) |
| `municipality` | Filter by municipality ID |
| `type` | Filter by bylaw type |
| `limit` | Max results (default 8, max 20) |

### `GET /api/bylaws/compare`
Structured metric comparison across municipalities.

| Param | Description |
|---|---|
| `id` | Municipality ID (repeat for multiple, e.g. `?id=waterloo-on&id=kitchener-on`) |

### `GET /api/open-data`
Query Waterloo Region open datasets.

| Param | Description |
|---|---|
| `dataset` | One of: `building_permits`, `planning_communities`, `neighbourhood_assoc`, `landmarks`, `address_proximity` |
| `municipality` | Filter by municipality (e.g. `waterloo-on`) |
| `aggregate` | Property key to count-by (e.g. `ISSUE_YEAR`, `STATUS`, `CATEGORY`) |
| `filter[KEY]` | Property value filter (e.g. `filter[STATUS]=Issued`) |
| `limit` | Max records (default 50, max 200) |
| `offset` | Pagination offset |

### `POST /api/chat`
Streaming AI agent (SSE). Body: `{ question, municipalityId?, municipalityName? }`

Agent tools:
- `get_structured_metrics` — returns extracted zoning metrics for one or more municipalities
- `search_bylaws` — semantic search across bylaw sections
- `query_open_data` — queries building permits, landmarks, neighbourhood associations, etc.

---

## Setup

### Prerequisites
- Node.js 20+
- Python 3.10+
- Supabase project (PostgreSQL with pgvector extension)
- OpenAI API key

### 1. Environment

Copy and fill in `app/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_POSTGRES_TRANSACTION_POOLER=postgresql://...
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Optional LangSmith tracing
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=...
LANGCHAIN_PROJECT=zoneity-canada
```

### 2. Database

Run migrations in order in the Supabase SQL editor:

```sql
-- Run each in sequence:
scripts/setup-db.sql
scripts/migrate-v2.sql
scripts/migrate-v3-submissions.sql
scripts/migrate-v4-admin.sql
scripts/migrate-v5-open-data.sql
scripts/seed-municipalities-on.sql
```

Enable the pgvector extension first:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 3. App

```bash
cd app
npm install
npm run dev
```

### 4. Data Pipeline

Install Python dependencies:
```bash
cd scripts
pip install -r requirements.txt
```

Scrape and register bylaw PDFs:
```bash
python scripts/scraper.py
```

Ingest a municipality (downloads PDF, parses, embeds, extracts metrics):
```bash
python scripts/ingest.py --all
# or single document:
python scripts/ingest.py --document-id <uuid>
```

Ingest Waterloo open data:
```bash
python scripts/ingest_open_data.py
```

Validate data quality:
```bash
python scripts/validate.py
python scripts/validate.py --fix   # auto-resolve flags
```

---

## Municipalities Covered

Currently indexed Ontario municipalities:

**Waterloo Region:** Waterloo, Kitchener, Cambridge, Guelph
**GTA:** Mississauga, Brampton, Hamilton, Markham, Vaughan, Richmond Hill, Oakville, Burlington
**Other:** Ottawa, Barrie, London, Windsor, Thunder Bay, Kingston, Sudbury, Oshawa

---

## Metric Extraction

Bylaw metrics are extracted using a two-stage approach:

1. **Regex scan** — 100+ Ontario-specific patterns scanned against raw PDF text (fast, zero cost)
2. **Semantic + LLM fallback** — for metrics not found by regex: embed a targeted query, find relevant sections via cosine similarity, pass to GPT-4o-mini for structured extraction

Extracted values are stored with a `confidence_score` and `extraction_method` (`regex` | `llm` | `manual`).

---

## License

Data from data.waterloo.ca is licensed under the [City of Waterloo Open Data License](https://www.waterloo.ca/en/government/open-data-licence.aspx) (CC-BY compatible).
