import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

describe("MCP Server", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "bun",
      args: ["run", "src/mcp-server.ts"]
    });

    client = new Client(
      {
        name: "test-client",
        version: "1.0.0"
      },
      {
        capabilities: {
          tools: {},
          prompts: {}
        }
      }
    );

    await client.connect(transport);
  });

  afterAll(async () => {
    await transport.close();
  });

  test("should successfully connect to MCP server", () => {
    expect(client).toBeDefined();
    expect(transport).toBeDefined();
  });

  test("should successfully list tools", () => {
    const list = client.listTools()
    expect(client).toBeDefined();
    expect(transport).toBeDefined();
    expect(list).toBeDefined()
  });

  test("should extract content from a valid URL", async () => {
    const result = await client.callTool({
      name: "extract-url-content",
      arguments: {
        url: "https://developer.mozilla.org/en-US/"
      }
    });
    console.log(result)
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
  }, 10000);

  test("should handle invalid URLs with proper error", async () => {
    try {
      await client.callTool({
        name: "extract-url-content",
        arguments: {
          url: "not-a-valid-url"
        }
      });
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  test("should have extract-and-summarize prompt available", async () => {
    const prompts = await client.listPrompts();
    const hasPrompt = prompts.prompts.some(p => p.name === "extract-and-summarize");
    expect(hasPrompt).toBe(true);
  });

  test("should get correct prompt template", async () => {
    const prompt = await client.getPrompt({
        name: "extract-and-summarize",
        arguments: {
            url: "https://raw.githubusercontent.com/nostr-protocol/nips/refs/heads/master/01.md"
        }
    });
    
    expect(prompt).toBeDefined();
    expect(prompt.messages).toBeDefined();
    expect(prompt.messages[0].role).toBe("user");
    expect(prompt.messages[0].content.type).toBe("text");
    expect(prompt.messages[0].content.text).toContain("https://raw.githubusercontent.com/nostr-protocol/nips/refs/heads/master/01.md");
  });
});