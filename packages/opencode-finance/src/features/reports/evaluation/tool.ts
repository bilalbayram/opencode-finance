import path from "path"
import z from "zod"
import { Tool } from "../../../core/tool"
import DESCRIPTION from "./report_evaluation.txt"
import { assertExternalDirectory } from "../../../core/tooling/external-directory"
import { normalizeTicker } from "../../../integrations/finance/parser"
import { buildReportEvaluationSnapshot, writeReportEvaluationArtifacts } from "./evaluation"

const parameters = z.object({
  ticker: z.string().describe("Ticker symbol (for example: AAPL)."),
  outputRoot: z.string().describe("Report directory path, usually reports/<TICKER>/<YYYY-MM-DD>/."),
  refresh: z.boolean().optional().describe("Accepted for parity with finance tools."),
})

function projectWorktree(context: Pick<Tool.Context, "directory" | "worktree">) {
  return context.worktree === "/" ? context.directory : context.worktree
}

export const ReportEvaluationTool = Tool.define("report_evaluation", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const ticker = normalizeTicker(params.ticker)
    if (!ticker) throw new Error("ticker must include at least one valid symbol character")
    const root = path.isAbsolute(params.outputRoot)
      ? path.normalize(params.outputRoot)
      : path.resolve(ctx.directory, params.outputRoot)
    const worktree = projectWorktree(ctx)

    await assertExternalDirectory(ctx, root, { kind: "directory" })

    await ctx.ask({
      permission: "financial_search",
      patterns: [ticker, "report", "evaluation", "dcf", "piotroski", "altman"],
      always: ["*"],
      metadata: {
        ticker,
        output_root: root,
        refresh: params.refresh,
      },
    })

    const snapshot = await buildReportEvaluationSnapshot({
      ticker,
      signal: ctx.abort,
    })

    const evaluationPath = path.join(root, "evaluation.md")
    const snapshotPath = path.join(root, "evaluation-snapshot.json")
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(worktree, evaluationPath), path.relative(worktree, snapshotPath)],
      always: ["*"],
      metadata: {
        output_root: root,
        evaluation_path: evaluationPath,
        snapshot_path: snapshotPath,
      },
    })

    const files = await writeReportEvaluationArtifacts({
      outputRoot: root,
      snapshot,
    })

    return {
      title: `report_evaluation: ${ticker}`,
      metadata: {
        ticker,
        output_root: files.output_root,
        evaluation_path: files.evaluation_path,
        snapshot_path: files.snapshot_path,
      },
      output: JSON.stringify(
        {
          ...snapshot,
          artifacts: files,
        },
        null,
        2,
      ),
    }
  },
})
