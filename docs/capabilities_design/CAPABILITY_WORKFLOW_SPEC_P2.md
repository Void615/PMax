# Capability 工作流详细设计（下）

> 接上篇 CAPABILITY_WORKFLOW_SPEC_P1.md。

---

## 3. Information Processing

### 3.1 类型定义

```typescript
// 沿用 shared/types.ts 中的定义，以下为补充
interface ConflictReport {
  recordA: StructuredRecord;
  recordB: StructuredRecord;
  nature: "value_contradiction" | "credibility_mismatch";
  severity: "high" | "medium" | "low";
  resolution?: string;  // LLM 推荐的解决方式
}

// ProcessingResult 补充字段
interface ProcessingResult {
  records: StructuredRecord[];
  coverageMatrix: Record<string, Record<string, "covered" | "inferred" | "missing">>;
  conflictCount: number;
  conflicts?: ConflictReport[];
}
```

### 3.2 主执行流程

```typescript
async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
  const config = state.data.config as RequirementConfig;
  const rawData = state.data.rawData as Record<string, RawDataItem[]> | undefined;
  if (!config || !rawData) return { patch: {}, artifacts: [] };

  const dimensions = config.dimensions;
  const targets = config.targets.map(t => t.name);
  const coverageMatrix: Record<string, Record<string, "covered" | "inferred" | "missing">> = {};

  // 初始化覆盖矩阵
  for (const target of targets) {
    coverageMatrix[target] = {};
    for (const dim of dimensions) {
      coverageMatrix[target][dim] = "missing";
    }
  }

  // Step 1 & 2: 按维度路由 + 逐(target,dimension)提取
  const allRecords: StructuredRecord[] = [];

  for (const dim of dimensions) {
    const extractTool = this.selectTool(dim);  // pricing→pricing_normalizer, 其他→feature_extractor

    for (const target of targets) {
      const items = (rawData[dim] ?? []).filter(i => i.target === target);
      if (items.length === 0) continue;  // 保持 "missing"

      // 拼接 content，截断到 8000
      const rawContent = items.map(i => i.content).join("\n---\n").slice(0, 8000);

      await ctx.emit({
        uiHint: "tool_call", eventType: "TOOL_CALL",
        nodeId: ctx.nodeId, workflowId: ctx.workflowId, runId: ctx.runId,
        traceId: ctx.traceId,
        payload: { toolName: extractTool.name, params: { target, dimension: dim } },
        timestamp: new Date().toISOString(),
      });

      const result = await extractTool.execute({
        target,
        dimension: dim,
        rawContent,
        items: items.map(i => ({ traceId: (i as any).traceId ?? "", sourceUrl: i.sourceUrl })),
      }, { traceId: ctx.traceId, runId: ctx.runId });

      await ctx.emit({
        uiHint: "tool_result", eventType: "TOOL_RESULT",
        nodeId: ctx.nodeId, workflowId: ctx.workflowId, runId: ctx.runId,
        traceId: ctx.traceId,
        payload: { toolName: extractTool.name, result: { recordCount: result.records?.length ?? 0 } },
        timestamp: new Date().toISOString(),
      });

      // 过滤低置信度，附加 sourceTraceIds
      const validRecords = (result.records ?? [])
        .filter((r: any) => (r.confidence ?? 0) >= 0.5)
        .map((r: any) => ({
          ...r,
          target,
          dimension: dim,
          sourceTraceIds: items.map(i => (i as any).traceId ?? "").filter(Boolean),
          status: "clean" as const,
        }));

      allRecords.push(...validRecords);
    }
  }

  // Step 3: 实体对齐
  const entityTool = this.tools.find(t => t.name === "entity_resolver")!;
  let mergedRecords: StructuredRecord[] = [];

  for (const dim of dimensions) {
    const dimRecords = allRecords.filter(r => r.dimension === dim);
    if (dimRecords.length === 0) continue;

    await ctx.emit({ uiHint: "tool_call", eventType: "TOOL_CALL",
      payload: { toolName: "entity_resolver", params: { dimension: dim, recordCount: dimRecords.length } } });

    const result = await entityTool.execute(
      { dimension: dim, records: dimRecords },
      { traceId: ctx.traceId, runId: ctx.runId }
    );

    await ctx.emit({ uiHint: "tool_result", eventType: "TOOL_RESULT",
      payload: { toolName: "entity_resolver", result: { before: dimRecords.length, after: result.merged?.length ?? 0 } } });

    // 合并后的记录保留最高 confidence 和最多 sourceTraceIds
    mergedRecords.push(...(result.merged ?? []));
  }

  // Step 4: 冲突检测
  const conflictTool = this.tools.find(t => t.name === "conflict_detector")!;

  await ctx.emit({ uiHint: "tool_call", eventType: "TOOL_CALL",
    payload: { toolName: "conflict_detector", params: { recordCount: mergedRecords.length } } });

  const conflictResult = await conflictTool.execute(
    { records: mergedRecords },
    { traceId: ctx.traceId, runId: ctx.runId }
  );

  await ctx.emit({ uiHint: "tool_result", eventType: "TOOL_RESULT",
    payload: { toolName: "conflict_detector", result: { conflictCount: conflictResult.conflicts?.length ?? 0 } } });

  // 应用冲突标记
  const finalRecords = (conflictResult.records ?? mergedRecords) as StructuredRecord[];

  // Step 5: 覆盖矩阵生成
  for (const rec of finalRecords) {
    if (!coverageMatrix[rec.target]) continue;
    switch (rec.status) {
      case "clean":
        if (coverageMatrix[rec.target][rec.dimension] !== "covered") {
          coverageMatrix[rec.target][rec.dimension] = "covered";
        }
        break;
      case "conflicting":
      case "inferred":
        if (coverageMatrix[rec.target][rec.dimension] === "missing") {
          coverageMatrix[rec.target][rec.dimension] = "inferred";
        }
        break;
    }
  }

  // 按 dimension 分组写入
  const structuredData: Record<string, StructuredRecord[]> = {};
  for (const rec of finalRecords) {
    if (!structuredData[rec.dimension]) structuredData[rec.dimension] = [];
    structuredData[rec.dimension].push(rec);
  }

  const processingResult: ProcessingResult = {
    records: finalRecords,
    coverageMatrix,
    conflictCount: conflictResult.conflicts?.length ?? 0,
    conflicts: conflictResult.conflicts,
  };

  await ctx.emit({
    uiHint: "node_completed", eventType: "NODE_COMPLETED",
    nodeId: ctx.nodeId, workflowId: ctx.workflowId, runId: ctx.runId, traceId: ctx.traceId,
    payload: {
      recordCount: finalRecords.length,
      dimensions: Object.keys(structuredData),
      conflictCount: processingResult.conflictCount,
      coverageMatrix,
    },
    timestamp: new Date().toISOString(),
  });

  return { patch: { structuredData, processingResult }, artifacts: [] };
}

private selectTool(dimension: string): Tool {
  if (dimension === "pricing") return this.tools.find(t => t.name === "pricing_normalizer")!;
  return this.tools.find(t => t.name === "feature_extractor")!;
}
```

