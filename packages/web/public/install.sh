#!/usr/bin/env bash
set -euo pipefail

readonly OPENCODE_INSTALL_URL="https://opencode.ai/install"
readonly OPENCODE_SCHEMA_URL="https://opencode.ai/config.json"
readonly OPENCODE_PLUGIN="opencode-finance"

readonly XDG_CONFIG_ROOT="${XDG_CONFIG_HOME:-$HOME/.config}"
readonly XDG_DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}"
readonly OPENCODE_CONFIG_DIR="${XDG_CONFIG_ROOT}/opencode"
readonly OPENCODE_DATA_DIR="${XDG_DATA_ROOT}/opencode"

readonly OPENCODE_CONFIG_JSON="${OPENCODE_CONFIG_DIR}/opencode.json"
readonly OPENCODE_CONFIG_JSONC="${OPENCODE_CONFIG_DIR}/opencode.jsonc"
readonly OPENCODE_AUTH_PATH="${OPENCODE_DATA_DIR}/auth.json"

require_binary() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "error: missing required binary '$name'" >&2
    exit 1
  fi
}

if [[ ! -c /dev/tty ]]; then
  echo "error: interactive terminal is required for installer prompts" >&2
  exit 1
fi

require_binary curl
require_binary python3

if ! command -v opencode >/dev/null 2>&1; then
  echo "[opencode-finance] OpenCode not found. Installing from ${OPENCODE_INSTALL_URL} ..."
  curl -fsSL "${OPENCODE_INSTALL_URL}" | bash
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "error: 'opencode' command is still unavailable after installation" >&2
  echo "Ensure your shell PATH includes the OpenCode install location, then rerun this installer." >&2
  exit 1
fi

export OPENCODE_SCHEMA_URL
export OPENCODE_PLUGIN
export OPENCODE_CONFIG_DIR
export OPENCODE_DATA_DIR
export OPENCODE_CONFIG_JSON
export OPENCODE_CONFIG_JSONC
export OPENCODE_AUTH_PATH

python3 <<'PY'
import getpass
import json
import os
import sys
from pathlib import Path


class InstallError(RuntimeError):
    pass


def strip_jsonc_comments(source):
    out = []
    in_string = False
    escaped = False
    in_line_comment = False
    in_block_comment = False
    i = 0

    while i < len(source):
        char = source[i]
        nxt = source[i + 1] if i + 1 < len(source) else ""

        if in_line_comment:
            if char == "\n":
                in_line_comment = False
                out.append(char)
            i += 1
            continue

        if in_block_comment:
            if char == "*" and nxt == "/":
                in_block_comment = False
                i += 2
                continue
            if char == "\n":
                out.append(char)
            i += 1
            continue

        if in_string:
            out.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            i += 1
            continue

        if char == "/" and nxt == "/":
            in_line_comment = True
            i += 2
            continue

        if char == "/" and nxt == "*":
            in_block_comment = True
            i += 2
            continue

        if char == '"':
            in_string = True

        out.append(char)
        i += 1

    return "".join(out)


def strip_jsonc_trailing_commas(source):
    out = []
    in_string = False
    escaped = False
    i = 0

    while i < len(source):
        char = source[i]

        if in_string:
            out.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            i += 1
            continue

        if char == '"':
            in_string = True
            out.append(char)
            i += 1
            continue

        if char == ",":
            j = i + 1
            while j < len(source) and source[j].isspace():
                j += 1
            if j < len(source) and source[j] in ("}", "]"):
                i += 1
                continue

        out.append(char)
        i += 1

    return "".join(out)


def load_json_object(path):
    if not path.exists():
        return {}

    raw = path.read_text(encoding="utf-8")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as json_err:
        try:
            sanitized = strip_jsonc_trailing_commas(strip_jsonc_comments(raw))
            parsed = json.loads(sanitized)
        except json.JSONDecodeError as fallback_err:
            raise InstallError(
                "failed to parse {}: {}; jsonc fallback failed: {}".format(path, json_err.msg, fallback_err.msg)
            )

    if not isinstance(parsed, dict):
        raise InstallError("expected JSON object in {}".format(path))

    return parsed


