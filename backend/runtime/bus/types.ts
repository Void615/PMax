export type UiHint =
  | "tool_call"
  | "tool_result"
  | "tool_error"
  | "llm_stream"
  | "node_progress"
  | "routing_decision"
  | "workflow_paused"
  | "node_completed"
  | "workflow_complete"
  | "workflow_failed"
  | "degradation_notice"
  | "clarification_asked"
  | "quality_warning";

export interface WorkflowEvent {
  traceId: string;
  parentTraceId?: string;
  eventType: string;
  uiHint: UiHint;
  nodeId: string;
  workflowId: string;
  runId: string;
  payload: Record<string, any>;
  timestamp: string;
}

export interface EventBus {
  publish(event: WorkflowEvent, opts?: { persist?: boolean }): Promise<void>;
  subscribe(workflowId: string, handler: (event: WorkflowEvent) => void): Promise<void>;
  unsubscribe(workflowId: string): Promise<void>;
}
