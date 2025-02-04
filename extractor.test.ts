import { expect, test, describe } from "bun:test";
import { extractContent } from "./src/extractor";

describe("Content Extractor", () => {
  test("should extract content from a valid URL", async () => {
    const result = await extractContent("https://www.mozilla.org");
    console.log(result)
    expect(result).toBeDefined();
    expect(result.title).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.textContent).toBeDefined();
    expect(result.isReadable).toBeDefined();
  }, 10000);

  test("should handle invalid URLs gracefully", async () => {
    try {
      await extractContent("invalid-url");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});