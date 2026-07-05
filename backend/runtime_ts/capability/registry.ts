import type { Capability } from "./types.js";

export class CapabilityRegistry {
  private caps = new Map<string, Capability>();

  register(cap: Capability): void {
    if (this.caps.has(cap.id)) {
      throw new Error(`Duplicate capability: ${cap.id}`);
    }
    this.caps.set(cap.id, cap);
  }

  get(id: string): Capability | undefined {
    return this.caps.get(id);
  }

  listIds(): string[] {
    return [...this.caps.keys()];
  }

  listAll(): Capability[] {
    return [...this.caps.values()];
  }

  remove(id: string): boolean {
    return this.caps.delete(id);
  }

  clear(): void {
    this.caps.clear();
  }
}
