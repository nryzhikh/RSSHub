import { load } from 'cheerio';
import got from 'got';
import sanitizeHtml from 'sanitize-html';

import type { DataItem } from '@/types';
import cache from '@/utils/cache';
import { collapseWhitespace } from '@/utils/common-utils';
import logger from '@/utils/logger';

import type { BrowserSession } from './browser-session';

type Options = {
    cachePrefix: string;
    articleSelector: string;
    articleMediaSelector?: string;
    articleTextSelectors?: string;
    session?: BrowserSession;
    exclude?: string;
    include?: string;
};

const MEDIA_URL_ATTRIBUTES: string[] = ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-url', 'data-image', 'data-img', 'srcset', 'data-srcset'];

export async function getContent(items: DataItem[], options: Options) {
    const { cachePrefix, session, articleSelector, articleMediaSelector, articleTextSelectors, exclude, include } = options;
    const results = await Promise.all(
        items.map(async (item) => {
            try {
                if (!item.link) {
                    return item;
                }

                const cacheKey = `${cachePrefix}:${item.link}`;
                const cached = await cache.get(cacheKey);
                if (cached) {
                    try {
                        return JSON.parse(cached);
                    } catch {
                        // ignore parse errors
                    }
                }

                // Only proceed with fetch if not cached
                const response = session ? await session.gotoAndFetch(item.link, articleSelector) : await got(item.link).text();
                // logger.info(`[_transform/get-content] Response: ${response ? response.slice(0, 500) : 'null'}...`);

                if (!response) {
                    return item; // Don't cache failures
                }

                const $ = load(response);

                if (exclude) {
                    logger.debug(`[_transform/get-content] Excluding ${exclude} exclude items length: ${$(exclude).length}`);
                    $(exclude).remove();
                }
                const $html = $(articleSelector);
                if (include) {
                    logger.debug(`[_transform/get-content] Including ${include}`);
                    if ($html.length) {
                        // Find all elements matching include
                        const $included = $(include);

                        if ($included.length > 0) {
                            // Get the parent of the first included element (or use container)
                            const $parent = $included.first().parent();

                            // Remove all children that don't match include
                            $parent.children().each((_, element) => {
                                const $el = $(element);
                                if (!$el.is(include) && $el.find(include).length === 0) {
                                    $el.remove();
                                }
                            });

                            // Also handle nested elements - keep only those in the include path
                            $html.find('*').each((_, element) => {
                                const $el = $(element);
                                // Remove if it doesn't match include and isn't a parent/ancestor of included
                                if (!$el.is(include) && !$el.closest(include).length && $el.find(include).length === 0) {
                                    $el.remove();
                                }
                            });
                        }
                    }
                }

                if (!$html.length) {
                    logger.error(`[_transform/get-content] No HTML found for ${item.link}`);
                    return item; // Don't cache failures
                }

                const sanitized = sanitizeHtml($html.html() || '', {
                    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'video', 'audio', 'source', 'iframe'],
                    allowedAttributes: {
                        '*': ['*'], // Allow all attributes by default
                    },
                    transformTags: {
                        iframe: (tagName, attribs) => ({
                            tagName: 'iframe',
                            attribs,
                            text: '', // Explicitly set empty content
                        }),
                        '*': (tagName, attribs) => {
                            // Attributes to exclude
                            const excludedAttrs = new Set([
                                'style',
                                'onclick',
                                'onerror',
                                'onload',
                                // Add any other attributes you want to exclude
                            ]);

                            // Patterns for attributes to exclude (e.g., all event handlers)
                            const excludedPatterns = [
                                /^on/i, // All event handlers (onclick, onload, etc.)
                            ];

                            const cleanedAttribs: Record<string, string> = {};
                            for (const [key, value] of Object.entries(attribs)) {
                                // Skip if in excluded list
                                if (excludedAttrs.has(key.toLowerCase())) {
                                    continue;
                                }

                                // Skip if matches excluded pattern
                                if (excludedPatterns.some((pattern) => pattern.test(key))) {
                                    continue;
                                }

                                cleanedAttribs[key] = value;
                            }

                            return {
                                tagName,
                                attribs: cleanedAttribs,
                            };
                        },
                    },
                    parseStyleAttributes: false,
                });
                // logger.info(`[_transform/get-content] Sanitized HTML: ${sanitized.slice(0, 500)}...`);

                const $sanitized = load(sanitized);
                const text = articleTextSelectors
                    ? $html
                          .find(articleTextSelectors)
                          .toArray()
                          .map((el) => $(el).text().trim())
                          .filter(Boolean)
                          .join(' ')
                          .replaceAll(/\s+/g, ' ')
                          .trim()
                    : collapseWhitespace($sanitized.text());

                let attachments: DataItem['attachments'] = [];
                if (articleMediaSelector) {
                    logger.debug(`[_transform/get-content] Article media selector: ${articleMediaSelector}`);
                    attachments = $(articleMediaSelector)
                        .toArray()
                        .map((att) => {
                            for (const attribute of MEDIA_URL_ATTRIBUTES) {
                                let url = $(att).attr(attribute)?.split(',')[0]?.trim();
                                try {
                                    url = new URL(url ?? 'x', item.link).href;
                                } catch {
                                    url = undefined;
                                }
                                if (url) {
                                    logger.debug(`[_transform/get-content] Attachment URL: ${url}`);
                                    return {
                                        url: url.trim(),
                                        mime_type: $(att).attr('type')?.trim(),
                                        title: $(att).attr('alt') || $(att).attr('title')?.trim(),
                                        size_in_bytes: $(att).attr('size')?.trim(),
                                        duration_in_seconds: $(att).attr('duration')?.trim(),
                                    };
                                }
                            }
                            return null;
                        })
                        .filter(Boolean) as DataItem['attachments'];
                }
                // logger.info(`[_transform/get-content] ${item.link} Attachments: ${JSON.stringify(attachments, null, 2)}`);

                const result = {
                    ...item,
                    description: sanitized,
                    attachments,
                    content: {
                        html: collapseWhitespace(sanitized),
                        text,
                    },
                };

                // Only cache successful results
                await cache.set(cacheKey, JSON.stringify(result));
                return result;
            } catch (error: any) {
                logger.error(`[_transform/get-content] Error getting content for ${item.link}: ${error.message}`);
                return item; // Don't cache errors
            }
        })
    );

    return results;
}
