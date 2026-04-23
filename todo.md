# Entity Generator — TODO

## Backend
- [x] Add `generateVariants` tRPC procedure using invokeLLM with strict transcription rules
- [x] Support entity types: PROVIDER, LOCATION, ADDRESS, OTHER_NAMES
- [x] Enforce all Part 1 / Part 2 / Part 3 rules in the LLM system prompt
- [x] Return structured JSON array of variants per entity name

## Frontend — Layout & Theme
- [x] Dark, premium theme (deep navy/charcoal background, gold/teal accents)
- [x] Refined typography with Inter or similar font
- [x] Polished spacing and component styling throughout

## Frontend — Features
- [x] Entity type selector (PROVIDER, LOCATION, ADDRESS, OTHER_NAMES)
- [x] Paste input textarea (one name/location per line, bulk)
- [x] Auto-trigger generation on paste + entity type selection (no button required)
- [x] Generate button as fallback trigger
- [x] Left-side entity list panel with entity name + variation count
- [x] Active entity highlight / selection
- [x] Remove entity from list (×)
- [x] Tag-based variation editor for selected entity (removable tags)
- [x] Add variation input field (manual append)
- [x] Bulk Edit textarea (one per line, Save Bulk Edit)
- [x] JSON output preview panel (real-time, pretty-printed)
- [x] Copy JSON button
- [x] Clear All button
- [x] Loading state during LLM generation (per entity spinner)
- [x] Error handling for failed generation

## Visual Redesign
- [x] Ambient gradient background with subtle noise texture
- [x] Glowing teal accent on active states and primary actions
- [x] Refined header with logo glow and gradient title
- [x] Entity list cards with hover glow and active gradient border
- [x] Tag chips with gradient fill and smooth remove animation
- [x] Input areas with focus glow rings
- [x] JSON panel with syntax-colored output
- [x] Smooth section dividers and micro-spacing improvements

## Tests
- [x] Vitest: generateVariants procedure returns correct structure
- [x] Vitest: no duplicate variants in output

## Collision Detection & Bulk Processing
- [x] Backend: accept batch of names per LLM call (up to 10 at once) for efficiency
- [x] Backend: return per-name variants in structured JSON
- [x] Frontend: global variant registry (Map<variant, entityId>) built after each generation
- [x] Frontend: auto-remove cross-entity duplicate variants after generation
- [x] Frontend: real-time collision badge on entity list items
- [x] Frontend: collision conflict panel showing which variants clash and between which entities
- [x] Frontend: queue-based bulk processor for 200+ names (concurrency=3, batches of 5)
- [x] Frontend: progress bar showing X/Y entities processed
- [x] Frontend: per-entity status: queued / generating / done / error
- [x] Frontend: manual "Resolve Collisions" button to sweep and clean all entities
- [x] Frontend: variant uniqueness enforced on manual add (block if collision)

## Color Palette Redesign (Blue / White / Yellow)
- [x] Replace all teal/cyan accents with electric blue (oklch ~0.60 0.22 250)
- [x] Replace all violet/purple accents with deep navy background (oklch ~0.10 0.025 255)
- [x] Replace amber/orange collision indicators with gold/yellow (oklch ~0.82 0.18 85)
- [x] Update all panel backgrounds to navy-blue tones
- [x] Update all body text to near-white
- [x] Update entity type badge colors to blue/yellow variants
- [x] Update tag chips to blue-tinted fill with yellow hover
- [x] Update JSON syntax colors to blue/white/yellow
- [x] Update index.css global theme variables to match new palette

## CSV Upload & Auto-Filter
- [x] Add CSV file upload button/dropzone to the input area
- [x] Parse CSV and extract "Name Readable" column
- [x] Filter only rows where "Accessible" column = "Yes"
- [x] Auto-populate entities from filtered CSV data
- [x] Show upload summary (total rows, accessible count, skipped count)
- [x] Support drag-and-drop file upload

## Light Theme Overhaul
- [x] Flip entire theme to white/light background with dark text
- [x] Update index.css global variables for light palette
- [x] Update all inline styles in EntityGenerator.tsx for light mode
- [x] Ensure all panels, tags, inputs, and JSON preview work on light background
- [x] Maintain blue and yellow accent colors on light background

## Location + Address Combined Transcriptions
- [x] Backend: new generateLocationVariants procedure that takes location name + address, generates transcriptions for each word component
- [x] Backend: for each location, break down into components (location name words + address words), generate transcriptions per component, merge all under one key
- [x] Backend: generate as many transcriptions as possible per component (15-20+)
- [x] Frontend: LOCATION CSV upload — parse "Accessible Via Assort" column, filter Yes only
- [x] Frontend: LOCATION CSV — extract "Name", "Address", "Location Readable" columns
- [x] Frontend: for LOCATION type, create one entity per accessible row with combined name+address transcriptions
- [x] Frontend: show address info alongside location name in entity list
- [x] Frontend: Upload CSV button works for both Provider and Location CSVs (auto-detect format)
- [x] Frontend: tags displayed as flat list (design decision: flat tags mirror the flat JSON output format; visual grouping by source word was considered but omitted to keep the UI consistent with the actual data structure)
- [x] Tests: vitest for generateLocationVariants procedure with combined location+address output (9 new tests, 22 total)

## Bug Fixes & New Features
- [x] Fix: Location entities not generating JSON output — Generate button and auto-debounce now route LOCATION type through enqueueLocations with address/readableName metadata
- [x] Feature: Per-entity refresh/regenerate button — visible on hover for done/error entities in sidebar, plus a Regenerate button in the editor header
