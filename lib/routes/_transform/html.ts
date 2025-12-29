import type { Cheerio } from 'cheerio';
import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';
import got from 'got';

import type { Data, Route } from '@/types';
import logger from '@/utils/logger';

import { BrowserSession } from './browser-session';
import { DateTimeParser } from './datetime-parser';
import { getContent } from './get-content';
import type { FeedItem, RouteParams } from './types';

const DEFAULT_ROUTE_PARAMS = {
    maxItems: 20,
    useBrowser: false,
};

function getValue(item: Cheerio<AnyNode>, selector: FeedItem | undefined, type: 'text' | 'html' = 'text') {
    if (!selector) {
        return;
    }
    const selectorStr = typeof selector === 'string' ? selector : selector.element;
    const ele = item.find(selectorStr);

    if (typeof selector === 'object' && selector?.attr) {
        return ele.attr(selector.attr)?.trim() || item.attr(selector.attr)?.trim();
    }
    if (type === 'html') {
        return ele.html()?.trim();
    }
    // For text type, add spaces between elements to prevent concatenation
    // Get text from each element in the collection and join with spaces
    const texts = ele
        .toArray()
        .map((el) => load(el).text().trim())
        .filter((text) => text.length > 0);
    return texts.length > 0 ? texts.join(' ') : ele.text().trim();
}

async function handler(ctx) {
    const routeParamsString = ctx.req.param('routeParams');

    const url = ctx.req.param('url');
    const routeParams: RouteParams = {
        ...DEFAULT_ROUTE_PARAMS,
        ...JSON.parse(ctx.req.param('routeParams') || '{}'),
    };

    if (!routeParams.item) {
        throw new Error('item is required');
    }

    const session = new BrowserSession();
    const response = routeParams.useBrowser ? await session.gotoAndFetch(url, routeParams.item) : await got(url).text();

    if (!response) {
        logger.error(`[_transform/rss2] No RSS feed found`);
        await session.close();
        return null;
    }

    const datetimeParser = new DateTimeParser(routeParams.timezoneOffset, routeParams.locale);

    const $ = load(response);
    const data: Data = {
        link: url,
        description: `Proxy ${url}`,
        title: `Proxy ${url}`,
        item: [],
    };
    for (const item of $(routeParams.item).toArray()) {
        if (data.item && data.item.length >= Number(routeParams.maxItems)) {
            break;
        }
        const $item = $(item);

        let link = getValue($item, routeParams.feed?.link || { element: 'a', attr: 'href' }, 'html') || $item.attr('href');
        if (link && !link.startsWith('http')) {
            link = new URL(link, url).href;
        }

        const category = getValue($item, routeParams.feed?.category);
        if (routeParams.filterCategory && routeParams.filterCategory.length > 0) {
            const filterCategories = routeParams.filterCategory.map((c) => c.toLowerCase().trim());
            if (category && !filterCategories.includes(category.toLowerCase().trim())) {
                continue;
            }
        }

        data.item?.push({
            title: getValue($item, routeParams.feed?.title) || $item.attr('title') || '',
            description: getValue($item, routeParams.feed?.description),
            pubDate: new Date(datetimeParser.parse(getValue($item, routeParams.feed?.pubDate) || '') || new Date('')),
            category: category ? [category] : undefined,
            link,
            enclosure_url: getValue($item, routeParams.feed?.enclosure || { element: 'img', attr: 'src' }),
        });
    }

    if (!routeParams.content || !data.item?.length) {
        await session.close();
        return data;
    }

    data.item = await getContent(data.item, {
        cachePrefix: `_transform:${url}:${routeParamsString}`,
        articleSelector: routeParams.content,
        articleMediaSelector: routeParams.media,
        articleTextSelectors: routeParams.contentText,
        session: routeParams.useBrowser ? session : undefined,
        exclude: routeParams.exclude,
        include: routeParams.include,
    });

    await session.close();

    return data;
}

export const route: Route = {
    path: '/html/:url/:routeParams?',
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
