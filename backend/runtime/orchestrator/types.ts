export interface CapabilityProfile {
  id: string;
  description: string;
  tools: string[];
  toolDescriptions: { name: string; desc: string }[];
  inputHints: string[];
  outputHints: string[];
  requires: string[];
}

export interface RouteCandidate {
  nodeId: string;
  status: "pending" | "rerun";
  executable: boolean;
  planWeight: number;
}

export interface RouteSuggestion {
  nodeId: string;
  priority: number;
  reason: string;
}

export interface TaskPhase {
  name: string;
  targetNodes: string[];
  rationale: string;
}

export interface TaskPlan {
  phases: TaskPhase[];
  dependencies: Record<string, string[]>;
}