### 3.3 各 Tool 调用规格

#### pricing_normalizer（已有，待接入）

```
参数: { target, dimension: "pricing", rawContent, items: [{ traceId, sourceUrl }] }
返回: {
  records: [{
    attribute: "月费价格", value: "¥99/月", rawValue: "$13.99/month",
    confidence: 0.95
  }]
}

Tool 内部:
1. LLM 提取所有价格相关属性（基础价格、高级版价格、免费版限制等）
2. 统一货币（以人民币为基准）和计费周期（月/年归一化到月）
3. 每个属性标记提取 confidence
```

#### feature_extractor（已有，待接入）

```
参数: { target, dimension, rawContent, items: [{ traceId, sourceUrl }] }
返回: {
  records: [{
    attribute: "实时协作", value: "支持最多 100 人同时编辑",
    rawValue: "up to 100 collaborators in real-time",
    confidence: 0.90
  }]
}

Tool 内部:
1. LLM 将文本拆分为原子功能点
2. 每个功能点提取: attribute（功能名）、value（具体描述）、rawValue（原文）
3. 去除此 dimension 无关内容（如 UX 文本中提取到价格信息 → 低 confidence）
```

#### entity_resolver（新增）

```
参数: { dimension: string, records: StructuredRecord[] }
返回: { merged: StructuredRecord[] }

Tool 内部:
1. 用语义相似度分组（基于 attribute 的 LLM embedding 比较或直接 LLM 判断）
2. 同义合并规则:
   - attribute 取最常见的表述
   - value 取 confidence 最高的记录的 value
   - sourceTraceIds 合并去重
   - rawValue 保留所有（用 " | " 连接）
```

