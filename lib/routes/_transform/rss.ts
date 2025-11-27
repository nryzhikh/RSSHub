import { load } from 'cheerio';
import sanitizeHtml from 'sanitize-html';

import { fetchContent } from '@/routes/_transform/utils';
import type { DataItem, Language, Route } from '@/types';
import cache from '@/utils/cache';
import logger from '@/utils/logger';

function escape(selector: string): string {
    // Split by comma to handle multiple selectors, then escape each
    return selector
        .split(',')
        .map((s) => s.trim().replaceAll(':', String.raw`\:`))
        .join(', ');
}

async function handler(ctx) {
    const url = ctx.req.param('url');

    const defaults = {
        useBrowser: '0',
        waitUntil: 'networkidle2',
        encoding: 'utf-8',
        filterCategory: '',
        maxItems: 20,
        item: 'item',
        title: 'channel > title, feed > title',
        language: 'language',
        description: 'description',
        link: 'link',
        itemTitle: 'title',
        itemLink: 'link',
        itemDescription: 'description',
        itemPubDate: 'pubDate',
        itemGuid: 'guid',
        itemId: 'id',
        itemImage: 'image',
        itemAuthor: 'author, dc:creator',
        itemCategory: 'category',
        itemEnclosure: 'enclosure',
        itemUpdated: 'updated',
        itemContent: '',
    };

    const p = {
        ...defaults,
        ...Object.fromEntries(new URLSearchParams(ctx.req.param('routeParams') || '')),
    };

    const filterCategories =
        p.filterCategory.trim().length > 0
            ? p.filterCategory
                  .split(',')
                  .map((c) => c.trim())
                  .filter(Boolean)
            : [];

    const content = await fetchContent(url, {
        useBrowser: p.useBrowser,
        waitUntil: p.waitUntil,
        encoding: p.encoding,
    });

    const $ = load(content, { xmlMode: true });
    const rss = $('rss, feed');
    if (!rss.length) {
        throw new Error('Invalid RSS/Atom feed: missing <rss> or <feed> root element');
    }

    const header = {
        title: $(p.title).first().text(),
        link: $(p.link).first().text(),
        description: `Proxy ${url}`,
        language: $(p.language).first().text() as Language | undefined,
    };

    const itemSelector = p.item || ($('feed').length > 0 ? 'entry' : 'item');
    let items: Partial<DataItem>[] = [];

    for (const i of $(itemSelector).toArray()) {
        try {
            if (items.length >= Number(p.maxItems)) {
                break;
            }
            const $i = $(i);

            const res: Partial<DataItem> = {
                title: $i.find(escape(p.itemTitle)).first().text(),
                link: $i.find(escape(p.itemLink)).first().text() || $i.find(escape(p.itemLink)).first().attr('href'),
                description: $i.find(escape(p.itemDescription)).first().text(),
                pubDate: $i.find(escape(p.itemPubDate)).first().text(),
                guid: $i.find(escape(p.itemGuid)).first().text(),
                id: $i.find(escape(p.itemId)).first().text(),
                author: $i.find(escape(p.itemAuthor)).first().text(),
                category: $i
                    .find(escape(p.itemCategory))
                    .toArray()
                    .map((el) => $(el).text().trim())
                    .filter(Boolean),
                updated: $i.find(escape(p.itemUpdated)).first().text(),
                enclosure_url: $i.find(escape(p.itemEnclosure)).first().attr('url'),
                enclosure_type: $i.find(escape(p.itemEnclosure)).first().attr('type'),
                enclosure_length: Number($i.find(escape(p.itemEnclosure)).first().attr('length')),
                enclosure_title: $i.find(escape(p.itemEnclosure)).first().attr('description'),
            };

            if (res.link && !res.link.startsWith('http')) {
                res.link = new URL(res.link, url).href;
            }

            if (filterCategories.length > 0 && res.category) {
                const itemCategories = Array.isArray(res.category) ? res.category : [res.category];
                const hasMatch = itemCategories.some((cat) => filterCategories.includes(cat));
                if (!hasMatch) {
                    continue; // Skip this item
                }
            }

            items.push(res);
        } catch (error: any) {
            logger.warn(`[_transform/rss] Failed to parse item: ${error.message}`);
            continue;
        }
    }

    if (p.itemContent) {
        logger.info(`[_transform/rss] Extracting content for ${items.length} items`);
        items = await Promise.all(
            items.map((item) => {
                if (!item.link) {
                    return item;
                }
                logger.info(`[_transform/rss] Extracting content for ${item.link}`);

                return cache.tryGet(`_transform:${item.link}:${p.itemContent}`, async () => {
                    const response = await fetchContent(
                        item.link!,
                        {
                            useBrowser: p.useBrowser,
                            waitUntil: p.waitUntil,
                            encoding: p.encoding,
                        },
                        p.itemContent
                    );
                    logger.info(`[_transform/rss] Response: ${response.slice(0, 500)}`);
                    if (!response || typeof response !== 'string') {
                        return item;
                    }

                    const $ = load(response);
                    const content = $(p.itemContent).first().html();
                    logger.info(`[_transform/rss] Content: ${content?.slice(0, 500)}`);
                    if (!content) {
                        return item;
                    }
                    const sanitized = sanitizeHtml(content, {
                        allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'video', 'audio'],
                    });
                    item.description = sanitized;

                    // if (p.itemContentAttachments) {
                    //     const attachments = $(p.itemContentAttachments).toArray().map((el) => {
                    //         const $el = $(el);
                    //         const url = [$el.attr('data-src'), $el.attr('src'), $el.attr('href')].find((u) => u?.startsWith('http'));
                    //         if (url) {
                    //             return {
                    //                 url,
                    //                 mime_type: $el.attr('type') || '*/*',
                    //                 title: $el.attr('alt') || $el.attr('title'),
                    //             };
                    //         }
                    //         return null;
                    //     }).filter((a) => a !== null);
                    //     if (attachments.length > 0) {
                    //         item.attachments = attachments;
                    //     }
                    // }

                    return item;
                });
            })
        );
    }

    return {
        ...header,
        item: items as DataItem[],
    };
}

export const route: Route = {
    path: '/rss/:url/:routeParams?',
    categories: ['other'],
    example: '/_transform/rss/https%3A%2F%2Fexample.com%2Ffeed.xml/maxItems=10',
    parameters: {
        url: '`encodeURIComponent`ed RSS/Atom feed URL',
        routeParams: `Optional parameters (URL encoded, key=value pairs separated by &):
- maxItems: Max items to return (default: 20)
- filterCategory: Comma-separated categories to filter (e.g., "Tech,News")
- tzOffset: Timezone offset for dates (e.g., "3" for GMT+3, "-5" for GMT-5)
- useBrowser: Use Puppeteer for JS-rendered feeds (1=yes, 0=no, default: 0)
- itemSelector: Custom item selector (default: "item" for RSS, use "entry" for Atom)
- feedTitle: Custom feed title selector (default: "channel > title")
- Custom field mappings: fieldName=selector or fieldName=selector@attr
  Example: author=dc:creator or image=media:thumbnail@url`,
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
