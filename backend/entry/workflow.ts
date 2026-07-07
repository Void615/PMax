import {
  CapabilityRegistry,
  GraphRuntime,
  Orchestrator,
} from "../runtime/index.js";
import type {
  RuntimeContext,
  EventBus,
  RuntimeState,
} from "../runtime/index.js";
import { createRequirementParsingCap } from "../capabilities/requirement_parsing/index.js";
import { createInformationCollectionCap } from "../capabilities/information_collection/index.js";
import { createAnalysisReasoningCap } from "../capabilities/analysis_reasoning/index.js";
import { createArtifactGenerationCap } from "../capabilities/artifact_generation/index.js";
import type { WorkflowData } from "../capabilities/shared/types.js";

export interface LlmClient {
  complete(prompt: string): Promise<string>;
  plan?(state: Record<string, any>, tools: { name: string; description: string }[]): Promise<Record<string, any>>;
  synthesize?(state: Record<string, any>, results: any[]): Promise<Record<string, any>>;
}

export function createWorkflow(llm: LlmClient, eventBus: EventBus) {
  const registry = new CapabilityRegistry();

  // 注册所有 Capability
  registry.register(createRequirementParsingCap(llm));
  registry.register(createInformationCollectionCap(llm));
  registry.register(createAnalysisReasoningCap(llm));
  registry.register(createArtifactGenerationCap());

  const runtime = new GraphRuntime(registry);

  return {
    async run(userInput: string): Promise<RuntimeState> {
      const state = runtime.initialState({ userInput } as WorkflowData);

      // 构建 RuntimeContext
      const ctx: RuntimeContext = {
        traceId: "",
        workflowId: "default",
        runId: state.runtime.runId,
        nodeId: "",
        iteration: 0,
        signal: new AbortController().signal,
        llm: {
          complete: llm.complete,
          plan: llm.plan ?? (async () => ({ phases: [] })),
          synthesize: llm.synthesize ?? (async (_state: Record<string, any>, r: any[]) => r),
        },
        emit: async (event: any, _opts?: any) => {
          await eventBus.publish({
            traceId: ctx.traceId,
            eventType: event.eventType ?? "EVENT",
            uiHint: event.uiHint,
            nodeId: ctx.nodeId,
            workflowId: ctx.workflowId,
            runId: ctx.runId,
            payload: event.payload ?? {},
            timestamp: new Date().toISOString(),
          } as any);
        },
        saveArtifact: async (_draft: any) => "",
      };

      // Orchestrator 编排循环
      const orch = new Orchestrator(registry, ctx, eventBus);
      await orch.initialize(userInput);

      let currentState = state;

      // 先执行入口节点
      currentState = await runtime.executeStep("requirement_parsing", currentState, {
        ...ctx,
        nodeId: "requirement_parsing",
      });

      // 进入编排循环
      let lastNodeId = "requirement_parsing";
      while (orch.hasMoreCandidates(currentState)) {
        // 在生产环境中，这里应等待人工路由决策
        // 当前简化：自动选择第一个 pending 候选
        const suggestions = await orch.suggestRoute(lastNodeId, currentState, "state summary");

        if (suggestions.length === 0) break;

        const nextNode = suggestions[0].nodeId;
        currentState = await runtime.executeStep(nextNode, currentState, {
          ...ctx,
          nodeId: nextNode,
        });
        lastNodeId = nextNode;

        // artifact_generation 是终止节点
        if (nextNode === "artifact_generation") break;
      }

      return currentState;
    },
  };
}
