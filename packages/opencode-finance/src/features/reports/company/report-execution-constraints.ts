export function reportExecutionConstraintLines(input: { outputRoot: string; focus: string; quiverSetupHint: string }) {
  return [
    "Execution constraints for this `/report` run:",
    `- Write artifacts only under \`${input.outputRoot}\`.`,
    ...(input.focus ? [`- Focus area for this run: \`${input.focus}\`.`] : []),
    '- Use `financial_search` with `coverage: "comprehensive"` for numeric claims.',
    "- If a numeric field cannot be sourced, set the value to `unknown` (never `N/A`).",
    `- If Quiver setup is missing, instruct: ${input.quiverSetupHint}.`,
    "- After `report.md`, `dashboard.md`, `assumptions.json`, and `adjustment-log.md` are written, call `report_evaluation`.",
    '- After `report_evaluation` writes `evaluation.md` and `evaluation-snapshot.json`, call `report_pdf` with `subcommand: "report"`.',
  ]
}
