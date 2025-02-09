import { chromium } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import type { ParseResult } from 'mozilla-readability';

// TODO: Accept cookies banner, e.g yt, g

class PageLoadError extends Error {
  constructor(
    message: string,
    public readonly permanent: boolean = false
  ) {
    super(message);
    this.name = 'PageLoadError';
  }
}

const PERMANENT_ERRORS = [
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_NAME_RESOLUTION_FAILED',
  'net::ERR_INVALID_URL',
  'net::ERR_CONNECTION_REFUSED',
];

function isPermanentError(error: Error): boolean {
  return PERMANENT_ERRORS.some(msg => error.message.includes(msg));
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

function normalizeText(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/[\n\r]+/g, '\n') // Convert multiple line breaks to single
    .replace(/[ \t]+/g, ' ') // Convert multiple spaces/tabs to single space
    .replace(/\n +/g, '\n') // Remove spaces after line breaks
    .replace(/ +\n/g, '\n') // Remove spaces before line breaks
    .replace(/\n\n+/g, '\n\n') // Max two consecutive line breaks
    .trim();
}

const config = {
  maxRetries: 3,
  retryDelay: 1000,
  problematicSites: ['washingtonpost.com', 'bloomberg.com'],
};

async function attemptExtraction(url: string, context: any, forceHttp1 = false): Promise<string> {
  const page = await context.newPage();

  await page.setExtraHTTPHeaders({
    'Accept-CH': 'Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version',
    'Permissions-Policy': 'interest-cohort=()',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-CH-UA': '"Chromium";v="120", "Google Chrome";v="120"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Linux"',
  });

  try {
    if (forceHttp1) {
      url = url.replace('https://', 'http://');
    }

    const randomDelay = Math.floor(Math.random() * 1000) + 500;
    await page.waitForTimeout(randomDelay);

    const response = await page.goto(url, {
      waitUntil: 'commit',
      timeout: 30000,
    });

    if (!response) {
      throw new PageLoadError('No response received');
    }

    if (!response.ok()) {
      throw new PageLoadError(`HTTP error: ${response.status()} ${response.statusText()}`);
    }

    await Promise.race([
      page.waitForLoadState('domcontentloaded', { timeout: 10000 }),
      page.waitForTimeout(11000),
    ]);

    await page.evaluate(() => {
      window.scrollTo({
        top: Math.random() * document.body.scrollHeight,
        behavior: 'smooth',
      });
    });

    const html = await page.content();
    await page.close();
    return html;
  } catch (error: any) {
    await page.close();
    if (isPermanentError(error)) {
      throw new PageLoadError(error.message, true);
    }
    throw new PageLoadError(error.message);
  }
}
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol == 'http:' || url.protocol == 'https:';
  } catch {
    return false;
  }
}

export async function extractContent(url: string): Promise<any> {
  if (!isValidUrl(url)) throw new PageLoadError('Invalid URL format');
  const browser = await chromium.launch({
    handleSIGINT: true,
    handleSIGTERM: true,
    handleSIGHUP: true,
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: {
        width: 1920,
        height: 1080,
      },
      deviceScaleFactor: Math.random() > 0.5 ? 1 : 2,
    });

    const isProblematicSite = config.problematicSites.some(site => url.includes(site));

    let html: string | null = null;
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < config.maxRetries && !html) {
      try {
        if (attempts === 0) {
          html = await attemptExtraction(url, context);
        } else if (attempts === 1 && isProblematicSite) {
          html = await attemptExtraction(url, context, true);
        } else {
          await new Promise(resolve => setTimeout(resolve, config.retryDelay * attempts));
          html = await attemptExtraction(url, context, attempts % 2 === 0);
        }
      } catch (error: any) {
        lastError = error;

        if (error instanceof PageLoadError && error.permanent) {
          throw error;
        }

        attempts++;
        if (attempts < config.maxRetries) {
          console.error(`Attempt ${attempts} failed, retrying... Error: ${error.message}`);
        }
      }
    }

    if (!html && lastError) {
      throw new PageLoadError(
        `Failed to load page after ${attempts} attempts: ${lastError.message}`
      );
    }

    const cleanedHtml = html!
      .replace(/<link[^>]*stylesheet[^>]*>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    const dom = new JSDOM(cleanedHtml!, { url });
    const document = dom.window.document;

    cleanHTML(document);

    const reader = new Readability(document, {
      charThreshold: 0,
      nbTopCandidates: 5,
      classesToPreserve: ['code', 'pre'],
    });

    const article: ParseResult | null = reader.parse();

    if (!article) {
      const rawContent = document.body ? document.body.innerHTML : '';
      const rawText = document.body ? document.body.textContent : '';
      const title = document.title || '';

      return {
        title: normalizeText(title),
        content: rawContent,
        textContent: normalizeText(rawText ?? undefined),
        length: rawText?.length || 0,
        excerpt: normalizeText(rawText?.slice(0, 150)),
        byline: null,
        siteName: null,
        isReadable: false,
      };
    }

    return {
      title: normalizeText(article.title),
      content: article.content || '',
      textContent: normalizeText(article.textContent),
      length: article.textContent?.length || 0,
      excerpt: normalizeText(article.excerpt),
      byline: article.byline,
      siteName: article.siteName,
      isReadable: true,
    };
  } catch (error) {
    console.error('Extraction error:', error);
    throw error;
  } finally {
    await browser.close();
  }
}