#### conflict_detector（新增）

```
参数: { records: StructuredRecord[] }
返回: { records: StructuredRecord[], conflicts: ConflictReport[] }

Tool 内部:
1. 按 (target, attribute) 分组
2. 对每组内的多个记录比较 value:
   a. 规则层: 完全相同 → clean；语义相反（"免费" vs "付费"）→ 标记
   b. LLM 层: 传给 LLM 判断是否存在矛盾（如 "¥99/月" vs "¥1188/年" 其实等价）
3. 有冲突的记录:
   - status = "conflicting"
   - 生成 ConflictReport（含 nature + severity）
4. 仅有低置信度来源的记录:
   - status = "inferred"（数据存在但可信度低）
```

### 3.4 错误处理

| 错误场景 | 处理策略 |
|----------|----------|
| pricing_normalizer/feature_extractor LLM 返回格式错误 | catch JSON parse error → 返回空 records，该 (target,dim) 标记 missing |
| entity_resolver 失败 | 跳过合并步骤，使用未合并的 records |
| conflict_detector 失败 | 所有记录保持 status="clean"，conflictCount=0 |
| 某个 dimension 全部无数据 | coverageMatrix 全为 "missing"，正常写入 |

---

## 4. Analysis Reasoning

### 4.1 类型定义

```typescript
// 新增：Insight（差异化洞察）
interface Insight {
  category: "gap" | "opportunity" | "risk" | "advantage";
  statement: string;
  evidence: string;
  relatedTargets: string[];
  sourceTraceIds: string[];
}

// AnalysisResult 扩展
interface AnalysisResult {
  comparisonMatrix: FeatureComparison[];
  swot: SWOTEntry[];
  insights: Insight[];
  summary: string;
  analysisReport: AnalysisReport;
}

interface AnalysisReport {
  conclusionCount: number;
  overallConfidence: "high" | "medium" | "low";
  imbalanceWarnings?: string[];
}
```

### 4.2 主执行流程

