import { expect, test, describe } from "bun:test";
import { extractContent } from "./src/extractor";

describe("Content Extractor", () => {
  test("should extract content from a valid URL", async () => {
    const result = await extractContent("https://developer.mozilla.org/en-US/");
    expect(result).toBeDefined();
    expect(result.title).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.textContent).toBeDefined();
    expect(result.isReadable).toBeDefined();
    expect(result.isReadable).toBe(true);
  }, 10000);

  test("should handle invalid URLs gracefully", async () => {
    expect(extractContent("invalid-url")).rejects.toThrow('Invalid URL format');
  });

  test("should handle non-existent domains", async () => {
    expect(extractContent("https://thisisnotarealdomainxxxyyy.com")).rejects.toThrow();
  });
});