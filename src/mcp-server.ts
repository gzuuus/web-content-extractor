import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { extractContent } from './extractor';

// Create an MCP server
const server = new McpServer({
  name: 'Web Content Extractor',
  version: '1.0.0',
});

// Define the extract tool
server.tool('extract', { url: z.string().url() }, async ({ url }) => {
  try {
    const result = await extractContent(url);

    // Format the response in a readable way
    const content = [
      { type: 'text' as const, text: `Title: ${result.title}\n\n` },
      { type: 'text' as const, text: `Site: ${result.siteName || 'Unknown'}\n` },
      { type: 'text' as const, text: `Author: ${result.byline || 'Unknown'}\n\n` },
      { type: 'text' as const, text: result.content },
    ];

    return {
      content,
      metadata: {
        isReadable: result.isReadable,
        contentLength: result.length,
        excerpt: result.excerpt,
      },
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error extracting content: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
});

// Add a prompt template for content extraction
server.prompt('extract-and-summarize', { url: z.string().url() }, ({ url }) => ({
  messages: [
    {
      role: 'user',
      content: {
        type: 'text',
        text: `Please extract and summarize the content from ${url}. Focus on the main points and key information.`,
      },
    },
  ],
}));

// Start the server using stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

// Log server start
console.error('MCP Web Content Extractor Server started');
