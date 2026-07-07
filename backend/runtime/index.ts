/**
 * 多 Agent 编排运行时 —— 可复用的分布式工作流执行引擎（v2）。
 *
 * 公共 API:
 *
 *   engine/:       StateGraph, CompiledGraph, Checkpointer, END
 *   capability/:   Capability, Tool, RuntimeContext, CapabilityRegistry, CapabilityExecutor
 *   bus/:          WorkflowEvent, UiHint, EventBus, RedisEventBus, SSERelay
 *   orchestrator/: Orchestrator
 *   tracing/:      TraceId
 *   retry.ts:      NodeFatalError, executeWithRetry
 */

// ── engine ──
export { StateGraph, CompiledGraph, END } from "./engine/graph.js";
export type { Checkpointer, Checkpoint } from "./engine/checkpointer.js";
export type { GraphConfig } from "./engine/graph.js";

// ── capability ──
export { CapabilityRegistry } from "./capability/registry.js";
export { CapabilityExecutor } from "./capability/executor.js";
export type {
  Capability,
  Tool,
  ToolContext,
  CapabilityResult,
  ArtifactDraft,
  NodeMetrics,
} from "./capability/types.js";
export type { RuntimeContext, EmitOptions, LlmClient } from "./capability/context.js";

// ── bus ──
export type { WorkflowEvent, UiHint, EventBus } from "./bus/types.js";
export { RedisEventBus } from "./bus/redis_bus.js";
export { EventPersister } from "./bus/persister.js";
export { SSERelay } from "./bus/sse_relay.js";

// ── retry ──
export { NodeFatalError, executeWithRetry } from "./retry.js";
export type { RetryPolicyConfig, RetryEventLogger } from "./retry.js";

// ── state ──
export type { RuntimeState, ExecutionStep, ErrorRecord } from "./state.js";

// ── graph runtime ──
export { GraphRuntime } from "./graph_runtime.js";

// ── orchestrator ──
export { Orchestrator } from "./orchestrator/orchestrator.js";
export { CapabilityDiscoverer } from "./orchestrator/discover.js";
export { TaskPlanner } from "./orchestrator/planner.js";
export { CandidateEngine } from "./orchestrator/candidate_engine.js";
export { LlmRanker } from "./orchestrator/llm_ranker.js";
export type {
  RouteCandidate,
  RouteSuggestion,
  TaskPlan,
  TaskPhase,
  CapabilityProfile,
} from "./orchestrator/types.js";

// ── skills ──
export { SkillLoader } from "./skills/loader.js";
export { McpAdapter, McpProcessManager } from "./skills/adapter.js";
export type { McpManifold, McpClientLike, McpProcess } from "./skills/adapter.js";

// ── tracing ──
export { generateTraceId, generateRunId } from "./tracing/trace_id.js";
export { TraceCollector } from "./tracing/collector.js";
export type { TraceNode, TraceStore } from "./tracing/collector.js";
