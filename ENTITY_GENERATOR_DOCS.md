# Entity Generator — Comprehensive Rules and Documentation

**Author:** Manus AI
**Version:** 1.0
**Last Updated:** April 22, 2026

---

## 1. Overview

The Entity Generator is a web-based tool designed to produce structured phonetic transcription variants for voice AI systems. When a caller speaks a provider name, location, or address over the phone, speech-to-text (STT) engines frequently mishear or approximate what was said. The Entity Generator pre-computes every plausible phonetic variant so the AI can match spoken input to the correct entity with high confidence.

The tool accepts two types of input: **manual text entry** (names pasted one per line) and **CSV file upload** (bulk provider or location spreadsheets). It uses an LLM to generate phonetic variants that strictly follow the transcription rules defined in this document, then outputs a clean JSON object ready for integration into a voice AI configuration.

---

## 2. Entity Types

The system supports four entity types, each with distinct transcription behavior.

| Entity Type | Purpose | Input Source | Transcription Strategy |
|---|---|---|---|
| **PROVIDER** | Doctor / staff names | Manual paste or Provider CSV | First name variants + last name variants + combined full-name variants |
| **LOCATION** | Clinic / office names with addresses | Manual paste (pipe-separated) or Location CSV | Location name variants + address word variants + readable name variants, all merged into one flat array |
| **ADDRESS** | Street addresses only | Manual paste | Strip numbers and street types; generate variants for each significant word |
| **OTHER_NAMES** | Aliases, acronyms, alternate names | Manual paste | Correct spelling + phonetic simplifications + spoken acronym spellings |

---

## 3. Transcription Rules

These rules govern how every phonetic variant is generated. They are enforced both in the LLM system prompt and through post-processing deduplication on the server.

### 3.1 Part 1 — Name Transcription Rules (Providers)

For each provider name (first name, last name, or full name), the system generates **10 to 15 unique transcriptions** following these constraints.

**Formatting requirements:**

All transcriptions must be lowercase. Each transcription is a unique string — no duplicates are permitted within the same entity's list. First and last name components are transcribed separately, then combined full-name variants are also included.

**Uniqueness requirements:**

No overlapping transcriptions are allowed across different entities in the same batch. If "emmi" appears in the transcription list for "Emily," it must not appear in the list for "Emma." When two names sound similar (e.g., "Scott" and "Scopp"), their transcription lists must be fully distinct with zero shared entries. Duplicate values such as including both "scott norris" and "norris" in the same list are prohibited.

**Content requirements:**

The name itself must always appear in its own transcription list — if the name is "Michael," then "michael" must be one of the transcriptions. Common filler words are excluded: "doctor," "what," "who," "whom," "the," "a," and "an" must never appear as transcriptions. For names that contain address-like components, the system splits them into the shortest unique identifiers (e.g., "4215" and "flagler" rather than "4215 flagler").

**Example output for "Joel Patel":**

```
"joel", "juel", "jooel", "joil", "joal", "goel", "joell", "jel", "jol",
"patel", "petel", "putel", "patil", "patal", "ppatel", "pattel",
"joel patel", "juel patel", "jooel patel", "joil patel"
```

### 3.2 Part 2 — Spreadsheet Transcription Rules (Locations)

When processing a location row from a spreadsheet, the system generates **three transcription sets** that are merged into a single flat array under the location name key.

**[A] Location Name Transcription** — derived from the location name column. Includes: correct spelling, abbreviations, phonetic variations, and common STT mishearings. Target: 10 to 15 variants.

> Example: "Jupiter" produces "jupiter", "jup", "jupter", "rupiter", "jupitor"

**[B] Address Transcription** — derived from the street name only. The system removes all numbers, street type suffixes (Ave, Avenue, Road, Rd, St, Street, Blvd, Boulevard, Dr, Drive), and directionals (N, S, East, West, North, South). For each remaining significant word, it generates 8 to 12 phonetic variants independently.

> Example: "2055 Military Ave" produces "military", "millitry", "mullitry", "mallitary", "militery", "millitary", "militari", "miltary"

> Example: "632 Blue Hill Avenue" produces variants for "Blue" AND "Hill" separately:
> - "blue", "bloo", "blew", "blou", "bleu", "bue", "bluw", "bloue"
> - "hill", "hil", "hll", "heel", "heil", "hille", "hyll", "hel"

**[C] Other Names / Readable Name Transcription** — derived from the "Location Readable" or "Other Names" column when it differs from the location name. Includes correct spelling, phonetic simplifications, and spoken acronym spellings. Target: 5 to 8 variants per extra word.

