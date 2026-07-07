// ── requirement_parsing 产出 ──

export interface Target {
  name: string;
  url?: string;
  category?: string;
}

export type Dimension =
  | "functionality"
  | "pricing"
  | "user_experience"
  | "market_position"
  | "technology"
  | string;

export type OutputFormat = "comparison_matrix" | "swot" | "feature_list" | "report";

export interface AnalysisConstraints {
  timeRange?: { from?: string; to?: string };
  regions?: string[];
  languages?: string[];
  maxCompetitors?: number;
}

export interface RequirementConfig {
  analysisType: "product_comparison";
  targets: Target[];
  dimensions: Dimension[];
  outputFormat: OutputFormat[];
  constraints: AnalysisConstraints;
  userInput: string;
}

// ── information_collection 产出 ──

export interface RawDataItem {
  target: string;
  dimension: string;
  content: string;
  sourceUrl: string;
  sourceTitle?: string;
  retrievedAt: string;
  credibility: "high" | "medium" | "low" | "unknown";
}

export interface CollectionResult {
  items: RawDataItem[];
  uncoveredDimensions: string[];
  summary: string;
}

// ── information_processing 产出 ──

export interface StructuredRecord {
  target: string;
  dimension: string;
  attribute: string;
  value: string;
  rawValue?: string;
  confidence: number;
  sourceTraceIds: string[];
}

export interface ProcessingResult {
  records: StructuredRecord[];
  uncoveredDimensions: string[];
}

// ── analysis_reasoning 产出 ──

export interface FeatureComparison {
  dimension: string;
  attribute: string;
  values: { target: string; value: string; sourceTraceId: string }[];
  winner?: string;
  analysis: string;
}

export interface SWOTEntry {
  category: "strengths" | "weaknesses" | "opportunities" | "threats";
  target: string;
  point: string;
  evidence: string;
  sourceTraceIds: string[];
}

export interface AnalysisResult {
  comparisonMatrix: FeatureComparison[];
  swot: SWOTEntry[];
  summary: string;
}

// ── artifact_generation 产出 ──

export interface SourceMapEntry {
  conclusionFragment: string;
  sourceUrl: string;
  sourceExcerpt: string;
  traceId: string;
}

export interface Artifact {
  type: "comparison_matrix" | "swot" | "summary";
  format: "markdown" | "html" | "json";
  title: string;
  content: string;
  sourceMap: SourceMapEntry[];
}

// ── RuntimeState.data 数据契约 ──

export interface WorkflowData {
  userInput?: string;
  config?: RequirementConfig;
  rawData?: Record<string, RawDataItem[]>;
  structuredData?: Record<string, StructuredRecord[]>;
  analysisResults?: AnalysisResult;
  artifacts?: Artifact[];
}
