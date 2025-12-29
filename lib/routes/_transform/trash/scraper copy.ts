// lib/routes/_transform/scraper-simple.ts

import type { Browser, Page } from 'rebrowser-puppeteer';

import got from '@/utils/got';
import logger from '@/utils/logger';
import { getPuppeteerPage } from '@/utils/puppeteer';

interface Options {
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    timeout: number;
    concurency: number;
    useBrowser: boolean;
    encoding: string;
}

interface Session {
    page: Page;
    destroy: () => Promise<void>;
    browser: Browser;
}

type Task<T> = (page: Page) => Promise<T>;

function isValidUrl(url: string): boolean {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

export class Scraper {
    private session: Session | null = null;
    private decoder: TextDecoder | null = null;
    private options: Options = {
        waitUntil: 'networkidle2',
        timeout: 30000,
        concurency: 5,
        useBrowser: false,
        encoding: 'utf-8',
    };

    constructor(options?: Options) {
        this.options = { ...this.options, ...options };
        this.decoder = new TextDecoder(this.options.encoding);
        this.getSession();
    }

    async getSession() {
        if (this.session) {
            return this.session;
        }
        try {
            const { page, destory, browser } = await getPuppeteerPage('about:blank', {
                noGoto: true,
            });
            if (!browser) {
                throw new Error('Failed to get browser from getPuppeteerPage');
            }
            this.session = { page, destroy: destory, browser };
            return this.session;
        } catch (error: any) {
            logger.error(`[Scraper] Failed to get session: ${error.message}`);
            throw error;
        }
    }

    async destroy() {
        if (this.session) {
            await this.session.destroy();
            this.session = null;
        }
    }

    async goto<T>(url: string, onPageReady: Task<T>): Promise<T | null> {
        if (!this.options.useBrowser) {
            const response = await got({
                method: 'get',
                url,
                responseType: 'arrayBuffer',
            });
            return this.decoder!.decode(response.data) as T;
        }

        const session = await this.getSession();
        const page = await session.browser.newPage();
        try {
            // Only pass navigation options, not the entire options object
            await page.goto(url, {
                waitUntil: this.options.waitUntil,
                timeout: this.options.timeout,
            });
            await new Promise((resolve) => setTimeout(resolve, 100));
            return await onPageReady(page);
        } catch (error: any) {
            logger.error(`[Scraper] Navigation failed for ${url}: ${error.message}`);
            return null;
        } finally {
            await page.close();
        }
    }

    async gotoMany<T>(urls: string[], onPageReady: Task<T>) {
        const result: (T | null)[] = Array.from({ length: urls.length }, () => null);

        const tasks = urls
            .map((url, idx) => ({
                url,
                isValid: isValidUrl(url),
                idx,
            }))
            .filter((task) => task.isValid);

        if (tasks.length === 0) {
            return result;
        }

        const session = await this.getSession();
        const pages = await Promise.all(
            Array.from(
                {
                    length: Math.min(this.options.concurency, tasks.length),
                },
                () => session.browser.newPage()
            )
        );

        // Distribute tasks round-robin across pages
        const taskQueues: (typeof tasks)[] = Array.from({ length: pages.length }, () => []);
        for (const [index, task] of tasks.entries()) {
            taskQueues[index % pages.length].push(task);
        }

        // Each page processes its assigned tasks sequentially
        const pageResults = await Promise.all(
            pages.map(async (page, pageIdx) => {
                const queue = taskQueues[pageIdx];
                const results: Array<{ idx: number; result: T | null }> = [];

                for (const task of queue) {
                    try {
                        // eslint-disable-next-line no-await-in-loop
                        await page.goto(task.url, this.options);
                        // eslint-disable-next-line no-await-in-loop
                        const taskResult = await onPageReady(page);
                        results.push({ idx: task.idx, result: taskResult });
                    } catch (error: any) {
                        logger.error(`[Scraper] Error processing task ${task.url}: ${error.message}`);
                        results.push({ idx: task.idx, result: null });
                    }
                }

                return results;
            })
        );

        // Map results back to original indices
        for (const { idx, result: taskResult } of pageResults.flat()) {
            result[idx] = taskResult;
        }

        // Clean up pages
        await Promise.allSettled(pages.map((page) => page.close()));

        return result;
    }
}