> Example: "P-B-G" produces "pbg", "ppg", "tbg", "tbgwe", "abg", "p b g"

**Formatting rules applied to all three sets:**

All entries are lowercase. Street suffixes, directionals, numbers, city/state/ZIP, and common filler words are excluded. No duplicates within any transcription list. Common-sense phonetic variations are used (e.g., "jamie" produces "jamee", "jamey", "jaymi").

### 3.3 Part 3 — JSON Output Format

After generating transcriptions, all output is formatted as a single JSON object following these rules:

- First and last names are combined into a single string key (e.g., "Joel Patel")
- All transcriptions for an entity are listed as values in a JSON array
- The entire result is one JSON object
- Pretty-printed format with 2-space indentation and line breaks
- Double quotes for all keys and values
- Each transcription appears on its own line inside the array
- Output is valid JSON only — no explanation, commentary, or extra text

**Example output:**

```json
{
  "Joel Patel": [
    "joel",
    "juel",
    "jooel",
    "patel",
    "petel",
    "joel patel",
    "juel patel"
  ],
  "Nutrition": [
    "nutrition",
    "nutriton",
    "nutrishun",
    "blue",
    "bloo",
    "blew",
    "hill",
    "hil",
    "heel"
  ]
}
```

---

## 4. CSV File Formats

The tool auto-detects whether an uploaded CSV is a Provider file or a Location file based on its column headers.

### 4.1 Provider CSV

| Column | Required | Description |
|---|---|---|
| `EHR ID` | No | Internal identifier |
| `Title` | No | Professional title (MD, DDS, PSYD, etc.) |
| `First Name` | No | Provider first name |
| `Last Name` | No | Provider last name |
| `Name Readable` | **Yes** | Full display name used as the entity key |
| `Gender` | No | Provider gender |
| `Schedulable` | No | Whether the provider can be scheduled |
| `Reschedulable` | No | Whether appointments can be rescheduled |
| `Cancellable` | No | Whether appointments can be cancelled |
| `Accessible` | **Yes** | **Filter column** — only rows with "Yes" are processed |
| `Min Age` | No | Minimum patient age |
| `Max Age` | No | Maximum patient age |
| `Secondary EHR IDs` | No | Additional identifiers |
| `Accepting New Patients` | No | New patient acceptance status |
| `Locations` | No | Number of associated locations |
| `Practices` | No | Associated practice names |
| `Notes` | No | Free-text notes |

**Detection logic:** The tool identifies a Provider CSV by the presence of an `Accessible` column header (case-insensitive). Only rows where `Accessible` equals "Yes" (case-insensitive) are imported. The `Name Readable` column is used as the entity name.

**Sample row:**

```
"63","DDS","Maxwelle","Albin","Maxwelle Albin","","No","No","No","No","0","150","","Yes","0","","Dental"
```

This row has `Accessible = No`, so it would be **skipped**. A row with `Accessible = Yes` would be imported with the entity name "Maxwelle Albin".

### 4.2 Location CSV

| Column | Required | Description |
|---|---|---|
| `EHR ID` | No | Internal identifier |
| `Name` | **Yes** | Location name used as the entity key |
| `Address` | **Yes** | Street address — words are extracted for address transcriptions |
| `Location Readable` | **Yes** | Human-readable name / alias for additional transcriptions |
| `Accessible Via Assort` | **Yes** | **Filter column** — only rows with "Yes" are processed |
| `Confirm` | No | Whether confirmations are supported |
| `Schedule` | No | Whether scheduling is supported |
| `Reschedule` | No | Whether rescheduling is supported |
| `Cancel` | No | Whether cancellation is supported |
| `Practice` | No | Associated practice |
| `Notes` | No | Free-text notes |

**Detection logic:** The tool identifies a Location CSV by the presence of an `Accessible Via Assort` column header (case-insensitive). Only rows where `Accessible Via Assort` equals "Yes" are imported. The `Name` column is the entity key, `Address` provides address words for transcription, and `Location Readable` provides additional alias words.

**Sample row:**

```
"3","Nutrition","632 Blue Hill Avenue","Nutrition","Yes","Yes","Yes","Yes","Yes","",""
```

This row has `Accessible Via Assort = Yes`, so it is imported. The entity key is "Nutrition," the address "632 Blue Hill Avenue" is parsed into words "Blue" and "Hill" (numbers and "Avenue" are stripped), and since `Location Readable` matches the name, no additional alias variants are generated.

