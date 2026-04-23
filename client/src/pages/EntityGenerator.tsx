import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Copy, Trash2, Plus, ChevronDown, Loader2, X, Wand2,
  FileJson, Edit3, Check, Zap, Sparkles, AlertTriangle,
  ShieldCheck, Clock, RefreshCw, Upload, FileSpreadsheet, MapPin,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

// ─── Types ────────────────────────────────────────────────────────────────────
type EntityType = "PROVIDER" | "LOCATION" | "ADDRESS" | "OTHER_NAMES";
type EntityStatus = "queued" | "generating" | "done" | "error";

interface Entity {
  id: string;
  name: string;
  type: EntityType;
  variants: string[];
  status: EntityStatus;
  collisions: string[];
  error?: string;
  // Location-specific metadata
  address?: string;
  readableName?: string;
}

const ENTITY_TYPES: {
  value: EntityType; label: string; description: string; color: string; glow: string;
}[] = [
  { value: "PROVIDER",    label: "PROVIDER",    description: "Doctor / staff names",  color: "oklch(0.45 0.22 250)", glow: "oklch(0.45 0.22 250 / 0.18)" },
  { value: "LOCATION",    label: "LOCATION",    description: "Clinic / facility names + address",   color: "oklch(0.48 0.18 160)",  glow: "oklch(0.48 0.18 160 / 0.18)"  },
  { value: "ADDRESS",     label: "ADDRESS",     description: "Street address names",  color: "oklch(0.52 0.18 220)", glow: "oklch(0.52 0.18 220 / 0.18)" },
  { value: "OTHER_NAMES", label: "OTHER NAMES", description: "Acronyms / aliases",    color: "oklch(0.55 0.15 85)", glow: "oklch(0.55 0.15 85 / 0.18)"  },
];
const TYPE_MAP = Object.fromEntries(ENTITY_TYPES.map(t => [t.value, t])) as Record<EntityType, typeof ENTITY_TYPES[0]>;

function genId() { return Math.random().toString(36).slice(2, 10); }
function parseNames(raw: string): string[] {
  return raw.split(/[\n,\t]+/).map(s => s.trim()).filter(s => s.length > 0);
}

// ─── CSV Parser ──────────────────────────────────────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

// ─── CSV Format Detection ────────────────────────────────────────────────────
type CSVFormat = "provider" | "location" | "unknown";

function detectCSVFormat(rows: Record<string, string>[]): CSVFormat {
  if (rows.length === 0) return "unknown";
  const cols = Object.keys(rows[0]).map(c => c.toLowerCase().trim());

  // Location CSV: has "Accessible Via Assort" or ("Address" + "Location Readable")
  const hasAccessibleViaAssort = cols.some(c => c === "accessible via assort");
  const hasAddress = cols.some(c => c === "address");
  const hasLocationReadable = cols.some(c => c === "location readable");

  if (hasAccessibleViaAssort || (hasAddress && hasLocationReadable)) return "location";

  // Provider CSV: has "Accessible" + ("Name Readable" or "Name")
  const hasAccessible = cols.some(c => c === "accessible");
  const hasNameReadable = cols.some(c => c === "name readable");
  const hasName = cols.some(c => c === "name");

  if (hasAccessible && (hasNameReadable || hasName)) return "provider";

  // Fallback: if it has "Name" column, treat as provider
  if (hasName || hasNameReadable) return "provider";

  return "unknown";
}

// ─── Collision engine ─────────────────────────────────────────────────────────
function resolveCollisions(entities: Entity[]): Entity[] {
  const registry = new Map<string, string>();
  const collisionMap = new Map<string, Set<string>>();

  for (const e of entities) {
    if (e.status !== "done") continue;
    for (const v of e.variants) {
      if (registry.has(v)) {
        if (!collisionMap.has(v)) collisionMap.set(v, new Set([registry.get(v)!]));
        collisionMap.get(v)!.add(e.id);
      } else {
        registry.set(v, e.id);
      }
    }
  }

  const collidingVariants = new Set(collisionMap.keys());

  return entities.map(e => ({
    ...e,
    collisions: e.status === "done" ? e.variants.filter(v => collidingVariants.has(v)) : [],
  }));
}

function autoRemoveCollisions(entities: Entity[]): Entity[] {
  const seen = new Set<string>();
  const result: Entity[] = [];
  for (const e of entities) {
    if (e.status !== "done") { result.push(e); continue; }
    const clean = e.variants.filter(v => {
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    });
    result.push({ ...e, variants: clean, collisions: [] });
  }
  return result;
}

// ─── Syntax-colored JSON (light theme) ───────────────────────────────────────
function ColoredJson({ json }: { json: string }) {
  const colored = json
    .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span style="color:oklch(0.42 0.22 250)">$1</span>$2')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span style="color:oklch(0.52 0.18 85)">$1</span>')
    .replace(/[{}[\]]/g, m => `<span style="color:oklch(0.50 0.02 250)">${m}</span>`);
  return (
    <pre
      className="text-foreground"
      style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: "1.7" }}
      dangerouslySetInnerHTML={{ __html: colored }}
    />
  );
}

