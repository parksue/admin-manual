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
const DB_ID = process.env.CATEGORY_DB_ID;
const NOTION_VERSION = '2022-06-28';

function notionHeaders() {
  return {
    'Authorization': `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

// ─── 캐시 ───────────────────────────────────────────
let cache = { categories: null, articles: {}, allArticles: null, time: 0 };
const TTL = 5 * 60 * 1000; // 5분

async function getDB() {
  if (cache.categories && Date.now() - cache.time < TTL) return;
  const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({ page_size: 100, sorts: [{ property: 'Sort', direction: 'ascending' }] })
  });
  const data = await res.json();
  const pages = data.results || [];

  const getTitle = p => (p.properties?.Name?.title || []).map(x => x.plain_text).join('') || '제목 없음';
  const getType  = p => p.properties?.['Page Type']?.select?.name || '';
  const getDesc  = p => (p.properties?.Description?.rich_text || []).map(x => x.plain_text).join('');
  const getParent= p => (p.properties?.['KB Parent']?.rich_text || []).map(x => x.plain_text).join('').trim();

  cache.categories = pages
    .filter(p => getType(p) === 'kb:category' && !getParent(p))
    .map(p => {
      let icon = '📄';
      if (p.icon?.type === 'emoji') icon = p.icon.emoji;
      else if (p.icon?.type === 'external') icon = p.icon.external.url;
      else if (p.icon?.type === 'file') icon = p.icon.file.url;
      return { id: p.id, title: getTitle(p), desc: getDesc(p), icon };
    });

  cache.articles = {};
  cache.allArticles = [];
  pages.filter(p => ['kb:article','kb:sub-category'].includes(getType(p))).forEach(p => {
    const parent = getParent(p);
    const item = { id: p.id, title: getTitle(p), type: getType(p), parentName: parent };
    if (!cache.articles[parent]) cache.articles[parent] = [];
    cache.articles[parent].push(item);
    cache.allArticles.push(item);
  });

  cache.time = Date.now();
}

// 서버 시작 시 미리 로드
getDB().catch(() => {});
// 4분마다 갱신
setInterval(() => getDB().catch(() => {}), 4 * 60 * 1000);

// ─── API ─────────────────────────────────────────────
app.get('/api/categories', async (req, res) => {
  try { await getDB(); res.json(cache.categories || []); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/articles/:cat', async (req, res) => {
  try {
    await getDB();
    res.json(cache.articles[decodeURIComponent(req.params.cat)] || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/all-articles', async (req, res) => {
  try { await getDB(); res.json(cache.allArticles || []); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// 하위 페이지 lazy load
app.get('/api/children/:pageId', async (req, res) => {
  try {
    const r = await fetch(`https://api.notion.com/v1/blocks/${req.params.pageId}/children?page_size=100`, { headers: notionHeaders() });
    const data = await r.json();
    const children = (data.results || []).filter(b => b.type === 'child_page').map(b => ({ id: b.id, title: b.child_page.title }));
    res.json(children);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 페이지 내용
async function fetchBlocks(id) {
  const r = await fetch(`https://api.notion.com/v1/blocks/${id}/children?page_size=100`, { headers: notionHeaders() });
  const data = await r.json();
  if (!data.results) return [];
  const blocks = [];
  for (const b of data.results) {
    const block = { ...b };
    if (b.has_children && b.type !== 'child_page') block.children = await fetchBlocks(b.id);
    blocks.push(block);
  }
  return blocks;
}

app.get('/api/page/:pageId', async (req, res) => {
  try {
    const [metaRes, blocks] = await Promise.all([
      fetch(`https://api.notion.com/v1/pages/${req.params.pageId}`, { headers: notionHeaders() }),
      fetchBlocks(req.params.pageId)
    ]);
    const meta = await metaRes.json();
    const tp = meta.properties?.Name?.title || meta.properties?.title?.title || [];
    res.json({ title: tp.map(t => t.plain_text).join(''), blocks });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 이미지 프록시
app.get('/api/image', async (req, res) => {
  try {
    const blockId = req.query.blockId;
    let url = decodeURIComponent(req.query.url);
    if (blockId) {
      const r = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, { headers: notionHeaders() });
      const b = await r.json();
      url = b.image?.file?.url || b.image?.external?.url || url;
    }
    const imgRes = await fetch(url);
    res.set('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=1800');
    imgRes.body.pipe(res);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
