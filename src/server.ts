import { Hono } from 'hono';
import type { ContentExtractionResult } from './types';
import { extractContent } from './extractor';

const app = new Hono();

app.post('/extract', async c => {
  try {
    const { url } = await c.req.json();
    if (!url) {
      return c.json({ error: 'URL is required' }, 400);
    }

    const content: ContentExtractionResult = await extractContent(url);

    return c.json(content);
  } catch (error) {
    console.error('Extraction error:', error);
    return c.json({ error: 'Failed to extract content' }, 500);
  }
});

export default {
  port: 3000,
  fetch: app.fetch,
};
