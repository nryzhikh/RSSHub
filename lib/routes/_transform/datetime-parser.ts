import * as chrono from 'chrono-node';

import logger from '@/utils/logger';

export class DateTimeParser {
    private lastDate: Date | null = null;
    private parser: typeof chrono;
    private offsetMinutes?: number; // offset from GMT in minutes

    constructor(offset?: number | string, locale?: string) {
        const n = Number.parseFloat(String(offset));
        this.offsetMinutes = Number.isFinite(n) ? Math.round(n * 60) : undefined; // e.g. +3 -> +180
        this.parser = locale ? chrono[locale.toLowerCase().trim()] || chrono : chrono;
    }

    parse(dateStr: string) {
        const trimmed = dateStr.trim();
        logger.info(`[_transform/datetime-parser] trimmed: ${trimmed}`);

        let date = new Date(dateStr);
        if (!Number.isNaN(date.getTime())) {
            return date;
        }

        date = this.parser.parseDate(trimmed, {
            timezone: this.offsetMinutes ?? 'UTC',
        });
        logger.info(`[_transform/datetime-parser] date: ${date}`);
        if (!date) {
            return;
        }

        if (this.lastDate && date.getTime() > this.lastDate.getTime()) {
            date.setTime(date.getTime() - 24 * 60 * 60 * 1000);
        }
        this.lastDate = date;
        return date;
    }
}
