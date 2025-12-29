// import { load } from 'cheerio';

// import { config } from '@/config';
// import ConfigNotFoundError from '@/errors/types/config-not-found';
// import type { DataItem, Route } from '@/types';
// import cache from '@/utils/cache';
// import logger from '@/utils/logger';

// import { DateTimeParser } from '../datetime-parser';
// import { Scraper } from '../scraper copy';
// import { chunk, cleanHtml, isValidUrl, pollForElement } from '../utils';

// export const route: Route = {
//     path: '/html/:url/:routeParams?',
//     categories: ['other'],
//     example: '/rsshub/transform/html/https%3A%2F%2Fwechat2rss.xlab.app%2Fposts%2Flist%2F/item=div%5Bclass%3D%27post%2Dcontent%27%5D%20p%20a',
//     parameters: { url: '`encodeURIComponent`ed URL address', routeParams: 'Transformation rules, requires URL encode' },
//     features: {
//         requireConfig: [
//             {
//                 name: 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN',
//                 description: '',
//             },
//         ],
//         requirePuppeteer: false,
//         antiCrawler: false,
//         supportBT: false,
//         supportPodcast: false,
//         supportScihub: false,
//     },
//     name: 'Transformation - HTML',
//     maintainers: ['ttttmr', 'hyoban'],
//     description: `Pass URL and transformation rules to convert HTML/JSON into RSS.

// Specify options (in the format of query string) in parameter \`routeParams\` parameter to extract data from HTML.

// | Key                 | Meaning                                                                                                       | Accepted Values | Default                  |
// | ------------------- | ------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------ |
// | \`title\`           | The title of the RSS                                                                                          | \`string\`      | Extract from \`<title>\` |
// | \`item\`            | The HTML elements as \`item\` using CSS selector                                                              | \`string\`      | html                     |
// | \`itemTitle\`       | The HTML elements as \`title\` in \`item\` using CSS selector                                                 | \`string\`      | \`item\` element         |
// | \`itemTitleAttr\`   | The attributes of \`title\` element as title                                                                  | \`string\`      | Element text             |
// | \`itemLink\`        | The HTML elements as \`link\` in \`item\` using CSS selector                                                  | \`string\`      | \`item\` element         |
// | \`itemLinkAttr\`    | The attributes of \`link\` element as link                                                                    | \`string\`      | \`href\`                 |
// | \`itemDesc\`        | The HTML elements as \`descrption\` in \`item\` using CSS selector                                            | \`string\`      | \`item\` element         |
// | \`itemDescAttr\`    | The attributes of \`descrption\` element as description                                                       | \`string\`      | Element html             |
// | \`itemPubDate\`     | The HTML elements as \`pubDate\` in \`item\` using CSS selector                                               | \`string\`      | \`item\` element         |
// | \`itemPubDateAttr\` | The attributes of \`pubDate\` element as pubDate                                                              | \`string\`      | Element html             |
// | \`itemContent\`     | The HTML elements as \`description\` in \`item\` using CSS selector ( in \`itemLink\` page for full content ) | \`string\`      |                          |
// | \`encoding\`        | The encoding of the HTML content                                                                              | \`string\`      | utf-8                    |

//   Parameters parsing in the above example:

// | Parameter     | Value                                     |
// | ------------- | ----------------------------------------- |
// | \`url\`         | \`https://wechat2rss.xlab.app/posts/list/\` |
// | \`routeParams\` | \`item=div[class='post-content'] p a\`      |

//   Parsing of \`routeParams\` parameter:

// | Parameter | Value                           |
// | --------- | ------------------------------- |
// | \`item\`    | \`div[class='post-content'] p a\` |`,
//     handler: async (ctx) => {
//         if (!config.feature.allow_user_supply_unsafe_domain) {
//             throw new ConfigNotFoundError(`This RSS is disabled unless 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN' is set to 'true'.`);
//         }
//         const url = ctx.req.param('url');
//         const routeParams = new URLSearchParams(ctx.req.param('routeParams'));
//         logger.info(`[_transform/html] routeParams: ${JSON.stringify(Object.fromEntries(routeParams.entries()))}`);

//         const filterCategories =
//             routeParams
//                 .get('filterCategory')
//                 ?.split(',')
//                 .map((c) => c.toLowerCase().trim())
//                 .filter(Boolean) || [];

//         const scraper = new Scraper({
//             useBrowser: routeParams.get('useBrowser') === '1',
//             encoding: routeParams.get('encoding') || 'utf-8',
//             waitUntil: routeParams.get('waitUntil') as 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2',
//             timeout: 30000,
//             concurency: 10,
//         });
//         const datetimeParser = new DateTimeParser(routeParams.get('timezoneOffset'));
//         // const content = await scraper.goto(url);

//         const content = await scraper.goto(url, async (page) => await pollForElement(page, p.item || ''));

//         // logger.info(`[_transform/html] Fetched content: ${content ? content.slice(0, 500) : 'null'}...`);

//         if (!content) {
//             throw new Error('Failed to fetch content');
//         }

//         const $ = load(content);
//         const rssTitle = routeParams.get('title') || $('title').text();
//         const itemSelector = routeParams.get('item') || 'html';
//         const items: Partial<DataItem>[] = [];
//         for (let item of $(itemSelector).toArray()) {
//             try {
//                 if (items.length >= Number(routeParams.get('maxItems') || 20)) {
//                     break;
//                 }
//                 item = $(item);
//                 // logger.info(`[_transform/html] Item: ${item.toString()}`);

