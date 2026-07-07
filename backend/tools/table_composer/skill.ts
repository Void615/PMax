import type { Tool, ToolContext } from "../../runtime/capability/types.js";

export const tableComposer: Tool = {
  name: "table_composer",
  description: "将对比矩阵数据渲染为 Markdown 表格",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "表格标题" },
      targets: { type: "array", items: { type: "string" } },
      rows: { type: "string", description: "行数据的 JSON 字符串" },
    },
    required: ["title", "targets", "rows"],
  },
  async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
    const { title, targets, rows: rowsJson } = params;
    const rows: { attribute: string; values: Record<string, string> }[] =
      typeof rowsJson === "string" ? JSON.parse(rowsJson) : rowsJson;

    const header = `| 属性 | ${targets.join(" | ")} |`;
    const separator = `|------|${targets.map(() => "------").join("|")}|`;
    const body = rows.map((row) => {
      const vals = targets.map((t: string) => row.values[t] ?? "-");
      return `| ${row.attribute} | ${vals.join(" | ")} |`;
    }).join("\n");

    const markdown = `## ${title}\n\n${header}\n${separator}\n${body}`;
    return { format: "markdown", content: markdown };
  },
};
