// ═══════════════════════════════════════════════════════════════
// Phase 2 共享类型 —— RuntimeState.data 数据契约
// ═══════════════════════════════════════════════════════════════
//
// 生命周期: requirement_parsing 写入 → 各下游 Capability 读取
//
// 说明: 本条目的所有类型均被 `WorkflowData` 聚合，
//       由 Capability 通过 `state.data` 按 key 读写。

// ─────────────────────────────────────────────────────────────
// 生产方: requirement_parsing
// 消费方: information_collection, information_processing,
//         analysis_reasoning, artifact_generation
// ─────────────────────────────────────────────────────────────

/**
 * 竞品目标。
 *
 * @field name     - 竞品名称（必填）
 * @field url      - 竞品官网或应用商店链接（可选，用于抓取）
 * @field category - 产品品类，如 "电商"、"短视频"（可选，辅助维度推断）
 */
export interface Target {
  name: string;
  url?: string;
  category?: string;
}

/**
 * 对比维度，预设 5 个常用值，也接受任意 string 以支持自定义维度。
 *
 * - "functionality"   功能特性
 * - "pricing"         定价与付费模式
 * - "user_experience" 用户体验与交互设计
 * - "market_position" 市场定位与份额
 * - "technology"      技术能力与架构
 */
export type Dimension =
  | "functionality"
  | "pricing"
  | "user_experience"
  | "market_position"
  | "technology"
  | string;

/**
 * 产物输出格式，决定 artifact_generation 的渲染路径。
 *
 * - "comparison_matrix" 对比矩阵表格
 * - "swot"              SWOT 分析
 * - "feature_list"      功能点列表
 * - "report"            综合报告
 */
export type OutputFormat = "comparison_matrix" | "swot" | "feature_list" | "report";

/**
 * 分析约束条件，影响信息采集的搜索范围和分析推理的时间/地域裁剪。
 *
 * @field timeRange     - 限定信息的时间窗口，如最近一年
 * @field regions       - 限定地域市场，如 ["中国", "北美"]
 * @field languages     - 限定信息来源语言
 * @field maxCompetitors - 最多分析的竞品数量上限
 */
export interface AnalysisConstraints {
  timeRange?: { from?: string; to?: string };
  regions?: string[];
  languages?: string[];
  maxCompetitors?: number;
}

/**
 * 单轮澄清的定义。每种 analysisType 有一组 ROUND_DEFS。
 * 所有轮次必填。
 */
export interface ClarificationRoundDef {
  questionType: "targets" | "dimensions" | "output_format" | "constraints";
}

/**
 * 单轮澄清对话记录，用于多轮对话的完整溯源。
 */
export interface ClarificationRound {
  round: number;
  questionType: "scene_selection" | "targets" | "dimensions" | "output_format" | "constraints" | "confirm_preview";
  agentPrompt: string;
  userResponse: string;
  extractedDelta: Record<string, any>;
  timestamp: string;
}

/**
 * 每种分析场景的澄清轮次序列。
 * Round 1 (scene_selection) 是固定入口，不在表内。
 */
export const ROUND_DEFS: Record<string, ClarificationRoundDef[]> = {
  product_comparison: [
    { questionType: "targets" },
    { questionType: "dimensions" },
    { questionType: "output_format" },
    { questionType: "constraints" },
  ],
};

/**
 * 需求解析的完整产出。写入 `state.data.config`，是所有下游 Capability 的输入契约。
 *
 * @field analysisType - 分析场景类型（Phase 2 固定为 "product_comparison"）
 * @field targets      - 竞品列表，至少 2 个
 * @field dimensions   - 对比维度列表
 * @field outputFormat - 期望产物格式列表
 * @field constraints  - 可选约束条件
 * @field userInput    - 保留原始用户输入文本
 */
export interface RequirementConfig {
  analysisType: "product_comparison";
  targets: Target[];
  dimensions: Dimension[];
  outputFormat: OutputFormat[];
  constraints: AnalysisConstraints;
  userInput: string;
  clarificationHistory: ClarificationRound[];
}