// ─── Design tokens (Light theme: White / Blue / Yellow) ─────────────────────
const S = {
  bg:          "oklch(0.985 0.002 250)",
  panel:       "oklch(1 0 0)",
  panelBorder: "oklch(0.90 0.010 250)",
  inputBg:     "oklch(0.975 0.004 250)",
  tagBg:       "oklch(0.96 0.008 250)",
  tagBorder:   "oklch(0.88 0.012 250)",
  mutedText:   "oklch(0.50 0.02 250)",
  dimText:     "oklch(0.62 0.015 250)",
  bodyText:    "oklch(0.14 0.03 250)",
  blue:        "oklch(0.45 0.22 250)",
  green:       "oklch(0.48 0.18 160)",
  amber:       "oklch(0.58 0.18 85)",
  red:         "oklch(0.52 0.22 25)",
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function EntityGenerator() {
  const [entityType, setEntityType]       = useState<EntityType>("PROVIDER");
  const [inputText, setInputText]         = useState("");
  const [entities, setEntities]           = useState<Entity[]>([]);
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [addVariantText, setAddVariantText] = useState("");
  const [bulkEditText, setBulkEditText]   = useState("");
  const [bulkEditOpen, setBulkEditOpen]   = useState(false);
  const [jsonOpen, setJsonOpen]           = useState(true);
  const [copied, setCopied]               = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);

  // CSV upload state
  const [csvSummary, setCsvSummary]       = useState<{ total: number; accessible: number; skipped: number; format: CSVFormat } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver]       = useState(false);

  // Queue state
  const [queueTotal, setQueueTotal]       = useState(0);
  const [queueDone, setQueueDone]         = useState(0);
  const [isProcessing, setIsProcessing]   = useState(false);

  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processingRef  = useRef<Set<string>>(new Set());
  const queueRef       = useRef<{ name: string; type: EntityType; id: string; address?: string; readableName?: string }[]>([]);
  const activeJobsRef  = useRef(0);
  const CONCURRENCY    = 4;
  const BATCH_SIZE     = 10;
  const LOCATION_BATCH = 5; // Smaller batches for locations (more data per call)

  const generateMutation = trpc.entity.generateVariants.useMutation();
  const generateLocationMutation = trpc.entity.generateLocationVariants.useMutation();

  const selectedEntity = useMemo(
    () => entities.find(e => e.id === selectedId) ?? null,
    [entities, selectedId]
  );

  // ─── Global collision stats ───────────────────────────────────────────────
  const collisionStats = useMemo(() => {
    const registry = new Map<string, string[]>();
    for (const e of entities) {
      if (e.status !== "done") continue;
      for (const v of e.variants) {
        if (!registry.has(v)) registry.set(v, []);
        registry.get(v)!.push(e.name);
      }
    }
    const conflicts: { variant: string; owners: string[] }[] = [];
    Array.from(registry.entries()).forEach(([v, owners]) => {
      if (owners.length > 1) conflicts.push({ variant: v, owners });
    });
    return conflicts;
  }, [entities]);

  const totalVariants = useMemo(
    () => entities.reduce((s, e) => s + e.variants.length, 0),
    [entities]
  );

  // ─── Queue processor ──────────────────────────────────────────────────────
  const processNextBatch = useCallback(async () => {
    if (activeJobsRef.current >= CONCURRENCY || queueRef.current.length === 0) return;

    // Peek at the first item to determine if this is a location batch
    const firstItem = queueRef.current[0];
    const isLocationBatch = firstItem.type === "LOCATION" && (firstItem.address !== undefined || firstItem.readableName !== undefined);
    const batchSize = isLocationBatch ? LOCATION_BATCH : BATCH_SIZE;

    const batch = queueRef.current.splice(0, batchSize);
    if (batch.length === 0) return;

    activeJobsRef.current += 1;
    const ids = batch.map(b => b.id);

    setEntities(prev => prev.map(e =>
      ids.includes(e.id) ? { ...e, status: "generating" as EntityStatus } : e
    ));

    try {
      let result: Record<string, string[]>;

      if (isLocationBatch) {
        // Use the location-specific mutation
        const locations = batch.map(b => ({
          name: b.name,
          address: b.address || "",
          readableName: b.readableName || "",
        }));
        result = await generateLocationMutation.mutateAsync({ locations });
      } else {
        // Use the generic mutation
        const names = batch.map(b => b.name);
        const type = batch[0].type;
        result = await generateMutation.mutateAsync({ entityType: type, names });
      }

      setEntities(prev => {
        const existingVariants = new Set<string>();
        for (const e of prev) {
          if (!ids.includes(e.id) && e.status === "done") {
            for (const v of e.variants) existingVariants.add(v);
          }
        }

        const updated = prev.map(e => {
          if (!ids.includes(e.id)) return e;
          const raw = (result[e.name] ?? []).map((v: string) => v.toLowerCase().trim()).filter(Boolean);
          const seen = new Set<string>();
          const clean = raw.filter((v: string) => {
            if (seen.has(v) || existingVariants.has(v)) return false;
            seen.add(v);
            existingVariants.add(v);
            return true;
          });
          return { ...e, variants: clean, status: "done" as EntityStatus, collisions: [] };
        });

        return resolveCollisions(updated);
      });

      setQueueDone(d => d + batch.length);
    } catch {
      setEntities(prev => prev.map(e =>
        ids.includes(e.id) ? { ...e, status: "error" as EntityStatus, error: "Generation failed" } : e
      ));
      setQueueDone(d => d + batch.length);
      const names = batch.map(b => b.name);
      toast.error(`Failed to generate variants for: ${names.join(", ")}`);
    } finally {
      activeJobsRef.current -= 1;
      batch.forEach(b => processingRef.current.delete(b.name.toLowerCase()));

      if (queueRef.current.length > 0) {
        processNextBatch();
      } else if (activeJobsRef.current === 0) {
        setIsProcessing(false);
      }
    }
  }, [generateMutation, generateLocationMutation]);

  // ─── Enqueue names (generic) ──────────────────────────────────────────────
  const enqueueNames = useCallback((names: string[], type: EntityType) => {
    const existingNames = new Set(entities.map(e => e.name.toLowerCase()));
    const seen = new Set<string>();
    const newNames = names.filter(n => {
      const key = n.toLowerCase();
      if (existingNames.has(key) || processingRef.current.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (newNames.length === 0) return;

    const placeholders: Entity[] = newNames.map(name => ({
      id: genId(), name, type, variants: [], status: "queued", collisions: [],
    }));

    setEntities(prev => [...prev, ...placeholders]);
    setSelectedId(prev => prev ?? placeholders[0]?.id ?? null);
    newNames.forEach(n => processingRef.current.add(n.toLowerCase()));

    const jobs = placeholders.map(p => ({ name: p.name, type, id: p.id }));
    queueRef.current.push(...jobs);

    setQueueTotal(t => t + newNames.length);
    setIsProcessing(true);

    for (let i = 0; i < CONCURRENCY; i++) {
      processNextBatch();
    }
  }, [entities, processNextBatch]);

  // ─── Enqueue locations (with address + readable name) ─────────────────────
  const enqueueLocations = useCallback((locations: { name: string; address: string; readableName: string }[]) => {
    const existingNames = new Set(entities.map(e => e.name.toLowerCase()));
    const seen = new Set<string>();
    const newLocations = locations.filter(loc => {
      const key = loc.name.toLowerCase();
      if (existingNames.has(key) || processingRef.current.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (newLocations.length === 0) return;

    const placeholders: Entity[] = newLocations.map(loc => ({
      id: genId(),
      name: loc.name,
      type: "LOCATION" as EntityType,
      variants: [],
      status: "queued",
      collisions: [],
      address: loc.address,
      readableName: loc.readableName,
    }));

    setEntities(prev => [...prev, ...placeholders]);
    setSelectedId(prev => prev ?? placeholders[0]?.id ?? null);
    newLocations.forEach(loc => processingRef.current.add(loc.name.toLowerCase()));

    const jobs = placeholders.map((p, i) => ({
      name: p.name,
      type: "LOCATION" as EntityType,
      id: p.id,
      address: newLocations[i].address,
      readableName: newLocations[i].readableName,
    }));
    queueRef.current.push(...jobs);

    setQueueTotal(t => t + newLocations.length);
    setIsProcessing(true);

    for (let i = 0; i < CONCURRENCY; i++) {
      processNextBatch();
    }
  }, [entities, processNextBatch]);

  useEffect(() => {
    if (!isProcessing) return;
    setEntities(prev => prev.map(e =>
      e.status === "queued" && !queueRef.current.find(q => q.id === e.id)
        ? { ...e, status: "generating" }
        : e
    ));
  }, [isProcessing, queueDone]);

  useEffect(() => {
    if (!isProcessing && queueTotal > 0 && queueDone >= queueTotal) {
      setTimeout(() => {
        setQueueTotal(0);
        setQueueDone(0);
      }, 2000);
    }
  }, [isProcessing, queueTotal, queueDone]);

  // ─── CSV Upload handler (auto-detects Provider vs Location) ───────────────
  const handleCSVUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length === 0) {
        toast.error("Could not parse CSV — no data rows found");
        return;
      }

      const format = detectCSVFormat(rows);
      const findCol = (target: string) =>
        Object.keys(rows[0]).find(k => k.toLowerCase().trim() === target.toLowerCase());

      if (format === "location") {
        // ── Location CSV ──────────────────────────────────────────────────
        const accessibleCol = findCol("Accessible Via Assort") || findCol("Accessible");
        const nameCol = findCol("Name");
        const addressCol = findCol("Address");
        const readableCol = findCol("Location Readable");

        if (!nameCol) {
          toast.error("Location CSV must have a 'Name' column");
          return;
        }

        const total = rows.length;
        let accessibleRows = rows;

        if (accessibleCol) {
          accessibleRows = rows.filter(r => (r[accessibleCol] || "").trim().toLowerCase() === "yes");
        } else {
          toast.warning("No 'Accessible' column found — importing all rows.");
        }

        const locations = accessibleRows
          .map(r => ({
            name: (r[nameCol] || "").trim(),
            address: addressCol ? (r[addressCol] || "").trim() : "",
            readableName: readableCol ? (r[readableCol] || "").trim() : "",
          }))
          .filter(loc => loc.name.length > 0 && loc.name.toLowerCase() !== "n/a");

        const skipped = total - locations.length;

        setCsvSummary({ total, accessible: locations.length, skipped, format: "location" });

        if (locations.length === 0) {
          toast.warning("No accessible locations found in CSV");
          return;
        }

        setEntityType("LOCATION");
        if (debounceRef.current) clearTimeout(debounceRef.current);

        // Build display text for the input area
        const displayLines = locations.map(loc => {
          let line = loc.name;
          if (loc.address) line += ` | ${loc.address}`;
          if (loc.readableName && loc.readableName !== loc.name) line += ` | ${loc.readableName}`;
          return line;
        });
        setInputText(displayLines.join("\n"));

        // Enqueue locations with metadata
        setTimeout(() => enqueueLocations(locations), 50);

        toast.success(`Loaded ${locations.length} accessible locations from CSV`);

      } else if (format === "provider") {
        // ── Provider CSV ──────────────────────────────────────────────────
        const accessibleCol = findCol("Accessible");
        const nameCol = findCol("Name Readable") || findCol("Name") || findCol("First Name");

        if (!nameCol) {
          toast.error("Provider CSV must have a 'Name Readable' or 'Name' column");
          return;
        }

        const total = rows.length;
        let accessibleRows = rows;

        if (accessibleCol) {
          accessibleRows = rows.filter(r => (r[accessibleCol] || "").trim().toLowerCase() === "yes");
        } else {
          toast.warning("No 'Accessible' column found — importing all rows.");
        }

        const names = accessibleRows
          .map(r => (r[nameCol] || "").trim())
          .filter(n => n.length > 0 && n.toLowerCase() !== "n/a");

        const skipped = total - names.length;

        setCsvSummary({ total, accessible: names.length, skipped, format: "provider" });

        if (names.length === 0) {
          toast.warning("No accessible providers found in CSV");
          return;
        }

        setEntityType("PROVIDER");
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setInputText(names.join("\n"));
        setTimeout(() => enqueueNames(names, "PROVIDER"), 50);

        toast.success(`Loaded ${names.length} accessible providers from CSV`);

      } else {
        toast.error("Could not detect CSV format. Expected Provider or Location columns.");
      }
    };
    reader.readAsText(file);
  }, [enqueueNames, enqueueLocations]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".csv") || file.type === "text/csv")) {
      handleCSVUpload(file);
    } else {
      toast.error("Please drop a CSV file");
    }
  }, [handleCSVUpload]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleCSVUpload(file);
    e.target.value = "";
  }, [handleCSVUpload]);

  // ─── Input handling ───────────────────────────────────────────────────────
  const handleInputChange = useCallback((value: string) => {
    setInputText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const names = parseNames(value);
      if (names.length > 0) enqueueNames(names, entityType);
    }, 600);
  }, [entityType, enqueueNames]);

  const handleTypeChange = useCallback((type: EntityType) => {
    setEntityType(type);
    if (inputText.trim()) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const names = parseNames(inputText);
        if (names.length > 0) enqueueNames(names, type);
      }, 300);
    }
  }, [inputText, enqueueNames]);

  // ─── Editing ──────────────────────────────────────────────────────────────
  const removeVariant = useCallback((entityId: string, variant: string) => {
    setEntities(prev => {
      const updated = prev.map(e =>
        e.id === entityId ? { ...e, variants: e.variants.filter(v => v !== variant) } : e
      );
      return resolveCollisions(updated);
    });
  }, []);

  const addVariant = useCallback(() => {
    if (!selectedEntity || !addVariantText.trim()) return;
    const newVar = addVariantText.trim().toLowerCase();
    const collision = entities.find(e => e.id !== selectedEntity.id && e.variants.includes(newVar));
    if (collision) {
      toast.error(`"${newVar}" already exists in entity "${collision.name}"`);
      return;
    }
    if (selectedEntity.variants.includes(newVar)) {
      toast.error("Variant already exists in this entity");
      return;
    }
    setEntities(prev => {
      const updated = prev.map(e =>
        e.id === selectedEntity.id ? { ...e, variants: [...e.variants, newVar] } : e
      );
      return resolveCollisions(updated);
    });
    setAddVariantText("");
  }, [selectedEntity, addVariantText, entities]);

  const removeEntity = useCallback((id: string) => {
    setEntities(prev => resolveCollisions(prev.filter(e => e.id !== id)));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  const clearAll = useCallback(() => {
    setEntities([]); setSelectedId(null); setInputText("");
    setAddVariantText(""); setBulkEditText(""); setBulkEditOpen(false);
    queueRef.current = []; processingRef.current.clear();
    setQueueTotal(0); setQueueDone(0); setIsProcessing(false);
    setCsvSummary(null);
  }, []);

  const resolveAllCollisions = useCallback(() => {
    setEntities(prev => autoRemoveCollisions(prev));
    toast.success("All collisions resolved — duplicates removed from later entities");
  }, []);

  const retryEntity = useCallback((entity: Entity) => {
    processingRef.current.delete(entity.name.toLowerCase());
    setEntities(prev => prev.map(e => e.id === entity.id ? { ...e, status: "queued", error: undefined } : e));
    queueRef.current.push({
      name: entity.name,
      type: entity.type,
      id: entity.id,
      address: entity.address,
      readableName: entity.readableName,
    });
    processingRef.current.add(entity.name.toLowerCase());
    setQueueTotal(t => t + 1);
    setIsProcessing(true);
    processNextBatch();
  }, [processNextBatch]);

  useEffect(() => {
    if (bulkEditOpen && selectedEntity) setBulkEditText(selectedEntity.variants.join("\n"));
  }, [bulkEditOpen, selectedEntity?.id]);

  const saveBulkEdit = useCallback(() => {
    if (!selectedEntity) return;
    const lines = bulkEditText.split("\n").map(l => l.trim().toLowerCase()).filter(l => l.length > 0);
    const seenLocal = new Set<string>();
    const unique = lines.filter(l => { if (seenLocal.has(l)) return false; seenLocal.add(l); return true; });
    const otherVariants = new Set(
      entities.filter(e => e.id !== selectedEntity.id).flatMap(e => e.variants)
    );
    const clean = unique.filter(v => !otherVariants.has(v));
    const removed = unique.length - clean.length;
    setEntities(prev => {
      const updated = prev.map(e => e.id === selectedEntity.id ? { ...e, variants: clean } : e);
      return resolveCollisions(updated);
    });
    setBulkEditOpen(false);
    if (removed > 0) toast.warning(`Saved — ${removed} collision(s) auto-removed`);
    else toast.success("Bulk edit saved");
  }, [selectedEntity, bulkEditText, entities]);

  // ─── JSON ─────────────────────────────────────────────────────────────────
  const jsonOutput = useMemo(() => JSON.stringify(
    Object.fromEntries(
      entities.filter(e => e.status === "done" && e.variants.length > 0).map(e => [e.name, e.variants])
    ), null, 2
  ), [entities]);

  const copyJson = useCallback(async () => {
    await navigator.clipboard.writeText(jsonOutput);
    setCopied(true);
    toast.success("JSON copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }, [jsonOutput]);

  const progressPct = queueTotal > 0 ? Math.round((queueDone / queueTotal) * 100) : 0;
  const currentType = TYPE_MAP[entityType];

  // ─── Status icon ──────────────────────────────────────────────────────────
  function StatusIcon({ entity }: { entity: Entity }) {
    if (entity.status === "queued")     return <Clock size={9} style={{ color: S.dimText }} />;
    if (entity.status === "generating") return <Loader2 size={9} className="animate-spin" style={{ color: S.blue }} />;
    if (entity.status === "error")      return <AlertTriangle size={9} style={{ color: S.red }} />;
    if (entity.collisions.length > 0)   return <AlertTriangle size={9} style={{ color: S.amber }} />;
    return <ShieldCheck size={9} style={{ color: S.green }} />;
  }

  return (
    <div
      className="flex flex-col"
      style={{
        height: "100vh", overflow: "hidden",
        background: S.bg,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleFileDrop}
    >
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />

      {/* Drag overlay */}
      <AnimatePresence>
        {isDragOver && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "oklch(0.45 0.22 250 / 0.08)", backdropFilter: "blur(4px)" }}
          >
            <div className="flex flex-col items-center gap-3 p-8 rounded-2xl"
              style={{ background: S.panel, border: `2px dashed ${S.blue}`, boxShadow: `0 0 40px oklch(0.45 0.22 250 / 0.15)` }}>
              <Upload size={36} style={{ color: S.blue }} />
              <p className="text-lg font-semibold" style={{ color: S.bodyText }}>Drop CSV file here</p>
              <p className="text-sm" style={{ color: S.mutedText }}>Auto-detects Provider or Location format. Only accessible entries will be imported.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-6 py-3"
        style={{
          background: S.panel,
          borderBottom: `1px solid ${S.panelBorder}`,
          boxShadow: "0 1px 3px oklch(0 0 0 / 0.06)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="relative w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: "oklch(0.45 0.22 250 / 0.10)",
              border: "1px solid oklch(0.45 0.22 250 / 0.25)",
            }}
          >
            <Wand2 size={16} style={{ color: S.blue }} />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
              style={{ background: S.blue, boxShadow: `0 0 6px ${S.blue}` }} />
          </div>
          <div>
            <h1 className="text-[15px] font-bold tracking-tight leading-none"
              style={{
                fontFamily: "'Syne', 'Inter', sans-serif",
                color: S.bodyText,
              }}>
              Entity Generator
            </h1>
            <p className="text-[11px] mt-0.5 leading-none" style={{ color: S.mutedText }}>
              Generate phonetic variations for voice AI transcription entities
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Stats pill */}
          {entities.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
              style={{ background: "oklch(0.45 0.22 250 / 0.06)", border: `1px solid oklch(0.45 0.22 250 / 0.15)`, color: S.blue }}>
              <Sparkles size={11} />
              <span className="font-medium">{entities.length} {entities.length === 1 ? "entity" : "entities"}</span>
              <span style={{ color: S.dimText }}>·</span>
              <span>{totalVariants} variants</span>
            </div>
          )}

          {/* CSV summary */}
          {csvSummary && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
              style={{
                background: csvSummary.format === "location" ? "oklch(0.48 0.18 160 / 0.06)" : "oklch(0.55 0.15 160 / 0.06)",
                border: `1px solid ${csvSummary.format === "location" ? "oklch(0.48 0.18 160 / 0.18)" : "oklch(0.55 0.15 160 / 0.18)"}`,
                color: csvSummary.format === "location" ? "oklch(0.38 0.15 160)" : "oklch(0.40 0.15 160)",
              }}>
              {csvSummary.format === "location" ? <MapPin size={11} /> : <FileSpreadsheet size={11} />}
              <span className="font-medium">{csvSummary.accessible} accessible {csvSummary.format === "location" ? "locations" : "providers"}</span>
              <span style={{ color: S.dimText }}>/ {csvSummary.total} total</span>
              {csvSummary.skipped > 0 && (
                <><span style={{ color: S.dimText }}>·</span><span style={{ color: S.red }}>{csvSummary.skipped} skipped</span></>
              )}
            </div>
          )}

          {/* Collision badge */}
          {collisionStats.length > 0 && (
            <button
              onClick={() => setShowConflicts(o => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                background: showConflicts ? "oklch(0.58 0.18 85 / 0.12)" : "oklch(0.58 0.18 85 / 0.06)",
                border: `1px solid oklch(0.58 0.18 85 / ${showConflicts ? "0.35" : "0.18"})`,
                color: S.amber,
              }}
            >
              <AlertTriangle size={11} />
              {collisionStats.length} collision{collisionStats.length !== 1 ? "s" : ""}
            </button>
          )}

          {/* Auto-resolve */}
          {collisionStats.length > 0 && (
            <button
              onClick={resolveAllCollisions}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                background: "oklch(0.45 0.22 250 / 0.06)",
                border: "1px solid oklch(0.45 0.22 250 / 0.18)",
                color: S.blue,
              }}
            >
              <ShieldCheck size={11} />
              Auto-Resolve
            </button>
          )}

          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ background: S.inputBg, border: `1px solid ${S.panelBorder}`, color: S.mutedText }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = S.red; (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.52 0.22 25 / 0.35)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = S.mutedText; (e.currentTarget as HTMLElement).style.borderColor = S.panelBorder; }}
          >
            <Trash2 size={12} /> Clear All
          </button>
        </div>
      </header>

      {/* ══ PROGRESS BAR (bulk) ═════════════════════════════════════════════ */}
      <AnimatePresence>
        {isProcessing && queueTotal > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0 px-6 py-2 flex items-center gap-3"
            style={{ background: "oklch(0.45 0.22 250 / 0.04)", borderBottom: `1px solid ${S.panelBorder}` }}
          >
            <Loader2 size={12} className="animate-spin flex-shrink-0" style={{ color: S.blue }} />
            <div className="flex-1">
              <Progress value={progressPct} className="h-1.5" />
            </div>
            <span className="text-[11px] font-medium flex-shrink-0 tabular-nums" style={{ color: S.blue }}>
              {queueDone} / {queueTotal}
            </span>
            <span className="text-[11px] flex-shrink-0" style={{ color: S.mutedText }}>
              entities processed
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══ COLLISION PANEL ═════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showConflicts && collisionStats.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0 overflow-hidden"
            style={{ borderBottom: `1px solid oklch(0.58 0.18 85 / 0.18)`, background: "oklch(0.58 0.18 85 / 0.04)" }}
          >
            <div className="px-6 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: S.amber }}>
                  Collision Report — {collisionStats.length} conflicting variant{collisionStats.length !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={resolveAllCollisions}
                  className="flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-lg font-medium"
                  style={{ background: "oklch(0.45 0.22 250 / 0.08)", border: "1px solid oklch(0.45 0.22 250 / 0.20)", color: S.blue }}
                >
                  <ShieldCheck size={11} /> Auto-Resolve All
                </button>
              </div>
              <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                {collisionStats.map(({ variant, owners }) => (
                  <div
                    key={variant}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px]"
                    style={{ background: "oklch(0.58 0.18 85 / 0.08)", border: `1px solid oklch(0.58 0.18 85 / 0.18)` }}
                  >
                    <span style={{ color: S.amber, fontFamily: "'JetBrains Mono', monospace" }}>{variant}</span>
                    <span style={{ color: S.dimText }}>in</span>
                    <span style={{ color: S.bodyText }}>{owners.join(" & ")}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══ BODY ════════════════════════════════════════════════════════════ */}
      <div className="flex overflow-hidden" style={{ flex: 1, minHeight: 0 }}>

        {/* ── LEFT: Entity List ──────────────────────────────────────────── */}
        <aside
          className="flex-shrink-0 flex flex-col overflow-y-auto"
          style={{ width: 260, background: S.panel, borderRight: `1px solid ${S.panelBorder}` }}
        >
          <div className="flex-shrink-0 px-4 pt-4 pb-2" style={{ borderBottom: `1px solid ${S.panelBorder}` }}>
            <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: S.dimText }}>Entities</p>
          </div>

          <div className="flex-1 p-2 space-y-0.5">
            {entities.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                  style={{ background: S.inputBg, border: `1px solid ${S.panelBorder}` }}>
                  <Zap size={16} style={{ color: S.dimText }} />
                </div>
                <p className="text-xs leading-relaxed" style={{ color: S.dimText }}>Paste names or upload CSV to generate entities</p>
              </div>
            ) : (
              <AnimatePresence>
                {entities.map(entity => {
                  const isActive = selectedId === entity.id;
                  const tc = TYPE_MAP[entity.type];
                  const hasCollision = entity.collisions.length > 0;
                  const hasAddress = entity.address && entity.address.length > 0;
                  return (
                    <motion.div key={entity.id}
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4, scale: 0.96 }} transition={{ duration: 0.15 }}>
                      <button
                        onClick={() => { setSelectedId(entity.id); setBulkEditOpen(false); }}
                        className="w-full text-left rounded-xl px-3 py-2.5 group transition-all relative overflow-hidden"
                        style={{
                          background: isActive ? "oklch(0.45 0.22 250 / 0.06)" : "transparent",
                          border: isActive ? `1px solid oklch(0.45 0.22 250 / 0.18)` : "1px solid transparent",
                        }}
                      >
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                            style={{ background: tc.color }} />
                        )}
                        <div className="flex items-start justify-between gap-1">
                          <div className="flex-1 min-w-0 pl-1">
                            <div className="flex items-center gap-1.5">
                              <p className="text-[13px] font-medium truncate leading-tight"
                                style={{ color: isActive ? S.bodyText : S.mutedText }}>
                                {entity.name}
                              </p>
                              {hasCollision && (
                                <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                                  style={{ background: S.amber }} />
                              )}
                            </div>
                            {/* Show address subtitle for location entities */}
                            {hasAddress && (
                              <p className="text-[10px] truncate mt-0.5 flex items-center gap-1"
                                style={{ color: S.dimText }}>
                                <MapPin size={8} className="flex-shrink-0" />
                                {entity.address}
                              </p>
                            )}
                            <div className="mt-0.5 flex items-center gap-1">
                              <StatusIcon entity={entity} />
                              <span className="text-[11px]" style={{
                                color: entity.status === "error" ? S.red
                                  : entity.status === "generating" ? S.blue
                                  : entity.status === "queued" ? S.dimText
                                  : hasCollision ? S.amber
                                  : S.dimText
                              }}>
                                {entity.status === "queued"     ? "Queued"
                                  : entity.status === "generating" ? "Generating…"
                                  : entity.status === "error"      ? "Failed"
                                  : hasCollision
                                    ? `${entity.variants.length} vars · ${entity.collisions.length} collision${entity.collisions.length !== 1 ? "s" : ""}`
                                    : `${entity.variants.length} variations`}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            {entity.status === "error" && (
                              <button onClick={e => { e.stopPropagation(); retryEntity(entity); }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg"
                                style={{ color: S.blue }}>
                                <RefreshCw size={10} />
                              </button>
                            )}
                            <button onClick={e => { e.stopPropagation(); removeEntity(entity.id); }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg"
                              style={{ color: S.dimText }}
                              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = S.red}
                              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = S.dimText}>
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </aside>

        {/* ── CENTER: Input + Editor ─────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden" style={{ minWidth: 0 }}>

          {/* Input bar */}
          <div className="flex-shrink-0 p-4 space-y-3"
            style={{ background: S.panel, borderBottom: `1px solid ${S.panelBorder}` }}>
            <div className="flex items-center gap-2.5 flex-wrap">
              <Select value={entityType} onValueChange={v => handleTypeChange(v as EntityType)}>
                <SelectTrigger className="h-9 text-xs font-bold tracking-widest w-auto min-w-[160px] gap-2"
                  style={{
                    background: S.inputBg,
                    border: `1px solid ${currentType.color}30`,
                    color: currentType.color,
                  }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value} className="text-xs py-2">
                      <span className="font-bold tracking-wider" style={{ color: t.color }}>{t.label}</span>
                      <span className="ml-2 font-normal normal-case" style={{ color: S.mutedText }}>{t.description}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Upload CSV button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: "oklch(0.48 0.18 160 / 0.06)",
                  border: "1px solid oklch(0.48 0.18 160 / 0.18)",
                  color: "oklch(0.38 0.15 160)",
                }}
              >
                <Upload size={12} />
                Upload CSV
              </button>

              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium"
                style={{ background: "oklch(0.45 0.22 250 / 0.05)", border: "1px solid oklch(0.45 0.22 250 / 0.12)", color: "oklch(0.45 0.22 250 / 0.75)" }}>
                <Zap size={10} style={{ color: S.blue }} />
                Auto-detects Provider &amp; Location CSVs · 200+ names
              </div>

              <button
                onClick={() => { const names = parseNames(inputText); if (names.length > 0) enqueueNames(names, entityType); }}
                disabled={!inputText.trim() || isProcessing}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
                style={{
                  background: S.blue,
                  color: "oklch(1 0 0)",
                  boxShadow: `0 1px 3px oklch(0.45 0.22 250 / 0.25)`,
                }}>
                {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                Generate
              </button>

              <span className="ml-auto text-[11px]" style={{ color: S.dimText }}>Supports newline, comma, tab, or CSV upload</span>
            </div>

            <div className="relative">
              <textarea
                value={inputText}
                onChange={e => handleInputChange(e.target.value)}
                placeholder={
                  entityType === "PROVIDER"    ? "Enter names (e.g. Joel Patel, Momo Patucci) — one per line, or upload a CSV" :
                  entityType === "LOCATION"    ? "Enter locations (e.g. Nutrition | 632 Blue Hill Avenue) — or upload a Location CSV" :
                  entityType === "ADDRESS"     ? "Enter addresses (e.g. 2055 Military Ave) — one per line" :
                                                 "Enter other names (e.g. PBG, Victor) — one per line"
                }
                rows={3}
                className="w-full resize-none rounded-xl px-4 py-3 text-sm outline-none transition-all"
                style={{
                  background: S.inputBg, border: `1px solid ${S.panelBorder}`, color: S.bodyText,
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "12.5px", lineHeight: "1.6",
                }}
                onFocus={e => { e.target.style.borderColor = "oklch(0.45 0.22 250 / 0.40)"; e.target.style.boxShadow = `0 0 0 3px oklch(0.45 0.22 250 / 0.08)`; }}
                onBlur={e => { e.target.style.borderColor = S.panelBorder; e.target.style.boxShadow = "none"; }}
              />
              {isProcessing && (
                <div className="absolute top-2.5 right-3 flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full"
                  style={{ background: "oklch(0.45 0.22 250 / 0.08)", border: "1px solid oklch(0.45 0.22 250 / 0.18)", color: S.blue }}>
                  <Loader2 size={10} className="animate-spin" />
                  {queueTotal > 1 ? `${queueDone}/${queueTotal} done` : "Generating"}
                </div>
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ background: S.bg }}>
            {!selectedEntity ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-16">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
                  style={{ background: S.panel, border: `1px solid ${S.panelBorder}`, boxShadow: "0 2px 8px oklch(0 0 0 / 0.04)" }}>
                  <FileJson size={26} style={{ color: S.dimText }} />
                </div>
                <p className="text-sm font-medium" style={{ color: S.mutedText }}>Select an entity to edit its variants</p>
                <p className="text-xs mt-1.5" style={{ color: S.dimText }}>Paste names or upload a CSV to get started</p>
              </div>
            ) : (
              <>
                {/* Entity header */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: S.mutedText }}>Editing:</span>
                    <span className="text-sm font-bold" style={{ color: TYPE_MAP[selectedEntity.type].color }}>
                      {selectedEntity.name}
                    </span>
                    <span className="text-[10px] font-bold tracking-widest px-2 py-0.5 rounded-full"
                      style={{
                        background: `${TYPE_MAP[selectedEntity.type].color}10`,
                        border: `1px solid ${TYPE_MAP[selectedEntity.type].color}25`,
                        color: TYPE_MAP[selectedEntity.type].color,
                      }}>
                      {selectedEntity.type}
                    </span>
                    {/* Show address badge for location entities */}
                    {selectedEntity.address && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1"
                        style={{ background: "oklch(0.48 0.18 160 / 0.06)", border: "1px solid oklch(0.48 0.18 160 / 0.18)", color: S.green }}>
                        <MapPin size={8} />
                        {selectedEntity.address}
                      </span>
                    )}
                    {selectedEntity.readableName && selectedEntity.readableName !== selectedEntity.name && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                        style={{ background: "oklch(0.55 0.15 85 / 0.06)", border: "1px solid oklch(0.55 0.15 85 / 0.18)", color: S.amber }}>
                        aka: {selectedEntity.readableName}
                      </span>
                    )}
                    {selectedEntity.collisions.length > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                        style={{ background: "oklch(0.58 0.18 85 / 0.08)", border: "1px solid oklch(0.58 0.18 85 / 0.20)", color: S.amber }}>
                        <AlertTriangle size={9} />
                        {selectedEntity.collisions.length} collision{selectedEntity.collisions.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] flex items-center gap-1" style={{ color: S.red }}>
                    Do NOT change the key name
                  </span>
                </div>

                {/* Tags panel */}
                <div className="rounded-2xl p-4 min-h-[90px]"
                  style={{
                    background: S.panel,
                    border: `1px solid ${selectedEntity.collisions.length > 0 ? "oklch(0.58 0.18 85 / 0.25)" : S.panelBorder}`,
                    boxShadow: "0 1px 3px oklch(0 0 0 / 0.04)",
                  }}>
                  {selectedEntity.status === "generating" || selectedEntity.status === "queued" ? (
                    <div className="flex items-center justify-center gap-3 py-4">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                        style={{ background: "oklch(0.45 0.22 250 / 0.08)" }}>
                        {selectedEntity.status === "queued"
                          ? <Clock size={14} style={{ color: S.dimText }} />
                          : <Loader2 size={14} className="animate-spin" style={{ color: S.blue }} />}
                      </div>
                      <span className="text-sm" style={{ color: S.mutedText }}>
                        {selectedEntity.status === "queued" ? "Queued for generation…" : "Generating phonetic variants…"}
                      </span>
                    </div>
                  ) : selectedEntity.status === "error" ? (
                    <div className="flex items-center justify-center gap-3 py-4">
                      <AlertTriangle size={16} style={{ color: S.red }} />
                      <span className="text-sm" style={{ color: S.red }}>Generation failed</span>
                      <button onClick={() => retryEntity(selectedEntity)}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg"
                        style={{ background: S.inputBg, border: `1px solid ${S.panelBorder}`, color: S.blue }}>
                        <RefreshCw size={11} /> Retry
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <AnimatePresence>
                        {selectedEntity.variants.map(variant => {
                          const isColliding = selectedEntity.collisions.includes(variant);
                          return (
                            <motion.span key={variant}
                              initial={{ opacity: 0, scale: 0.8, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.75, y: -2 }} transition={{ duration: 0.14 }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full group cursor-default"
                              style={{
                                background: isColliding
                                  ? "oklch(0.58 0.18 85 / 0.08)"
                                  : S.tagBg,
                                border: `1px solid ${isColliding ? "oklch(0.58 0.18 85 / 0.30)" : S.tagBorder}`,
                                fontFamily: "'JetBrains Mono', monospace", fontSize: "11.5px",
                                color: isColliding ? S.amber : "oklch(0.35 0.12 250)",
                                transition: "all 0.15s ease",
                              }}>
                              {isColliding && <AlertTriangle size={9} style={{ color: S.amber }} />}
                              {variant}
                              <button onClick={() => removeVariant(selectedEntity.id, variant)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-3.5 h-3.5 rounded-full"
                                style={{ color: S.red }}>
                                <X size={9} />
                              </button>
                            </motion.span>
                          );
                        })}
                      </AnimatePresence>
                      {selectedEntity.variants.length === 0 && (
                        <span className="text-xs py-2" style={{ color: S.dimText }}>No variants yet — add some below</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Add variant */}
                <div className="flex gap-2">
                  <input type="text" value={addVariantText}
                    onChange={e => setAddVariantText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addVariant()}
                    placeholder="Add variation (address, landmark, STT mishearing...)"
                    className="flex-1 rounded-xl px-4 py-2.5 text-[12.5px] outline-none transition-all"
                    style={{ background: S.inputBg, border: `1px solid ${S.panelBorder}`, color: S.bodyText, fontFamily: "'JetBrains Mono', monospace" }}
                    onFocus={e => { e.target.style.borderColor = "oklch(0.45 0.22 250 / 0.40)"; e.target.style.boxShadow = "0 0 0 3px oklch(0.45 0.22 250 / 0.08)"; }}
                    onBlur={e => { e.target.style.borderColor = S.panelBorder; e.target.style.boxShadow = "none"; }}
                  />
                  <button onClick={addVariant}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all"
                    style={{ background: S.blue, color: "oklch(1 0 0)", boxShadow: `0 1px 3px oklch(0.45 0.22 250 / 0.25)` }}>
                    <Plus size={13} /> Add
                  </button>
                </div>

                {/* Bulk Edit */}
                <div className="rounded-2xl overflow-hidden"
                  style={{ background: S.panel, border: `1px solid ${S.panelBorder}` }}>
                  <button onClick={() => setBulkEditOpen(o => !o)}
                    className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium transition-all"
                    style={{ color: S.mutedText }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = S.bodyText}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = S.mutedText}>
                    <span className="flex items-center gap-2">
                      <Edit3 size={12} /> Bulk Edit <span style={{ color: S.dimText, fontWeight: 400 }}>(one per line)</span>
                    </span>
                    <ChevronDown size={13} className="transition-transform duration-200"
                      style={{ transform: bulkEditOpen ? "rotate(180deg)" : "rotate(0deg)" }} />
                  </button>
                  <AnimatePresence>
                    {bulkEditOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                        style={{ overflow: "hidden", borderTop: `1px solid ${S.panelBorder}` }}>
                        <div className="p-3 space-y-2.5">
                          <textarea value={bulkEditText} onChange={e => setBulkEditText(e.target.value)} rows={8}
                            className="w-full resize-none rounded-xl px-3 py-2.5 text-[11.5px] outline-none transition-all"
                            style={{ background: S.inputBg, border: `1px solid ${S.panelBorder}`, color: "oklch(0.35 0.12 250)", fontFamily: "'JetBrains Mono', monospace", lineHeight: "1.7" }}
                            onFocus={e => { e.target.style.borderColor = "oklch(0.45 0.22 250 / 0.40)"; e.target.style.boxShadow = "0 0 0 3px oklch(0.45 0.22 250 / 0.08)"; }}
                            onBlur={e => { e.target.style.borderColor = S.panelBorder; e.target.style.boxShadow = "none"; }}
                          />
                          <p className="text-[11px]" style={{ color: S.dimText }}>
                            Collisions with other entities will be auto-removed on save.
                          </p>
                          <button onClick={saveBulkEdit}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold"
                            style={{ background: S.blue, color: "oklch(1 0 0)", boxShadow: `0 1px 3px oklch(0.45 0.22 250 / 0.25)` }}>
                            <Check size={12} /> Save Bulk Edit
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* JSON Preview */}
                <div className="rounded-2xl overflow-hidden"
                  style={{ background: S.panel, border: `1px solid ${S.panelBorder}` }}>
                  <button onClick={() => setJsonOpen(o => !o)}
                    className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium transition-all"
                    style={{ color: S.mutedText }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = S.bodyText}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = S.mutedText}>
                    <span className="flex items-center gap-2"><FileJson size={12} /> JSON Output Preview</span>
                    <div className="flex items-center gap-2">
                      <button onClick={e => { e.stopPropagation(); copyJson(); }}
                        className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md transition-all"
                        style={{ background: copied ? "oklch(0.45 0.22 250 / 0.08)" : S.inputBg, color: copied ? S.blue : S.mutedText, border: `1px solid ${copied ? "oklch(0.45 0.22 250 / 0.20)" : S.panelBorder}` }}>
                        {copied ? <Check size={10} /> : <Copy size={10} />}
                        {copied ? "Copied!" : "Copy JSON"}
                      </button>
                      <ChevronDown size={13} className="transition-transform duration-200"
                        style={{ transform: jsonOpen ? "rotate(180deg)" : "rotate(0deg)" }} />
                    </div>
                  </button>
                  <AnimatePresence>
                    {jsonOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                        style={{ overflow: "hidden", borderTop: `1px solid ${S.panelBorder}` }}>
                        <div className="p-4 overflow-y-auto" style={{ maxHeight: 280, background: S.inputBg }}>
                          <ColoredJson json={jsonOutput || '{\n  // No entities yet\n}'} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}
          </div>
        </main>

        {/* ── RIGHT: Full JSON Panel ─────────────────────────────────────── */}
        <aside className="flex-shrink-0 flex flex-col overflow-hidden"
          style={{ width: 300, background: S.panel, borderLeft: `1px solid ${S.panelBorder}` }}>
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3"
            style={{ borderBottom: `1px solid ${S.panelBorder}` }}>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                style={{ background: "oklch(0.45 0.22 250 / 0.08)", border: "1px solid oklch(0.45 0.22 250 / 0.15)" }}>
                <FileJson size={12} style={{ color: S.blue }} />
              </div>
              <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: S.mutedText }}>Full JSON Output</span>
            </div>
            <button onClick={copyJson}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg font-medium transition-all"
              style={{
                background: copied ? "oklch(0.45 0.22 250 / 0.08)" : S.inputBg,
                color: copied ? S.blue : S.mutedText,
                border: `1px solid ${copied ? "oklch(0.45 0.22 250 / 0.20)" : S.panelBorder}`,
              }}>
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4" style={{ background: S.inputBg }}>
            {jsonOutput && jsonOutput !== "{}" ? (
              <ColoredJson json={jsonOutput} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                  style={{ background: S.panel, border: `1px solid ${S.panelBorder}` }}>
                  <FileJson size={18} style={{ color: S.dimText }} />
                </div>
                <p className="text-xs" style={{ color: S.dimText }}>JSON output will appear here</p>
              </div>
            )}
          </div>
        </aside>

      </div>
    </div>
  );
}
