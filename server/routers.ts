import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { z } from "zod";

// ─── Provider / Generic Transcription System Prompt ─────────────────────────
const TRANSCRIPTION_SYSTEM_PROMPT = `You are a transcription and JSON formatting assistant for voice AI systems.
Your task is to generate phonetic transcription variants for entity names so a speech-to-text engine can recognize them when spoken aloud.

STRICT RULES — follow ALL of them exactly:

FORMATTING:
- All transcriptions must be lowercase
- No duplicates within the same entity's list
- Generate 10–15 unique transcriptions per entity

UNIQUENESS RULES:
- No overlapping transcriptions across DIFFERENT entities in the same batch
  (e.g., if "emily" appears for Emily, it must NOT appear for Emma)
- If two names sound similar, their transcription lists must be fully distinct
- Do not include the exact same word in two different entity arrays

CONTENT RULES:
- For PROVIDER entity type: generate phonetic mishearings of the full name
  - Combine first + last name transcriptions AND combined full-name variants
  - Include: correct spelling, phonetic variants, common STT mishearings
  - Example for "Joel Patel": "joel", "juel", "jooel", "joil", "patel", "petel", "putel", "joel patel", "juel patel"
- For LOCATION entity type: include correct spelling, abbreviations, phonetic variants
  - Example for "Jupiter": "jupiter", "jup", "jupter", "rupiter", "jupitor"
- For ADDRESS entity type: use street name only (strip numbers, street types like Ave/Rd/St, directionals like N/S/East)
  - Example for "2055 Military Ave": "military", "millitry", "mullitry", "mallitary"
- For OTHER_NAMES entity type: include correct spelling, phonetic simplifications, spoken acronym spellings
  - Example for "PBG": "pbg", "ppg", "tbg", "tbgwe", "abg", "p b g"
- Avoid common filler words: "doctor", "what", "who", "whom", "the", "a", "an"
- If the name is "michael", include "michael" in its list

OUTPUT FORMAT:
Return ONLY a valid JSON object. No explanation, no commentary.
Keys are the entity names exactly as provided. Values are arrays of lowercase string transcriptions.
Example:
{
  "Joel Patel": ["joel", "juel", "jooel", "patel", "petel", "joel patel", "juel patel"],
  "Jupiter": ["jupiter", "jup", "jupter", "rupiter"]
}`;

// ─── Location + Address Combined Transcription System Prompt ────────────────
const LOCATION_COMBINED_SYSTEM_PROMPT = `You are a transcription and JSON formatting assistant for voice AI systems.
Your task is to generate phonetic transcription variants for LOCATION entities that include both the location name AND address components.

For each location, you will receive:
- The location name (e.g., "Nutrition", "Family Medicine")
- An optional street address (e.g., "632 Blue Hill Avenue")
- An optional readable name / alias (e.g., "Family Medicine Main Office")

STRICT RULES — follow ALL of them exactly:

WHAT TO GENERATE:
For each location, generate transcriptions for ALL of these components and merge them into ONE flat array:

1. LOCATION NAME transcriptions (from the location name):
   - Correct spelling, abbreviations, phonetic variations, STT mishearings
   - Generate 10-15 variants for the location name
   - Example: "Nutrition" → "nutrition", "nutriton", "nutrishun", "nutrision", "nutrishen", "nutricion", "nutrishon", "newtrition", "nutrtion", "nutri", "nutrish"

2. ADDRESS WORD transcriptions (from each significant word in the address):
   - REMOVE: numbers (632), street types (Ave/Avenue/Road/St/Street/Blvd/Dr/Drive), directionals (N/S/East/West/North/South)
   - For EACH remaining word, generate 8-12 phonetic variants
   - Example: "632 Blue Hill Avenue" → generate variants for "Blue" AND "Hill" separately:
     "blue" → "blue", "bloo", "blew", "blou", "bleu", "bue", "bluw", "bloue"
     "hill" → "hill", "hil", "hll", "heel", "heil", "hille", "hyll", "hel"

3. READABLE NAME transcriptions (if different from location name):
   - Generate 5-8 additional variants for any extra words in the readable name
   - Example: "Family Medicine Main Office" when name is "Family Medicine" → generate for "Main" and "Office"

FORMATTING:
- All transcriptions must be lowercase
- No duplicates within the merged array
- Generate AS MANY transcriptions as possible (aim for 25-50+ total per location)

UNIQUENESS RULES:
- No overlapping transcriptions across DIFFERENT locations in the same batch
- Each location's merged array must be fully distinct from other locations

OUTPUT FORMAT:
Return ONLY a valid JSON object. No explanation, no commentary.
Keys are the location names exactly as provided. Values are flat arrays of ALL transcription strings merged together.

Example for location "Nutrition" with address "632 Blue Hill Avenue":
{
  "Nutrition": [
    "nutrition", "nutriton", "nutrishun", "nutrision", "nutrishen", "nutricion", "nutrishon", "newtrition", "nutrtion", "nutri", "nutrish",
    "blue", "bloo", "blew", "blou", "bleu", "bue", "bluw", "bloue",
    "hill", "hil", "hll", "heel", "heil", "hille", "hyll", "hel"
  ]
}`;

