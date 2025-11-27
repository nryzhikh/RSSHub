#!/bin/bash

# Quick test script for _transform/rss route
# Usage: ./test-rss.sh [url] [usePuppeteer]
# https://rsshub.nryzhikh.dev/rsshub/transform/html/https://matchtv.ru/news/football/item=a.node-news-list__item&itemDesc=.node-news-list__title&itemPubDate=.credits__list li:first-child

BASE_URL="http://localhost:1200/_transform/rss"

# Default test URL (a known RSS feed)
# TEST_URL="https://matchtv.ru/news/football"
# TEST_URL="https://www.liveresult.ru/football/matches/rss"
# TEST_URL="https://metaratings.ru/rss/news"
# TEST_PARAMS="useBrowser=0&itemDescription=yandex:full-text&itemStatus=status"
# TEST_URL="https://www.squawka.com/en/news/feed"
TEST_URL="https://www.championat.com/rss/article/football"
# TEST_URL="https://www.sport-express.ru/services/materials/news/football/se"
TEST_PARAMS="useBrowser=1&bob=31231231"


# URL encode
ENCODED_URL=$(node -e "console.log(encodeURIComponent('$TEST_URL'))")
ENCODED_PARAMS=$(node -e "console.log(encodeURIComponent('$TEST_PARAMS'))")
FULL_URL="${BASE_URL}/${ENCODED_URL}/${ENCODED_PARAMS}"
RESPONSE=$(curl -s "$FULL_URL")

echo "$RESPONSE"
echo "$FULL_URL"