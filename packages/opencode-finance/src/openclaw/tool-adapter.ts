import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk/core"
import z from "zod"
import { FinancialSearchTool } from "../tool/financial-search"
import { ReportPdfTool } from "../tool/pdf"
import { Tool } from "../tool/tool"

const OPENCLAW_TOOL_INFOS = [FinancialSearchTool, ReportPdfTool]

type OpenClawToolRegistration = Parameters<OpenClawPluginApi["registerTool"]>[0]
type OpenClawToolFactory = Exclude<OpenClawToolRegistration, AnyAgentTool>
type OpenClawPluginToolContext = Parameters<OpenClawToolFactory>[0]

export const OPENCLAW_TOOL_IDS = OPENCLAW_TOOL_INFOS.map((tool) => tool.id)

export type OpenClawToolEntry = {
  name: string
  create(context: OpenClawPluginToolContext): AnyAgentTool
}

function toolLabel(input: string) {
  return input
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ")
}

export function createOpenClawExecutionContext(
  pluginContext: OpenClawPluginToolContext,
  signal?: AbortSignal,
): Tool.Context {
  const directory = pluginContext.workspaceDir ?? pluginContext.agentDir ?? process.cwd()
  return {
    directory,
    worktree: directory,
    abort: signal ?? new AbortController().signal,
    async ask() {},
    metadata() {},
  }
}

export async function loadOpenClawToolEntries(): Promise<OpenClawToolEntry[]> {
  return Promise.all(
    OPENCLAW_TOOL_INFOS.map(async (toolInfo) => {
      const tool = await toolInfo.init()
      const parameters = z.toJSONSchema(tool.parameters) as Record<string, unknown>

      return {
        name: toolInfo.id,
        create(context) {
          return {
            name: toolInfo.id,
            label: toolLabel(toolInfo.id),
            description: tool.description,
            parameters,
            async execute(_toolCallId, args, signal) {
              const result = await tool.execute(args, createOpenClawExecutionContext(context, signal))
              return {
                content: [{ type: "text", text: result.output }],
                details: {
                  title: result.title,
                  metadata: result.metadata,
                },
              }
            },
          } satisfies AnyAgentTool
        },
      }
    }),
  )
}
