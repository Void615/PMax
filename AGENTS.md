# AGENTS.md

用于为编码 agent 提供规约和开发过程信息。

## 规约

./.trae/rules/general-rules.md

## 项目基本介绍

README.md

## 目录基本信息

- `/.trae/memory`: 包含开发过程中的记忆文件，包括当前开发进度、变更日志等。你可以按需修改。
- `/docs`: 包含项目设计文档、规格说明、开发阶段说明、模块设计说明等。你可以根据需要添加其他文档。
- `/backend`: 包含后端代码。
  - `/backend/runtime`: 包含节点运行时。
  - `/backend/src`: 包含后端源代码。
  - `/backend/test`: 包含后端测试代码。
- `/tools`: 包含所有 agent 的工具。
- `/frontend`: 包含前端代码。
- `.env.example`: 包含环境变量配置示例，你可以根据需要修改。
- `.env`: 包含实际的环境变量配置。**永远不要提交到 repo**。