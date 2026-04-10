# 프로그램 매뉴얼 사이트

노션 페이지를 그대로 보여주는 매뉴얼 사이트입니다.

## 구조
```
notion-manual/
├── server.js        # Express 백엔드 (Notion API 프록시)
├── public/
│   └── index.html   # 프론트엔드 (검색, 카테고리, 내용 렌더링)
├── package.json
└── .env.example
```

## Render 배포 방법

### 1. 노션 Integration 설정
1. https://www.notion.so/my-integrations 접속
2. 기존 HR FAQ용 Integration이 있으면 그대로 사용 가능
3. Integration Token 복사 (`secret_xxx...`)
4. 매뉴얼 노션 페이지 → 우측 상단 `...` → `Connections` → Integration 연결

### 2. Render 배포
1. GitHub에 이 폴더 업로드
2. Render → New Web Service → GitHub 연결
3. Build Command: `npm install`
4. Start Command: `node server.js`

### 3. Render 환경변수 설정
| Key | Value |
|-----|-------|
| `NOTION_TOKEN` | `secret_xxxx...` |
| `ROOT_PAGE_ID` | `dcd4686d95924e32934f961177c48045` |

## 지원하는 노션 블록
- 텍스트, 제목 (H1/H2/H3)
- 불릿 리스트, 번호 리스트, 체크리스트
- 이미지 (내부 업로드 + 외부 URL 모두)
- 콜아웃, 인용, 코드 블록
- 토글, 구분선
- 표 (table)
- 컬럼 레이아웃
- 하위 페이지 링크
- 텍스트 서식 (굵게, 기울임, 색상 등)
