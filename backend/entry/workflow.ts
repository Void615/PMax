import {
  CapabilityRegistry,
} from "../runtime/index.js";
import { createRequirementParsingCap } from "../capabilities/requirement_parsing/index.js";
import { createInformationCollectionCap } from "../capabilities/information_collection/index.js";
import { createInformationProcessingCap } from "../capabilities/information_processing/index.js";
import { createAnalysisReasoningCap } from "../capabilities/analysis_reasoning/index.js";
import { createArtifactGenerationCap } from "../capabilities/artifact_generation/index.js";

export interface LlmClient {
  complete(prompt: string): Promise<string>;
  plan?(state: Record<string, any>, tools: { name: string; description: string }[]): Promise<Record<string, any>>;
  synthesize?(state: Record<string, any>, results: any[]): Promise<Record<string, any>>;
}

export function createRegistry(llm: LlmClient): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(createRequirementParsingCap(llm));
  registry.register(createInformationCollectionCap(llm));
  registry.register(createInformationProcessingCap(llm));
  registry.register(createAnalysisReasoningCap(llm));
  registry.register(createArtifactGenerationCap());
  return registry;
}
