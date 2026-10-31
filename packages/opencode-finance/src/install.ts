import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { homeDir } from "./core/paths"

export const SKILL_NAME = "opencode-finance"

export type Target = {
  id: string
  label: string
  // Global skills directory; the skill is installed at <dir>/opencode-finance.
  dir: string
}

function exists(file: string) {
  return fs.access(file).then(
    () => true,
    () => false,
  )
}

async function onPath(command: string) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    if (await exists(path.join(dir, command))) return true
  }
  return false
}

// ~/.agents/skills is the shared location read by Codex, Cursor, Copilot CLI and OpenCode.
// Claude Code and Gemini CLI read only their own folders, so they get a copy when present.
export async function detectTargets(home = homeDir()): Promise<Target[]> {
  const targets: Target[] = [{ id: "agents", label: "Codex, Cursor, Copilot CLI, OpenCode", dir: path.join(home, ".agents", "skills") }]
  if ((await exists(path.join(home, ".claude"))) || (await onPath("claude"))) {
    targets.push({ id: "claude", label: "Claude Code", dir: path.join(home, ".claude", "skills") })
  }
  if ((await exists(path.join(home, ".gemini"))) || (await onPath("gemini"))) {
    targets.push({ id: "gemini", label: "Gemini CLI", dir: path.join(home, ".gemini", "skills") })
  }
  return targets
}

export function bundledSkillDir() {
  // The bundle lives at <skill>/scripts/fin.mjs.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
}

async function skillName(dir: string) {
  const text = await fs.readFile(path.join(dir, "SKILL.md"), "utf8").catch(() => undefined)
  return text?.match(/^name:\s*(.+)$/m)?.[1]?.trim()
}

export class InstallError extends Error {}

export type InstallResult = { target: Target; path: string; status: "installed" | "updated" | "current" | "removed" | "absent" }

export async function installSkill(source: string, target: Target): Promise<InstallResult> {
  if ((await skillName(source)) !== SKILL_NAME) throw new InstallError(`${source} is not the ${SKILL_NAME} skill folder`)
  const destination = path.join(target.dir, SKILL_NAME)
  if (path.resolve(destination) === path.resolve(source)) return { target, path: destination, status: "current" }

  const existing = await exists(destination)
  if (existing && (await skillName(destination)) !== SKILL_NAME) {
    throw new InstallError(`${destination} exists and is not ${SKILL_NAME}; move it aside and run again`)
  }

  await fs.mkdir(target.dir, { recursive: true })
  const staging = `${destination}.tmp-${process.pid}`
  await fs.rm(staging, { recursive: true, force: true })
  await fs.cp(source, staging, { recursive: true })
  await fs.rm(destination, { recursive: true, force: true })
  await fs.rename(staging, destination)
  return { target, path: destination, status: existing ? "updated" : "installed" }
}

export async function uninstallSkill(target: Target): Promise<InstallResult> {
  const destination = path.join(target.dir, SKILL_NAME)
  if (!(await exists(destination))) return { target, path: destination, status: "absent" }
  if ((await skillName(destination)) !== SKILL_NAME) throw new InstallError(`${destination} is not ${SKILL_NAME}; leaving it alone`)
  await fs.rm(destination, { recursive: true, force: true })
  return { target, path: destination, status: "removed" }
}

// Leftovers from the retired OpenCode plugin. Reported, never edited: the user owns their config.
export async function legacyNotices(home = homeDir()) {
  const notices: string[] = []
  const config = process.env.XDG_CONFIG_HOME?.trim() || path.join(home, ".config")
  for (const file of ["opencode.json", "opencode.jsonc"].map((name) => path.join(config, "opencode", name))) {
    const text = await fs.readFile(file, "utf8").catch(() => "")
    if (/"opencode-finance(@[^"]*)?"/.test(text)) {
      notices.push(`${file} still loads the old "opencode-finance" plugin. Remove it from "plugin" to avoid duplicate finance tools.`)
    }
  }
  for (const dir of [path.join(home, ".opencode", "skills", "finance-comprehensive-report"), path.join(config, "opencode", "skills", "finance-comprehensive-report")]) {
    if (await exists(dir)) notices.push(`${dir} is the old report skill and can be deleted.`)
  }
  return notices
}