---

## 5. Processing Pipeline

### 5.1 Manual Input Flow

For **PROVIDER**, **ADDRESS**, and **OTHER_NAMES** types, the user pastes names one per line into the textarea. The system auto-triggers generation after a 600ms debounce. Each name becomes a separate entity.

For **LOCATION** type, the user pastes pipe-separated lines in the format:

```
Name | Address | ReadableName
```

For example:

```
Nutrition | 632 Blue Hill Avenue | Nutrition
Family Medicine | 100 Warren Street | Family Med Main
```

### 5.2 CSV Upload Flow

1. User clicks "Upload CSV" or drags a `.csv` file onto the page
2. The tool reads the CSV headers and auto-detects the format (Provider vs. Location)
3. Rows are filtered by the accessibility column (`Accessible` or `Accessible Via Assort`)
4. A toast notification shows: "Imported X accessible [providers/locations] from Y total rows (Z skipped)"
5. Entities are queued for generation with 4 concurrent LLM calls, 10 names per batch

### 5.3 Batch Processing Architecture

The queue engine processes entities in batches to handle 200+ names efficiently.

| Parameter | Value | Purpose |
|---|---|---|
| Concurrent LLM calls | 4 | Parallel processing without overwhelming the API |
| Names per batch | 10 (providers) / 10 (locations) | Optimal batch size for LLM context window |
| Max names per API call | 50 (providers) / 20 (locations) | Hard limit enforced by the backend |
| Debounce delay | 600ms (input) / 300ms (type change) | Prevents excessive API calls during typing |

### 5.4 Collision Detection and Resolution

After each batch completes, the system builds a **global variant registry** — a map from every variant string to the entity that owns it. When a variant appears in more than one entity, it is flagged as a collision.

**Auto-resolution strategy:** When collisions are detected, the system removes the duplicate variant from the entity that was generated later (preserving the first occurrence). Users can also click "Auto-Resolve" to sweep all entities and remove all collisions at once.

**Manual add blocking:** When a user manually types a new variant, the system checks the global registry. If the variant already exists in another entity, the add is blocked and a toast notification explains which entity already owns that variant.

---

## 6. LLM System Prompts

The backend uses two distinct system prompts depending on the entity type.

### 6.1 Provider / Generic Prompt

Used for entity types: PROVIDER, ADDRESS, OTHER_NAMES, and simple LOCATION (without address metadata).

The prompt instructs the LLM to generate 10 to 15 unique lowercase transcriptions per entity, with zero overlap between entities in the same batch. For PROVIDER type, it combines first name, last name, and full-name variants. For ADDRESS type, it strips numbers and street types. For OTHER_NAMES, it includes acronym spellings.

### 6.2 Location + Address Combined Prompt

Used when processing LOCATION entities that include address and readable name metadata (typically from CSV upload or pipe-separated manual input).

The prompt instructs the LLM to generate transcriptions for three component groups and merge them into one flat array:

1. **Location name** — 10 to 15 variants
2. **Each significant address word** — 8 to 12 variants per word (after stripping numbers, street types, and directionals)
3. **Extra readable name words** — 5 to 8 variants per word not already covered

The target is 25 to 50+ total transcriptions per location. Cross-location uniqueness is enforced.

### 6.3 Post-Processing

Regardless of which prompt is used, the server applies a deduplication pass after receiving the LLM response:

1. Parse the JSON response
2. Iterate through each entity's variants
3. Lowercase and trim each variant
4. Check against a global `seen` set — if the variant was already assigned to a previous entity, skip it
5. Check against the current entity's list — if it is a duplicate within the same entity, skip it
6. Add surviving variants to the result

This ensures that even if the LLM produces overlapping variants (which occasionally happens), the final output is guaranteed to have zero cross-entity collisions.

---

## 7. JSON Output Specification

The final JSON output follows this exact structure:

```json
{
  "Entity Name 1": [
    "variant1",
    "variant2",
    "variant3"
  ],
  "Entity Name 2": [
    "variant1",
    "variant2",
    "variant3"
  ]
}
```

**Rules:**

- The top-level object contains one key per entity
- Keys are the exact entity names as provided (preserving original casing)
- Values are arrays of lowercase strings
- No variant appears in more than one entity's array
- No variant appears more than once within the same array
- The JSON is pretty-printed with 2-space indentation
- All strings use double quotes

---

## 8. UI Feature Reference

### 8.1 Header Bar

