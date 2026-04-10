require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.CATEGORY_DB_ID || '33e008a1606380c0944ef8f9c21319b0';
const NOTION_VERSION = '2022-06-28';

function notionHeaders() {
  return {
    'Authorization': `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

async function queryDB() {
  const response = await fetch(
    `https://api.notion.com/v1/databases/${DB_ID}/query`,
    {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({ page_size: 100, sorts: [{ property: "Sort", direction: "ascending" }] }) // Publish 필터 일단 제거
    }
  );
  const data = await response.json();
  return data;
}

function getTitle(page) {
  const t = page.properties?.Name?.title;
  return t ? t.map(x => x.plain_text).join('') : '제목 없음';
}
function getPageType(page) {
  return page.properties?.['Page Type']?.select?.name || '';
}
function getDescription(page) {
  const t = page.properties?.Description?.rich_text;
  return t ? t.map(x => x.plain_text).join('') : '';
}
function getParentName(page) {
  const t = page.properties?.['KB Parent']?.rich_text;
  return t ? t.map(x => x.plain_text).join('').trim() : '';
}

// 디버그용 - DB 전체 raw 응답
app.get('/api/debug', async (req, res) => {
  try {
    const data = await queryDB();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 카테고리 목록
app.get('/api/categories', async (req, res) => {
  try {
    const data = await queryDB();
    const pages = data.results || [];
    console.log('전체 페이지 수:', pages.length);
    pages.forEach(p => {
      console.log('페이지:', getTitle(p), '| 타입:', getPageType(p), '| 부모:', getParentName(p));
    });
    const categories = pages
      .filter(p => getPageType(p) === 'kb:category' && !getParentName(p))
      .map(p => ({
        id: p.id,
        title: getTitle(p),
        desc: getDescription(p),
        icon: p.icon?.emoji || '📄',
      }));
    res.json(categories);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/articles/:categoryTitle', async (req, res) => {
  try {
    const data = await queryDB();
    const pages = data.results || [];
    const catTitle = decodeURIComponent(req.params.categoryTitle);
    const articles = pages
      .filter(p => {
        const type = getPageType(p);
        const parent = getParentName(p);
        return (type === 'kb:article' || type === 'kb:sub-category') && parent === catTitle;
      })
      .map(p => ({ id: p.id, title: getTitle(p), type: getPageType(p) }));
    res.json(articles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/all-articles', async (req, res) => {
  try {
    const data = await queryDB();
    const pages = data.results || [];
    const all = pages
      .filter(p => getPageType(p) === 'kb:article')
      .map(p => ({ id: p.id, title: getTitle(p), parentName: getParentName(p) }));
    res.json(all);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function fetchBlocks(blockId) {
  const response = await fetch(
    `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`,
    { headers: notionHeaders() }
  );
  const data = await response.json();
  if (!data.results) return [];
  const blocks = [];
  for (const block of data.results) {
    const b = { ...block };
    if (block.has_children) b.children = await fetchBlocks(block.id);
    blocks.push(b);
  }
  return blocks;
}

app.get('/api/page/:pageId', async (req, res) => {
  try {
    const metaRes = await fetch(
      `https://api.notion.com/v1/pages/${req.params.pageId}`,
      { headers: notionHeaders() }
    );
    const meta = await metaRes.json();
    const blocks = await fetchBlocks(req.params.pageId);
    const titleProp = meta.properties?.Name?.title || meta.properties?.title?.title;
    const title = titleProp ? titleProp.map(t => t.plain_text).join('') : '';
    res.json({ title, blocks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/image', async (req, res) => {
  try {
    const url = decodeURIComponent(req.query.url);
    const blockId = req.query.blockId;

    let imageUrl = url;
    if (blockId) {
      try {
        const blockRes = await fetch(
          `https://api.notion.com/v1/blocks/${blockId}`,
          { headers: notionHeaders() }
        );
        const block = await blockRes.json();
        if (block.image?.file?.url) imageUrl = block.image.file.url;
        else if (block.image?.external?.url) imageUrl = block.image.external.url;
      } catch (e) {}
    }

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error('Image fetch failed: ' + imgRes.status);
    res.set('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=1800');
    imgRes.body.pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