// ─────────────────────────────────────────────────────────────
// 生产方: information_collection
// 消费方: information_processing, analysis_reasoning,
//         artifact_generation (source_map)
// ─────────────────────────────────────────────────────────────

/**
 * 单条原始采集数据。由 information_collection 搜索产生，按 dimension 分组后写入 `state.data.rawData`。
 *
 * @field target      - 所属竞品名称
 * @field dimension   - 所属对比维度
 * @field content     - 原始文本内容
 * @field sourceUrl   - 信息来源 URL（用于溯源）
 * @field sourceTitle - 来源页面标题
 * @field retrievedAt - 采集时间（ISO 8601）
 * @field credibility - 来源可信度: high/medium/low/unknown
 */
export interface RawDataItem {
  target: string;
  dimension: string;
  content: string;
  sourceUrl: string;
  sourceTitle?: string;
  retrievedAt: string;
  credibility: "high" | "medium" | "low" | "unknown";
}

/**
 * 单轮采集的结果摘要。
 *
 * @field items               - 采集到的原始数据条目
 * @field uncoveredDimensions - 未采集到任何数据的维度
 * @field summary             - 人类可读的采集概况描述
 */
export interface CollectionResult {
  items: RawDataItem[];
  uncoveredDimensions: string[];
  summary: string;
}

// ─────────────────────────────────────────────────────────────
// 信息采集工具类型（information_collection Capability 内部使用）
// ─────────────────────────────────────────────────────────────

/** 单个搜索查询 */
export interface SearchQuery {
  target: string;
  dimension: string;
  query: string;
  searchType: "broad" | "targeted";
}

/** 一批可并行执行的搜索查询 */
export interface SearchBatch {
  queries: SearchQuery[];
}

/** 搜索计划 */
export interface SearchPlan {
  batches: SearchBatch[];
}

/** 采集报告 */
export interface CollectionReport {
  totalItems: number;
  perDimension: Record<string, { count: number; credibilityBreakdown: Record<string, number> }>;
  sufficiencyScore: number;
  sufficiencyVerdict: "sufficient" | "insufficient";
  collectionRounds: number;
}

// ─────────────────────────────────────────────────────────────
// 生产方: information_processing
// 消费方: analysis_reasoning（优先使用，优于 rawData）
// ─────────────────────────────────────────────────────────────

/**
 * 单条结构化记录。由 information_processing 从 rawData 中提取并归一化后写入 `state.data.structuredData`。
 *
 * @field target         - 所属竞品名称
 * @field dimension      - 所属对比维度
 * @field attribute      - 具体属性名，如 "月费价格"、"去广告"
 * @field value          - 归一化后的属性值
 * @field rawValue       - 原始文本值（保留溯源用）
 * @field confidence     - LLM 提取置信度 0-1
 * @field sourceTraceIds - 回溯到 rawData 的 traceId 列表
 */
export interface StructuredRecord {
  target: string;
  dimension: string;
  attribute: string;
  value: string;
  rawValue?: string;
  confidence: number;
  sourceTraceIds: string[];
  status: "clean" | "conflicting" | "inferred";
}

/**
 * 冲突报告。由 conflict_detector 生成，描述两条记录之间的矛盾。
 */
export interface ConflictReport {
  recordA: StructuredRecord;
  recordB: StructuredRecord;
  nature: "value_contradiction" | "credibility_mismatch";
  severity: "high" | "medium" | "low";
}

/**
 * 信息处理结果汇总。
 *
 * @field records             - 所有结构化记录
 * @field uncoveredDimensions - 处理后仍无数据的维度
 * @field coverageMatrix      - (target, attribute) 覆盖率矩阵
 * @field conflictCount       - 检测到的冲突总数
 * @field conflicts           - 冲突详情列表
 */
export interface ProcessingResult {
  records: StructuredRecord[];
  uncoveredDimensions: string[];
  coverageMatrix: Record<string, Record<string, "covered" | "inferred" | "missing">>;
  conflictCount: number;
  conflicts?: ConflictReport[];
}

// ─────────────────────────────────────────────────────────────
// 生产方: analysis_reasoning
// 消费方: artifact_generation
// ─────────────────────────────────────────────────────────────

