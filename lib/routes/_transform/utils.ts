/* eslint-disable no-await-in-loop */
import { load } from 'cheerio';
import * as chrono from 'chrono-node';
import type { Page } from 'rebrowser-puppeteer';
import sanitizeHtml from 'sanitize-html';

import got from '@/utils/got';
import logger from '@/utils/logger';
import { getPuppeteerPage } from '@/utils/puppeteer';

export function parsePubDate(dateString: string | undefined, timezoneOffset?: any): Date | undefined {
    if (!dateString?.trim()) {
        return undefined;
    }

    let cleaned = dateString.trim();
    logger.info(`[_transform/utils/parsePubDate] cleaned: ${cleaned}`);
    try {
        const hasTimezone = /GMT|UTC|[+-]\d{2}:\d{2}|[+-]\d{4}|\b[A-Z]{3,4}\b/.test(cleaned);
        logger.info(`[_transform/utils/parsePubDate] hasTimezone: ${hasTimezone}`);
        if (!hasTimezone) {
            if (timezoneOffset) {
                // Use provided offset
                const offset = Number.parseFloat(timezoneOffset);
                logger.info(`[_transform/utils/parsePubDate] offset: ${offset}`);
                if (!Number.isNaN(offset)) {
                    const sign = offset >= 0 ? '+' : '';
                    const hours = Math.floor(Math.abs(offset));
                    const minutes = Math.round((Math.abs(offset) % 1) * 60);
                    cleaned = `${cleaned} GMT${sign}${hours}${minutes > 0 ? ':' + minutes.toString().padStart(2, '0') : ''}`;
                    logger.info(`[_transform/utils/parsePubDate] cleaned: ${cleaned}`);
                }
            } else {
                // Force UTC if no offset provided
                // cleaned = `${cleaned} UTC`;
                // logger.info(`[_transform/utils/parsePubDate] cleaned: ${cleaned} (forced UTC)`);
            }
        }

        const date = chrono.parseDate(cleaned);
        logger.info(`[_transform/utils/parsePubDate] date: ${date}`);

        return date ?? undefined;
    } catch (error: any) {
        logger.error(`[_transform/utils/parsePubDate] error: ${error.message}`);
        return undefined;
    }
}

export async function fetchContent(
    url: string,
    routeParams: {
        useBrowser: string;
        waitUntil: string;
        encoding: string;
    },
    waitForSelector?: string | string[],
    selectorTimeout: number = 10000
) {
    const { useBrowser, waitUntil, encoding } = routeParams;
    const decoder = new TextDecoder(encoding);

    if (useBrowser === '1') {
        const { page, destory } = await getPuppeteerPage(url, {
            gotoConfig: { waitUntil: waitUntil as 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' },
        });

        try {
            if (waitForSelector) {
                const selectors = Array.isArray(waitForSelector) ? waitForSelector : [waitForSelector];

                try {
                    logger.info(`[_transform/utils/fetchContent] Waiting for selectors: ${selectors.join(', ')}`);

                    // Race: wait for whichever selector appears first
                    await Promise.race(
                        selectors.map((selector) =>
                            page.waitForSelector(selector, {
                                timeout: selectorTimeout,
                                visible: true,
                            })
                        )
                    );

                    logger.info(`[_transform/utils/fetchContent] Selector found, proceeding...`);
                } catch (error: any) {
                    logger.warn(`[_transform/utils/fetchContent] Error: ${error.message}`);
                    logger.warn(`[_transform/utils/fetchContent] No selectors found within ${selectorTimeout}ms, continuing...`);
                    return '';
                }
            } else {
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }

            const content = await page.evaluate(() => document.documentElement.outerHTML);

            if (content.includes('<pre') && content.includes('&lt;')) {
                const $ = load(content, { xmlMode: false });
                const preContent = $('pre').first().html();
                if (preContent) {
                    const decoded = $('<div>').html(preContent).text();
                    logger.info('[_transform/utils/unwrapEncodedXML] Detected HTML-wrapped XML, unwrapping...');
                    return decoded;
                }
            }

            return content;
        } finally {
            await destory();
        }
    }

    const response = await got({
        method: 'get',
        url,
        responseType: 'arrayBuffer',
    });

    return decoder.decode(response.data);
}

export function escape(selector: string): string {
    // Split by comma to handle multiple selectors, then escape each
    return selector
        .split(',')
        .map((s) => s.trim().replaceAll(':', String.raw`\:`))
        .join(', ');
}

export function chunk<T>(arr: T[], size: number): T[][] {
    const res: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        res.push(arr.slice(i, i + size));
    }
    return res;
}

