import os from "os"
import path from "path"

const APP = "finance"

function xdg(variable: string, fallback: string) {
  const value = process.env[variable]?.trim()
  return value && path.isAbsolute(value) ? value : path.join(os.homedir(), fallback)
}

export const Paths = {
  get config() {
    return path.join(xdg("XDG_CONFIG_HOME", ".config"), APP)
  },
  get cache() {
    return process.env.FINANCE_CACHE_DIR?.trim() || path.join(xdg("XDG_CACHE_HOME", ".cache"), APP)
  },
  get credentials() {
    return process.env.FINANCE_CREDENTIALS_FILE?.trim() || path.join(this.config, "credentials.json")
  },
  // Credentials written by the retired OpenCode plugin installer; read-only fallback.
  get legacyCredentials() {
    return path.join(xdg("XDG_DATA_HOME", ".local/share"), "opencode", "auth.json")
  },
}
