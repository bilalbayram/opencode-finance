import { spawnSync } from "child_process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { runCli } from "../src/cli"
import { detectTargets, installSkill, legacyNotices, uninstallSkill } from "../src/install"

const packageDir = path.resolve(import.meta.dir, "..")
const skillDir = path.join(packageDir, "skill")
const ENV_KEYS = ["HOME", "PATH", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "FINANCE_CREDENTIALS_FILE", "SEC_EDGAR_IDENTITY", "SEC_API_USER_AGENT"]
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
let home = ""

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "fin-install-"))
  process.env.HOME = home
  process.env.PATH = "/nonexistent"
  for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "SEC_EDGAR_IDENTITY", "SEC_API_USER_AGENT"]) delete process.env[key]
  // Belt and braces: never let a test write credentials outside its temp home.
  process.env.FINANCE_CREDENTIALS_FILE = path.join(home, ".config", "opencode-finance", "credentials.json")
})

afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await fs.rm(home, { recursive: true, force: true })
})

const target = (dir: string) => ({ id: "custom", label: "Custom", dir })

describe("installSkill", () => {
  test("installs, then updates in place", async () => {
    const dir = path.join(home, "skills")
    expect((await installSkill(skillDir, target(dir))).status).toBe("installed")
    await fs.writeFile(path.join(dir, "opencode-finance", "stale.txt"), "old")
    expect((await installSkill(skillDir, target(dir))).status).toBe("updated")
    expect(await fs.readdir(path.join(dir, "opencode-finance"))).toEqual(expect.arrayContaining(["SKILL.md", "references", "scripts"]))
    await expect(fs.access(path.join(dir, "opencode-finance", "stale.txt"))).rejects.toThrow()
    expect((await fs.readdir(dir)).filter((name) => name.includes(".tmp-"))).toEqual([])
  })

  test("refuses to overwrite a folder that is not this skill", async () => {
    const dir = path.join(home, "skills")
    await fs.mkdir(path.join(dir, "opencode-finance"), { recursive: true })
    await fs.writeFile(path.join(dir, "opencode-finance", "SKILL.md"), "---\nname: something-else\n---\n")
    await expect(installSkill(skillDir, target(dir))).rejects.toThrow(/not opencode-finance/)
    await expect(uninstallSkill(target(dir))).rejects.toThrow(/leaving it alone/)
  })

  test("is a no-op when run from the installed copy, and uninstall removes it", async () => {
    const dir = path.join(home, "skills")
    const { path: installed } = await installSkill(skillDir, target(dir))
    expect((await installSkill(installed, target(dir))).status).toBe("current")
    expect((await uninstallSkill(target(dir))).status).toBe("removed")
    expect((await uninstallSkill(target(dir))).status).toBe("absent")
  })
})

test("detectTargets always includes ~/.agents/skills and adds agents that are present", async () => {
  expect((await detectTargets(home)).map((item) => item.id)).toEqual(["agents"])
  await fs.mkdir(path.join(home, ".claude"))
  await fs.mkdir(path.join(home, "bin"))
  await fs.writeFile(path.join(home, "bin", "gemini"), "")
  process.env.PATH = path.join(home, "bin")
  expect((await detectTargets(home)).map((item) => item.dir)).toEqual([
    path.join(home, ".agents", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(home, ".gemini", "skills"),
  ])
})

test("legacyNotices reports the old plugin entry and report skill without touching them", async () => {
  expect(await legacyNotices(home)).toEqual([])
  const config = path.join(home, ".config", "opencode", "opencode.jsonc")
  await fs.mkdir(path.dirname(config), { recursive: true })
  await fs.writeFile(config, '{ "plugin": ["opencode-finance@1.2.7"] }')
  await fs.mkdir(path.join(home, ".opencode", "skills", "finance-comprehensive-report"), { recursive: true })
  const notices = await legacyNotices(home)
  expect(notices).toHaveLength(2)
  expect(await fs.readFile(config, "utf8")).toContain("opencode-finance@1.2.7")
})

describe("fin install", () => {
  function capture() {
    const out: string[] = []
    return { io: { stdout: (text: string) => void out.push(text), stderr: () => {} }, out: () => out.join("") }
  }

  test("installs into detected agents and stores the identity the user types", async () => {
    await fs.mkdir(path.join(home, ".claude"))
    const io = capture()
    const asked: string[] = []
    const code = await runCli(["install", "--source", skillDir], io.io, undefined, async (question) => {
      asked.push(question)
      return "Jane Doe jane@example.com"
    })
    expect(code).toBe(0)
    expect(asked).toHaveLength(1)
    await fs.access(path.join(home, ".agents", "skills", "opencode-finance", "scripts", "fin.mjs"))
    await fs.access(path.join(home, ".claude", "skills", "opencode-finance", "SKILL.md"))
    const credentials = JSON.parse(await fs.readFile(path.join(home, ".config", "opencode-finance", "credentials.json"), "utf8"))
    expect(credentials["sec-edgar"].key).toBe("Jane Doe jane@example.com")
    expect(io.out()).toContain("SEC identity: set")
  })

  test("--dir installs only there and --no-prompt never asks", async () => {
    const io = capture()
    const dir = path.join(home, "only-here")
    expect(await runCli(["install", "--source", skillDir, "--dir", dir, "--no-prompt"], io.io, undefined, async () => {
      throw new Error("must not prompt")
    })).toBe(0)
    expect(await fs.readdir(home)).toEqual(["only-here"])
    expect(io.out()).toContain("SEC identity: not set")
  })

  test("rejects unknown agents and options", async () => {
    expect(await runCli(["install", "--agents", "vim"], capture().io)).toBe(2)
    expect(await runCli(["install", "--force"], capture().io)).toBe(2)
  })
})

test("install.sh installs from the packed npm tarball", async () => {
  const pack = await fs.mkdtemp(path.join(os.tmpdir(), "fin-pack-"))
  try {
    const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", pack], {
      cwd: packageDir,
      encoding: "utf8",
      env: { ...saved, HOME: saved.HOME } as NodeJS.ProcessEnv,
    })
    expect(packed.status, packed.stderr).toBe(0)
    const tarball = path.join(pack, JSON.parse(packed.stdout)[0].filename)

    const script = path.resolve(packageDir, "..", "web", "public", "install.sh")
    const run = spawnSync("bash", [script, "--agents", "agents"], {
      encoding: "utf8",
      env: { HOME: home, PATH: saved.PATH, OPENCODE_FINANCE_TARBALL: tarball },
    })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain("Installed opencode-finance")
    const fin = path.join(home, ".agents", "skills", "opencode-finance", "scripts", "fin.mjs")
    expect(spawnSync("node", [fin, "--version"], { encoding: "utf8" }).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  } finally {
    await fs.rm(pack, { recursive: true, force: true })
  }
}, 60_000)
