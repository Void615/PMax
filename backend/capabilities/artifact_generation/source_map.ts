import type { SourceMapEntry, FeatureComparison, RawDataItem } from "../shared/types.js";

export function buildSourceMap(
  analysisResults: { comparisonMatrix: FeatureComparison[] },
  rawData: Record<string, RawDataItem[]> | undefined
): SourceMapEntry[] {
  const map: SourceMapEntry[] = [];
  const allRawItems = rawData ? Object.values(rawData).flat() : [];

  for (const entry of analysisResults.comparisonMatrix ?? []) {
    for (const val of entry.values ?? []) {
      // 简单文本匹配查找来源
      const src = allRawItems.find(r => {
        return r.content.includes(val.value) || val.value.includes(r.content.slice(0, 20));
      });
      if (src) {
        map.push({
          conclusionFragment: `${entry.attribute}: ${val.target}=${val.value}`,
          sourceUrl: src.sourceUrl,
          sourceExcerpt: src.content.slice(0, 200),
          traceId: val.sourceTraceId ?? "",
        });
      }
    }
  }

  return map;
}
