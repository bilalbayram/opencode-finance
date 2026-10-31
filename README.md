# OpenCode Finance

A finance skill for coding agents. It gives any agent that can read a `SKILL.md` and run a shell command reliable access to primary-source financial data, and rules for citing it.

- **Primary sources.** Fundamentals, filings, filing text and insider trades come straight from SEC EDGAR. No paid data vendors.
- **Every number is traceable.** XBRL values carry the period, tag, form, filing date and filing URL. Every response lists its sources with an `official` or `unofficial` tier.
- **The agent does the analysis.** The skill provides data and rules; the agent writes and runs its own code for calculations and decides the report's shape.

This repository contains:

- `packages/opencode-finance/skill`: the skill folder (`SKILL.md`, `references/`, and the bundled `scripts/fin.mjs`), published to npm as `opencode-finance-skill`.
- `packages/opencode-finance/src`: source for `fin`.
- `packages/web`: the marketing page and installer served at opencode.finance.

## Install

Requires Node 20 or newer.

```bash
curl -fsSL https://opencode.finance/install.sh | bash
# or
npx opencode-finance-skill install
```

The installer copies the skill into every agent it finds and asks once for the identity SEC requires from every client (your name and email, sent only to sec.gov):

| Folder | Read by |
| --- | --- |
| `~/.agents/skills/opencode-finance` | Codex, Cursor, Copilot CLI, OpenCode (always installed) |
| `~/.claude/skills/opencode-finance` | Claude Code (when `~/.claude` or `claude` exists) |
| `~/.gemini/skills/opencode-finance` | Gemini CLI (when `~/.gemini` or `gemini` exists) |

Options, passed after `bash -s --` for the curl form:

- `--agents agents,claude,gemini` installs only into those folders.
- `--dir <skills dir>` installs only into a folder of your choice, such as a project's `.agents/skills`.
- `--sec-identity "Jane Doe jane@example.com"` sets the identity without prompting; `--no-prompt` skips the prompt.
- `--uninstall` removes the skill from the same folders.

Run the installer again to update. Credentials are stored in `~/.config/opencode-finance/credentials.json` with mode `0600`; `SEC_EDGAR_IDENTITY` overrides them.

### Coming from the OpenCode plugin

The `opencode-finance` npm plugin is frozen at 1.2.7 and no longer developed. The installer points out a leftover `opencode-finance` entry in your OpenCode `plugin` list and the old `finance-comprehensive-report` skill; remove them to avoid duplicate tools. It never edits your config itself. Your existing SEC identity from the plugin is picked up automatically.

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
