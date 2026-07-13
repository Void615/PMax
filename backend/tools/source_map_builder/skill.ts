import type { Tool, ToolContext } from "../../runtime/capability/types.js";
import type { AnalysisResult, RawDataItem, SourceMapEntry } from "../../capabilities/shared/types.js";

/**
 * Pure rule-based Tool: traces conclusion fragments back to their original
 * source URLs by walking the traceId chain through rawData.
 *
 * Algorithm:
 * 1. Build a URL → RawDataItem index from rawData
 * 2. Walk comparisonMatrix.values[], match sourceTraceId → sourceUrl
 * 3. Walk swot[].sourceTraceIds
 * 4. Walk insights[].sourceTraceIds
 * 5. Unresolvable entries are emitted with traceId: "unavailable"
 *
 * No LLM dependency — pure data lookup + index traversal.
 */
export const sourceMapBuilder: Tool = {
  name: "source_map_builder",
  description: "从分析结论回溯到原始URL，构建全链路溯源映射",
  parameters: {
    type: "object",
    properties: {
      analysisResults: { type: "object" },
      rawData: { type: "object" },
      structuredData: { type: "object" },
    },
    required: ["analysisResults", "rawData"],
  },
  async execute(
    params: Record<string, any>,
    _ctx: ToolContext
  ): Promise<{ sourceMap: SourceMapEntry[] }> {
    const analysis = params.analysisResults as AnalysisResult;
    const rawData = params.rawData as Record<string, RawDataItem[]> | undefined;

    // ── Build URL → item index ──
    const urlIndex = new Map<string, RawDataItem>();
    if (rawData) {
      for (const items of Object.values(rawData)) {
        for (const item of items) {
          if (item.sourceUrl) {
            urlIndex.set(item.sourceUrl, item);
          }
        }
      }
    }

    const map: SourceMapEntry[] = [];

    const lookup = (traceId: string): RawDataItem | undefined => {
      if (!traceId) return undefined;
      // Direct match: traceIds in structuredData are sourceUrls
      let found = urlIndex.get(traceId);
      if (found) return found;
      // Fallback: substring match for partial URLs
      for (const [url, ri] of urlIndex) {
        if (url.includes(traceId) || traceId.includes(url)) return ri;
      }
      return undefined;
    };

    const addEntry = (fragment: string, traceId: string) => {
      const raw = lookup(traceId);
      map.push({
        conclusionFragment: fragment,
        sourceUrl: raw?.sourceUrl ?? "unavailable",
        sourceExcerpt: raw ? raw.content.slice(0, 200) : "unavailable",
        traceId: traceId || "unavailable",
        credibility: raw?.credibility ?? "unknown",
      });
    };

    // 1. comparisonMatrix → per-value sourceTraceId
    for (const entry of analysis.comparisonMatrix ?? []) {
      for (const val of entry.values ?? []) {
        addEntry(
          `${entry.attribute}: ${val.target}=${val.value}`,
          val.sourceTraceId
        );
      }
    }

    // 2. SWOT → per-entry sourceTraceIds
    for (const swot of analysis.swot ?? []) {
      const fragment = `SWOT(${swot.category}): ${swot.target} - ${swot.point}`;
      if (swot.sourceTraceIds?.length) {
        for (const tid of swot.sourceTraceIds) addEntry(fragment, tid);
      } else {
        map.push({
          conclusionFragment: fragment,
          sourceUrl: "unavailable",
          sourceExcerpt: "unavailable",
          traceId: "unavailable",
          credibility: "unknown",
        });
      }
    }

    // 3. Insights → per-entry sourceTraceIds
    for (const insight of analysis.insights ?? []) {
      const fragment = `INSIGHT(${insight.category}): ${insight.statement}`;
      if (insight.sourceTraceIds?.length) {
        for (const tid of insight.sourceTraceIds) addEntry(fragment, tid);
      } else {
        map.push({
          conclusionFragment: fragment,
          sourceUrl: "unavailable",
          sourceExcerpt: "unavailable",
          traceId: "unavailable",
          credibility: "unknown",
        });
      }
    }

    return { sourceMap: map };
  },
};
