import type { Tool, ToolContext } from "../../runtime/capability/types.js";
import { CONFLICT_DETECTOR_PROMPT } from "./prompts.js";

interface StructuredRecord {
  target: string;
  dimension: string;
  attribute: string;
  value: string;
  rawValue?: string;
  confidence: number;
  sourceTraceIds: string[];
  status: "clean" | "conflicting" | "inferred";
}

interface ConflictReport {
  recordA: StructuredRecord;
  recordB: StructuredRecord;
  nature: "value_contradiction" | "credibility_mismatch";
  severity: "high" | "medium" | "low";
}

interface ConflictDetectorParams {
  records: StructuredRecord[];
}

/**
 * Rule-based pre-check: exact match and semantic opposites.
 * Returns records with preliminary status and a list of obvious conflicts.
 */
function ruleBasedPreCheck(records: StructuredRecord[]): {
  records: StructuredRecord[];
  ruleConflicts: ConflictReport[];
  ruleResultsSummary: string;
} {
  const results: StructuredRecord[] = records.map(r => ({ ...r }));
  const ruleConflicts: ConflictReport[] = [];
  const lowConfidenceThreshold = 0.5;

  // Mark low-confidence records
  for (const rec of results) {
    if (rec.confidence < lowConfidenceThreshold && rec.status === "clean") {
      rec.status = "inferred";
    }
  }

  // Group by (target, attribute) for cross-source comparison
  const groups = new Map<string, StructuredRecord[]>();
  for (const rec of results) {
    const key = `${rec.target}::${rec.attribute}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(rec);
  }

  for (const [, group] of groups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;

        // Exact match — clean
        if (a.value === b.value) {
          continue;
        }

        // Semantic opposites: free vs paid
        const freeKeywords = ["免费", "free", "無料", "0元"];
        const paidKeywords = ["付费", "收费", "paid", "订阅", "subscribe"];
        const aIsFree = freeKeywords.some(k => a.value.includes(k));
        const aIsPaid = paidKeywords.some(k => a.value.includes(k));
        const bIsFree = freeKeywords.some(k => b.value.includes(k));
        const bIsPaid = paidKeywords.some(k => b.value.includes(k));

        if ((aIsFree && bIsPaid) || (aIsPaid && bIsFree)) {
          a.status = "conflicting";
          b.status = "conflicting";
          ruleConflicts.push({
            recordA: a,
            recordB: b,
            nature: "value_contradiction",
            severity: "high",
          });
        }
      }
    }
  }

  const ruleResultsSummary = ruleConflicts.length > 0
    ? `预检发现 ${ruleConflicts.length} 个明显冲突（免费/付费对立）。`
    : "预检未发现明显冲突。";

  return { records: results, ruleConflicts, ruleResultsSummary };
}

export function createConflictDetector(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "conflict_detector",
    description: "检测同属性多来源的矛盾声明",
    parameters: {
      type: "object",
      properties: {
        records: { type: "array", items: { type: "object" } },
      },
      required: ["records"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<{ records: StructuredRecord[]; conflicts: ConflictReport[] }> {
      const { records } = params as unknown as ConflictDetectorParams;

      // Step 1: Rule-based pre-check
      const { records: preChecked, ruleConflicts, ruleResultsSummary } = ruleBasedPreCheck(records);

      // Step 2: LLM for semantic analysis
      const simplified = preChecked.map((r) => ({
        target: r.target,
        dimension: r.dimension,
        attribute: r.attribute,
        value: r.value,
        rawValue: r.rawValue,
        confidence: r.confidence,
        sourceTraceIds: r.sourceTraceIds,
        status: r.status,
      }));

      const prompt = CONFLICT_DETECTOR_PROMPT
        .replace("{records}", JSON.stringify(simplified, null, 2))
        .replace("{ruleResults}", ruleResultsSummary);

      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      const extracted = JSON.parse((jsonMatch[1] ?? raw).trim());

      // Merge LLM results with rule-based results
      const llmRecords: StructuredRecord[] = (extracted.records ?? []).map((rec: any) => ({
        target: rec.target,
        dimension: rec.dimension,
        attribute: rec.attribute,
        value: rec.value,
        rawValue: rec.rawValue ?? rec.value,
        confidence: rec.confidence ?? 0.8,
        sourceTraceIds: rec.sourceTraceIds ?? [],
        status: rec.status ?? "clean",
      }));

      const llmConflicts: ConflictReport[] = (extracted.conflicts ?? []).map((c: any) => ({
        recordA: c.recordA,
        recordB: c.recordB,
        nature: c.nature ?? "value_contradiction",
        severity: c.severity ?? "medium",
      }));

      // Merge: LLM records take precedence for status, rule conflicts are unioned
      const finalRecords = llmRecords;
      const allConflicts = [...ruleConflicts, ...llmConflicts];

      return { records: finalRecords, conflicts: allConflicts };
    },
  };
}