The header contains the application title ("Entity Generator"), a subtitle describing its purpose, and a **Clear All** button that resets the entire workspace — removing all entities, clearing the input textarea, and resetting the JSON output.

### 8.2 Entity Type Selector

A dropdown menu offering four options: PROVIDER (default), LOCATION, ADDRESS, and OTHER_NAMES. Each option includes a brief description. Changing the entity type while text is present in the input area triggers a re-generation with the new type.

### 8.3 Upload CSV Button

Opens a file picker for `.csv` files. The tool auto-detects the CSV format and filters by the appropriate accessibility column. A toast notification summarizes the import results.

### 8.4 Generate Button

A manual fallback trigger that starts generation for whatever is currently in the input textarea. For LOCATION type, it parses pipe-separated input. For all other types, it parses newline/comma/tab-separated names.

### 8.5 Input Textarea

Accepts pasted text. Supports newline, comma, and tab separators. For LOCATION type, supports pipe-separated format (`Name | Address | ReadableName`). Auto-triggers generation after 600ms of inactivity.

### 8.6 Entity List Panel (Left Sidebar)

Displays all entities with their names, variation counts, and status indicators. Each entity card shows:

- Entity name
- Address subtitle (for location entities)
- Variation count or status text (Queued, Generating, Error)
- Hover-revealed **Regenerate** button (refresh icon) for completed entities
- Hover-revealed **Remove** button (X icon)

Clicking an entity selects it for editing in the center panel.

### 8.7 Tag-Based Variation Editor (Center Panel)

Displays all variants for the selected entity as removable tag chips. Each tag shows the variant text and a hover-revealed X button to remove it. Collision variants are highlighted with an amber warning icon.

### 8.8 Regenerate Button

Appears in the editor header for the selected entity. Clears existing variants and re-queues the entity for fresh LLM generation.

### 8.9 Add Variation Input

A text input field below the tags panel. Type a new variant and press Enter or click "Add" to append it. The system checks for collisions before adding — if the variant exists in another entity, the add is blocked with a toast notification.

### 8.10 Bulk Edit Mode

A collapsible textarea showing all variants for the selected entity, one per line. Edit freely, then click "Save Bulk Edit" to apply. Cross-entity collisions are auto-removed on save.

### 8.11 JSON Output Preview (Center Panel)

A collapsible panel showing the JSON output for the current entity set with syntax coloring. Includes an inline "Copy JSON" button.

### 8.12 Full JSON Panel (Right Sidebar)

A persistent panel showing the complete JSON output for all entities. Includes a "Copy" button at the top. Updates in real time as entities are generated, edited, or removed.

---

## 9. Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                      │
│                                                          │
│  Input → CSV Parser / Text Parser                        │
│    ↓                                                     │
│  Queue Engine (4 concurrent, batches of 10)              │
│    ↓                                                     │
│  tRPC Mutation Call                                      │
│    ↓                                                     │
│  Global Variant Registry → Collision Detection           │
│    ↓                                                     │
│  Entity State → Tag Editor + JSON Output                 │
└─────────────────────────────────────────────────────────┘
                          ↕ tRPC
