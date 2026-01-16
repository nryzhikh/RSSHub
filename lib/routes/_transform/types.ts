export type RouteParams = {
    feed?: Feed;
    item?: string;
    content?: string;
    exclude?: string;
    include?: string;
    contentText?: string;
    media?: string | { element: string; attrs?: string[] };
    useBrowser?: boolean;
    maxItems?: number;
    filterCategory?: string[];
    timezoneOffset?: number;
    locale?: 'de' | 'fr' | 'ja' | 'pt' | 'nl' | 'zh' | 'ru' | 'es' | 'uk' | 'it' | 'sv';
};
export type Attr = string;
export type FeedItem = string | { element: string; attr?: Attr };

export type Feed = {
    title?: FeedItem;
    description?: FeedItem;
    pubDate?: FeedItem;
    author?: FeedItem;
    category?: FeedItem;
    guid?: FeedItem;
    link?: FeedItem;
    enclosure?: FeedItem;
};