/**
 * 单行对比条目，对应对比矩阵的一行。
 *
 * @field dimension - 所属维度
 * @field attribute - 对比属性名
 * @field values    - 各竞品在该属性上的取值列表
 *                   每个 value 含 {target, value, sourceTraceId}
 * @field winner     - 该属性表现最佳的竞品名，无明显差异时为 null
 * @field analysis   - LLM 生成的一句差异分析
 */
export interface FeatureComparison {
  dimension: string;
  attribute: string;
  values: { target: string; value: string; sourceTraceId: string }[];
  winner?: string;
  analysis: string;
}

/**
 * 单条 SWOT 条目。
 *
 * @field category       - 象限: strengths/weaknesses/opportunities/threats
 * @field target         - 所属竞品名称
 * @field point          - SWOT 分析点（一句话）
 * @field evidence       - 支撑证据（引用对比数据）
 * @field sourceTraceIds - 回溯到 rawData/structuredData 的 traceId
 */
export interface SWOTEntry {
  category: "strengths" | "weaknesses" | "opportunities" | "threats";
  target: string;
  point: string;
  evidence: string;
  sourceTraceIds: string[];
}

/**
 * 分析推理的完整产出。写入 `state.data.analysisResults`。
 *
 * @field comparisonMatrix - 多维度对比矩阵（每行一个属性）
 * @field swot             - 每个竞品的 SWOT 分析条目
 * @field summary          - LLM 生成的综合分析摘要（≤500 字）
 */
export interface AnalysisResult {
  comparisonMatrix: FeatureComparison[];
  swot: SWOTEntry[];
  summary: string;
}

// ─────────────────────────────────────────────────────────────
// 生产方: artifact_generation
// 消费方: 前端渲染 / 外部导出
// ─────────────────────────────────────────────────────────────

/**
 * 单条溯源映射，将产物中的结论片段关联回原始信息来源。
 *
 * @field conclusionFragment - 产物中的结论片段文本
 * @field sourceUrl          - 原始信息来源 URL
 * @field sourceExcerpt      - 原始来源摘要（截取前 200 字符）
 * @field traceId            - 回溯到 WorkflowEvent 的 traceId
 */
export interface SourceMapEntry {
  conclusionFragment: string;
  sourceUrl: string;
  sourceExcerpt: string;
  traceId: string;
}

/**
 * 单个可交付产物。写入 `state.data.artifacts`。
 *
 * @field type      - 产物类型: comparison_matrix/swot/summary
 * @field format    - 渲染格式: markdown/html/json
 * @field title     - 产物标题
 * @field content   - 渲染后的正文内容
 * @field sourceMap - 溯源映射列表，支持结论→来源的精准回溯
 */
export interface Artifact {
  type: "comparison_matrix" | "swot" | "summary";
  format: "markdown" | "html" | "json";
  title: string;
  content: string;
  sourceMap: SourceMapEntry[];
}

// ─────────────────────────────────────────────────────────────
// RuntimeState.data 聚合类型
// ─────────────────────────────────────────────────────────────

/**
 * 整个工作流共享的 `RuntimeState.data` 数据契约。
 * 各 Capability 按 inputHints/outputHints 声明读写哪个 key，
 * Orchestrator 据此验证依赖满足性。
 *
 * @field userInput       - 原始用户输入，requirement_parsing 读取
 * @field config          - 需求解析结果，requirement_parsing 写入
 * @field rawData         - 原始采集数据，按 dimension 分组，
 *                          information_collection 写入
 * @field structuredData  - 结构化处理后数据（可选），
 *                          information_processing 写入
 * @field analysisResults - 分析推理结果，
 *                          analysis_reasoning 写入
 * @field artifacts       - 最终产物列表，
 *                          artifact_generation 写入
 */
export interface WorkflowData {
  userInput?: string;
  config?: RequirementConfig;
  rawData?: Record<string, RawDataItem[]>;
  structuredData?: Record<string, StructuredRecord[]>;
  analysisResults?: AnalysisResult;
  artifacts?: Artifact[];
}