```typescript
async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
  const config = state.data.config as RequirementConfig;
  const structuredData = state.data.structuredData as Record<string, StructuredRecord[]> | undefined;
  const rawData = state.data.rawData as Record<string, RawDataItem[]> | undefined;
  const processingResult = state.data.processingResult as ProcessingResult | undefined;
  if (!config) return { patch: {}, artifacts: [] };

  // Step 0: 数据质量预检
  const imbalanceWarnings: string[] = [];
  let globalConfidencePenalty = 0;  // 0 = no penalty, 1 = downgrade one level, 2 = capped at medium

  // 0a: 数据不平衡检测
  if (structuredData) {
    const counts = Object.entries(structuredData)
      .map(([dim, records]) => ({ dim, targets: new Set(records.map(r => r.target)).size }));
    const maxCount = Math.max(...counts.map(c => c.targets));
    const minCount = Math.min(...counts.map(c => c.targets));
    if (minCount > 0 && maxCount / minCount > 2) {
      imbalanceWarnings.push(`数据不均衡：${counts.find(c => c.targets === maxCount)?.dim} 维度的数据量是 ${counts.find(c => c.targets === minCount)?.dim} 的 ${(maxCount/minCount).toFixed(1)} 倍`);
    }
    if (imbalanceWarnings.length > 0) {
      await ctx.emit({
        uiHint: "quality_warning", eventType: "DATA_IMBALANCE_WARNING",
        payload: { warnings: imbalanceWarnings },
      });
    }
  }

  // 0b: 冲突汇总
  if (processingResult && processingResult.conflictCount > processingResult.records.length * 0.2) {
    globalConfidencePenalty = 1;  // 所有结论 confidence 下调一级
  }

  // 0c: 数据降级检查
  let useRawData = false;
  if (!structuredData || Object.keys(structuredData).length === 0) {
    useRawData = true;
    globalConfidencePenalty = 2;
  } else if (processingResult) {
    const totalEntries = Object.values(processingResult.coverageMatrix)
      .flatMap(m => Object.values(m));
    const missingCount = totalEntries.filter(v => v === "missing").length;
    if (missingCount > totalEntries.length * 0.5) {
      useRawData = true;
      globalConfidencePenalty = Math.max(globalConfidencePenalty, 1);
    }
  }

  const analysisData = useRawData
    ? JSON.stringify(rawData ?? {}).slice(0, 12000)
    : JSON.stringify(structuredData).slice(0, 12000);

  // Step 1: 对比矩阵生成
  const matrixTool = this.tools.find(t => t.name === "matrix_builder")!;
  await ctx.emit({ uiHint: "tool_call", eventType: "TOOL_CALL",
    payload: { toolName: "matrix_builder", params: { targets: config.targets.map(t => t.name) } } });
  const matrixResult = await matrixTool.execute({
    targets: config.targets.map(t => t.name),
    dimensions: config.dimensions,
    data: analysisData,
    coverageContext: processingResult?.coverageMatrix,
    imbalanceWarnings: imbalanceWarnings.length > 0 ? imbalanceWarnings : undefined,
    confidencePenalty: globalConfidencePenalty,
  }, { traceId: ctx.traceId, runId: ctx.runId });
  await ctx.emit({ uiHint: "tool_result", eventType: "TOOL_RESULT",
    payload: { toolName: "matrix_builder", result: { rows: matrixResult.comparisonMatrix?.length ?? 0 } } });

  // Step 2: SWOT 并行生成
  const swotTool = this.tools.find(t => t.name === "swot_generator")!;
  const matrixSummary = JSON.stringify((matrixResult.comparisonMatrix ?? []).slice(0, 5));
  const swotResults = await Promise.allSettled(
    config.targets.map(async (target) => {
      await ctx.emit({ uiHint: "tool_call", eventType: "TOOL_CALL",
        payload: { toolName: "swot_generator", params: { target: target.name } } });
      const res = await swotTool.execute({
        target: target.name,
        data: analysisData,
        comparisonContext: matrixSummary,
        confidencePenalty: globalConfidencePenalty,
      }, { traceId: ctx.traceId, runId: ctx.runId });
      await ctx.emit({ uiHint: "tool_result", eventType: "TOOL_RESULT",
        payload: { toolName: "swot_generator", result: { target: target.name, entries: res.swot?.length ?? 0 } } });
      return res;
    })
  );

  const allSwot: SWOTEntry[] = [];
  for (const r of swotResults) {
    if (r.status === "fulfilled" && r.value.swot) {
      allSwot.push(...r.value.swot.map((s: any) => ({
        ...s,
        target: s.target ?? "unknown",
        confidence: applyPenalty(s.confidence ?? "high", globalConfidencePenalty),
      })));
    }
  }

  // Step 3: 差异化洞察提取
  const insightTool = this.tools.find(t => t.name === "insight_extractor")!;
  await ctx.emit({ uiHint: "tool_call", eventType: "TOOL_CALL",
    payload: { toolName: "insight_extractor", params: { ownProduct: config.targets[0].name } } });
  const insightResult = await insightTool.execute({
    comparisonMatrix: matrixResult.comparisonMatrix ?? [],
    swot: allSwot,
    ownProduct: config.targets[0].name,
    imbalanceWarnings: imbalanceWarnings.length > 0 ? imbalanceWarnings : undefined,
    confidencePenalty: globalConfidencePenalty,
  }, { traceId: ctx.traceId, runId: ctx.runId });
  await ctx.emit({ uiHint: "tool_result", eventType: "TOOL_RESULT",
    payload: { toolName: "insight_extractor", result: { insightCount: insightResult.insights?.length ?? 0 } } });

  // Step 4: 综合摘要生成
  const summaryTool = this.tools.find(t => t.name === "comparison_summarizer")!;
  await ctx.emit({ uiHint: "tool_call", eventType: "TOOL_CALL",
    payload: { toolName: "comparison_summarizer" } });
  const summarySwot = allSwot.slice(0, 10);  // 截断，防 token 溢出
  const summaryResult = await summaryTool.execute({
    targets: config.targets.map(t => t.name),
    matrixSummary,
    swotSummary: JSON.stringify(summarySwot),
    insights: JSON.stringify((insightResult.insights ?? []).slice(0, 6)),
    imbalanceWarnings: imbalanceWarnings.length > 0 ? imbalanceWarnings : undefined,
  }, { traceId: ctx.traceId, runId: ctx.runId });
  await ctx.emit({ uiHint: "tool_result", eventType: "TOOL_RESULT",
    payload: { toolName: "comparison_summarizer", result: { summaryLength: summaryResult.summary?.length ?? 0 } } });

  // Step 5: 组装写入
  const confidenceLevels = ["low", "medium", "high"] as const;
  const overallConfidenceIdx = Math.max(0, 2 - globalConfidencePenalty);
  const overallConfidence = confidenceLevels[overallConfidenceIdx];

  const analysisResult: AnalysisResult = {
    comparisonMatrix: matrixResult.comparisonMatrix ?? [],
    swot: allSwot,
    insights: insightResult.insights ?? [],
    summary: (summaryResult.summary ?? "").trim().slice(0, 500),
    analysisReport: {
      conclusionCount: (matrixResult.comparisonMatrix?.length ?? 0) + allSwot.length + (insightResult.insights?.length ?? 0),
      overallConfidence,
      imbalanceWarnings: imbalanceWarnings.length > 0 ? imbalanceWarnings : undefined,
    },
  };

  await ctx.emit({
    uiHint: "node_completed", eventType: "NODE_COMPLETED",
    payload: { summary: `生成 ${analysisResult.comparisonMatrix.length} 条对比 + ${allSwot.length} 条 SWOT + ${analysisResult.insights.length} 条洞察` },
    timestamp: new Date().toISOString(),
  });

  return { patch: { analysisResults: analysisResult }, artifacts: [] };
}

// 辅助: 根据 penalty 降级 confidence
function applyPenalty(level: string, penalty: number): "high" | "medium" | "low" {
  const levels = ["low", "medium", "high"];
  const idx = levels.indexOf(level);
  if (idx === -1) return "medium";
  return levels[Math.max(0, idx - penalty)] as "high" | "medium" | "low";
}
```

