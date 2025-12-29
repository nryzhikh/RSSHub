// /* eslint-disable no-await-in-loop */
// import { load, } from 'cheerio';

// // import { fetchContent } from '@/routes/_transform/utils';
// import type { DataItem, Language, Route } from '@/types';
// import cache from '@/utils/cache';
// import logger from '@/utils/logger';

// import { Scraper } from './scraper copy';
// import { chunk, cleanHtml, escape, isValidUrl, pollForElement, unwrapEncodedXML } from './utils';

// async function handler(ctx) {
//     const url = ctx.req.param('url');

//     const defaults = {
//         useBrowser: '0',
//         waitUntil: 'networkidle2',
//         encoding: 'utf-8',
//         filterCategory: '',
//         maxItems: 20,
//         item: 'item',
//         title: 'channel > title, feed > title',
//         language: 'language',
//         description: 'description',
//         link: 'link',
//         itemTitle: 'title',
//         itemLink: 'link',
//         itemDescription: 'description',
//         itemPubDate: 'pubDate',
//         itemGuid: 'guid',
//         itemId: 'id',
//         itemImage: 'image',
//         itemAuthor: 'author, dc:creator',
//         itemCategory: 'category',
//         itemEnclosure: 'enclosure',
//         itemUpdated: 'updated',
//         itemContent: '',
//         concurency: 5,
//     };

//     const p = {
//         ...defaults,
//         ...Object.fromEntries(new URLSearchParams(ctx.req.param('routeParams') || '')),
//     };

//     const filterCategories =
//         p.filterCategory.trim().length > 0
//             ? p.filterCategory
//                   .split(',')
//                   .map((c) => c.toLowerCase().trim())
//                   .filter(Boolean)
//             : [];

//     const scraper = new Scraper({
//         useBrowser: p.useBrowser === '1',
//         encoding: p.encoding || 'utf-8',
//         waitUntil: p.waitUntil as 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2',
//         timeout: 60000,
//         concurency: 5,
//     });
//     const content = await scraper.goto(url, async (page) => await pollForElement(page, p.item || ''));

//     if (!content) {
//         throw new Error('Failed to fetch content');
//     }

//     logger.info(`[_transform/rss] Fetched content: ${content.slice(0, 500)}...`);

//     const $ = load(content, { xmlMode: true });
//     const rss = $('rss, feed');
//     if (!rss.length) {
//         throw new Error('Invalid RSS/Atom feed: missing <rss> or <feed> root element');
//     }

//     const header = {
//         title: $(p.title).first().text(),
//         link: $(p.link).first().text(),
//         description: `Proxy ${url}`,
//         language: $(p.language).first().text() as Language | undefined,
//     };

//     const itemSelector = p.item || ($('feed').length > 0 ? 'entry' : 'item');
//     const items: Partial<DataItem>[] = [];

//     for (const i of $(itemSelector).toArray()) {
//         try {
//             if (items.length >= Number(p.maxItems)) {
//                 break;
//             }
//             const $i = $(i);

//             const res: Partial<DataItem> = {
//                 title: $i.find(escape(p.itemTitle)).first().text(),
//                 link: $i.find(escape(p.itemLink)).first().text() || $i.find(escape(p.itemLink)).first().attr('href'),
//                 description: $i.find(escape(p.itemDescription)).first().text(),
//                 pubDate: $i.find(escape(p.itemPubDate)).first().text(),
//                 guid: $i.find(escape(p.itemGuid)).first().text(),
//                 id: $i.find(escape(p.itemId)).first().text(),
//                 author: $i.find(escape(p.itemAuthor)).first().text(),
//                 category: $i
//                     .find(escape(p.itemCategory))
//                     .toArray()
//                     .map((el) => $(el).text().trim())
//                     .filter(Boolean),
//                 updated: $i.find(escape(p.itemUpdated)).first().text(),
//                 enclosure_url: $i.find(escape(p.itemEnclosure)).attr('url'),
//                 enclosure_type: $i.find(escape(p.itemEnclosure)).attr('type'),
//                 enclosure_length: Number($i.find(escape(p.itemEnclosure)).attr('length')),
//                 enclosure_title: $i.find(escape(p.itemEnclosure)).attr('description'),
//             };

//             if (res.link && !res.link.startsWith('http')) {
//                 res.link = new URL(res.link, url).href;
//             }

//             logger.info(`[_transform/rss] Res link: ${res.enclosure_url}`);

//             logger.info(`[_transform/rss] Res: ${JSON.stringify(res).slice(0, 500)}...`);

//             if (filterCategories.length > 0 && res.category) {
//                 const itemCategories = Array.isArray(res.category) ? res.category : [res.category];
//                 logger.info(`[_transform/rss] Item categories: ${itemCategories}`);
//                 logger.info(`[_transform/rss] Filter categories: ${filterCategories}`);
//                 const hasMatch = itemCategories.some((cat) => filterCategories.includes(cat.toLowerCase().trim()));
//                 if (!hasMatch) {
//                     continue; // Skip this item
//                 }
//             }

