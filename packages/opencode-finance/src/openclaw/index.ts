import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core"
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core"
import { loadOpenClawToolEntries } from "./tool-adapter"

const plugin: {
  id: string
  name: string
  description: string
  configSchema: ReturnType<typeof emptyPluginConfigSchema>
  register(api: OpenClawPluginApi): Promise<void>
} = {
  id: "opencode-finance",
  name: "OpenCode Finance",
  description: "Comprehensive equity report workflows for OpenClaw.",
  configSchema: emptyPluginConfigSchema(),
  async register(api: OpenClawPluginApi) {
    const tools = await loadOpenClawToolEntries()
    for (const tool of tools) {
      api.registerTool((context) => tool.create(context), { names: [tool.name] })
    }
  },
}

export default plugin