### 4.3 各 Tool 调用规格

#### matrix_builder（已有，已接入，需扩展参数）

```
现有参数: { targets, data }
需新增: { dimensions, coverageContext, imbalanceWarnings, confidencePenalty }
返回: { comparisonMatrix: FeatureComparison[] }

扩展后的 prompt 应引导 LLM:
- 如果 coverageContext 中某单元格为 "missing"，value 填 "无数据"，confidence="low"
- 如果 imbalanceWarnings 存在，在矩阵相关行的 analysis 中注明
- confidencePenalty > 0 时，所有 confidence 下调对应级别
```

#### swot_generator（已有，已接入，需扩展参数）

```
现有参数: { target, data }
需新增: { comparisonContext, confidencePenalty }
返回: { swot: SWOTEntry[] }

扩展后:
- comparisonContext 让 LLM 了解竞品间横向差异，O/T 更准确
- evidence 字段强制要求引用具体数据点
- sourceTraceIds 从 structuredData 传播（不能为空数组）
```

#### insight_extractor（新增）

```
参数: { comparisonMatrix, swot, ownProduct, imbalanceWarnings?, confidencePenalty? }
返回: { insights: Insight[] }

Tool 内部 prompt:
- 以 ownProduct 为参照系
- 逐维度扫描 comparisonMatrix: 找 ownProduct 得分最低/最高的属性 → gap/advantage
- 扫描 comparisonMatrix: 找所有竞品都无数据或数据都很弱的维度 → opportunity
- 扫描 swot: 找竞品 T（threat）与 ownProduct W（weakness）的交集 → risk
- 每条 insight 的 evidence 必须引用具体数值（如 "竞品 A ¥49/月 vs 你的 ¥99/月"）
- 同类型 insight 最多 3 条（去冗余）
```

#### comparison_summarizer（新增）

```
参数: { targets, matrixSummary, swotSummary, insights, imbalanceWarnings? }
返回: { summary: string }  // ≤ 500 字

Tool 内部 prompt:
- 第一段：整体竞争格局（1-2 句）
- 第二段：各竞品核心差异化优势（每个竞品 1 句）
- 第三段：自身产品的关键差距和机会（2-3 句）
- 第四段：值得关注的趋势或风险（如有 imbalanceWarnings 则注明数据局限性）
```

