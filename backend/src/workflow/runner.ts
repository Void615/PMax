// backend/src/workflow/runner.ts

import {
  CapabilityRegistry,
  GraphRuntime,
  Orchestrator,
} from "../../runtime/index.js";
import type {
  RuntimeContext,
  RuntimeState,
  EventBus,
} from "../../runtime/index.js";
import type { WorkflowData } from "../../capabilities/shared/types.js";
import {
  fold,
  countIterations,
  getOutputKeys,
} from "./events.js";
import type { WorkflowLifecycleEvent, HumanDecision } from "./events.js";

export interface RunnerDeps {
  loadEventStream(workflowId: string): Promise<WorkflowLifecycleEvent[]>;
  appendEvent(workflowId: string, event: WorkflowLifecycleEvent): Promise<void>;
  waitForHumanDecision(workflowId: string): Promise<HumanDecision>;
  updateWorkflowStatus(
    workflowId: string,
    data: { status: string; pausedAt?: Date | null; currentNode?: string }
  ): Promise<void>;
}

export async function* runWorkflow(
  workflowId: string,
  userInput: string,
  registry: CapabilityRegistry,
  ctx: RuntimeContext,
  eventBus: EventBus,
  deps: RunnerDeps
): AsyncGenerator<void> {
  const runtime = new GraphRuntime(registry);

  // 1. Load event stream + project state
  const pastEvents = await deps.loadEventStream(workflowId);
  let state: RuntimeState = runtime.initialState({ userInput } as WorkflowData);
  for (const e of pastEvents) {
    state = fold(state, e, registry);
  }

  // 2. Determine resume point
  const lastEvent = pastEvents[pastEvents.length - 1];
  let currentNode: string | null = null;

  if (!lastEvent) {
    currentNode = "requirement_parsing";
  } else if (lastEvent.type === "human.continued" || lastEvent.type === "human.backjumped") {
    currentNode = lastEvent.targetNode;
  } else if (lastEvent.type === "route.required") {
    currentNode = null;
  } else {
    // Already terminated
    return;
  }

  const orch = new Orchestrator(registry, ctx, eventBus);
  await orch.initialize(userInput);

  // 3. Orchestration loop
  while (currentNode) {
    // Execute node
    ctx.nodeId = currentNode;
    state = await runtime.executeStep(currentNode, state, ctx);
    const iteration = countIterations(state, currentNode);
    const outputKeys = getOutputKeys(currentNode, registry);

    await deps.appendEvent(workflowId, {
      type: "node.executed",
      nodeId: currentNode,
      iteration,
      outputKeys,
    });

    // Termination check
    if (currentNode === "artifact_generation") {
      await deps.appendEvent(workflowId, { type: "workflow.completed" });
      await deps.updateWorkflowStatus(workflowId, { status: "completed" });
      break;
    }

    // Route
    const suggestions = await orch.suggestRoute(currentNode, state, "state summary");
    await deps.appendEvent(workflowId, {
      type: "route.required",
      completedNode: currentNode,
      suggestions,
    });

    // Pause — wait for human decision
    await deps.updateWorkflowStatus(workflowId, {
      status: "paused",
      pausedAt: new Date(),
      currentNode,
    });

    const decision = await deps.waitForHumanDecision(workflowId);

    // Resume — update status
    await deps.updateWorkflowStatus(workflowId, {
      status: "running",
      pausedAt: null,
      currentNode: decision.targetNode,
    });

    const eventType =
      decision.action === "backjump" ? "human.backjumped" : "human.continued";

    await deps.appendEvent(workflowId, {
      type: eventType,
      targetNode: decision.targetNode,
    } as WorkflowLifecycleEvent);

    state = fold(state, { type: eventType, targetNode: decision.targetNode } as WorkflowLifecycleEvent, registry);
    currentNode = decision.targetNode;
  }
}
