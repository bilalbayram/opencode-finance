import fs from "fs/promises"
import path from "path"
import { Paths } from "./paths"

export type CredentialProvider = {
  id: string
  name: string
  env: string[]
  hint: string
  required: boolean
}

export const CREDENTIAL_PROVIDERS = [
  {
    id: "sec-edgar",
    name: "SEC EDGAR",
    env: ["SEC_EDGAR_IDENTITY", "SEC_API_USER_AGENT"],
    hint: 'Your name and email, sent as the User-Agent SEC requires, e.g. "Jane Doe jane@example.com"',
    required: true,
  },
] as const satisfies readonly CredentialProvider[]

export type CredentialProviderId = (typeof CREDENTIAL_PROVIDERS)[number]["id"]

export class MissingCredentialError extends Error {
  constructor(readonly provider: CredentialProvider) {
    super(
      `${provider.name} credential is missing. ${provider.hint}. ` +
        `Set ${provider.env[0]} or run: fin auth set ${provider.id} "<value>"`,
    )
  }
}

type Stored = Record<string, { type?: string; key?: string }>

async function readStore(file: string): Promise<Stored> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {}
    throw new Error(`could not read credentials file ${file}: ${(error as Error).message}`)
  }
}

export function findProvider(id: string): CredentialProvider | undefined {
  return CREDENTIAL_PROVIDERS.find((item) => item.id === id)
}

export async function credentialStatus(id: CredentialProviderId) {
  const provider = findProvider(id)!
  const env = provider.env.find((key) => process.env[key]?.trim())
  if (env) return { value: process.env[env]!.trim(), origin: `environment (${env})` }
  for (const file of [Paths.credentials, Paths.legacyCredentials]) {
    const value = (await readStore(file))[id]?.key?.trim()
    if (value) return { value, origin: file }
  }
  return undefined
}

export async function requireCredential(id: CredentialProviderId) {
  const found = await credentialStatus(id)
  if (!found) throw new MissingCredentialError(findProvider(id)!)
  return found.value
}

export async function setCredential(id: string, value: string) {
  const store = await readStore(Paths.credentials)
  store[id] = { type: "api", key: value }
  await writeStore(store)
}

export async function removeCredential(id: string) {
  const store = await readStore(Paths.credentials)
  delete store[id]
  await writeStore(store)
}

async function writeStore(store: Stored) {
  const file = Paths.credentials
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await fs.writeFile(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
  await fs.chmod(file, 0o600)
}