┌─────────────────────────────────────────────────────────┐
│                    BACKEND (Express + tRPC)               │
│                                                          │
│  entity.generateVariants (PROVIDER/ADDRESS/OTHER_NAMES)  │
│  entity.generateLocationVariants (LOCATION + address)    │
│    ↓                                                     │
│  LLM Call (structured JSON schema response)              │
│    ↓                                                     │
│  Server-side deduplication (global seen set)             │
│    ↓                                                     │
│  Return clean { name: variants[] } map                   │
└─────────────────────────────────────────────────────────┘
```

---

## 10. Recreation Guide

To recreate this tool from scratch using Claude or another AI assistant, provide the following instructions:

### Step 1 — Set Up the Project

Create a React + TypeScript + Tailwind CSS frontend with an Express + tRPC backend. Use the following stack:

- React 19 with Vite
- Tailwind CSS 4 with a light theme (white background, dark text, blue primary accent, yellow/amber warning accent)
- tRPC 11 for type-safe API calls
- Framer Motion for tag animations
- Lucide React for icons
- Sonner for toast notifications

### Step 2 — Implement the Backend

Create two tRPC mutation procedures:

1. **`entity.generateVariants`** — accepts `{ entityType: string, names: string[] }`, calls the LLM with the Provider/Generic system prompt (Section 6.1), returns `Record<string, string[]>`
2. **`entity.generateLocationVariants`** — accepts `{ locations: { name, address, readableName }[] }`, calls the LLM with the Location Combined system prompt (Section 6.2), returns `Record<string, string[]>`

Both procedures must enforce server-side deduplication using a global `seen` set that prevents any variant from appearing in more than one entity's array.

### Step 3 — Implement the Frontend

Build a three-column layout:

- **Left sidebar** (240px): Entity list with status indicators, hover-revealed refresh/remove buttons
- **Center panel** (flexible): Entity type selector, CSV upload, input textarea, tag editor, add variant input, bulk edit, JSON preview
- **Right sidebar** (300px): Full JSON output with copy button

Implement a queue engine with 4 concurrent workers that processes entities in batches of 10. After each batch completes, rebuild the global variant registry and flag collisions.

### Step 4 — Implement CSV Parsing

Use the browser's `FileReader` API to read CSV files. Split by newlines, then split each line by commas (respecting quoted fields). Detect the CSV type by checking for `Accessible Via Assort` (Location) or `Accessible` (Provider) in the headers. Filter rows by the accessibility column, extract the relevant name/address columns, and enqueue entities for generation.

### Step 5 — Apply the Transcription Rules

Copy the full system prompts from Section 6 into your backend. The prompts encode all the transcription rules from Sections 3.1, 3.2, and 3.3. Use structured JSON schema in the LLM `response_format` parameter to guarantee parseable output.

---

## 11. Complete Transcription Rules Reference

This section reproduces the canonical transcription rules in their original form for direct use as an LLM system prompt or reference document.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 1 — NAME TRANSCRIPTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For each name (first names only, last names only, or full names),
generate 10–15 unique transcriptions following these rules:

FORMATTING:
- All transcriptions must be in lowercase
- Wrap each transcription in double quotes, separated by commas
- Do not repeat any transcription within the same list
- Create separate transcription lists for first and last names

UNIQUENESS RULES:
- No overlapping words across different names
  (e.g., "emmi" must not appear in both Emily & Emma)
- If two names sound similar, their transcriptions must be fully distinct
- Do not include duplicate values

CONTENT RULES:
- If the name is "michael," include "michael" in its transcription list
- Avoid common filler words: "doctor", "what", "who", "whom", etc.
- For addresses, split into components and use the shortest unique identifiers

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 2 — SPREADSHEET TRANSCRIPTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For each row in a spreadsheet, generate three transcription sets:

[A] LOCATION TRANSCRIPTION (from Location name column)
- Include: correct spelling, abbreviations, phonetic variations

[B] ADDRESS TRANSCRIPTION (from street name only)
- Remove: numbers, street types (Ave/Road/St), directionals (N/S/East)
- Include: correct spelling of core name, phonetic variants, compound splits

[C] OTHER NAMES TRANSCRIPTION (from Other Names column)
- Include: correct spelling, phonetic simplifications, spoken acronym spellings

FORMATTING RULES (apply to all three sets):
- All entries lowercase, wrapped in double quotes, comma-separated
- Do NOT include: street suffixes, directionals, numbers, city/state/ZIP,
  common filler words
- No duplicates within any transcription list
- Use common-sense variations

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 3 — JSON OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULES:
- Combine first and last name into a single string key
- List all transcriptions as values in a JSON array
- Output the entire result as one JSON object
- Use pretty-printed format: indented, 2-space indentation, line breaks
- Use double quotes for ALL keys and values
- Each transcription must appear on its own line inside the array
- Output valid JSON ONLY — no explanation, commentary, or extra text
```

---

## 12. Glossary

| Term | Definition |
|---|---|
| **Entity** | A named item (provider, location, address, or alias) for which transcription variants are generated |
| **Variant** | A single phonetic transcription string representing how an entity name might be heard by an STT engine |
| **Collision** | A variant string that appears in more than one entity's transcription list |
| **STT** | Speech-to-text — the technology that converts spoken audio into text |
| **Accessible** | A flag in the Provider CSV indicating whether the provider is available for AI scheduling |
| **Accessible Via Assort** | A flag in the Location CSV indicating whether the location is available through the scheduling system |
| **Batch** | A group of entities sent to the LLM in a single API call for transcription generation |
| **Queue Engine** | The frontend processing system that manages concurrent LLM calls and tracks progress |
| **Global Variant Registry** | A frontend data structure (Map) that tracks which entity owns each variant, used for collision detection |

---

*This document is the authoritative reference for the Entity Generator system. All transcription rules, CSV formats, and processing logic described here are implemented in the application and enforced at both the LLM prompt level and through server-side post-processing.*
