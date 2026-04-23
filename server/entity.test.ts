import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mock the LLM helper ───────────────────────────────────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { invokeLLM } from "./_core/llm";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function makeLLMResponse(entities: { name: string; variants: string[] }[]) {
  return {
    id: "test",
    created: Date.now(),
    model: "test",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant" as const,
          content: JSON.stringify({ entities }),
        },
        finish_reason: "stop",
      },
    ],
  };
}

describe("entity.generateVariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a record of entity name → string array", async () => {
    const mockVariants = [
      "joel", "juel", "jooel", "joil", "joal", "goel",
      "patel", "petel", "putel", "patil", "joel patel", "juel patel",
    ];
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([{ name: "Joel Patel", variants: mockVariants }])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateVariants({
      entityType: "PROVIDER",
      names: ["Joel Patel"],
    });
    expect(result).toHaveProperty("Joel Patel");
    expect(Array.isArray(result["Joel Patel"])).toBe(true);
    expect(result["Joel Patel"].length).toBeGreaterThan(0);
  });

  it("enforces lowercase on all variants", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([{
        name: "Jupiter",
        variants: ["Jupiter", "JUPTER", "Jupitor", "jup", "rupiter", "jupter", "jupitr", "jupitor", "jupetr", "jupitar"],
      }])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateVariants({ entityType: "LOCATION", names: ["Jupiter"] });
    for (const v of result["Jupiter"]) {
      expect(v).toBe(v.toLowerCase());
    }
  });

  it("deduplicates variants within the same entity", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([{
        name: "Military",
        variants: ["military", "military", "millitry", "mullitry", "mallitary", "miletary", "militery", "militry", "millitary", "milltary"],
      }])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateVariants({ entityType: "ADDRESS", names: ["Military"] });
    const variants = result["Military"];
    const unique = variants.filter((v, i) => variants.indexOf(v) === i);
    expect(variants.length).toBe(unique.length);
  });

  it("removes cross-entity duplicate variants", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([
        { name: "Emily", variants: ["emily", "emilee", "emili", "emmily", "emely", "emiley", "emilly", "emmilee", "emilye", "emilii"] },
        { name: "Emma", variants: ["emily", "emma", "emah", "emmah", "ema", "emmuh", "emmma", "emuh", "emmaa", "emaa"] },
      ])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateVariants({ entityType: "PROVIDER", names: ["Emily", "Emma"] });
    const emilyVariants = result["Emily"] ?? [];
    const emmaVariants = result["Emma"] ?? [];
    for (const v of emilyVariants) {
      expect(emmaVariants).not.toContain(v);
    }
  });

  it("handles a batch of 5 names with zero cross-entity collisions", async () => {
    const names = ["Dr. Adams", "Dr. Baker", "Dr. Clark", "Dr. Davis", "Dr. Evans"];
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse(
        names.map((name, i) => ({
          name,
          variants: [`variant_${i}_a`, `variant_${i}_b`, `variant_${i}_c`, `variant_${i}_d`, `variant_${i}_e`],
        }))
      )
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateVariants({ entityType: "PROVIDER", names });
    const allVariants = names.flatMap(n => result[n] ?? []);
    const uniqueSet = new Set(allVariants);
    expect(uniqueSet.size).toBe(allVariants.length);
  });

  it("auto-removes shared variants across 5 entities when LLM returns collisions", async () => {
    const names = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([
        { name: "Alpha",   variants: ["shared", "alpha1", "alpha2"] },
        { name: "Beta",    variants: ["shared", "beta1", "beta2"] },
        { name: "Gamma",   variants: ["shared", "gamma1", "gamma2"] },
        { name: "Delta",   variants: ["shared", "delta1", "delta2"] },
        { name: "Epsilon", variants: ["shared", "epsilon1", "epsilon2"] },
      ])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateVariants({ entityType: "PROVIDER", names });
    const allVariants = names.flatMap(n => result[n] ?? []);
    const seen = new Set<string>();
    for (const v of allVariants) {
      expect(seen.has(v)).toBe(false);
      seen.add(v);
    }
  });

  it("accepts LOCATION entity type and returns variants", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([{ name: "Jupiter Medical", variants: ["jupiter", "jupter", "jup", "jupitor", "rupiter"] }])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateVariants({ entityType: "LOCATION", names: ["Jupiter Medical"] });
    expect(result["Jupiter Medical"].length).toBeGreaterThan(0);
  });

  it("accepts ADDRESS entity type and returns lowercase street variants", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([{ name: "2055 Military Ave", variants: ["military", "millitry", "mullitry", "mallitary", "miletary"] }])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateVariants({ entityType: "ADDRESS", names: ["2055 Military Ave"] });
    const variants = result["2055 Military Ave"];
    expect(variants.every(v => v === v.toLowerCase())).toBe(true);
    expect(variants.some(v => v.includes("milit"))).toBe(true);
  });

  it("accepts OTHER_NAMES entity type", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([{ name: "PBG", variants: ["pbg", "ppg", "tbg", "abg", "p b g", "pibg", "pibge", "pbge", "pbgee", "pbgi"] }])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateVariants({ entityType: "OTHER_NAMES", names: ["PBG"] });
    expect(result["PBG"].length).toBeGreaterThan(0);
  });

  it("throws on empty LLM response", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce({
      id: "test", created: Date.now(), model: "test",
      choices: [{ index: 0, message: { role: "assistant" as const, content: "" }, finish_reason: "stop" }],
    });
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.entity.generateVariants({ entityType: "PROVIDER", names: ["Test"] })
    ).rejects.toThrow();
  });

  it("throws on invalid JSON from LLM", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce({
      id: "test", created: Date.now(), model: "test",
      choices: [{ index: 0, message: { role: "assistant" as const, content: "not valid json" }, finish_reason: "stop" }],
    });
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.entity.generateVariants({ entityType: "PROVIDER", names: ["Test"] })
    ).rejects.toThrow("LLM returned invalid JSON");
  });

  it("rejects input with more than 50 names", async () => {
    const caller = appRouter.createCaller(createCtx());
    const tooMany = Array.from({ length: 51 }, (_, i) => `Name ${i}`);
    await expect(
      caller.entity.generateVariants({ entityType: "PROVIDER", names: tooMany })
    ).rejects.toThrow();
  });
});