### 4.4 错误处理

| 错误场景 | 处理策略 |
|----------|----------|
| matrix_builder 失败 | comparisonMatrix=[]，其他步骤继续 |
| swot_generator 对某个 target 失败 | 该 target 的 swot 为空，不影响其他 target |
| 全部 swot_generator 失败 | swot=[]，insight_extractor 仅基于 comparisonMatrix |
| insight_extractor 失败 | insights=[]，summary 仍可基于 matrix+swot |
| comparison_summarizer 失败 | summary="分析摘要暂时无法生成" |

---

## 5. Artifact Generation

### 5.1 主执行流程

```typescript
async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
  const config = state.data.config as RequirementConfig;
  const analysisResults = state.data.analysisResults as AnalysisResult;
  const rawData = state.data.rawData as Record<string, RawDataItem[]> | undefined;
  if (!config || !analysisResults) return { patch: {}, artifacts: [] };

  // Step 1: 溯源链构建
  const sourceMapTool = this.tools.find(t => t.name === "source_map_builder")!;
  await ctx.emit({ uiHint: "tool_call", eventType: "TOOL_CALL",
    payload: { toolName: "source_map_builder" } });
  const sourceResult = await sourceMapTool.execute({
    analysisResults,
    rawData: rawData ?? {},
    structuredData: state.data.structuredData,
  }, { traceId: ctx.traceId, runId: ctx.runId });
  const sourceMap: SourceMapEntry[] = sourceResult.sourceMap ?? [];
  await ctx.emit({ uiHint: "tool_result", eventType: "TOOL_RESULT",
    payload: { toolName: "source_map_builder", result: { entryCount: sourceMap.length } } });

  // Step 2: 按 outputFormat 路由产物生成
  const artifacts: Artifact[] = [];
  const tableTool = this.tools.find(t => t.name === "table_composer")!;
  const mdTool = this.tools.find(t => t.name === "markdown_renderer")!;

  for (const fmt of config.outputFormat) {
    switch (fmt) {
      case "comparison_matrix": {
        const rows = analysisResults.comparisonMatrix.map(c => ({
          attribute: c.attribute,
          values: Object.fromEntries((c.values ?? []).map(v => [v.target, v.value])),
          winner: c.winner,
          confidence: c.confidence,
        }));
        const highlights = analysisResults.comparisonMatrix
          .filter(c => c.winner)
          .map(c => c.attribute);

        await ctx.emit({ uiHint: "tool_call", eventType: "TOOL_CALL",
          payload: { toolName: "table_composer", params: { title: "产品对比矩阵" } } });
        const result = await tableTool.execute({
          title: "产品对比矩阵",
          targets: config.targets.map(t => t.name),
          rows: JSON.stringify(rows),
          highlights,
        }, { traceId: ctx.traceId, runId: ctx.runId });
        await ctx.emit({ uiHint: "tool_result", eventType: "TOOL_RESULT",
          payload: { toolName: "table_composer", result: { format: result.format } } });

        artifacts.push({
          type: "comparison_matrix",
          format: result.format ?? "markdown",
          title: "产品对比矩阵",
          content: result.content ?? "",
          sourceMap: this.filterSourceMap(sourceMap, "comparison_matrix"),
        });
        break;
      }
      case "swot": {
        for (const target of config.targets) {
          const swotForTarget = (analysisResults.swot ?? []).filter(s => s.target === target.name);
          const content = this.renderSwotMarkdown(target.name, swotForTarget);
          artifacts.push({
            type: "swot",
            format: "markdown",
            title: `${target.name} SWOT 分析`,
            content,
            sourceMap: this.filterSourceMap(sourceMap, "swot", target.name),
          });
        }
        break;
      }
      case "insight_report": {
        const content = this.renderInsightMarkdown(analysisResults.insights ?? []);
        artifacts.push({
          type: "insight_report",
          format: "markdown",
          title: "差异化洞察",
          content,
          sourceMap: this.filterSourceMap(sourceMap, "insight_report"),
        });
        break;
      }
      case "report": {
        const sections = await this.buildReportSections(
          config, analysisResults, tableTool, ctx, sourceMap
        );
        await ctx.emit({ uiHint: "tool_call", eventType: "TOOL_CALL",
          payload: { toolName: "markdown_renderer", params: { title: `竞品分析报告` } } });
        const result = await mdTool.execute({
          title: `竞品分析报告 — ${config.targets[0].name} vs ${config.targets.slice(1).map(t => t.name).join("、")}`,
          sections,
        }, { traceId: ctx.traceId, runId: ctx.runId });
        await ctx.emit({ uiHint: "tool_result", eventType: "TOOL_RESULT",
          payload: { toolName: "markdown_renderer", result: { length: result.content?.length ?? 0 } } });

        artifacts.push({
          type: "report",
          format: "markdown",
          title: "竞品分析报告",
          content: result.content ?? "",
          sourceMap,
        });
        break;
      }
    }
  }

  // Step 3: 终止
  const overallConfidence = analysisResults.analysisReport?.overallConfidence ?? "medium";
  await ctx.emit({
    uiHint: "workflow_complete", eventType: "WORKFLOW_COMPLETE",
    nodeId: ctx.nodeId, workflowId: ctx.workflowId, runId: ctx.runId, traceId: ctx.traceId,
    payload: {
      artifactCount: artifacts.length,
      sourceMapCount: sourceMap.length,
      overallConfidence,
    },
    timestamp: new Date().toISOString(),
  });

  return { patch: { artifacts }, artifacts: [] };
}
```

