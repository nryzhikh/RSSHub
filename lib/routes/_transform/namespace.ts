import type { Namespace } from '@/types';

export const namespace: Namespace = {
    name: 'Custom transform',
    description: `
Enhanced transformation routes with optional Puppeteer support for JavaScript-rendered content.

These routes extend the standard transform functionality with the ability to use headless browsers
for sites that require JavaScript execution to render content.

Available transformations:
- **General**: Parse any HTML/RSS content using CSS selectors (/_transform/)
- **RSS**: Dedicated RSS/Atom feed transformer with auto-extraction and custom field mapping (/_transform/rss/)
    `,
};
