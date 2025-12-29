// lib/routes/_transform/scraper-simple.ts

import type { Browser, Page } from 'rebrowser-puppeteer';

import logger from '@/utils/logger';
import { getPuppeteerPage } from '@/utils/puppeteer';

interface HostSession {
    browser: Browser; // Keep browser, not page
    destroy: () => Promise<void>;
    lastUsed: number;
}

export interface SimpleFetchOptions {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    onPageReady?: (page: Page) => Promise<void>;
}

/**
 * Fast scraper: One browser per host, multiple tabs for parallel processing
 * All tabs share cookies/session automatically
 */
export class Scraper {
    private sessions = new Map<string, HostSession>();
    private readonly SESSION_TTL = 300000; // 5 minutes

    /**
     * Fetch content from URL
     * Creates new tab in shared browser for parallel processing
     * Returns null if anything goes wrong
     */
    async fetch(url: string, options?: SimpleFetchOptions): Promise<string | null> {
        const host = this.getHost(url);
        const waitUntil = options?.waitUntil || 'networkidle2';
        const browser = await this.initBrowser(host, url);

        // Create new tab in shared browser (automatic cookie sharing!)
        const page = await browser.newPage();

        try {
            logger.info(`[Scraper] New tab for ${url} (shared browser for ${host})`);

            // Navigate
            try {
                await page.goto(url, {
                    waitUntil,
                    timeout: 30000,
                });
            } catch (error: any) {
                if (error.message.includes('ERR_ABORTED') || error.message.includes('Navigation failed')) {
                    try {
                        const currentUrl = page.url();
                        if (currentUrl && currentUrl !== 'about:blank') {
                            logger.info(`[Scraper] Page navigated to ${currentUrl} instead, continuing...`);
                        } else {
                            return null;
                        }
                    } catch {
                        return null;
                    }
                } else {
                    logger.warn(`[Scraper] Navigation failed for ${url}: ${error.message}`);
                    return null;
                }
            }

            // Call user's hook
            try {
                await (options?.onPageReady ? options.onPageReady(page) : new Promise((resolve) => setTimeout(resolve, 1000)));

                const html = await page.evaluate(() => document.documentElement.outerHTML);

                if (!html || typeof html !== 'string') {
                    return null;
                }

                await new Promise((resolve) => setTimeout(resolve, 50));

                return html;
            } catch (error: any) {
                logger.warn(`[Scraper] onPageReady hook failed for ${url}: ${error.message}`);
                return null;
            }
        } catch (error: any) {
            logger.error(`[Scraper] Unexpected error fetching ${url}: ${error.message}`);
            return null;
        } finally {
            // Always close tab
            try {
                await page.close();
            } catch (closeError: any) {
                logger.info(`[Scraper] Error closing page: ${closeError.message}`);
            }
        }
    }

    async cleanup(): Promise<void> {
        logger.info(`[Scraper] Cleaning up ${this.sessions.size} browsers`);

        await Promise.allSettled([...this.sessions.values()].map((session) => session.destroy()));

        this.sessions.clear();
    }

    getStats() {
        return {
            activeBrowsers: this.sessions.size,
            activeHosts: [...this.sessions.keys()],
        };
    }

    // ========== Private Methods ==========

    private getHost(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            logger.warn(`[Scraper] Invalid URL: ${url}`);
            return 'unknown';
        }
    }
    async initBrowsers(urls: string[]): Promise<void> {
        // Extract unique hosts
        const uniqueHosts = new Set<string>();
        const hostToUrl = new Map<string, string>();

        for (const url of urls) {
            const host = this.getHost(url);
            if (!uniqueHosts.has(host)) {
                uniqueHosts.add(host);
                hostToUrl.set(host, url);
            }
        }

        logger.info(`[Scraper] Pre-initializing ${uniqueHosts.size} browsers for ${urls.length} URLs`);

        // Initialize all browsers in parallel
        await Promise.all([...uniqueHosts].map((host) => this.initBrowser(host, hostToUrl.get(host)!)));

        logger.info(`[Scraper] All browsers initialized`);
    }

    async initBrowser(host: string, initialUrl: string): Promise<Browser> {
        const existing = this.sessions.get(host);

        // Reuse existing browser if valid
        if (existing && Date.now() - existing.lastUsed < this.SESSION_TTL) {
            logger.info(`[Scraper] Reusing browser for ${host}`);
            existing.lastUsed = Date.now();
            return existing.browser;
        }

        // Create new browser
        logger.info(`[Scraper] Creating new browser for ${host}`);

        try {
            const { browser, destory } = await getPuppeteerPage(initialUrl, {
                noGoto: true, // Don't navigate - we'll create tabs as needed
            });

            const session: HostSession = {
                browser,
                destroy: destory,
                lastUsed: Date.now(),
            };

            this.sessions.set(host, session);
            return browser;
        } catch (error: any) {
            logger.error(`[Scraper] Failed to create browser for ${host}: ${error.message}`);
            throw error;
        }
    }
}