### 5.2 各 Tool 调用规格

#### source_map_builder（新增）

```
参数: { analysisResults, rawData, structuredData }
返回: { sourceMap: SourceMapEntry[] }

构建算法:
1. 遍历 analysisResults.comparisonMatrix
   → 对每行的每个 value，通过 value.sourceTraceId
   → 查找 structuredData 中对应 record.sourceTraceIds
   → 查找 rawData 中对应 item.sourceUrl, item.content
   → 截取 content 中相关片段（≤200 字符）
2. 遍历 analysisResults.swot
   → 对每条 SWOTEntry.sourceTraceIds 回溯
3. 遍历 analysisResults.insights
   → 对每条 Insight.sourceTraceIds 回溯
4. 不可回溯的 → { traceId: "unavailable", sourceUrl: "", sourceExcerpt: "无法回溯" }
```

#### table_composer（已有，已接入，需扩展参数）

```
现有参数: { title, targets, rows }
需新增: { highlights?: string[] }
返回: { content: string, format: "markdown"|"html" }

扩展后:
- highlights 数组中的 attribute 名匹配到的行 → 标记 **winner**（加粗或 🏆）
- 每行末尾追加 confidence 标记（如 "[H]" 表示高置信度）
```

#### markdown_renderer（已有，待接入）

```
参数: { title, sections: [{ heading, content }] }
返回: { content: string, format: "markdown" }

作用: 将多个 section 组装为统一 Markdown 文档，含标题层级和目录
```

### 5.3 辅助函数

```typescript
// SWOT Markdown 渲染（非 Tool，Capability 自身逻辑）
private renderSwotMarkdown(targetName: string, entries: SWOTEntry[]): string {
  const categories: Record<string, string> = {
    strengths: "优势 (Strengths)",
    weaknesses: "劣势 (Weaknesses)",
    opportunities: "机会 (Opportunities)",
    threats: "威胁 (Threats)",
  };
  let md = `## ${targetName} SWOT 分析\n\n`;
  for (const [cat, label] of Object.entries(categories)) {
    md += `### ${label}\n`;
    const items = entries.filter(e => e.category === cat);
    if (items.length === 0) {
      md += "暂无数据\n\n";
    } else {
      for (const item of items) {
        const confTag = item.confidence === "high" ? " [H]" : item.confidence === "medium" ? " [M]" : " [L]";
        md += `- **${item.point}**${confTag}\n  > ${item.evidence}\n\n`;
      }
    }
  }
  return md;
}