// ─── Location + Address Combined Variant Tests ──────────────────────────────
describe("entity.generateLocationVariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns combined location name + address word variants in a flat array", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([{
        name: "Nutrition",
        variants: [
          // Location name variants
          "nutrition", "nutriton", "nutrishun", "nutrision", "nutrishen", "nutricion",
          // Address word "blue" variants
          "blue", "bloo", "blew", "blou", "bleu",
          // Address word "hill" variants
          "hill", "hil", "hll", "heel", "heil",
        ],
      }])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateLocationVariants({
      locations: [{ name: "Nutrition", address: "632 Blue Hill Avenue", readableName: "" }],
    });

    expect(result).toHaveProperty("Nutrition");
    const variants = result["Nutrition"];
    expect(Array.isArray(variants)).toBe(true);

    // Should contain location name variants
    expect(variants).toContain("nutrition");
    expect(variants).toContain("nutrishun");

    // Should contain address word variants
    expect(variants).toContain("blue");
    expect(variants).toContain("hill");
  });

  it("enforces lowercase on all location variants", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([{
        name: "Family Medicine",
        variants: ["Family", "MEDICINE", "Fam", "familee", "medisine", "medicin", "famly", "medcine"],
      }])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateLocationVariants({
      locations: [{ name: "Family Medicine", address: "100 Main St", readableName: "" }],
    });
    for (const v of result["Family Medicine"]) {
      expect(v).toBe(v.toLowerCase());
    }
  });

  it("deduplicates variants within a single location", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([{
        name: "Wellness Center",
        variants: ["wellness", "wellness", "welnes", "center", "center", "centr", "senter", "wellnes"],
      }])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateLocationVariants({
      locations: [{ name: "Wellness Center", address: "", readableName: "" }],
    });
    const variants = result["Wellness Center"];
    const unique = variants.filter((v, i) => variants.indexOf(v) === i);
    expect(variants.length).toBe(unique.length);
  });

  it("removes cross-location duplicate variants", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([
        { name: "Nutrition", variants: ["nutrition", "nutrishun", "blue", "bloo", "hill", "hil"] },
        { name: "Blue Cross Clinic", variants: ["blue", "bloo", "cross", "kross", "clinic", "klinic"] },
      ])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateLocationVariants({
      locations: [
        { name: "Nutrition", address: "632 Blue Hill Avenue", readableName: "" },
        { name: "Blue Cross Clinic", address: "100 Oak St", readableName: "" },
      ],
    });
    const nutritionVars = result["Nutrition"] ?? [];
    const blueVars = result["Blue Cross Clinic"] ?? [];

    // "blue" and "bloo" should only appear in Nutrition (first entity wins)
    for (const v of nutritionVars) {
      expect(blueVars).not.toContain(v);
    }
  });

  it("handles multiple locations in a batch", async () => {
    const locations = [
      { name: "Jupiter Medical", address: "2055 Military Trail", readableName: "Jupiter Medical Center" },
      { name: "Palm Beach Clinic", address: "500 Royal Palm Way", readableName: "" },
      { name: "Sunrise Health", address: "1200 Sunrise Blvd", readableName: "Sunrise Health Center" },
    ];
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([
        { name: "Jupiter Medical", variants: ["jupiter", "jupter", "medical", "medcal", "military", "millitry", "trail", "trale"] },
        { name: "Palm Beach Clinic", variants: ["palm", "pam", "beach", "beech", "clinic", "klinic", "royal", "royl"] },
        { name: "Sunrise Health", variants: ["sunrise", "sunrize", "health", "helth", "center", "centr"] },
      ])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateLocationVariants({ locations });

    expect(Object.keys(result)).toHaveLength(3);
    expect(result["Jupiter Medical"].length).toBeGreaterThan(0);
    expect(result["Palm Beach Clinic"].length).toBeGreaterThan(0);
    expect(result["Sunrise Health"].length).toBeGreaterThan(0);

    // No cross-location duplicates
    const allVariants = Object.values(result).flat();
    const uniqueSet = new Set(allVariants);
    expect(uniqueSet.size).toBe(allVariants.length);
  });

  it("includes readable name word variants when different from location name", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce(
      makeLLMResponse([{
        name: "Nutrition",
        variants: [
          "nutrition", "nutriton", "nutrishun",
          "blue", "bloo", "blew",
          "hill", "hil", "heel",
          "healthy", "helthy", "healthee",
        ],
      }])
    );
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.entity.generateLocationVariants({
      locations: [{ name: "Nutrition", address: "632 Blue Hill Avenue", readableName: "Nutrition Healthy Living" }],
    });
    const variants = result["Nutrition"];
    // Should contain readable name word variants
    expect(variants).toContain("healthy");
    expect(variants).toContain("helthy");
  });

  it("throws on empty LLM response", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce({
      id: "test", created: Date.now(), model: "test",
      choices: [{ index: 0, message: { role: "assistant" as const, content: "" }, finish_reason: "stop" }],
    });
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.entity.generateLocationVariants({
        locations: [{ name: "Test", address: "123 Main St", readableName: "" }],
      })
    ).rejects.toThrow();
  });

  it("throws on invalid JSON from LLM", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce({
      id: "test", created: Date.now(), model: "test",
      choices: [{ index: 0, message: { role: "assistant" as const, content: "not valid json" }, finish_reason: "stop" }],
    });
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.entity.generateLocationVariants({
        locations: [{ name: "Test", address: "123 Main St", readableName: "" }],
      })
    ).rejects.toThrow("LLM returned invalid JSON");
  });

  it("rejects input with more than 20 locations", async () => {
    const caller = appRouter.createCaller(createCtx());
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      name: `Location ${i}`, address: `${i} Main St`, readableName: "",
    }));
    await expect(
      caller.entity.generateLocationVariants({ locations: tooMany })
    ).rejects.toThrow();
  });
});
