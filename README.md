# Entity Generator

A polished web tool for generating phonetic transcription variants for voice AI systems. Paste names or upload CSV files, and the tool automatically generates structured transcription variant data using LLM-powered phonetic analysis.

## Features

- **Entity Type Selector** — PROVIDER, LOCATION, ADDRESS, OTHER_NAMES
- **CSV Upload with Auto-Detection** — automatically detects Provider vs Location CSV formats and filters only accessible entries
- **LLM-Powered Variant Generation** — generates 10-15+ phonetic variants per entity using strict transcription rules
- **Location + Address Combined Transcriptions** — for locations, generates variants for the location name AND each significant address word, merged into one flat array
- **Cross-Entity Collision Detection** — real-time scanning to prevent duplicate variants across entities
- **Tag-Based Variation Editor** — click to remove individual variants, add new ones manually
- **Bulk Edit Mode** — edit all variants as text (one per line)
- **JSON Output Preview** — real-time formatted JSON output with syntax highlighting
- **Copy JSON** — one-click copy to clipboard
- **200+ Name Support** — queue-based bulk processing with progress tracking

## Tech Stack

- **Frontend:** React 19 + Tailwind CSS 4 + shadcn/ui
- **Backend:** Express + tRPC 11
- **LLM:** Built-in Manus Forge API (invokeLLM)
- **Auth:** Manus OAuth
- **Database:** MySQL/TiDB via Drizzle ORM

## Getting Started

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Run tests
pnpm test
```

## CSV Format Support

### Provider CSV
Requires columns: `Name Readable` (or `Name`), `Accessible`
- Filters rows where `Accessible` = "Yes"

### Location CSV
Requires columns: `Name`, `Address`, `Location Readable`, `Accessible Via Assort`
- Filters rows where `Accessible Via Assort` = "Yes"
- Generates combined transcriptions for location name + address words

## Environment Variables

See `server/_core/env.ts` for required environment variables. Key ones:
- `BUILT_IN_FORGE_API_URL` — LLM API endpoint
- `BUILT_IN_FORGE_API_KEY` — LLM API key
- `DATABASE_URL` — MySQL connection string
- `JWT_SECRET` — Session signing secret

## Project Structure

```
client/src/pages/EntityGenerator.tsx  — Main UI component
server/routers.ts                     — tRPC procedures (generateVariants, generateLocationVariants)
server/entity.test.ts                 — 22 vitest tests
drizzle/schema.ts                     — Database schema
```
