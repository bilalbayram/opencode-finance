import { describe, expect, test } from "bun:test"
import z from "zod"
import { Tool } from "../../src/core/tool"

function createContext() {
  return {
    metadata() {},
  } as any
}

describe("Tool.define", () => {
  test("validates input before execution and preserves the execute result", async () => {
    const metadataCalls: unknown[] = []

    const tool = Tool.define("quote_lookup", {
      description: "Example tool",
      parameters: z.object({
        ticker: z.string().min(1),
      }),
      execute: async ({ ticker }, ctx) => {
        ctx.metadata({
          title: "Lookup",
          metadata: {
            ticker,
          },
        })
        metadataCalls.push(ticker)
        return {
          title: "Done",
          metadata: {
            ticker,
          },
          output: `resolved ${ticker}`,
        }
      },
    })

    const info = await tool.init()
    const result = await info.execute(
      { ticker: "AAPL" },
      {
        metadata(value: unknown) {
          metadataCalls.push(value)
        },
      } as any,
    )

    expect(result).toEqual({
      title: "Done",
      metadata: {
        ticker: "AAPL",
      },
      output: "resolved AAPL",
    })
    expect(metadataCalls).toEqual([
      {
        title: "Lookup",
        metadata: {
          ticker: "AAPL",
        },
      },
      "AAPL",
    ])
  })

  test("uses custom validation formatting when provided", async () => {
    let executed = false
    const tool = Tool.define("quote_lookup", {
      description: "Example tool",
      parameters: z.object({
        limit: z.number().int().positive(),
      }),
      formatValidationError() {
        return "custom validation error"
      },
      execute: async () => {
        executed = true
        return {
          title: "Done",
          metadata: {},
          output: "ok",
        }
      },
    })

    const info = await tool.init()

    await expect(info.execute({ limit: "bad" } as any, createContext())).rejects.toThrow("custom validation error")
    expect(executed).toBeFalse()
  })

  test("falls back to the default validation message when no formatter exists", async () => {
    const tool = Tool.define("quote_lookup", {
      description: "Example tool",
      parameters: z.object({
        ticker: z.string(),
      }),
      execute: async () => ({
        title: "Done",
        metadata: {},
        output: "ok",
      }),
    })

    const info = await tool.init()

    await expect(info.execute({ ticker: 7 } as any, createContext())).rejects.toThrow(
      /The quote_lookup tool was called with invalid arguments:/,
    )
  })
})