// 洞察 Markdown 渲染
private renderInsightMarkdown(insights: Insight[]): string {
  const catLabels: Record<string, string> = {
    gap: "差距分析",
    advantage: "自身优势",
    opportunity: "蓝海机会",
    risk: "风险预警",
  };
  let md = "## 差异化洞察\n\n";
  for (const [cat, label] of Object.entries(catLabels)) {
    const items = insights.filter(i => i.category === cat);
    md += `### ${label}\n`;
    if (items.length === 0) {
      md += "暂无\n\n";
    } else {
      for (const item of items) {
        md += `- **${item.statement}**\n  > 依据：${item.evidence}\n\n`;
      }
    }
  }
  return md;
}

// 溯源过滤
private filterSourceMap(sourceMap: SourceMapEntry[], artifactType: string, targetName?: string): SourceMapEntry[] {
  return sourceMap.filter(entry => {
    // 根据 conclusionFragment 中的关键词匹配 artifact 类型
    return true;  // 简化：全量传递，前端过滤
  });
}
```

### 5.4 错误处理

| 错误场景 | 处理策略 |
|----------|----------|
| source_map_builder 失败 | sourceMap=[]，产物不含溯源信息 |
| table_composer 失败 | comparison_matrix artifact 不生成，其他 artifact 继续 |
| markdown_renderer 失败 | report artifact 不生成 |
| 所有 outputFormat 都渲染失败 | artifacts=[]，仍 emit WORKFLOW_COMPLETE（含空 artifacts） |

### 5.5 依赖的 Tool

| Tool | manifest.json name | 参数 | 返回 | 新/已有 |
|------|-------------------|------|------|---------|
| source_map_builder | `source_map_builder` | `{ analysisResults, rawData, structuredData }` | `{ sourceMap }` | 新增 |
| table_composer | `table_composer` | `{ title, targets, rows, highlights? }` | `{ content, format }` | 已有·需扩展 |
| markdown_renderer | `markdown_renderer` | `{ title, sections }` | `{ content, format }` | 已有·待接入 |

---

## 附录：Tool 新增/修改清单汇总

### 新增 Tool（10 个）

| # | name | 归属 Capability | 类型 | 复杂度 |
|---|------|----------------|------|--------|
| 1 | `dimension_suggester` | requirement_parsing | LLM 工厂 | 低 |
| 2 | `competitor_url_resolver` | information_collection | LLM 工厂 | 低 |
| 3 | `search_planner` | information_collection | LLM 工厂 | 中 |
| 4 | `credibility_scorer` | information_collection | 规则+LLM | 低 |
| 5 | `sufficiency_checker` | information_collection | 规则+LLM | 中 |
| 6 | `entity_resolver` | information_processing | LLM 工厂 | 中 |
| 7 | `conflict_detector` | information_processing | 规则+LLM | 低-中 |
| 8 | `insight_extractor` | analysis_reasoning | LLM 工厂 | 中 |
| 9 | `comparison_summarizer` | analysis_reasoning | LLM 工厂 | 中 |
| 10 | `source_map_builder` | artifact_generation | 规则+LLM | 低 |

### 已有但需修改的 Tool（4 个）

| # | name | 修改内容 |
|---|------|---------|
| 1 | `web_scrape` | 接入 information_collection Step 3（当前注册但未使用） |
| 2 | `pricing_normalizer` | 接入 information_processing Step 2；参数从 `{ target, rawContent }` 扩展为 `{ target, dimension, rawContent, items }` |
| 3 | `feature_extractor` | 接入 information_processing Step 2；同上参数扩展 |
| 4 | `markdown_renderer` | 接入 artifact_generation Step 2d |
| 5 | `matrix_builder` | 参数扩展：增加 `{ dimensions, coverageContext, imbalanceWarnings, confidencePenalty }` |
| 6 | `swot_generator` | 参数扩展：增加 `{ comparisonContext, confidencePenalty }` |
| 7 | `table_composer` | 参数扩展：增加 `{ highlights }` |

### 新增 UiHint（3 个）

```typescript
// 追加到 backend/runtime/bus/types.ts
export type UiHint =
  | "tool_call" | "tool_result" | "tool_error" | "llm_stream"
  | "node_progress" | "routing_decision" | "workflow_paused"
  | "node_completed" | "workflow_complete" | "workflow_failed"
  | "degradation_notice"
  | "clarification_asked"      // 新增
  | "clarification_answered"   // 新增
  | "quality_warning";         // 新增
```
