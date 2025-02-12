import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { extractContent } from './extractor';

const server = new McpServer({
  name: 'Web Content Extractor',
  version: '1.0.0',
});

server.tool(
  'extract',
  'Extract the content from a given url',
  {
    url: z.string().url(),
  },
  async ({ url }) => {
    console.info(`Starting content extraction for: ${url}`);

    try {
      const result = await extractContent(url);
      console.debug('Extraction result:', {
        title: result.title,
        contentLength: result.length,
        isReadable: result.isReadable,
      });

      const content = [
        {
          type: 'text' as const,
          text: `# ${result.title}\n\n`,
        },
        {
          type: 'text' as const,
          text: result.siteName ? `Source: ${result.siteName}\n` : '',
        },
        {
          type: 'text' as const,
          text: result.byline ? `Author: ${result.byline}\n\n` : '\n',
        },
        {
          type: 'text' as const,
          text: '## Content\n\n' + result.textContent,
        },
      ].filter(item => item.text);

      return {
        content,
        metadata: {
          isReadable: result.isReadable,
          contentLength: result.length,
          excerpt: result.excerpt,
          url: url,
        },
      };
    } catch (error) {
      console.error('Extraction failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error extracting content: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
          url: url,
        },
      };
    }
  }
);

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
