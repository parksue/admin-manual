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
const ROOT_PAGE_ID = process.env.ROOT_PAGE_ID || 'dcd4686d95924e32934f961177c48045';
const NOTION_VERSION = '2022-06-28';

function notionHeaders() {
  return {
    'Authorization': `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

// 루트 페이지의 하위 페이지 목록 (카테고리)
app.get('/api/categories', async (req, res) => {
  try {
    const response = await fetch(
      `https://api.notion.com/v1/blocks/${ROOT_PAGE_ID}/children?page_size=100`,
      { headers: notionHeaders() }
    );
    const data = await response.json();

    if (!data.results) return res.status(500).json({ error: 'Notion API error', detail: data });

    // child_page 블록만 카테고리로 사용
    const categories = data.results
      .filter(b => b.type === 'child_page')
      .map(b => ({
        id: b.id,
        title: b.child_page.title,
        type: 'page',
      }));

    res.json(categories);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 특정 페이지의 하위 페이지 목록 (세부 카테고리)
app.get('/api/subpages/:pageId', async (req, res) => {
  try {
    const response = await fetch(
      `https://api.notion.com/v1/blocks/${req.params.pageId}/children?page_size=100`,
      { headers: notionHeaders() }
    );
    const data = await response.json();
    if (!data.results) return res.status(500).json({ error: 'Notion API error', detail: data });

    const subpages = data.results
      .filter(b => b.type === 'child_page')
      .map(b => ({
        id: b.id,
        title: b.child_page.title,
      }));

    // 하위 페이지가 없으면 비어있다고 표시
    res.json(subpages);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 특정 페이지 블록 내용 가져오기 (재귀적으로 children 포함)
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
    if (block.has_children) {
      b.children = await fetchBlocks(block.id);
    }
    blocks.push(b);
  }
  return blocks;
}

app.get('/api/page/:pageId', async (req, res) => {
  try {
    // 페이지 메타정보
    const metaRes = await fetch(
      `https://api.notion.com/v1/pages/${req.params.pageId}`,
      { headers: notionHeaders() }
    );
    const meta = await metaRes.json();

    // 페이지 블록
    const blocks = await fetchBlocks(req.params.pageId);

    let title = '';
    if (meta.properties) {
      const titleProp = meta.properties.title || meta.properties.Name;
      if (titleProp && titleProp.title) {
        title = titleProp.title.map(t => t.plain_text).join('');
      }
    }

    res.json({ title, blocks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 노션 이미지 프록시 (만료 방지)
app.get('/api/image', async (req, res) => {
  try {
    const url = decodeURIComponent(req.query.url);
    const imgRes = await fetch(url);
    res.set('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    imgRes.body.pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