//             items.push(res);
//         } catch (error: any) {
//             logger.warn(`[_transform/rss] Failed to parse item: ${error.message}`);
//             continue;
//         }
//     }

//     if (!p.itemContent) {
//         logger.info(`[_transform/rss] No item content, returning ${items.length} items`);
//         return {
//             ...header,
//             item: items as DataItem[],
//         };
//     }

//     const tasks = items.map((i, idx) => ({
//         idx,
//         item: i,
//         shouldProcess: i.link && isValidUrl(i.link),
//         task: async () => {
//             const cacheKey = `_transform:${url}:${i.link}`;
//             const cached = await cache.get(cacheKey);
//             if (cached) {
//                 try {
//                     const parsed = JSON.parse(cached);
//                     return parsed;
//                 } catch {
//                     logger.warn(`[_transform/rss] Failed to parse cached content: ${cached}`);
//                 }
//             }

//             const articleContent = await scraper.goto(i.link!, async (page) => await pollForElement(page, p.itemContent || ''));
//             logger.info(`[_transform/rss] Article content: ${articleContent ? articleContent.slice(0, 500) : 'null'}...`);

//             if (!articleContent || typeof articleContent !== 'string' || articleContent === null) {
//                 return i;
//             }
//             const $ = load(articleContent);
//             const extracted = $(p.itemContent).html();
//             if (!extracted) {
//                 return i;
//             }

//             const cleaned = cleanHtml(extracted);
//             const result = { ...i, description: cleaned };
//             logger.info(`[_transform/rss] Cached result: ${JSON.stringify(result).slice(0, 500)}...`);
//             await cache.set(cacheKey, result);
//             return result;
//         },
//     }));

//     const results: DataItem[] = [];
//     for (const batch of chunk(
//         tasks.filter((t) => t.shouldProcess),
//         p.concurency
//     )) {
//         logger.info(`[_transform/rss] Processing batch size: ${batch.length} items`);
//         const processed = await Promise.all(batch.map((t) => t.task()));
//         results.push(...processed);
//     }

//     await scraper.destroy();

//     return {
//         ...header,
//         item: items.map((i) => results.find((r) => r.link === i.link) || i),
//     };
// }

// export const route: Route = {
//     path: '/rss/:url/:routeParams?',
//     categories: ['other'],
//     example: '/_transform/rss/https%3A%2F%2Fexample.com%2Ffeed.xml/maxItems=10',
//     parameters: {
//         url: '`encodeURIComponent`ed RSS/Atom feed URL',
//         routeParams: `Optional parameters (URL encoded, key=value pairs separated by &):
// - maxItems: Max items to return (default: 20)
// - filterCategory: Comma-separated categories to filter (e.g., "Tech,News")
// - tzOffset: Timezone offset for dates (e.g., "3" for GMT+3, "-5" for GMT-5)
// - useBrowser: Use Puppeteer for JS-rendered feeds (1=yes, 0=no, default: 0)
// - itemSelector: Custom item selector (default: "item" for RSS, use "entry" for Atom)
// - feedTitle: Custom feed title selector (default: "channel > title")
// - Custom field mappings: fieldName=selector or fieldName=selector@attr
//   Example: author=dc:creator or image=media:thumbnail@url`,
//     },
//     features: {
//         requireConfig: [
//             {
//                 name: 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN',
//                 description: 'Allow fetching content from user-supplied URLs',
//             },
//         ],
//         requirePuppeteer: false,
//         antiCrawler: false,
//         supportBT: false,
//         supportPodcast: true,
//         supportScihub: false,
//     },
//     name: 'RSS Feed Transformer',
//     maintainers: ['nryzhikh'],
//     description: `
// Auto-extracts all standard RSS/Atom fields and allows custom field mapping.

// **Features:**
// - Auto-extracts: title, link, description, pubDate, author, category, guid, enclosure, iTunes fields, media, content
// - Custom field mapping: Map any RSS element to DataItem fields
// - Category filtering: Filter items by category
// - Timezone support: Parse dates with custom timezone offsets
// - Browser support: Optional Puppeteer for JavaScript-rendered feeds

// **Example usage:**
// 1. Basic: \`/_transform/rss/https%3A%2F%2Fexample.com%2Ffeed.xml\`
// 2. With filtering: \`/_transform/rss/https%3A%2F%2Fexample.com%2Ffeed.xml/maxItems=10&filterCategory=Tech,News\`
// 3. Custom mapping: \`/_transform/rss/https%3A%2F%2Fexample.com%2Ffeed.xml/author=dc:creator&image=media:thumbnail@url\`
// 4. Timezone: \`/_transform/rss/https%3A%2F%2Fexample.com%2Ffeed.xml/tzOffset=3\`
// `,
//     handler,
// };