export function isValidUrl(url: any): boolean {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

// ... existing code ...

/**
 * Polls for a selector on a page with a specified interval and timeout
 * @param page - Puppeteer page instance
 * @param selector - CSS selector to wait for
 * @param options - Polling options
 * @returns Promise that resolves when selector is found, or rejects if timeout
 */
export async function pollForElement(
    page: Page,
    elementOrSelector: string,
    options: {
        timeout?: number;
        interval?: number;
    } = {}
): Promise<string | null> {
    const { timeout = 6000, interval = 200 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        try {
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await new Promise((resolve) => setTimeout(resolve, 300));
            const html = await page.evaluate(() => document.documentElement.outerHTML);

            // Load into Cheerio
            const $ = load(unwrapEncodedXML(html));
            // const $ = load(html);

            // Try as CSS selector first
            if ($(elementOrSelector).length > 0) {
                logger.info(`[_transform/utils/pollForElement] Element found: ${elementOrSelector}`);
                return html;
            }

            // Try in HTML content (for cases where element might be in text)
            if (html.includes(`<${elementOrSelector}`)) {
                return html;
            }
        } catch (error: any) {
            logger.warn(`[_transform/utils/pollForElement] Error checking selector: ${error.message}`);
        }

        await new Promise((resolve) => setTimeout(resolve, interval));
    }

    logger.warn(`[_transform/rss] Element "${elementOrSelector}" not found within ${timeout}ms`);
    return null;
}

export function extractHtml(content: string, selector: string) {
    const $ = load(content);
    const html = $(escape(selector)).html();
    if (!html) {
        return null;
    }
    const sanitized = sanitizeHtml(html, {
        allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'video', 'audio'],
    });
    logger.info(`[_transform/rss] Extracted HTML: ${sanitized.slice(0, 500)}...`);
    return sanitized;
}

export function unwrapEncodedXML(content: string) {
    // Early exit check
    if (!content.includes('<pre') || (!content.includes('&lt;') && !content.includes('&gt;'))) {
        return content;
    }

    // Extract first pre tag content with regex
    const preMatch = content.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (!preMatch?.[1]) {
        return content;
    }

    // Fast entity decoding - only decode what we need
    const decoded = preMatch[1]
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;(?![a-z#])/gi', '&') // &amp; but not &amp;lt; etc
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;|&#x27;', "'")
        .trim();

    logger.info('[_transform/rss] Detected HTML-wrapped XML, unwrapping...');
    return decoded;
}

export function cleanHtml(
    html: string | null,
    excludeTags: string[] = [
        'script', // Executes JavaScript
        'iframe', // Loads external content
        'object', // Embeds external resources
        'embed', // Embeds external resources
        'applet', // Java applets
        'form', // Form submission (CSRF risk)
        'input', // Form element
        'button', // Form element
        'select', // Form element
        'textarea', // Form element
        'link', // External stylesheets/scripts
        'meta', // Meta manipulation/redirects
        'style', // CSS injection
        'base', // URL resolution changes
        'template', // Can contain scripts
        'frame', // Deprecated, loads external content
        'frameset', // Deprecated, loads external content
        // RSS garbage (navigation/layout)
        'noscript', // No-JS fallback (often ads)
        // Deprecated/obsolete
        'marquee', // Deprecated
        'blink', // Deprecated
        'font', // Deprecated
    ]
) {
    if (!html) {
        return;
    }

    // Remove dangerous tags using regex (handles both self-closing and paired tags)
    let preCleaned = html;
    for (const tag of excludeTags) {
        // Remove opening tag with attributes and closing tag (handles nested content)
        // Pattern: <tag...>...</tag> or <tag.../>
        const tagPattern = new RegExp(String.raw`<${tag}[^>]*>.*?<\/${tag}>|<${tag}[^>]*\/?>`, 'gis');
        preCleaned = preCleaned.replace(tagPattern, '');
    }

    const sanitized = sanitizeHtml(preCleaned, {
        allowedTags: false, // Allow all remaining tags
        allowedAttributes: {
            '*': ['*'], // Allow all attributes (sanitize-html will still strip event handlers automatically)
        },
    });

    const cleaned = sanitized.replaceAll(/\s+/g, ' ').replaceAll(/>\s+</g, '><').trim();
    return cleaned;
}

export async function scrollPage(
    page: Page,
    options: {
        scrollDelay?: number;
        scrollStep?: number;
        maxScrolls?: number;
    } = {}
) {
    const scrollDelay = options.scrollDelay || 300;
    const scrollStep = options.scrollStep || 500;
    const maxScrolls = options.maxScrolls || 10;

    // Get page dimensions
    const bodyHeight = await page.evaluate(() => Math.max(document.body.scrollHeight, document.body.offsetHeight, document.documentElement.clientHeight, document.documentElement.scrollHeight, document.documentElement.offsetHeight));

    const totalScrolls = Math.ceil(bodyHeight / scrollStep);

    // Scroll gradually down the page
    for (let i = 0; i < Math.min(totalScrolls, maxScrolls); i++) {
        await page.evaluate((step) => {
            window.scrollBy(0, step);
        }, scrollStep);

        // Wait for lazy-loaded content
        await new Promise((resolve) => setTimeout(resolve, scrollDelay));
    }

    // Scroll back to top
    await page.evaluate(() => {
        window.scrollTo(0, 0);
    });

    // Wait a bit more for any final lazy loads
    await new Promise((resolve) => setTimeout(resolve, 500));
}
