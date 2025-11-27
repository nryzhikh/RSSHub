// import dayjs from 'dayjs';
// import duration from 'dayjs/plugin/duration';
// import customParseFormat from 'dayjs/plugin/customParseFormat';
// import 'dayjs/locale/ru';
// import 'dayjs/locale/en';
import { load } from 'cheerio';
import * as chrono from 'chrono-node';

import got from '@/utils/got';
import logger from '@/utils/logger';
import { getPuppeteerPage } from '@/utils/puppeteer';

// dayjs.extend(duration);
// dayjs.extend(customParseFormat);

/**
 * Parse relative dates in English and Russian
 * Handles: 4h, 4ч, 2 hours ago, 3 часа назад, 5m, 10 минут назад, etc.
 */
// export function parseRelativeDate(dateString: string): Date | null {
//     const cleaned = dateString.toLowerCase().trim();
//     // Pattern for relative time with units
//     const patterns = [
//         // Years - English & Russian
//         { unit: 'years', regex: /(\d+)\s*(?:years?|y|лет|год|года)/i },
//         // Months - English & Russian
//         { unit: 'months', regex: /(\d+)\s*(?:months?|mo|месяц|месяцев|мес)/i },
//         // Weeks - English & Russian
//         { unit: 'weeks', regex: /(\d+)\s*(?:weeks?|w|недел[ья]|нед)/i },
//         // Days - English & Russian
//         { unit: 'days', regex: /(\d+)\s*(?:days?|d|дн[ея]й|д)/i },
//         // Hours - English & Russian
//         { unit: 'hours', regex: /(\d+)\s*(?:hours?|hrs?|h|час[ао]в?|ч)/i },
//         // Minutes - English & Russian
//         { unit: 'minutes', regex: /(\d+)\s*(?:minutes?|mins?|m|минут[ыа]?|мин|м)/i },
//         // Seconds - English & Russian
//         { unit: 'seconds', regex: /(\d+)\s*(?:seconds?|secs?|s|секунд[ыа]?|сек|с)/i },
//     ];

//     const durations: Record<string, number> = {};
//     let hasMatches = false;

//     // Extract all time units
//     for (const pattern of patterns) {
//         const match = pattern.regex.exec(cleaned);
//         if (match) {
//             durations[pattern.unit] = Number.parseInt(match[1], 10);
//             hasMatches = true;
//         }
//     }

//     if (!hasMatches) {
//         return null;
//     }

//     // Check if it's "ago/назад" (past) or not (assume past by default for relative)
//     const isPast = /ago|назад|тому назад|back/i.test(cleaned) || !/in\s|через/i.test(cleaned);

//     let result = dayjs();

//     if (isPast) {
//         // Subtract time (past)
//         if (durations.years) {
//             result = result.subtract(durations.years, 'years');
//         }
//         if (durations.months) {
//             result = result.subtract(durations.months, 'months');
//         }
//         if (durations.weeks) {
//             result = result.subtract(durations.weeks, 'weeks');
//         }
//         if (durations.days) {
//             result = result.subtract(durations.days, 'days');
//         }
//         if (durations.hours) {
//             result = result.subtract(durations.hours, 'hours');
//         }
//         if (durations.minutes) {
//             result = result.subtract(durations.minutes, 'minutes');
//         }
//         if (durations.seconds) {
//             result = result.subtract(durations.seconds, 'seconds');
//         }
//     } else {
//         // Add time (future)
//         if (durations.years) {
//             result = result.add(durations.years, 'years');
//         }
//         if (durations.months) {
//             result = result.add(durations.months, 'months');
//         }
//         if (durations.weeks) {
//             result = result.add(durations.weeks, 'weeks');
//         }
//         if (durations.days) {
//             result = result.add(durations.days, 'days');
//         }
//         if (durations.hours) {
//             result = result.add(durations.hours, 'hours');
//         }
//         if (durations.minutes) {
//             result = result.add(durations.minutes, 'minutes');
//         }
//         if (durations.seconds) {
//             result = result.add(durations.seconds, 'seconds');
//         }
//     }