// ─── Router ───────────────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  entity: router({
    // ── Generic variant generation (PROVIDER, simple LOCATION, ADDRESS, OTHER_NAMES) ──
    generateVariants: publicProcedure
      .input(
        z.object({
          entityType: z.enum(["PROVIDER", "LOCATION", "ADDRESS", "OTHER_NAMES"]),
          names: z.array(z.string().min(1)).min(1).max(50),
        })
      )
      .mutation(async ({ input }) => {
        const { entityType, names } = input;

        const userPrompt = `Entity type: ${entityType}
Generate transcription variants for the following ${names.length} entity name(s):
${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}

Return ONLY a JSON object where each key is the entity name and the value is an array of 10–15 unique lowercase transcription strings.
Ensure ZERO overlap between different entities' transcription lists.`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: TRANSCRIPTION_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "transcription_variants",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  entities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "The entity name exactly as provided" },
                        variants: {
                          type: "array",
                          items: { type: "string" },
                          description: "10–15 unique lowercase transcription variants",
                        },
                      },
                      required: ["name", "variants"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["entities"],
                additionalProperties: false,
              },
            },
          },
        });

        const rawContent = response?.choices?.[0]?.message?.content;
        const raw = typeof rawContent === "string" ? rawContent : null;
        if (!raw) throw new Error("LLM returned empty response");

        let parsed: { entities: { name: string; variants: string[] }[] };
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error("LLM returned invalid JSON");
        }

        const seen = new Set<string>();
        const result: Record<string, string[]> = {};

        for (const entity of parsed.entities) {
          const clean: string[] = [];
          for (const v of entity.variants) {
            const lower = v.toLowerCase().trim();
            if (lower && !seen.has(lower) && !clean.includes(lower)) {
              seen.add(lower);
              clean.push(lower);
            }
          }
          result[entity.name] = clean;
        }

        return result;
      }),

    // ── Location + Address combined variant generation ──────────────────────
    generateLocationVariants: publicProcedure
      .input(
        z.object({
          locations: z.array(z.object({
            name: z.string().min(1),
            address: z.string().default(""),
            readableName: z.string().default(""),
          })).min(1).max(20),
        })
      )
      .mutation(async ({ input }) => {
        const { locations } = input;

        const locationDescriptions = locations.map((loc, i) => {
          let desc = `${i + 1}. Location name: "${loc.name}"`;
          if (loc.address) desc += `\n   Address: "${loc.address}"`;
          if (loc.readableName && loc.readableName !== loc.name) desc += `\n   Readable name: "${loc.readableName}"`;
          return desc;
        }).join("\n");

        const userPrompt = `Generate combined transcription variants for the following ${locations.length} location(s):

${locationDescriptions}

For EACH location, generate transcriptions for:
1. The location name itself (10-15 variants)
2. Each significant word in the address (8-12 variants per word, skip numbers and street types like Ave/St/Road/Blvd)
3. Any extra words in the readable name not already covered (5-8 variants per word)

Merge ALL transcriptions into ONE flat array per location. Aim for 25-50+ total transcriptions per location.
Ensure ZERO overlap between different locations' transcription lists.
Return ONLY a JSON object where each key is the location name and the value is the merged flat array.`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: LOCATION_COMBINED_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "location_transcription_variants",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  entities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "The location name exactly as provided" },
                        variants: {
                          type: "array",
                          items: { type: "string" },
                          description: "All transcription variants merged into one flat array",
                        },
                      },
                      required: ["name", "variants"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["entities"],
                additionalProperties: false,
              },
            },
          },
        });

        const rawContent = response?.choices?.[0]?.message?.content;
        const raw = typeof rawContent === "string" ? rawContent : null;
        if (!raw) throw new Error("LLM returned empty response");

        let parsed: { entities: { name: string; variants: string[] }[] };
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error("LLM returned invalid JSON");
        }

        const seen = new Set<string>();
        const result: Record<string, string[]> = {};

        for (const entity of parsed.entities) {
          const clean: string[] = [];
          for (const v of entity.variants) {
            const lower = v.toLowerCase().trim();
            if (lower && !seen.has(lower) && !clean.includes(lower)) {
              seen.add(lower);
              clean.push(lower);
            }
          }
          result[entity.name] = clean;
        }

        return result;
      }),
  }),
});

export type AppRouter = typeof appRouter;
