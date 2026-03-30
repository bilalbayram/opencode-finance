import fs from "fs/promises"

function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

export async function exists(filepath: string) {
  try {
    await fs.access(filepath)
    return true
  } catch {
    return false
  }
}

export async function readText(filepath: string) {
  return fs.readFile(filepath, "utf8")
}

export async function readTextIfExists(filepath: string) {
  try {
    return await readText(filepath)
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
}

export async function readJson<T>(filepath: string) {
  return JSON.parse(await readText(filepath)) as T
}

export async function readJsonIfExists<T>(filepath: string) {
  const text = await readTextIfExists(filepath)
  if (text === undefined) return
  return JSON.parse(text) as T
}

export async function writeText(filepath: string, content: string, options?: { mode?: number }) {
  await fs.writeFile(filepath, content, options)
}

export async function writeBytes(filepath: string, content: NodeJS.ArrayBufferView | ArrayBuffer) {
  await fs.writeFile(filepath, content instanceof ArrayBuffer ? new Uint8Array(content) : content)
}

export async function stat(filepath: string) {
  return fs.stat(filepath)
}
