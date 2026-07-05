import type { Tool } from "../capability/types.js";

export interface McpManifold {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  serverCommand?: string;
  serverArgs?: string[];
}

export interface McpClientLike {
  call(toolName: string, params: Record<string, any>): Promise<any>;
}

export class McpAdapter {
  constructor(private readonly mcpClient: McpClientLike) {}

  adapt(manifest: McpManifold): Tool {
    return {
      name: manifest.name,
      description: manifest.description,
      parameters: manifest.inputSchema,
      execute: async (params: Record<string, any>) => {
        return this.mcpClient.call(manifest.name, params);
      },
    };
  }
}

// ── MCP 进程生命周期管理 ─────────────────────────────────────────────────

export interface McpProcess {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export class McpProcessManager {
  private processes = new Map<string, McpProcess>();

  async launch(manifest: McpManifold): Promise<void> {
    // Stub: MCP 服务进程的实际启动由外部实现
    // 这里提供接口框架
  }

  async shutdown(toolName: string): Promise<void> {
    const proc = this.processes.get(toolName);
    if (proc) await proc.stop();
    this.processes.delete(toolName);
  }

  async shutdownAll(): Promise<void> {
    await Promise.all([...this.processes.values()].map(p => p.stop()));
    this.processes.clear();
  }
}
