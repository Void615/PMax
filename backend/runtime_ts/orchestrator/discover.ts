import type { CapabilityRegistry } from "../capability/registry.js";
import type { CapabilityProfile } from "./types.js";

export class CapabilityDiscoverer {
  constructor(private readonly registry: CapabilityRegistry) {}

  discover(): CapabilityProfile[] {
    const profiles: CapabilityProfile[] = [];
    for (const cap of this.registry.listAll()) {
      profiles.push({
        id: cap.id,
        description: cap.description,
        tools: cap.tools.map(t => t.name),
        toolDescriptions: cap.tools.map(t => ({ name: t.name, desc: t.description })),
        inputHints: cap.inputHints ?? [],
        outputHints: cap.outputHints ?? [],
        requires: cap.requires ?? [],
      });
    }
    return profiles;
  }

  /** 降级：返回空画像列表 */
  discoverSafe(): CapabilityProfile[] {
    try {
      return this.discover();
    } catch {
      return [];
    }
  }
}