//     return result.toDate();
// }

export function parsePubDate(dateString: string | undefined, timezoneOffset?: string): Date | null {
    if (!dateString?.trim()) {
        return null;
    }

    let cleaned = dateString.trim();

    try {
        // chrono parses and returns UTC
        // const date = chrono.parseDate(cleaned);
        // if (!date) {
        //     return null;
        // }

        const hasTimezone = /GMT|UTC|[+-]\d{2}:\d{2}|[+-]\d{4}|\b[A-Z]{3,4}\b/.test(cleaned);
        if (!hasTimezone && timezoneOffset) {
            const offset = Number.parseFloat(timezoneOffset);
            if (!Number.isNaN(offset)) {
                const sign = offset >= 0 ? '+' : '';
                const hours = Math.floor(Math.abs(offset));
                const minutes = Math.round((Math.abs(offset) % 1) * 60);
                cleaned = `${cleaned} GMT${sign}${hours}${minutes > 0 ? ':' + minutes.toString().padStart(2, '0') : ''}`;
            }
        }

        const date = chrono.parseDate(cleaned);

        // If source timezone is different, adjust
        // E.g., if source is UTC+3 but chrono parsed as UTC, add 3 hours
        // const hasTimezone = /GMT|UTC|[+-]\d{2}:\d{2}|[+-]\d{4}|\b[A-Z]{3,4}\b/.test(cleaned);
        // if (timezoneOffset && !hasTimezone) {
        //     const offset = Number.parseFloat(timezoneOffset);
        //     const serverTimezone = new Date().getTimezoneOffset() / 60;
        //     if (!Number.isNaN(offset)) {
        //         return new Date(date.getTime() - (offset + serverTimezone) * 60 * 60 * 1000);
        //     }
        // }

        return date;
    } catch (error: any) {
        logger.error(`[_transform/utils/parsePubDate] error: ${error.message}`);
        return null;
    }
}

export async function fetchContent(
    url: string,
    routeParams: {
        useBrowser: string;
        waitUntil: string;
        encoding: string;
    },
    waitForSelector?: string | string[],
    selectorTimeout: number = 10000
) {
    const { useBrowser, waitUntil, encoding } = routeParams;
    const decoder = new TextDecoder(encoding);

    if (useBrowser === '1') {
        const { page, destory } = await getPuppeteerPage(url, {
            gotoConfig: { waitUntil: waitUntil as 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' },
        });

        try {
            if (waitForSelector) {
                const selectors = Array.isArray(waitForSelector) ? waitForSelector : [waitForSelector];

                try {
                    logger.info(`[_transform/utils/fetchContent] Waiting for selectors: ${selectors.join(', ')}`);

                    // Race: wait for whichever selector appears first
                    await Promise.race(
                        selectors.map((selector) =>
                            page.waitForSelector(selector, {
                                timeout: selectorTimeout,
                                visible: true,
                            })
                        )
                    );

                    logger.info(`[_transform/utils/fetchContent] Selector found, proceeding...`);
                } catch (error: any) {
                    logger.warn(`[_transform/utils/fetchContent] Error: ${error.message}`);
                    logger.warn(`[_transform/utils/fetchContent] No selectors found within ${selectorTimeout}ms, continuing...`);
                }
            } else {
                await new Promise((resolve) => setTimeout(resolve, 4000));
            }

            const content = await page.evaluate(() => document.documentElement.outerHTML);

            if (content.includes('<pre') && content.includes('&lt;')) {
                const $ = load(content, { xmlMode: false });
                const preContent = $('pre').first().html();
                if (preContent) {
                    const decoded = $('<div>').html(preContent).text();
                    logger.info('[_transform/utils/unwrapEncodedXML] Detected HTML-wrapped XML, unwrapping...');
                    return decoded;
                }
            }

            return content;
        } finally {
            await destory();
        }
    }

    const response = await got({
        method: 'get',
        url,
        responseType: 'arrayBuffer',
    });

    return decoder.decode(response.data);
}
