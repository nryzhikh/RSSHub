import type { Browser, GoToOptions, Page, WaitForSelectorOptions } from 'rebrowser-puppeteer';

import logger from '@/utils/logger';
import { getPuppeteerPage } from '@/utils/puppeteer';

export class BrowserSession {
    private session: { browser: Browser; destroy: () => Promise<void>; tabs: TabPool } | null = null;
    private initializing: Promise<void> | null = null;

    constructor(
        private maxTabs: number = 5,
        private maxNavigationsPerTab: number = 50
    ) {}

    async init() {
        if (this.session) {
            return;
        }
        if (this.initializing) {
            return this.initializing;
        }

        this.initializing = (async () => {
            const { page, browser, destory } = await getPuppeteerPage('about:blank', { noGoto: true });
            const pool = new TabPool();
            pool.addTab(new Tab(page, this.maxNavigationsPerTab));

            for (let i = 1; i < this.maxTabs; i++) {
                // eslint-disable-next-line no-await-in-loop
                const p = await browser.newPage();
                pool.addTab(new Tab(p, this.maxNavigationsPerTab));
            }

            this.session = { browser, destroy: destory, tabs: pool };
        })();

        await this.initializing;
    }

    async run<T>(fn: (page: Page) => Promise<T>): Promise<T> {
        await this.init();
        const tab = await this.session!.tabs.acquire();
        try {
            return await tab.run(fn);
        } finally {
            this.session!.tabs.release(tab);
        }
    }

    async close() {
        if (this.session) {
            await this.session.destroy();
            this.session = null;
        }
    }

    async gotoAndFetch(
        url: string,
        selector: string,
        options?: {
            goToOptions?: GoToOptions;
            waitForSelectorOptions?: WaitForSelectorOptions;
            selectorTimeout?: number;
            scrollToBottom?: boolean;
            scrollToBottomTimeout?: number;
        }
    ) {
        const { goToOptions = { waitUntil: 'domcontentloaded', timeout: 10000 }, waitForSelectorOptions = { timeout: 5000 }, scrollToBottom = true, scrollToBottomTimeout = 300 } = options || {};

        return await this.run(async (page) => {
            logger.debug(`[_transform/browser-session/gotoAndFetch] Going to ${url} with options: ${JSON.stringify(goToOptions)}`);
            await page.goto(url, goToOptions);
            try {
                await page.waitForSelector(selector, waitForSelectorOptions);
            } catch {
                // ignore
            }
            if (scrollToBottom) {
                await page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight);
                });
                await new Promise((resolve) => setTimeout(resolve, scrollToBottomTimeout));
            }
            return await page.evaluate(() => document.documentElement.outerHTML);
        });
    }

    get availableTabs() {
        return this.session ? this.session.tabs.total - this.session.tabs.busyCount : 0;
    }
}

class TabPool {
    private tabs: Tab[] = [];
    private queue: ((tab: Tab) => void)[] = [];

    addTab(tab: Tab) {
        this.tabs.push(tab);
    }

    // eslint-disable-next-line require-await
    async acquire(): Promise<Tab> {
        const free = this.tabs.find((t) => !t.busy);
        if (free) {
            free.busy = true; // Mark as busy immediately
            return free;
        }
        return new Promise((resolve) => {
            this.queue.push((tab) => {
                tab.busy = true; // Mark as busy when dequeued
                resolve(tab);
            });
        });
    }
    release(tab: Tab) {
        tab.busy = false; // Already here, good
        const waiter = this.queue.shift();
        if (waiter) {
            waiter(tab);
        }
    }

    get busyCount() {
        return this.tabs.filter((t) => t.busy).length;
    }
    get total() {
        return this.tabs.length;
    }
}

class Tab {
    busy = false;
    private prevHost = '';
    private navigations = 0;

    constructor(
        public readonly page: Page,
        private maxNavigations: number = 50
    ) {}

    get url() {
        return this.page.url();
    }
    get host(): string {
        try {
            const u = this.page.url();
            return u && u !== 'about:blank' ? new URL(u).host : '';
        } catch {
            return '';
        }
    }

    private async softReset() {
        try {
            if (!this.page.isClosed()) {
                await this.page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10000 });
            }
        } catch {
            // ignore
        }
    }

    private async cleanup() {
        const host = this.host;
        if (host && host !== this.prevHost) {
            await this.softReset();
            this.prevHost = host;
        }

        this.navigations++;
        if (this.maxNavigations && this.navigations >= this.maxNavigations) {
            await this.softReset();
            this.navigations = 0;
        }

        try {
            await this.page.evaluate(() => {
                if (typeof window.gc === 'function') {
                    window.gc();
                }
            });
        } catch {
            // ignore
        }
    }

    async run<T>(fn: (page: Page) => Promise<T>): Promise<T> {
        try {
            return await fn(this.page);
        } finally {
            await this.cleanup();
            this.busy = false;
        }
    }
}
