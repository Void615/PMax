import * as fs from "node:fs/promises";
import * as path from "node:path";
import { watch } from "node:fs";
import type { Tool } from "../capability/types.js";

interface ManifoldJson {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export class SkillLoader {
  constructor(private readonly toolsDir: string) {}

  async loadAll(): Promise<Tool[]> {
    const tools: Tool[] = [];
    const entries = await fs.readdir(this.toolsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const toolDir = path.join(this.toolsDir, entry.name);
      try {
        const tool = await this.loadTool(toolDir);
        if (tool) tools.push(tool);
      } catch (err) {
        console.warn(`Failed to load tool: ${entry.name}`, err);
      }
    }

    return tools;
  }

  /** 监听 tools 目录变化，支持热插拔 */
  watch(callback: (toolName: string, action: "added" | "removed" | "changed") => void): () => void {
    const watcher = watch(this.toolsDir, { recursive: false }, async (event, filename) => {
      if (!filename) return;
      try {
        if (event === "rename") {
          const dirPath = path.join(this.toolsDir, filename);
          const exists = await fs.access(dirPath).then(() => true).catch(() => false);
          callback(filename, exists ? "added" : "removed");
        } else {
          callback(filename, "changed");
        }
      } catch { /* ignore */ }
    });

    return () => watcher.close();
  }

  private async loadTool(toolDir: string): Promise<Tool | null> {
    const manifestPath = path.join(toolDir, "manifest.json");
    const manifest = JSON.parse(
      await fs.readFile(manifestPath, "utf-8")
    ) as ManifoldJson;

    let execute: Tool["execute"];
    const skillPath = path.join(toolDir, "skill.js");
    try {
      const mod = await import(skillPath);
      execute = mod.default ?? mod.execute;
    } catch {
      execute = async () => { throw new Error("No local skill implementation"); };
    }

    return {
      name: manifest.name,
      description: manifest.description,
      parameters: manifest.parameters,
      execute,
    };
  }
}
