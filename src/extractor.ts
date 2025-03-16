import { chromium, type BrowserContext, type Page } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

// TODO: Accept cookies banner, e.g yt, g

interface ExtractedContent {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string | null;
  siteName: string | null;
  isReadable: boolean;
}

interface Config {
  maxRetries: number;
  retryDelay: number;
  problematicSites: string[];
  defaultTimeout: number;
  headers: Record<string, string>;
}

const CONFIG: Config = {
  maxRetries: 3,
  retryDelay: 1000,
  problematicSites: ['washingtonpost.com', 'bloomberg.com'],
  defaultTimeout: 30000,
  headers: {
    'Accept-CH': 'Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version',
    'Permissions-Policy': 'interest-cohort=()',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-CH-UA': '"Chromium";v="120", "Google Chrome";v="120"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Linux"',
  },
};

// Error handling
class PageLoadError extends Error {
  public readonly permanent: boolean;
  private static PERMANENT_ERROR_PATTERNS = [
    'net::ERR_NAME_NOT_RESOLVED',
    'net::ERR_NAME_RESOLUTION_FAILED',
    'net::ERR_INVALID_URL',
    'net::ERR_CONNECTION_REFUSED',
    'net::ERR_ABORTED',
  ] as const;

  constructor(message: string) {
    super(message);
    this.name = 'PageLoadError';
    this.permanent = PageLoadError.PERMANENT_ERROR_PATTERNS.some(pattern =>
      message.includes(pattern)
    );
  }
}

const isValidUrl = (urlString: string): boolean => {
  try {
    const url = new URL(urlString);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};

const normalizeText = (text: string | undefined): string => {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n +/g, '\n')
    .replace(/\n{2,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .trim();
};

const cleanHTML = (document: Document): void => {
  const selectorsToRemove = [
    'script',
    'style',
    'svg',
    'img',
    'video',
    'iframe',
    '[aria-hidden="true"]',
    '.ad',
    '.cookie-banner',
    '.newsletter-signup',
    '.popup',
    '#cookie-notice',
  ];

  const cleanWhitespace = (node: Node): void => {
    if (node.nodeType === 3) {
      node.textContent = node.textContent?.replace(/[ \t]+/g, ' ') || '';
    } else {
      node.childNodes.forEach(cleanWhitespace);
    }
  };

  selectorsToRemove.forEach(selector => {
    document.querySelectorAll(selector).forEach(element => element.remove());
  });
  cleanWhitespace(document.body);
};

// Page extraction
async function setupPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.setExtraHTTPHeaders(CONFIG.headers);
  return page;
}

async function attemptExtraction(
  url: string,
  context: BrowserContext,
  forceHttp1 = false
): Promise<string> {
  const page = await setupPage(context);

  try {
    const targetUrl = forceHttp1 ? url.replace('https://', 'http://') : url;
    await page.waitForTimeout(Math.random() * 1000 + 500);

    const response = await page.goto(targetUrl, {
      waitUntil: 'commit',
      timeout: CONFIG.defaultTimeout,
    });

    if (!response) {
      throw new PageLoadError('No response received');
    }

    if (!response?.ok()) {
      throw new PageLoadError(`HTTP error: ${response?.status()} ${response?.statusText()}`);
    }

    await Promise.race([
      page.waitForLoadState('domcontentloaded', { timeout: 10000 }),
      page.waitForTimeout(11000),
    ]);

    await page.evaluate(() =>
      window.scrollTo({
        top: Math.random() * document.body.scrollHeight,
        behavior: 'smooth',
      })
    );

    return await page.content();
  } catch (error: any) {
    throw new PageLoadError(error.message);
  } finally {
    await page.close().catch(() => {}); // Ignore errors when closing the page
  }
}

async function processHTML(html: string, url: string): Promise<ExtractedContent> {
  const cleanedHtml = html
    .replace(/<link[^>]*stylesheet[^>]*>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  const dom = new JSDOM(cleanedHtml, { url });
  const document = dom.window.document;
  cleanHTML(document);

  const reader = new Readability(document, {
    charThreshold: 0,
    nbTopCandidates: 5,
    classesToPreserve: ['code', 'pre'],
  });

  const article = reader.parse();

  if (!article) {
    const rawText = document.body?.textContent || '';
    return {
      title: normalizeText(document.title),
      content: document.body?.innerHTML || '',
      textContent: normalizeText(rawText),
      length: rawText.length,
      excerpt: normalizeText(rawText.slice(0, 150)),
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
}

export async function extractContent(url: string): Promise<ExtractedContent> {
  if (!isValidUrl(url)) {
    throw new PageLoadError('Invalid URL format');
  }

  const browser = await chromium.launch({
    handleSIGINT: true,
    handleSIGTERM: true,
    handleSIGHUP: true,
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: Math.random() > 0.5 ? 1 : 2,
    });

    const isProblematicSite = CONFIG.problematicSites.some(site => url.includes(site));
    let html: string | null = null;
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < CONFIG.maxRetries && !html) {
      try {
        if (attempts === 0) {
          html = await attemptExtraction(url, context);
        } else if (attempts === 1 && isProblematicSite) {
          html = await attemptExtraction(url, context, true);
        } else {
          await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay * attempts));
          html = await attemptExtraction(url, context, attempts % 2 === 0);
        }
      } catch (error: any) {
        lastError = error;
        attempts++;

        if (error instanceof PageLoadError && error.permanent) {
          throw error;
        }

        if (attempts >= CONFIG.maxRetries) {
          throw new PageLoadError(
            `Failed to load page after ${attempts} attempts: ${lastError?.message}`
          );
        }

        console.error(`Attempt ${attempts} failed, retrying... Error: ${error.message}`);
      }
    }

    if (!html) {
      throw new PageLoadError('Failed to extract content');
    }

    return await processHTML(html!, url);
  } finally {
    await browser.close().catch(() => {}); // Ignore errors when closing the browser
  }
}
