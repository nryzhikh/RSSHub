import { load } from 'cheerio';
import got from 'got';

import type { Data, DataItem, Route } from '@/types';
import logger from '@/utils/logger';

import { BrowserSession } from './browser-session';
import { getContent } from './get-content';
import type { RouteParams } from './types';

const FEED_MAP = {
    'content:encoded': 'description',
    'dc:content': 'description',
    'dc:creator': 'author',
};

const DEFAULT_ROUTE_PARAMS = {
    maxItems: 20,
    useBrowser: false,
};

async function handler(ctx) {
    const url = ctx.req.param('url');
    const routeParamsString = ctx.req.param('routeParams');
    const routeParams: RouteParams = {
        ...DEFAULT_ROUTE_PARAMS,
        ...JSON.parse(routeParamsString || '{}'),
    };
    const session = new BrowserSession();
    const response = routeParams.useBrowser
        ? await session.run(async (page) => {
              await page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 });
              await new Promise((resolve) => setTimeout(resolve, 1000));
              return await page.evaluate(() => document.documentElement.outerHTML);
          })
        : await got(url).text();

    if (!response) {
        logger.error(`[_transform/rss] No RSS feed found`);
        await session.close();
        return null;
    }

    let $ = load(response, { xmlMode: true });
    if ($('pre').first().length) {
        $ = load($('pre').first().text(), { xmlMode: true });
    }

    const data: Partial<Data> = {};
    $('rss > channel, rss, feed > channel, feed')
        .children()
        .each((_, el) => {
            if (!['item', 'entry'].includes(el.tagName)) {
                data[el.tagName] = $(el).text().trim();
            }
        });

    const feedMap = {
        ...FEED_MAP,
        ...Object.fromEntries(Object.entries(routeParams.feed || {}).map(([k, v]) => [v, k])),
    };
    $('item, entry').each((_, el) => {
        data.item = data.item ?? [];
        const item: Partial<DataItem> = {};
        $(el)
            .children()
            .each((_, child) => {
                if (data.item && data.item.length >= Number(routeParams.maxItems)) {
                    return;
                }
                const name = feedMap?.[child.tagName] || child.tagName;
                // logger.info(`[_transform/rss2] name: ${name} text: ${$(child).text().trim()}`);
                if (name === 'category') {
                    item.category = item.category ?? [];
                    item.category.push($(child).text().trim());
                } else if (name === 'enclosure') {
                    item.enclosure_url = $(child).attr('url');
                    item.enclosure_type = $(child).attr('type');
                    item.enclosure_length = Number($(child).attr('length'));
                    item.enclosure_title = $(child).attr('description');
                } else if (name.startsWith('media:')) {
                    item.media = item.media ?? {};
                    let key = name.replace('media:', '');
                    if (item.media[key]) {
                        key = `${key}_${Object.keys(item.media).filter((k) => k.startsWith(key)).length}`;
                    }
                    item.media[key] = {
                        ...child.attribs,
                        text: $(child).text().trim(),
                    };
                } else if (name === 'link') {
                    let link = $(child).text().trim() || $(child).attr('href')?.trim();
                    if (link && !link.startsWith('http')) {
                        try {
                            link = new URL(link, url).href;
                            logger.debug(`[_transform/rss2] link: ${link}`);
                        } catch {
                            link = undefined;
                        }
                    }
                    if (link) {
                        item[name] = link;
                    }
                } else {
                    if (item[name]) {
                        return;
                    }
                    item[name] = $(child).text().trim();
                    // logger.info(`[_transform/rss2] item[${name}]: ${item[name]}`);
                }
            });
        data.item.push(item as DataItem);
    });

    if (routeParams.filterCategory && routeParams.filterCategory.length > 0) {
        const filterCategories = routeParams.filterCategory.map((c) => c.toLowerCase().trim());
        data.item = data.item?.filter((item) => item.category?.some((c) => filterCategories?.includes(c.toLowerCase().trim())));
    }

    data.item = data.item?.slice(0, routeParams.maxItems);

    if (!routeParams.content || !data.item?.length) {
        await session.close();
        return data;
    }

    data.item = await getContent(data.item, {
        cachePrefix: `_transform:${url}:${routeParamsString}`,
        articleSelector: routeParams.content,
        articleMediaSelector: typeof routeParams.media === 'string' ? routeParams.media : routeParams.media?.element,
        articleMediaAttributes: typeof routeParams.media === 'object' ? routeParams.media?.attrs : undefined,
        session: routeParams.useBrowser ? session : undefined,
        exclude: routeParams.exclude,
    });

    await session.close();

    return {
        ...data,
        link: url,
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
