import type { Tool, ToolContext } from "../../runtime/capability/types.js";

export const markdownRenderer: Tool = {
  name: "markdown_renderer",
  description: "将结构化数据渲染为格式化的 Markdown 文档",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "文档标题" },
      sections: { type: "string", description: "章节数组 JSON" },
    },
    required: ["title", "sections"],
  },
  async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
    const { title, sections: sectionsJson } = params;
    const sections: { heading: string; body: string }[] =
      typeof sectionsJson === "string" ? JSON.parse(sectionsJson) : sectionsJson;

    const content = [
      `# ${title}`,
      "",
      ...sections.flatMap(s => [`## ${s.heading}`, "", s.body, ""]),
    ].join("\n");

    return { format: "markdown", content };
  },
};
