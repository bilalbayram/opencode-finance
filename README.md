# OpenCode Finance

A finance skill for coding agents. It gives any agent that can read a `SKILL.md` and run a shell command reliable access to primary-source financial data, and rules for citing it.

- **Primary sources.** Fundamentals, filings, filing text and insider trades come straight from SEC EDGAR. No paid data vendors.
- **Every number is traceable.** XBRL values carry the period, tag, form, filing date and filing URL. Every response lists its sources with an `official` or `unofficial` tier.
- **The agent does the analysis.** The skill provides data and rules; the agent writes and runs its own code for calculations and decides the report's shape.

This repository contains:

- `packages/opencode-finance/skill`: the skill folder (`SKILL.md`, `references/`, and the bundled `scripts/fin.mjs`).
- `packages/opencode-finance/src`: source for `fin`.
- `packages/web`: the marketing page and installer served at opencode.finance.

## Install

Requires Node 20 or newer.

Copy `packages/opencode-finance/skill` into your agent's skills directory as `finance`, for example:

```bash
git clone https://github.com/bilalbayram/opencode-finance
cp -r opencode-finance/packages/opencode-finance/skill ~/.claude/skills/finance
```

Use your agent's skills directory in place of `~/.claude/skills`. For agents without skill support, point them at `SKILL.md`.

Then set the identity SEC requires from every client:

```bash
node ~/.claude/skills/finance/scripts/fin.mjs auth set sec-edgar "Jane Doe jane@example.com"
```

or export `SEC_EDGAR_IDENTITY`. Credentials are stored in `~/.config/finance/credentials.json` with mode `0600`.

## Commands

| Command | Returns |
| --- | --- |
| `fin sec company <ticker\|cik>` | Company profile |
| `fin sec facts <ticker>` | As-reported fundamentals, annual or quarterly, with the filing behind every value |
| `fin sec concept <ticker> <tag>` | Every value of one XBRL tag |
| `fin sec frames <tag> <period>` | One XBRL tag across all filers |
| `fin sec filings <ticker>` | Filing history with document links |
| `fin sec document <url>` | Filing text from sec.gov, paged or searched |
| `fin sec search "<text>"` | Full-text search across EDGAR filings |
| `fin sec insiders <ticker>` | Form 4 insider transactions |
| `fin price <symbol>` | Last price, previous close and OHLCV bars (unofficial) |

Run `fin --help` or `fin <command> --help` for options. Output is JSON: `{ data, sources, warnings }`.

See [`skill/references/sources.md`](packages/opencode-finance/skill/references/sources.md) for the full source catalogue and which sources are wrapped so far.

## Development

```bash
bun install
bun run typecheck
bun run build   # rebuilds skill/scripts/fin.mjs; commit the result
bun run test
```

The built `skill/scripts/fin.mjs` is committed because skill installers copy the folder straight from git. A test fails when it is out of date.