//                 const titleEle = routeParams.get('itemTitle') ? item.find(routeParams.get('itemTitle')) : item;
//                 const title = routeParams.get('itemTitleAttr') ? titleEle.attr(routeParams.get('itemTitleAttr')) : titleEle.text();

//                 let link;
//                 const linkEle = routeParams.get('itemLink') ? item.find(routeParams.get('itemLink')) : item;
//                 if (routeParams.get('itemLinkAttr')) {
//                     link = linkEle.attr(routeParams.get('itemLinkAttr'));
//                 } else {
//                     link = linkEle.is('a') ? linkEle.attr('href') : linkEle.find('a').attr('href');
//                 }
//                 // 补全绝对链接或相对链接
//                 link = link.trim();
//                 if (link && !link.startsWith('http')) {
//                     link = new URL(link, url).href;
//                 }

//                 const descEle = routeParams.get('itemDesc') ? item.find(routeParams.get('itemDesc')) : item;
//                 const desc = routeParams.get('itemDescAttr') ? descEle.attr(routeParams.get('itemDescAttr')) : descEle.html();
//                 const cleanedDesc = cleanHtml(desc);

//                 const pubDateEle = routeParams.get('itemPubDate') ? item.find(routeParams.get('itemPubDate')) : item;
//                 const pubDate = routeParams.get('itemPubDateAttr') ? pubDateEle.attr(routeParams.get('itemPubDateAttr')) : pubDateEle.html();

//                 const categoryEle = routeParams.get('itemCategory') ? item.find(routeParams.get('itemCategory')) : undefined;
//                 const category = routeParams.get('itemCategoryAttr') ? categoryEle.attr(routeParams.get('itemCategoryAttr')) : categoryEle ? categoryEle.text() : undefined;

//                 const enclosureEle = routeParams.get('itemEnclosure') ? item.find(routeParams.get('itemEnclosure')) : undefined;
//                 logger.info(`[_transform/html] enclosureEle: ${enclosureEle ? enclosureEle.attr('src') : undefined}`);

//                 if (filterCategories.length > 0 && category) {
//                     const itemCategories = Array.isArray(category) ? category : [category];
//                     const hasMatch = itemCategories.some((cat) => filterCategories.includes(cat.toLowerCase().trim()));
//                     if (!hasMatch) {
//                         continue; // Skip this item
//                     }
//                 }
//                 logger.info(`[_transform/html] pubDate: ${pubDate}...`);
//                 // logger.info(`[_transform/html] Item: ${JSON.stringify({ title, link, description: desc, pubDate, category }).slice(0, 5000)}...`);
//                 items.push({
//                     title,
//                     link,
//                     description: cleanedDesc,
//                     pubDate: pubDate ? datetimeParser.parse(pubDate) : undefined,
//                     category,
//                     enclosure_url: enclosureEle ? enclosureEle.attr('src') : undefined,
//                     // enclosure_type: enclosureEle ? enclosureEle.attr('type') : undefined,
//                     enclosure_title: enclosureEle ? enclosureEle.attr('alt') : undefined,
//                     // enclosure_length: enclosureEle ? Number(enclosureEle.attr('length')) : undefined,
//                 });
//             } catch (error: any) {
//                 logger.warn(`[_transform/html] Failed to parse item: ${error.message}`);
//                 continue;
//             }
//         }

//         // logger.info(`[_transform/html] Items: ${JSON.stringify(items).slice(0, 5000)}...`);

//         const itemContentSelector = routeParams.get('itemContent');
//         const results: DataItem[] = [];
//         if (itemContentSelector) {
//             const tasks = items.map((i, idx) => ({
//                 idx,
//                 item: i,
//                 shouldProcess: i.link && isValidUrl(i.link),
//                 task: async () => {
//                     const cacheKey = `_transform:${url}:${i.link}`;
//                     const cached = await cache.get(cacheKey);
//                     if (cached) {
//                         try {
//                             const parsed = JSON.parse(cached);
//                             return parsed;
//                         } catch {
//                             logger.warn(`[_transform/rss] Failed to parse cached content: ${cached}`);
//                         }
//                     }

//                     const articleContent = await scraper.goto(i.link!, async (page) => await pollForElement(page, routeParams.get('itemContent') || ''));
//                     // logger.info(`[_transform/html] Article content: ${articleContent ? articleContent.slice(0, 5000) : 'null'}...`);

//                     if (!articleContent) {
//                         return i;
//                     }
//                     // const extracted = extractHtml(articleContent, itemContentSelector);
//                     // if (!extracted) {
//                     //     return i;
//                     // }
//                     const $ = load(articleContent);
//                     const extracted = $(itemContentSelector).html();
//                     if (!extracted) {
//                         return i;
//                     }

//                     const cleaned = cleanHtml(extracted);

//                     const result = {
//                          ...i,
//                          description: cleaned,
//                     };
//                     // logger.info(`[_transform/rss] Cached result: ${JSON.stringify(result).slice(0, 500)}...`);
//                     await cache.set(cacheKey, result);
//                     return result;
//                 },
//             }));

//             for (const batch of chunk(
//                 tasks.filter((t) => t.shouldProcess),
//                 Number(routeParams.get('concurency') || 10)
//             )) {
//                 logger.info(`[_transform/rss] Processing batch size: ${batch.length} items`);
//                 // eslint-disable-next-line no-await-in-loop
//                 const processed = await Promise.all(batch.map((t) => t.task()));
//                 results.push(...processed);
//             }
//         }

//         await scraper.destroy();
//         return {
//             title: rssTitle,
//             link: url,
//             description: `Proxy ${url}`,
//             item: items.map((i) => results.find((r) => r.link === i.link) || i),
//         };
//     },
// };
