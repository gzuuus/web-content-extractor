import { chromium } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

class PageLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageLoadError';
  }
}

class ContentExtractionError extends Error {
  constructor(message: string, details?: any) {
    const fullMessage = details
      ? `${message}\nDetails: ${JSON.stringify(details, null, 2)}`
      : message;
    super(fullMessage);
    this.name = 'ContentExtractionError';
  }
}

function cleanHTML(document: Document): void {
  const selectorsToRemove = [
    'script',
    'style',
    'svg',
    'img',
    'video',
    'iframe',
    'iframe',
    '[aria-hidden="true"]',
    '.ad',
    '.cookie-banner',
    '.newsletter-signup',
    '.popup',
    '#cookie-notice',
  ];

  selectorsToRemove.forEach(selector => {
    document.querySelectorAll(selector).forEach(element => {
      element.remove();
    });
  });

  function cleanWhitespace(node: Node) {
    if (node.nodeType === 3) {
      node.textContent = node.textContent?.replace(/\s+/g, ' ').trim() || '';
    } else {
      node.childNodes.forEach(child => cleanWhitespace(child));
    }
  }

  cleanWhitespace(document.body);
}

function normalizeText(text: string): string {
  return text
    .replace(/[\n\r]+/g, '\n') // Convert multiple line breaks to single
    .replace(/[ \t]+/g, ' ') // Convert multiple spaces/tabs to single space
    .replace(/\n +/g, '\n') // Remove spaces after line breaks
    .replace(/ +\n/g, '\n') // Remove spaces before line breaks
    .replace(/\n\n+/g, '\n\n') // Max two consecutive line breaks
    .trim();
}

export async function extractContent(url: string): Promise<any> {
  const browser = await chromium.launch({
    handleSIGINT: true,
    handleSIGTERM: true,
    handleSIGHUP: true,
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      locale: 'en-US',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const page = await context.newPage();

    console.log(`Attempting to load URL: ${url}`);
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    if (!response) {
      throw new PageLoadError('No response received from page');
    }

    console.log(`Page loaded with status: ${response.status()}`);

    await Promise.race([
      page.waitForSelector('article', { timeout: 5000 }).catch(() => null),
      page.waitForSelector('main', { timeout: 5000 }).catch(() => null),
      page.waitForSelector('.content', { timeout: 5000 }).catch(() => null),
      page.waitForSelector('#content', { timeout: 5000 }).catch(() => null),
    ]);

    await page.waitForLoadState('domcontentloaded');

    const finalUrl = page.url();
    console.log('Final URL after potential redirects:', finalUrl);

    const html = await page.content();
    console.log('Retrieved HTML length:', html.length);

    const dom = new JSDOM(html, { url: finalUrl });
    const document = dom.window.document;

    cleanHTML(document);

    const reader = new Readability(document, {
      charThreshold: 0,
      nbTopCandidates: 5,
      classesToPreserve: ['code', 'pre', 'header', 'main', 'article'],
    });

    const article = reader.parse();

    if (!article || !article.content) {
      const mainContent =
        document.querySelector('main')?.innerHTML ||
        document.querySelector('article')?.innerHTML ||
        document.querySelector('.content, #content')?.innerHTML;

      if (mainContent) {
        const title =
          document.querySelector('h1')?.textContent ||
          document.querySelector('title')?.textContent ||
          '';

        console.log('Using direct content extraction');
        return {
          title: normalizeText(title),
          content: mainContent,
          textContent: normalizeText(document.body.textContent || ''),
          length: document.body.textContent?.length || 0,
          excerpt: normalizeText(
            document.querySelector('meta[name="description"]')?.getAttribute('content') ||
              document.body.textContent?.slice(0, 150) ||
              ''
          ),
          byline: null,
          siteName:
            document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ||
            null,
          isReadable: false,
        };
      }
    }

    if (!article) {
      throw new ContentExtractionError('Failed to extract meaningful content');
    }

    console.log('Successfully extracted content:', {
      titleLength: article.title?.length,
      contentLength: article.content?.length,
      textLength: article.textContent?.length,
    });

    return {
      title: normalizeText(article.title),
      content: article.content,
      textContent: normalizeText(article.textContent),
      length: article.textContent.length,
      excerpt: normalizeText(article.excerpt),
      byline: article.byline,
      siteName: article.siteName,
      isReadable: true,
    };
  } catch (error) {
    console.error('Extraction error:', {
      message: error,
    });
    throw error;
  } finally {
    await browser.close();
  }
}
