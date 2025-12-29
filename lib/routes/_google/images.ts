import type { Route } from '@/types';
import logger from '@/utils/logger';
import { getPuppeteerPage } from '@/utils/puppeteer';

// Stealth patches to evade bot detection
const applyStealthPatches = async (page) => {
    // Override webdriver property
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });

        // Override plugins to look like a real browser
        Object.defineProperty(navigator, 'plugins', {
            get: () => [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                { name: 'Native Client', filename: 'internal-nacl-plugin' },
            ],
        });

        // Override languages
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

        // Override permissions
        const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
        (window.navigator.permissions as any).query = (parameters: any) => (parameters.name === 'notifications' ? Promise.resolve({ state: Notification.permission } as PermissionStatus) : originalQuery(parameters));

        // Add chrome runtime
        (window as any).chrome = { runtime: {} };
    });

    // Set a realistic viewport
    await page.setViewport({ width: 1920, height: 1080 });
};

async function handler(ctx) {
    const query = ctx.req.param('query');

    const { page, destory } = await getPuppeteerPage(`https://www.google.com/search?q=${query}&tbm=isch`, {
        noGoto: true,
        onBeforeLoad: applyStealthPatches,
    });

    await page.goto(`https://www.google.com/search?q=${query}&tbm=isch`, { waitUntil: 'networkidle2', timeout: 20000 });

    const images: Array<{ url: string; title: string }> = [];

    // Get all image result elements
    const imageLinks = await page.$$('h3 > a');
    const maxImages = Math.min(imageLinks.length, 5);

    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 2;

    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < maxImages; i++) {
        try {
            // Re-query elements each iteration (DOM may have changed after clicks)
            const links = await page.$$('h3 > a');
            if (i >= links.length) {
                break;
            }

            // Scroll element into view smoothly (human-like)
            await page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), links[i]);
            await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));

            // Hover before click (human-like)
            await links[i].hover();
            await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));

            // Click to open the preview sidebar
            await links[i].click();

            // Wait for the preview panel image to change
            const previousUrl = images.at(-1)?.url || '';
            try {
                await page.waitForFunction(
                    (prevUrl) => {
                        const img = document.querySelector('c-wiz a[target="_blank"] img:not([src*="encrypted-tbn"]):not([src*="gstatic"])');
                        const src = img?.getAttribute('src') || '';
                        return src && src !== prevUrl && src.startsWith('http');
                    },
                    { timeout: 2000 },
                    previousUrl
                );
            } catch {
                // Fallback: just wait a bit
                await new Promise((r) => setTimeout(r, 500));
            }

            // Random human-like delay
            await new Promise((r) => setTimeout(r, 200 + Math.random() * 400));

            // Extract the actual image URL from the preview sidebar
            const imgSrc = await page.evaluate(() => document.querySelector('c-wiz a[target="_blank"] img:not([src*="encrypted-tbn"]):not([src*="gstatic"])')?.getAttribute('src') || '');

            // Check for duplicates
            if (imgSrc && !images.some((img) => img.url === imgSrc)) {
                images.push({ url: imgSrc, title: '' });
                logger.info(`[_google/images] Found: ${imgSrc.slice(0, 80)}...`);
                consecutiveErrors = 0; // Reset error counter on success
            }
        } catch (error) {
            logger.warn(`[_google/images] Failed to get image ${i}: ${(error as Error).message}`);
            consecutiveErrors++;

            // Stop if too many consecutive errors (likely bot detection)
            if (consecutiveErrors >= maxConsecutiveErrors) {
                logger.warn('[_google/images] Too many consecutive errors, stopping to avoid detection');
                break;
            }
        }
    }
    /* eslint-enable no-await-in-loop */

    logger.info(`[_google/images] Extracted ${images.length} actual image URLs`);
    await destory();

    return {
        title: `Google Images: ${query}`,
        description: `Google Images: ${query}`,
        link: `https://www.google.com/search?q=${query}&tbm=isch`,
        item: images.map((img) => ({
            title: img.title || `Image for ${query}`,
            link: img.url,
            description: `<img src="${img.url}" />`,
            enclosure_url: img.url,
            enclosure_type: 'image/jpeg',
        })),
    };
}

export const route: Route = {
    path: '/images/:query',
    categories: ['other'],
    example: '/google/images/cats',
    parameters: {
        query: 'google images query',
    },
    features: {
        requireConfig: [
            {
                name: 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN',
                description: 'Allow fetching content from user-supplied URLs',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: true,
        supportScihub: false,
    },
    name: 'RSS Feed Transformer',
    maintainers: ['nryzhikh'],
    description: `
Auto-extracts all standard RSS/Atom fields and allows custom field mapping.

**Features:**
- Auto-extracts: title, link, description, pubDate, author, category, guid, enclosure, iTunes fields, media, content
- Custom field mapping: Map any RSS element to DataItem fields
- Category filtering: Filter items by category
- Timezone support: Parse dates with custom timezone offsets
- Browser support: Optional Puppeteer for JavaScript-rendered feeds

**Example usage:**
1. Basic: \`/_transform/rss/https%3A%2F%2Fexample.com%2Ffeed.xml\`
2. With filtering: \`/_transform/rss/https%3A%2F%2Fexample.com%2Ffeed.xml/maxItems=10&filterCategory=Tech,News\`
3. Custom mapping: \`/_transform/rss/https%3A%2F%2Fexample.com%2Ffeed.xml/author=dc:creator&image=media:thumbnail@url\`
4. Timezone: \`/_transform/rss/https%3A%2F%2Fexample.com%2Ffeed.xml/tzOffset=3\`
`,
    handler,
};