def ensure_string_list(config, key):
    value = config.get(key)
    if value is None:
        return []
    if not isinstance(value, list):
        raise InstallError("expected '{}' to be an array in config".format(key))

    out = []
    for item in value:
        if not isinstance(item, str):
            raise InstallError("expected '{}' values to be strings".format(key))
        out.append(item)
    return out


def uniq(values):
    seen = set()
    out = []
    for item in values:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def write_json(path, payload, mode=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    if mode is not None:
        os.chmod(path, mode)


def existing_api_key(auth, provider_id):
    value = auth.get(provider_id)
    if not isinstance(value, dict):
        return ""
    if value.get("type") != "api":
        return ""
    key = value.get("key")
    return key.strip() if isinstance(key, str) else ""


def canonical_quiver_plan(input_value):
    if not isinstance(input_value, str):
        return None
    value = input_value.strip().lower().replace("-", "_").replace(" ", "_")
    if not value:
        return None

    mapping = {
        "public": "public",
        "tier0": "public",
        "tier_0": "public",
        "tier1": "public",
        "tier_1": "public",
        "1": "public",
        "t1": "public",
        "hobbyist": "hobbyist",
        "tier2": "hobbyist",
        "tier_2": "hobbyist",
        "2": "hobbyist",
        "t2": "hobbyist",
        "trader": "trader",
        "tier3": "trader",
        "tier_3": "trader",
        "3": "trader",
        "t3": "trader",
        "enterprise": "enterprise",
        "tier4": "enterprise",
        "tier_4": "enterprise",
        "4": "enterprise",
        "t4": "enterprise",
    }
    return mapping.get(value)


QUIVER_PLANS = {
    "public": {
        "label": "Public (Tier 0)",
        "provider_tier": "tier_1",
    },
    "hobbyist": {
        "label": "Hobbyist (Tier 0 + Tier 1)",
        "provider_tier": "tier_2",
    },
    "trader": {
        "label": "Trader (Tier 0 + Tier 1 + Tier 2)",
        "provider_tier": "tier_3",
    },
    "enterprise": {
        "label": "Enterprise (Tier 0 + Tier 1 + Tier 2)",
        "provider_tier": "enterprise",
    },
}

SKILL_NAME = "finance-comprehensive-report"
SKILL_MANAGED_BY = "opencode-finance"
SKILL_DIR_CANDIDATES = [
    Path.home() / ".agents" / "skills",
    Path.home() / ".opencode" / "skills",
]

# Keep this embedded skill content in sync with:
# packages/opencode-finance/src/skill/finance-comprehensive-report.SKILL.md
FINANCE_SKILL_CONTENT = """---
name: finance-comprehensive-report
description: Build a decision-first, evidence-tagged, audit-traceable public-company financial report using public filings, management commentary, ownership data, market context, and scenario valuation.
managed_by: opencode-finance
workflow_version: 5
---

# Finance Comprehensive Report

## Objective
- This report is a decision document, not a filing paraphrase.
- It must answer four questions clearly:
  - what matters
  - what changed
  - what is easy to miss
  - what would prove the thesis wrong
- Run the report in three layers at once:
  - factual layer: what happened
  - analytical layer: what actually drove it
  - monitoring layer: what to watch next
- Optimize for auditability and falsifiability over narrative smoothness.

## Input Requirements
- `ticker` (required): public company symbol, for example `AAPL`.
- `focus` (optional): emphasis area such as `forensic`, `valuation`, `governance`, `credit`, `capital-allocation`, or `variant-perception`.
- `report_date` (optional): date override in `YYYY-MM-DD`; default to today.
- `output_root` (optional): base output directory; default `reports/<ticker>/<report_date>/`.
- `portfolio_context` (optional): existing positions, weights, mandate, and risk budget for portfolio-fit analysis.
- `benchmark` (optional): market or sector benchmark symbol, for example `SPY`, `QQQ`, or a sector ETF.

## Evidence Rules
- Every meaningful statement in `report.md` must be explicitly labeled as one of:
  - `Observed`
  - `Inferred`
  - `Management-claimed`
  - `Market-implied`
  - `Needs verification`
- Add confidence to material bullets when possible: `High`, `Medium`, or `Low`.
- Use short labels at the start of material bullets or paragraphs, for example:
  - `[Observed | High]`
  - `[Inferred | Medium]`
  - `[Needs verification | Low]`
- Do not let inference read like fact.
- If a source class was not reviewed or evidence is incomplete, explicitly downgrade the claim to `Needs verification`.

## Public Source Coverage
- Build a source map covering all material public information reviewed or expected for the run.
- Attempt to cover, when public and relevant:
  - annual report / `10-K` / `20-F`
  - quarterly / half-year filings / `10-Q`
  - `8-K` / current reports
  - earnings release
  - earnings call transcript or webcast summary
  - investor presentation / capital markets day material
  - proxy statement
  - Forms `3/4/5`
  - Schedules `13D/13G`
  - debt documents, covenant summaries, and credit-rating commentary when public
  - major press releases, litigation updates, regulatory disclosures, and financing announcements
- For each source-map entry, record:
  - `source class`
  - `specific item`
  - `date`
  - `status` (`retrieved`, `not retrieved`, `not applicable`)
  - `basis` (`company-stated`, `regulator-filed`, `market-data`, `analyst-inferred`)
  - `confidence`
  - `notes`
- If a source class could not be retrieved during the run, say so explicitly and treat dependent conclusions as lower confidence or `Needs verification`.

## Workflow
1. Resolve and normalize the ticker symbol.
2. Retrieve quote, fundamentals, filings, insider, ownership, and news context with `financial_search` first, using `coverage: "comprehensive"` for numeric claims.
3. Use `financial_search` with `intent: "insider"` and `coverage: "comprehensive"` for insider analysis and reference returned `ownershipChange` when available.
4. Use Exa (`websearch`) only for qualitative context such as management commentary, industry developments, litigation, credit commentary, and catalyst context. Never use Exa for numeric financial metrics.
5. Build an evidence ledger that separates:
   - observed data
   - management claims
   - analytical inference
   - market-implied expectations
   - unresolved items that need verification
6. Build a one-page investment conclusion first:
   - what the business is
   - what the stock is really a bet on
   - current thesis in `3-5` bullets
   - key bull case
   - key bear case
   - what would make the thesis wrong
   - the `5` most important items to monitor next quarter
7. Build a business-model decomposition tailored to the company:
   - decompose by segment when multi-segment
   - for platforms, separate user growth, engagement, monetization, take rate, retention, and marginal cost
   - for industrials, separate backlog, pricing, utilization, input costs, and working capital
   - for banks or lenders, separate NII, NIM, deposit beta, credit costs, capital, and fee businesses
   - always distinguish what management can control from what it cannot
8. Reconstruct the economics into decision-useful bridges:
   - revenue bridge
   - gross margin bridge
   - operating margin / EBIT / EBITDA bridge
   - free cash flow bridge
   - working-capital bridge
   - capex split: maintenance vs growth when inferable
   - SBC treatment
   - one-offs and normalization adjustments
   - acquisition / disposal impact
   - FX impact
   - share-count and dilution bridge
9. Distill management commentary into signal:
   - exact management claims that matter
   - whether those claims are supported by numbers
   - wording changes versus prior quarter / prior comparable period when available
   - whether guidance tone hardened or softened
   - topics management avoided
   - whether call answers were evasive, unusually precise, or internally inconsistent
10. Build an explicit low-salience section for easy-to-miss items that may matter more than headlines.
11. Analyze capital allocation, liquidity, balance sheet, governance, incentives, insider ownership, beneficial ownership, and flow-of-funds.
12. Place the company in industry and competitor context, then compare public evidence with what the market price appears to imply.
13. Build scenario valuation, directional conviction output, and a red-team section that attacks the thesis.
14. Finish with a monitoring dashboard that can be reused next quarter.
15. Produce deliverables and reproducibility metadata.
16. After writing all report artifacts, ask whether to generate a PDF:
   - use `question` with:
     - header: `PDF Export`
     - question: `Generate a polished PDF report now?`
     - options:
       - `Yes (Recommended)` - generate PDF
       - `No` - skip PDF generation
     - `custom: false`
   - if user picks `Yes (Recommended)`, call `report_pdf` with:
     - `subcommand`: `report`
     - `outputRoot`: `reports/<ticker>/<report_date>/`
     - `filename`: `<ticker>-<report_date>.pdf`
   - if `question` is unavailable in this client context, skip PDF export and complete the report.

## Output Requirements
- Return a concise in-chat executive summary with:
  - what the business is
  - what the stock is really a bet on
  - thesis and anti-thesis
  - `directional_conviction_score` and score band
  - top positive drivers
  - top negative drivers
  - key falsifiers
  - next-quarter watch items
- Write markdown-first artifacts to `reports/<ticker>/<report_date>/`:
  - `report.md`: full decision-oriented report
  - `dashboard.md`: one-page KPI, thesis-monitoring, and catalyst dashboard
  - `assumptions.json`: scenario assumptions, score inputs, monitoring triggers, and machine-readable evidence metadata
  - `adjustment-log.md`: normalization entries, recurring vs non-recurring classification, source conflicts, and rationale
- Optionally write PDF artifact when user opts in via `question`:
  - `<ticker>-<report_date>.pdf`
  - first page: ticker summary
  - remaining pages: report information from `report.md`, `dashboard.md`, and `assumptions.json` (exclude `adjustment-log.md`)
  - footer on every page: display `opencode.finance`, linked to `https://opencode.finance`

## `report.md` Requirements
- Include explicit metadata lines at the top of the file, before the first analytical section:
  - `Sector: <value>` - use human-readable labels, not raw API enums
  - `Headquarters: <value>` - use short format `City, State, Country`
  - `Website: <value>`
  - `Icon URL: <value>`
- Use crisp, decision-first writing. Do not dump raw filing prose.
- Include these sections in this general order:
  - `## Investment Conclusion`
  - `## Thesis and Anti-Thesis`
  - `## Source Map of Public Information`
  - `## Business Model and Segment Economics`
  - `## Fundamental Analysis`
  - `## Reconstructed Economics`
  - `## Technical Analysis`
  - `## Management Commentary and Tone Changes`
  - `## Things the Market May Miss`
  - `## Capital Allocation, Balance Sheet, and Liquidity`
  - `## Governance, Incentives, Ownership, and Flow of Funds`
  - `## Market Intelligence`
  - `## Industry and Competitor Context`
  - `## Variant Perception and Market-Implied Expectations`
  - `## Scenario Valuation`
  - `## Directional Conviction and Monitoring Triggers`
  - `## Risk Assessment and Red-Team`
  - `## Portfolio Fit`
  - `## Monitoring Dashboard`
  - `## Appendix: Disclosure Timeline and Source Log`
  - `## Sources`
- `## Investment Conclusion` must function as a one-page decision surface and include:
  - what the business does
  - what the stock is really a bet on
  - current thesis in `3-5` bullets
  - key bull case
  - key bear case
  - what would make the thesis wrong
  - the `5` most important items to monitor next quarter
- `## Source Map of Public Information` must explicitly list the public inputs used and missing, with status and confidence.
- `## Business Model and Segment Economics` must explain:
  - how the company makes money
  - key revenue drivers
  - fixed vs variable cost structure when inferable
  - where margins actually come from
  - whether economics are volume-driven, price-driven, mix-driven, utilization-driven, or financing-driven
  - what management can and cannot control
- `## Reconstructed Economics` must explicitly separate:
  - recurring items
  - cyclical items
  - accounting noise
  - management-adjusted presentation
- `## Management Commentary and Tone Changes` must focus on signal extraction, not transcript summary.
- `## Things the Market May Miss` is mandatory and should surface low-salience but decision-relevant findings.
- `## Capital Allocation, Balance Sheet, and Liquidity` must cover:
  - buybacks
  - dividends
  - M&A
  - debt issuance / refinancing / maturities
  - covenant or interest-burden issues when public
  - cash deployment priorities
  - management's historical capital-allocation quality
- `## Governance, Incentives, Ownership, and Flow of Funds` must cover:
  - who controls the company
  - insider ownership
  - major outside holders
  - compensation design
  - incentive alignment or misalignment
  - board quality and related-party issues when visible
  - insider trading summary
  - recent `13D/13G` changes when available
  - dilution / convertibles / warrants / options overhang when relevant
- `## Variant Perception and Market-Implied Expectations` must compare public evidence vs what the market price appears to discount.
- `## Scenario Valuation` must include:
  - base / bull / bear cases
  - sensitivity tables
  - DCF only when assumptions are explicit and sane
  - multiples vs peers
  - historical valuation range
  - sum-of-the-parts when appropriate
  - which assumptions are observable vs mostly guesswork
- `## Risk Assessment and Red-Team` must explicitly attack the thesis:
  - strongest reasons the thesis is wrong
  - data that would falsify it
  - fragile accounting judgments
  - what management could be obscuring without lying
  - where public data is insufficient
- `## Portfolio Fit` must evaluate position fit relative to `portfolio_context` and `benchmark` when provided.
- If portfolio data is missing, render portfolio fit as:
  `Not evaluated: missing portfolio holdings, benchmark, and mandate`
- `## Monitoring Dashboard` must include:
  - next catalysts
  - next filings / events to watch
  - KPI thresholds that change the thesis
  - what would count as confirming evidence next quarter
  - what would count as disconfirming evidence next quarter
- Use explicit driver headings:
  - `Top Positive Drivers`
  - `Top Negative Drivers`
- End with a final `## Sources` section. It must be the last section in `report.md`.

## `dashboard.md` Requirements
- Use KPI tables with exactly these columns:
  `| KPI | Value | Period | Source | Source URL | Retrieval timestamp |`
- Include separate KPI rows for:
  - Stock price
  - Previous close
  - Daily change
  - Daily change percent
  - 52W high/low or 52W range
  - YTD return
  - Market cap
  - Analyst consensus
  - Revenue
  - Net income
  - Free cash flow
  - Debt-to-equity
- Add a monitoring table that includes, at minimum:
  - item being monitored
  - current state
  - threshold / trigger
  - why it matters
  - next check
  - evidence tag
- Add a catalyst table or list that includes the next filings, calls, or known events when inferable.
- Add a compact source-gap note for any material missing public information.
- Never leave `Source`, `Source URL`, or `Retrieval timestamp` empty for numeric KPI rows.
- Keep source labels and source URLs coherent, for example Yahoo chart label must use Yahoo chart URL.
- Use period-aware metric labels in KPI rows (`TTM`, `FY`, or `Q`) based on `metricPeriods`; do not force `(TTM)` when period differs.

## `assumptions.json` Requirements
- Must include:
  - `scenario_assumptions`
  - `score_inputs`
  - `factor_weights`
  - `uncertainty_flags`
- Also include, when possible:
  - `monitoring_triggers`
  - `market_implied_expectations`
  - `red_team_checks`
  - `source_map`
  - `known_unknowns`
  - `evidence_labels`

## `adjustment-log.md` Requirements
- Record every normalization or reconstruction decision and why it was made.
- Explicitly log:
  - one-offs
  - recurring vs non-recurring classification
  - management-adjusted vs analyst-normalized treatment
  - SBC treatment
  - capex treatment
  - FX adjustments
  - acquisition / disposal adjustments
  - share-count / dilution adjustments
  - source conflicts and how they were resolved
  - unresolved data gaps that limit confidence

## Data and Citation Rules
- Use IEEE-style numbered citations: place `[N]` markers in-text for each factual claim. Collect all references in a final `## Sources` section at the end of `report.md`.
- Each entry in `## Sources` must follow this format:
  `[N] Publisher/Domain Label, "page or dataset title," URL. Retrieved YYYY-MM-DD.`
- The `## Sources` section must be the last section in `report.md`. No analytical content may appear after it.
- Never use alternative section names like `Source Register`, `Reference List`, or alternative marker formats like `S1`, `Sn`, or `(S1)`. Only `## Sources` with `[N]` markers.
- Use `financial_search` as the primary source for finance data, with `coverage: "comprehensive"` for numeric claims.
- Use Exa (`websearch`) only for qualitative market and catalyst context, never for numeric financial metrics.
- Never use generic source labels such as `websearch`, `exa`, `search`, or `internet` in output artifacts.
- Never emit the token `N/A` in report artifacts. Use observed values, `unknown`, or explicit reason text.
- Keep observed data separate from model assumptions and inference.

## Failure Modes
- Missing or invalid ticker:
  - stop and request a valid symbol
- Insufficient data to support a section:
  - keep the section
  - mark unsupported claims as `Needs verification`
  - list specific missing sources or fields
- Missing public-source classes:
  - show them in the source map as `not retrieved`
  - downgrade dependent conclusions
- Missing `portfolio_context` or `benchmark`:
  - continue and render portfolio fit as `Not evaluated: missing portfolio holdings, benchmark, and mandate`
- Conflicting data across providers:
  - prefer the most recent timestamped source
  - record the discrepancy in `adjustment-log.md`
- Tool or provider failure:
  - return a partial report with explicit `known_unknowns`
  - do not invent missing values

## Completion Criteria
- Deliver all four artifacts under the default output path unless the user overrides output root.
- Ensure the report reads like a premium decision document, not a rewritten filing.
- Ensure each major section has at least one cited source, or an explicit `Needs verification` note.
- Include `directional_conviction_score`, score band, weighted drivers, and explicit non-advice framing.
- Make the report auditable: every material statement should be tagged and traceable to public evidence or clearly marked inference.
- End with a practical monitoring framework that can be reused next quarter.
"""


def open_tty_handles():
    try:
        tty_in = open("/dev/tty", "r", encoding="utf-8")
        tty_out = open("/dev/tty", "w", encoding="utf-8")
    except OSError:
        raise InstallError("interactive terminal is required for installer prompts")
    return tty_in, tty_out


def ask_line(tty_in, tty_out, prompt):
    tty_out.write(prompt)
    tty_out.flush()
    line = tty_in.readline()
    if line == "":
        raise InstallError("terminal input closed")
    return line.rstrip("\n")


def prompt_value(tty_in, tty_out, label, existing, required, secret, placeholder=""):
    while True:
        suffix = ""
        if existing:
            suffix = " [press Enter to keep existing value]"
        elif placeholder:
            suffix = " [{}]".format(placeholder)

        prompt = "{}{}: ".format(label, suffix)
        if secret:
            value = getpass.getpass(prompt, stream=tty_out)
        else:
            value = ask_line(tty_in, tty_out, prompt)

        value = value.strip()
        if value:
            return value
        if existing:
            return existing
        if not required:
            return ""

        print("{} is required.".format(label), file=tty_out)


def prompt_quiver_plan(tty_in, tty_out, existing_plan):
    current = existing_plan if existing_plan in QUIVER_PLANS else None

    print("\nQuiver Quant plan:", file=tty_out)
    print("1) Public (Tier 0)", file=tty_out)
    print("2) Hobbyist (Tier 0 + Tier 1)", file=tty_out)
    print("3) Trader (Tier 0 + Tier 1 + Tier 2)", file=tty_out)
    print("4) Enterprise (Tier 0 + Tier 1 + Tier 2)", file=tty_out)

    while True:
        keep = " [press Enter to keep {}]".format(current) if current else ""
        choice = ask_line(tty_in, tty_out, "Select Quiver plan [1-4]{}: ".format(keep)).strip()
        if not choice:
            if current:
                return current
            print("Quiver plan is required when Quiver key is set.", file=tty_out)
            continue

        lowered = choice.lower()
        if lowered in {"1", "public"}:
            return "public"
        if lowered in {"2", "hobbyist"}:
            return "hobbyist"
        if lowered in {"3", "trader"}:
            return "trader"
        if lowered in {"4", "enterprise"}:
            return "enterprise"

        parsed = canonical_quiver_plan(choice)
        if parsed:
            return parsed

        print("Invalid plan selection. Enter 1, 2, 3, or 4.", file=tty_out)


def select_config_path(config_json, config_jsonc):
    if config_json.exists():
        return config_json
    if config_jsonc.exists():
        return config_jsonc
    return config_json


def parse_frontmatter_managed_by(text):
    lines = text.splitlines()
    if len(lines) < 3:
        return None
    if lines[0].strip() != "---":
        return None

    closing = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            closing = idx
            break
    if closing is None:
        return None

    for line in lines[1:closing]:
        raw = line.strip()
        if not raw or ":" not in raw:
            continue
        key, value = raw.split(":", 1)
        if key.strip() != "managed_by":
            continue
        parsed = value.strip()
        if len(parsed) >= 2 and parsed[0] == parsed[-1] and parsed[0] in ("'", '"'):
            parsed = parsed[1:-1]
        return parsed or None
    return None


def install_finance_skill():
    target = None
    for base in SKILL_DIR_CANDIDATES:
        candidate = base / SKILL_NAME / "SKILL.md"
        if candidate.exists():
            target = candidate
            break

    if target is None:
        target = SKILL_DIR_CANDIDATES[0] / SKILL_NAME / "SKILL.md"

    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(FINANCE_SKILL_CONTENT, encoding="utf-8")
        return {
            "status": "installed",
            "path": str(target),
        }

    current = target.read_text(encoding="utf-8")
    managed_by = parse_frontmatter_managed_by(current)
    if managed_by != SKILL_MANAGED_BY:
        owner = managed_by if managed_by else "unmanaged"
        raise InstallError(
            "existing skill at {} is managed_by '{}'. refusing to overwrite. remove it manually or set managed_by: {}.".format(
                target,
                owner,
                SKILL_MANAGED_BY,
            )
        )

    if current == FINANCE_SKILL_CONTENT:
        return {
            "status": "unchanged",
            "path": str(target),
        }

    target.write_text(FINANCE_SKILL_CONTENT, encoding="utf-8")
    return {
        "status": "updated",
        "path": str(target),
    }


def main():
    config_dir = Path(os.environ["OPENCODE_CONFIG_DIR"])
    data_dir = Path(os.environ["OPENCODE_DATA_DIR"])
    config_json = Path(os.environ["OPENCODE_CONFIG_JSON"])
    config_jsonc = Path(os.environ["OPENCODE_CONFIG_JSONC"])
    auth_path = Path(os.environ["OPENCODE_AUTH_PATH"])
    schema_url = os.environ["OPENCODE_SCHEMA_URL"]
    plugin_id = os.environ["OPENCODE_PLUGIN"]

    config_target = select_config_path(config_json, config_jsonc)
    config = load_json_object(config_target)

    plugin = ensure_string_list(config, "plugin")
    merged_plugins = uniq(plugin)
    if plugin_id not in merged_plugins:
        merged_plugins.append(plugin_id)

    next_config = dict(config)
    next_config["plugin"] = merged_plugins
    if "$schema" not in next_config:
        next_config["$schema"] = schema_url

    auth = load_json_object(auth_path)

    tty_in, tty_out = open_tty_handles()
    try:
        print("[opencode-finance] OpenCode finance setup", file=tty_out)
        print("- config: {}".format(config_target), file=tty_out)
        print("- auth:   {}".format(auth_path), file=tty_out)
        skill = install_finance_skill()
        print("- skill:  {} ({})".format(skill["path"], skill["status"]), file=tty_out)
        print("", file=tty_out)

        sec_edgar = prompt_value(
            tty_in,
            tty_out,
            label="SEC EDGAR identity",
            existing=existing_api_key(auth, "sec-edgar"),
            required=True,
            secret=False,
            placeholder="MyCompany dev@mycompany.com",
        )
        finnhub = prompt_value(
            tty_in,
            tty_out,
            label="Finnhub API key",
            existing=existing_api_key(auth, "finnhub"),
            required=True,
            secret=True,
        )
        polygon = prompt_value(
            tty_in,
            tty_out,
            label="Polygon API key",
            existing=existing_api_key(auth, "polygon"),
            required=True,
            secret=True,
        )
        fmp = prompt_value(
            tty_in,
            tty_out,
            label="Financial Modeling Prep API key",
            existing=existing_api_key(auth, "financial-modeling-prep"),
            required=True,
            secret=True,
        )

        alphavantage = prompt_value(
            tty_in,
            tty_out,
            label="Alpha Vantage API key (optional)",
            existing=existing_api_key(auth, "alphavantage"),
            required=False,
            secret=True,
        )
        quartr = prompt_value(
            tty_in,
            tty_out,
            label="Quartr API key (optional)",
            existing=existing_api_key(auth, "quartr"),
            required=False,
            secret=True,
        )

        existing_quiver = auth.get("quiver-quant")
        existing_quiver_key = existing_api_key(auth, "quiver-quant")
        existing_quiver_plan = None
        if isinstance(existing_quiver, dict):
            existing_quiver_plan = canonical_quiver_plan(existing_quiver.get("provider_tier"))

        quiver_key = prompt_value(
            tty_in,
            tty_out,
            label="Quiver Quant API key (optional)",
            existing=existing_quiver_key,
            required=False,
            secret=True,
        )

        quiver_plan = None
        if quiver_key:
            quiver_plan = prompt_quiver_plan(tty_in, tty_out, existing_quiver_plan)

        next_auth = dict(auth)
        next_auth["sec-edgar"] = {"type": "api", "key": sec_edgar}
        next_auth["finnhub"] = {"type": "api", "key": finnhub}
        next_auth["polygon"] = {"type": "api", "key": polygon}
        next_auth["financial-modeling-prep"] = {"type": "api", "key": fmp}

        if alphavantage:
            next_auth["alphavantage"] = {"type": "api", "key": alphavantage}
        if quartr:
            next_auth["quartr"] = {"type": "api", "key": quartr}
        if quiver_key:
            if quiver_plan is None:
                raise InstallError("quiver plan is required when quiver key is set")
            next_auth["quiver-quant"] = {
                "type": "api",
                "key": quiver_key,
                "provider_tier": QUIVER_PLANS[quiver_plan]["provider_tier"],
                "provider_tag": "quiver-quant",
            }

        config_dir.mkdir(parents=True, exist_ok=True)
        data_dir.mkdir(parents=True, exist_ok=True)

        write_json(config_target, next_config)
        write_json(auth_path, next_auth, mode=0o600)

        optional_configured = []
        if alphavantage:
            optional_configured.append("alphavantage")
        if quartr:
            optional_configured.append("quartr")
        if quiver_key:
            optional_configured.append("quiver-quant ({})".format(quiver_plan))

        print("", file=tty_out)
        print("Setup complete.", file=tty_out)
        print("- ensured plugin in config: {}".format(plugin_id), file=tty_out)
        print("- finance-comprehensive-report skill: {} ({})".format(skill["path"], skill["status"]), file=tty_out)
        print("- configured required providers: sec-edgar, finnhub, polygon, financial-modeling-prep", file=tty_out)
        if optional_configured:
            print("- configured optional providers: {}".format(", ".join(optional_configured)), file=tty_out)
        else:
            print("- configured optional providers: none", file=tty_out)
        print("", file=tty_out)
        print("Next step: run `opencode` and execute `/onboard`.", file=tty_out)
    finally:
        tty_in.close()
        tty_out.close()

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except InstallError as error:
        print("error: {}".format(error), file=sys.stderr)
        raise SystemExit(1)
PY
