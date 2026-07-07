/**
 * 图运行时状态类型（v2 精简版）。
 *
 * data 由 Capability 读写。
 * control 由 Orchestrator + CapabilityExecutor 维护。
 * runtime 每次执行初始化一次。
 * errors 由 CapabilityExecutor 追加。
 */
export interface RuntimeState {
  data: Record<string, any>;
  control: {
    currentNode: string;
    executionPath: ExecutionStep[];
  };
  runtime: {
    workflowId: string;
    runId: string;
    threadId: string;
  };
  errors: ErrorRecord[];
}

export interface ExecutionStep {
  nodeId: string;
  iteration: number;
  startedAt: string;
  completedAt?: string;
}

export interface ErrorRecord {
  nodeId: string;
  traceId: string;
  errorCode: string;
  errorMessage: string;
  timestamp: string;
  details?: Record<string, any>;
}
