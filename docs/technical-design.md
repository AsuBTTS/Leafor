# Leafor — 技术设计文档（Technical Design Specification）

> **版本**：v0.1 · 技术架构基线  
> **日期**：2026-11-19  
> **产品**：Leafor  
> **对应需求基线**：《本地作品集与创作工作台 — 产品规格说明书》Spec v0.3，以及后续确认的产品名称和视觉要求  
> **目标**：作为架构评审、代码仓库初始化、模块开发和自动化验收的共同依据  
> **状态说明**：`[确定]` 已达成的产品/技术决策；`[方案]` 推荐实现；`[验证]` 开发前需要做技术验证；`[延期]` 后续里程碑实现

---

## 0. 决策摘要

| 决策项 | 方案 | 状态 |
|---|---|---|
| 产品定位 | 单机、离线、本地优先的作品档案馆与创作工作台 | [确定] |
| 桌面容器 | **Tauri 2** | [确定] |
| 主要开发语言 | **TypeScript**，前端 React；原生功能使用 Rust / Tauri 插件 | [确定] |
| UI 构建 | React + Vite + TypeScript + CSS Modules + CSS Variables | [方案] |
| 本地持久化 | Markdown、图片、PDF 和 JSON 文件为权威数据；SQLite 为可重建索引 | [确定/方案] |
| 文本编辑 | CodeMirror 6 + Markdown 源码保真；编辑 / 预览 / 分屏 | [确定/方案] |
| 数学公式 | remark-math + rehype-katex / KaTeX | [方案] |
| Markdown 渲染 | unified / remark / rehype，带 HTML 安全过滤 | [方案] |
| 外部 PDF | PDF.js 只读查看，原文件字节不变，标签/备注保存在旁路元数据 | [确定] |
| 图书成品 PDF | 从 Markdown + 排版配置生成新 PDF，PDF.js 预览；不编辑 PDF | [确定，P1] |
| Word / 多格式转换 | Pandoc 候选，须通过转换保真和打包验证 | [验证，P1] |
| 视觉 | **宋体、深青绿色与白灰色、极窄导航栏、2D 平面竖向矩形封面** | [确定] |
| 云端 | 不登录、不依赖 API、不提供云存储或同步 | [确定] |

**架构主线**：`本地工作区 → 作品集合 Collection → 单品 Item → 内容单元 Content Unit → 编辑 / 阅读 / 管理 / 导出`。

**技术边界**：首版无需自行开发复杂 Rust 服务。常规系统能力优先采用 Tauri 官方插件；为了安全写入、目录隔离或事务式导入而需要的原生操作，可增加**少量、明确边界的 Rust 命令**。不会为了使用 Rust 而把 Markdown 解析、UI、业务状态全部搬进 Rust。

---

## 1. 目标、范围与约束

### 1.1 功能覆盖

Leafor 支持以下单品类型，它们可以混合放进同一个 Collection：

| Item 类型 | 持久化内容 | 专属视图 | 核心组织方式 |
|---|---|---|---|
| `book` 图书 | 多个 `.md` 章节 + 封面/插图 | 章节目录、Markdown 编辑、连续/可选双页阅读 | 章节顺序 |
| `photo_album` 摄影集 | 图片源文件 + 独立元数据 | 照片网格、单张浏览 | 相册内顺序、分组 |
| `blog` 博客集 | 独立 `.md` 博文 | 博客时间线、草稿区、文章阅读 | 发布日期 |
| `article_series` 系列文章 | 独立 `.md` 文章 | 有序目录、上一篇/下一篇 | 用户自定义顺序、分卷 |
| `document` 纯文本 | 单个 `.md` | 编辑 / 预览 / 分屏 | 文档自身 |
| `pdf` 外部 PDF 对象 | 导入的原始 `.pdf` | 只读 PDF 阅读器 | 原始页码、内置书签目录 |

统一支持 Item 和 Content Unit 两级状态与标签；例如单张照片可以标记 `待P图`，章节可以标记 `待校对`，博客文章可以标记 `草稿`。状态词条、标签词条由用户维护。

### 1.2 明确不做

- 不建设云端服务、用户账户、同步 API、在线协作。
- **不开发 PDF 编辑器**：不修改外部 PDF 页面正文、版式、图层、文字或原文件元数据；不做 PDF → 可编辑 Markdown、PDF OCR 拆章。
- 不内置修图软件；摄影集的“待P图”仅是管理标记。
- 首版不做复杂的所见即所得双页原位编辑和输入时实时重分页；保留未来扩展接口。
- 首版不制作带书脊、透视、实体厚度的 3D 封面；书页也不采用仿真书脊或夸张投影。

### 1.3 非功能目标

1. **可迁移**：完整复制工作区文件夹到新设备或路径后，可再次打开，重建缓存，不依赖机器特定数据库。
2. **安全写入**：保存、重命名、导入失败时不损坏已有源文件；冲突不得静默覆盖。
3. **离线**：拔掉网络后，所有本地阅读、编辑、标签、搜索和已安装的转换功能继续工作。
4. **轻量**：缩略图按需加载，大文件分批处理；编辑长文档时避免整库重渲染。
5. **平台**：优先完成 Windows 版本，架构兼容 macOS / Linux；各平台字体与文件权限需单独验证。
6. **可测试**：业务逻辑、持久化、转换、PDF 只读和核心 UI 行为具备自动化测试入口。

---

## 2. 总体架构

```text
┌────────────────────────── Leafor.exe ───────────────────────────┐
│ Tauri 2：窗口 / 菜单 / 权限 / 本地对话框 / 安装与更新机制（离线优先） │
│                                                                │
│  ┌──────────────────── React + TypeScript ──────────────────┐  │
│  │ App Shell：窄图标栏 / 作品库 / 集合页 / 单品工作台          │  │
│  │                                                          │  │
│  │ Features                                                 │  │
│  │  Library | Book | Photos | Blog | Series | Document | PDF │  │
│  │                                                          │  │
│  │ Shared                                                   │  │
│  │  CodeMirror | Markdown Renderer | LaTeX | Tags | Search  │  │
│  │                                                          │  │
│  │ Services（TypeScript）                                    │  │
│  │  LibraryService / ContentService / ImportExportService   │  │
│  │  SearchService / PreviewService / SettingsService        │  │
│  └────────────────────────────┬─────────────────────────────┘  │
│                               │ Tauri invoke / plugins         │
│  ┌────────────────────────────▼─────────────────────────────┐  │
│  │ 原生访问层：官方 fs / dialog / sql / shell 插件           │  │
│  │ 必要时：少量 Rust 命令（安全写入、批量导入、原子性操作）   │  │
│  └──────────────┬────────────────────────────┬──────────────┘  │
└─────────────────┼────────────────────────────┼─────────────────┘
                  ▼                            ▼
         Workspace 文件树             AppData / SQLite 可重建索引
       .md / .json / 图片 / PDF       缩略图缓存 / 搜索缓存 / 最近记录
```

### 2.1 分层职责

**表现层（React）**：组件、状态展示、键盘快捷键、编辑器挂载、虚拟列表和排版视图。不得直接把数据库行结构当作界面领域对象。

**领域层（TypeScript）**：Collection、Item、Content Unit、状态/标签、排序、章节导航、博客发布时间线、系列前后篇规则。

**持久化层（TypeScript 接口 + Tauri 能力）**：JSON 与 Markdown 读写、图片/PDF 复制、路径解析、变更监听、索引重建、批量操作。对 UI 暴露稳定的仓储接口。

**原生层（Rust）**：只在官方插件不能满足写入完整性、跨文件事务、受控权限或高性能批量文件操作时实现，必须限制路径到当前授权工作区。

### 2.2 依赖方向

```text
pages → features → domain + application services → repositories / ports
                                                ↓
                                       Tauri adapters
```

业务类型定义和接口不应从 Tauri 插件直接导入，以便使用 Node 测试替身、模拟文件仓库和更换索引实现。

---

## 3. 技术栈与版本策略

| 层次 | 首选依赖 | 选择理由 | 验证点 |
|---|---|---|---|
| 桌面 | Tauri 2 + Rust toolchain | 轻量窗口、系统 WebView、原生能力和跨平台 | WebView2 安装/兼容、文件权限 |
| UI | React + TypeScript + Vite | 组件化、生态成熟、便于快速迭代 | 中文输入法、React 严格模式 |
| 样式 | CSS Modules + CSS Variables | 精确实现 Leafor 专属极简界面 | 系统缩放与字体回退 |
| 图标 | Lucide React | 细线图标，符合窄侧栏 | 统一笔画与基线 |
| 路由 | React Router（候选） | 作品库 → Collection → Item → 内容单元 | 页面恢复与深链接 |
| UI 状态 | Zustand（候选） | 侧栏、选择、工作台状态 | 避免状态分裂 |
| 编辑 | CodeMirror 6 / `@codemirror/lang-markdown` | Markdown 文本、撤销、语法高亮 | 大文档与中文 IME |
| MD 预览 | remark-parse + remark-gfm + remark-rehype + rehype | 可控解析、表格等扩展 | 相对图片与未知语法 |
| 数学 | remark-math + rehype-katex + KaTeX CSS | 数学公式显示 | 公式错误提示、字体 |
| HTML 保护 | rehype-sanitize（定制 schema） | 限制脚本和危险属性 | 本地文件 URL 与公式标记 |
| PDF 阅读 | pdfjs-dist / PDF.js | 只读页绘制、目录、缩放 | 大文件、加密 PDF、CJK 字体 |
| 数据索引 | SQLite + Tauri SQL plugin | 本地、无需独立服务 | 位置、迁移、损坏后重建 |
| 文件访问 | Tauri fs + dialog plugins | 文件系统操作与文件选择 | 权限 scope、重启后的 scope |
| 文档转换 | Pandoc（P1 候选） | DOCX ↔ Markdown、HTML 等 | 转换质量、sidecar 打包 |
| 排版 | HTML/CSS print + Paged.js（P1 候选） | Markdown 图书出版样式 | 分页、可复现 PDF 输出 |
| 测试 | Vitest + React Testing Library + Playwright + Rust tests | 领域、组件和端到端覆盖 | 真机权限和文件失败场景 |

**版本规则**：使用锁文件固定 JS 依赖，用 `Cargo.lock` 固定 Rust 依赖；初始化时选取当时稳定且彼此兼容的正式版本，避免无验证地追逐最新主版本。`Milkdown` 保留为后续可选的所见即所得编辑适配器，初版以 CodeMirror 为主，避免 Markdown 往返转换破坏源文。

---

## 4. 代码仓库与模块边界

```text
leafor/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── router.tsx
│   │   ├── providers/
│   │   └── styles/               # tokens.css / global.css / fonts.css
│   ├── domain/
│   │   ├── models/               # Workspace, Collection, Item, ContentUnit
│   │   ├── schemas/              # Zod / JSON schema
│   │   └── policies/             # 文章排序、类型规则、状态规则
│   ├── services/
│   │   ├── library/
│   │   ├── content/
│   │   ├── persistence/
│   │   ├── import-export/
│   │   ├── search/
│   │   └── preview/
│   ├── adapters/
│   │   ├── tauri/
│   │   └── mock/                 # 测试专用
│   ├── features/
│   │   ├── library/
│   │   ├── collections/
│   │   ├── book/
│   │   ├── photography/
│   │   ├── blog/
│   │   ├── series/
│   │   ├── document/
│   │   ├── pdf/
│   │   ├── tags-status/
│   │   └── settings/
│   ├── components/
│   │   ├── navigation/
│   │   ├── editor/
│   │   ├── markdown/
│   │   ├── forms/
│   │   └── feedback/
│   ├── hooks/
│   └── tests/
├── src-tauri/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── tauri.conf.json
│   ├── capabilities/
│   ├── src/
│   │   ├── lib.rs
│   │   └── commands/            # 需要时添加 scoped FS 命令
│   └── migrations/              # SQL 索引迁移
├── tests/
│   ├── fixtures/                # 测试图书、博文、相册与 PDF
│   └── e2e/
└── docs/
    ├── product-spec.md
    ├── technical-design.md
    └── decisions/              # ADR：重要技术决策
```

**模块隔离规则**：

1. `features/book` 与 `features/blog` 复用同一 `MarkdownEditor` 和渲染器。
2. 各内容类型通过 `ItemRendererRegistry` 按 `type` 匹配工作台，禁止在主页组件堆积全部业务分支。
3. `features/pdf` 只能得到 `PdfReadService` 及“外部元数据编辑”能力，不注入 Markdown 保存器。
4. `src/domain` 只声明纯 TypeScript 类型和规则，不依赖 React、Tauri、PDF.js。
5. 不允许直接从界面组件拼接真实磁盘路径；由 WorkspaceRepository 统一解析。

---

## 5. 领域模型与类型定义

### 5.1 通用模型

```ts
type UUID = string;
type RelativePath = string;
type ItemType =
  | "book"
  | "photo_album"
  | "blog"
  | "article_series"
  | "document"
  | "pdf";

type UnitType = "chapter" | "photo" | "post" | "series_article" | "text";

interface TagDefinition {
  id: UUID;
  name: string;
  color?: string;
}

interface StatusDefinition {
  id: UUID;
  name: string;       // "待P图" / "待校对" 等
  color?: string;
  order: number;
}

interface ContentUnit {
  id: UUID;
  type: UnitType;
  title: string;
  path: RelativePath;
  order: number;
  statusId?: UUID | null;
  tagIds: UUID[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface ItemBase {
  id: UUID;
  type: ItemType;
  title: string;
  coverPath?: RelativePath;
  summary?: string;
  statusId?: UUID | null;
  tagIds: UUID[];
  createdAt: string;
  updatedAt: string;
}

interface Collection {
  id: UUID;
  title: string;
  itemIds: UUID[];  // 所属 Item 的稳定顺序
  coverPath?: RelativePath;
  summary?: string;
}
```

上述类型是**逻辑接口草案**。进入实现时应通过可判别联合类型为不同 `Item` 定义特定字段，杜绝 `pdf`、`book` 等类型中出现不合规属性。

### 5.2 类型扩展字段

```ts
interface BookData {
  type: "book";
  chapters: ContentUnit[];       // type 必须为 chapter
  layoutProfilePath?: RelativePath;
  author?: string;
}
interface PhotoAlbumData {
  type: "photo_album";
  photos: ContentUnit[];         // type 必须为 photo
}
interface BlogData {
  type: "blog";
  posts: Array<ContentUnit & {
    publishedAt: string | null;  // null 表示未发布草稿
    slug?: string;
    excerpt?: string;
  }>;
}
interface SeriesData {
  type: "article_series";
  articles: Array<ContentUnit & { groupId?: UUID }>;
  groups?: Array<{ id: UUID; title: string; order: number }>;
}
interface DocumentData {
  type: "document";
  content: ContentUnit;          // type 必须为 text
}
interface ImportedPdfData {
  type: "pdf";
  sourcePath: RelativePath;      // 工作区内 PDF 副本
  sha256AtImport: string;
  pageCount?: number;
  importedAt: string;
  readerState?: { lastPage?: number; zoom?: number };
}
```

**规则**：
- Collection 不限制 Item 类型；一个集合可以同时拥有图书、摄影集、系列文章及 PDF。
- Item 的 `statusId` 与章节/照片/博文的 `statusId` 独立，内容单元标记不自动覆盖父级。
- 每个 Content Unit 可拥有多个标签，默认一个主状态；后续可扩展为多工作流状态。
- `publishedAt` 与 `statusId` 分开存；博客按发布时间展示，系列以 `order` 展示。
- ID 使用 UUID，排序不依赖文件名、创建日期或标题。
- 模型支持未来将系列**复制或引用**为图书章节，但首版不做隐式跨类型内容共享。

---

## 6. 工作区文件组织（权威数据）

### 6.1 目录布局

```text
LeaforLibrary/
├── .leafor/
│   ├── workspace.json             # 工作区标识 / schema / 词条定义
│   ├── recovery/                  # [方案] 尚未恢复的编辑草稿
│   └── trash/                     # [方案] 应用内软删除
└── collections/
    └── literature--c_7e2f/
        ├── collection.json
        └── items/
            ├── clocks--i_1001/
            │   ├── item.json
            │   ├── cover.jpg
            │   ├── chapters/
            │   │   ├── introduction.md
            │   │   └── chapter-01.md
            │   ├── assets/
            │   │   └── illustration-01.png
            │   ├── layouts/
            │   │   └── print.json
            │   └── originals/
            │       └── source.docx
            ├── photos--i_1002/
            │   ├── item.json
            │   └── photos/
            │       ├── 001.jpg
            │       └── 002.jpg
            ├── blog--i_1003/
            │   ├── item.json
            │   └── posts/
            │       └── 2026-essay.md
            ├── series--i_1004/
            │   ├── item.json
            │   └── articles/
            │       └── first.md
            ├── document--i_1005/
            │   ├── item.json
            │   └── content.md
            └── pdf--i_1006/
                ├── item.json
                └── originals/
                    └── original.pdf
```

**路径原则**：`--c_7e2f` 等稳定 ID 片段示意，不要求用户看到这些目录名。重命名标题优先修改 JSON 中的 `title`，文件夹可保持稳定，避免相对资源链接断裂；提供“在文件管理器中打开”入口。

### 6.2 JSON 元数据示例

```json
{
  "schemaVersion": 1,
  "id": "i_1004",
  "type": "article_series",
  "title": "现代音乐与游戏叙事",
  "coverPath": "assets/cover.jpg",
  "statusId": "in_progress",
  "tagIds": ["music", "game"],
  "createdAt": "2026-11-19T00:00:00+08:00",
  "updatedAt": "2026-11-19T00:00:00+08:00",
  "data": {
    "articles": [
      {
        "id": "u_001",
        "type": "series_article",
        "title": "声音、音乐与游戏",
        "path": "articles/first.md",
        "order": 0,
        "statusId": "draft",
        "tagIds": ["music"],
        "createdAt": "2026-11-19T00:00:00+08:00",
        "updatedAt": "2026-11-19T00:00:00+08:00"
      }
    ]
  }
}
```

**路径作用域**：文件相对路径以所属 Item 根目录为基准；工作区全局路径以工作区根目录为基准；不得允许 `../` 逃出根目录。外部导入文件优先**复制到工作区**，原文件保持不变。首次加载需验证 JSON schema 和字段版本，并兼容旧版迁移。

### 6.3 源文件与缓存边界

- **权威**：Markdown 文本、图片、导入 PDF、封面、`collection.json`、`item.json`、`workspace.json`、布局配置。
- **缓存**：SQLite 搜索索引、缩略图、最近打开记录、PDF 临时页面图、生成的预览 PDF。
- **普通导出**：用户指定目录中的 HTML / DOCX / PDF，不能自动覆盖源文件或导入 PDF。
- **备份**：复制整个工作区即可保留全部作品内容与权威元数据；缓存缺失时自动重建。

---

## 7. SQLite 索引设计

### 7.1 存储位置决策

建议首版使用 Tauri 官方 SQL 插件，在**应用数据目录**维护 `leafor-index.db`。其角色是多工作区的**可重建查询缓存**，而非单品内容的唯一存放位置。这样与官方插件默认数据库路径和迁移机制更协调。

工作区迁移到另一台机器时，读取 `.leafor/workspace.json` 和各 Item JSON，重建 SQLite；这满足“本地文件可迁移”。若将来要求索引也随工作区直接移动，可改用最小 Rust SQLite 适配器把 DB 放入工作区 `.leafor/cache/`；不影响应用层接口。

### 7.2 表设计（索引缓存示例）

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  title TEXT NOT NULL,
  indexed_at TEXT
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  title TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  status_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS content_units (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  unit_type TEXT NOT NULL,
  title TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  status_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS object_tags (
  workspace_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('item', 'unit', 'collection')),
  target_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, target_kind, target_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_items_collection ON items(collection_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_units_item ON content_units(item_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_units_published ON content_units(item_id, published_at);

-- FTS5 作为搜索缓存，开发时需检查部署环境 SQLite 是否启用 FTS5。
CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
  workspace_id UNINDEXED,
  target_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61'
);
```

> 注意：FTS5 `unicode61` 对中文分词支持有限，直接用它做中文搜索可能出现预期外结果。**M1** 先实现标题/标签/状态筛选与中文子串查找；**M2** 验证中文分词扩展或单独建立 N-gram 索引，再引入大库正文全文搜索。任一缓存表缺失或损坏，均不影响用户读取原文件。

### 7.3 索引同步

1. 启动时读取已打开工作区 `workspace.json`，校验 schemaVersion。
2. 按 `collection.json` / `item.json` 重建或增量更新结构索引。
3. Markdown 保存后触发相应标题/正文索引更新；照片及 PDF 只更新文件信息和元数据。
4. 外部文件变更由文件监听器发出事件；去抖后重新加载受影响的单品。
5. 首次索引失败仅提示搜索不可用，不阻断编辑与阅读。

---

## 8. Markdown 编辑与渲染架构

### 8.1 数据流

```text
磁盘 .md
   │ readText()
   ▼
CodeMirror 编辑缓冲区 ─────────→ 保存服务 ───────→ 同一 .md
   │                             │
   │ debounce                    └→ 索引更新 / 文件变更通知
   ▼
remark AST → rehype HTML AST → 安全过滤 → React 预览
                    │
                    ├→ KaTeX 公式
                    ├→ 图片相对路径解析
                    └→ 标题大纲 / 章节锚点
```

### 8.2 三种视图

- **编辑**：CodeMirror Markdown 源码模式（支持中文输入、撤销/重做、快捷键、代码块、表格）。
- **预览**：统一 Markdown 渲染器（包含公式、图片、表格、脚注等已支持扩展）。
- **分屏**：左编辑 / 右预览，可设同步滚动（M1 可选）。

图书增加**阅读视图**：章节目录导航，页面/连续阅读，视口宽度足够时可选双页；默认使用简洁平面排版，禁止书脊和 3D 特效。图书、博客、系列文章都复用相同 Markdown 文本组件，差异由外层导航决定。

### 8.3 Markdown 源码保真

1. `.md` 是唯一可信正文；预览 AST 和 HTML 均为衍生表示。
2. **仅切换视图不得重写源 Markdown**。预览使用单向解析，避免改动空行、缩进、LaTeX 或未知语法。
3. 未支持的 Markdown 扩展仍能在 CodeMirror 编辑；预览用安全降级提示，而非删除原文。
4. 如果未来加入 Milkdown 所见即所得模式，先建立往返转换测试，测试未通过则阻止将转换结果写回源文件。
5. 数学约定：`$...$` 行内、`$$...$$` 块级；其他自定义宏需明确支持范围。

### 8.4 图片和链接

- `![alt](assets/photo.jpg)` 按当前 Markdown 文件所在目录解析并限制在允许访问的工作区范围内。
- 图片导入可复制到相应 Item 的 `assets/`，并更新相对引用；不依赖远程 CDN。
- 链接需区分 `http(s)`、工作区相对路径及内部应用导航；默认不在未经用户确认的情况下自动抓取网络资源。
- Markdown 中内嵌 HTML 需通过 `rehype-sanitize` 的安全规则，禁止脚本执行、任意本地文件读取及危险 URL 方案。

---

## 9. 外部 PDF：只读特殊对象

### 9.1 导入与保存

```text
用户选择 source.pdf
  ↓
读取基本信息 + 校验格式
  ↓
复制字节到 Item/originals/original.pdf
  ↓
计算并记录 SHA-256
  ↓
写入 item.json（type="pdf"、标题、标签、状态、备注）
  ↓
生成仅用于目录展示的缩略图
```

**核心约束**：任何标记、备注、阅读进度都只写入旁路元数据；原始 PDF 只允许读取和原样复制。应用保存 PDF 后可复查 SHA-256；不能给外部 PDF 注册“保存正文”“编辑页面”“转换成 Markdown”等动作。

### 9.2 阅读实现

- 使用 PDF.js；从已授权工作区读取 PDF 字节并交给 PDF.js 渲染。
- 支持页码、上一页/下一页、缩放、连续浏览、PDF 内置书签目录（如果存在）、可选缩略图。
- PDF 自带文本层允许时可实现**阅读搜索**；搜索不会回写文件。
- 阅读记录 `lastPage`、`zoom` 保存到 `item.json` 或独立 UI 状态文件。
- 对大 PDF 需验证内存占用与加载策略；M0 可以先用字节读取方式，后续改为受限资产协议或范围加载。
- UI 不展示编辑工具条；右侧大属性栏默认不存在，状态/标签通过紧凑弹窗或可折叠属性区修改。

### 9.3 外部 PDF 与导出 PDF 的区别

| | 外部导入 PDF | Leafor 生成的出版 PDF |
|---|---|---|
| 来源 | 用户原有 `.pdf` | Markdown + `LayoutProfile` |
| 作用 | 只读作品档案对象 | 排版成品预览和导出文件 |
| 能否在 Leafor 中编辑 PDF 本体 | **不能** | **不能** |
| 如何改内容 | 使用外部软件，重新导入/关联原件 | 修改 `.md` 再重新生成 |
| 标记保存 | `item.json` | 源图书元数据 / 导出历史 |

---

## 10. 作品类型工作台实现

### 10.1 图书 Book

- 章节目录来自 Item JSON 中的稳定 `chapters[]` 顺序；创建、重排、删除同时更新元数据。
- 单章独立 `.md`，文件插图位于 `assets/`；可选择连续阅读所有章节。
- 图书阅读模式默认阅读区域最大化，目录可折叠，支持单页/可选双页和按章节跳转。
- P1 支持图书排版配置与 PDF 成品预览；P2 可探索分页阅读中直接编辑。

### 10.2 摄影集 Photo Album

- 批量导入常用图片格式；读取尺寸和 EXIF（存在时），不修改原图。
- 生成小尺寸缩略图用于网格、列表；浏览原图时再按需读取大图。
- 保留拖放顺序；相册照片级标题、说明、状态、标签（如 `待P图`）。
- 支持键盘上一张/下一张、聚焦/全屏；不实现图片像素编辑。

### 10.3 博客集 Blog

- 一篇博文对应一个 `.md` + 独立内容单元元数据。
- 已发布文章按 `publishedAt` 倒序，未发布（`publishedAt=null`）进入草稿分区；状态与发布日期独立。
- 支持时间归档、文章阅读、Markdown 编辑、单篇 Markdown / HTML 导出。
- P1 生成可离线导航的整站 HTML 归档；P2 本地静态站点/RSS 导出，不承担网络部署。

### 10.4 系列文章 Article Series

- 每篇文章独立 `.md`，使用 JSON 中的 `order` 控制顺序。
- 导航显示目录、当前位置、上一篇/下一篇，不依赖发布时间。
- P1 增加分卷/分组，整系列按指定顺序合并或导出为 HTML/DOCX/PDF。
- 从系列汇编成图书应采用显式复制/引用策略，避免破坏原系列。

### 10.5 纯文本 Document

- 单个 `.md`，复用完整编辑/预览/分屏和公式渲染能力。
- 可被 Collection 收录，支持状态、标签、搜索、导出。

---

## 11. 导入、导出与出版排版

### 11.1 导入策略

| 输入 | 目标 | 首版 | 注意 |
|---|---|---|---|
| `.md` | 图书章节/纯文本/博文/系列文章 | P0 | 保留 Markdown、处理相对附件 |
| 常用照片 | 摄影集 | P0 | 批量复制、缓存缩略图、保持原件 |
| `.pdf` | 只读 PDF Item | P0 | 原样复制、校验哈希、独立元数据 |
| `.docx` | 图书章节或 `.md` 文本单元 | P1 | 分章候选、提取插图、留原件 |

DOCX 导入属于**源格式转换**：由独立转换适配器处理，输出 Markdown 工作副本。转换失败不删除导入原件，用户可调整章节拆分结果。

### 11.2 导出策略

| 输出 | 首版 | 方案 |
|---|---|---|
| 原生 Markdown + 附件 | P0 | 直接复制/汇编源文件，保持相对路径有效 |
| HTML | P0 | remark/rehype 渲染并打包所需离线资源 |
| DOCX | P1 | Pandoc 适配器（需验证表格/脚注/公式） |
| PDF（来自 Markdown） | P1 | 根据排版模板生成新 PDF，先预览后保存 |
| 整套博客 HTML 归档 | P1 | 索引页 + 文章页 + 附件与站内链接 |
| 整套系列汇编 | P1 | 按用户指定顺序合并，支持 Markdown/HTML/DOCX/PDF |

### 11.3 布局配置 Layout Profile（P1）

```ts
interface LayoutProfile {
  id: string;
  page: { size: "A4" | "A5" | "B5" | "custom"; widthMm?: number; heightMm?: number };
  marginsMm: { top: number; bottom: number; left: number; right: number };
  typography: {
    fontFamily: string;       // 用户本机可用字体，默认宋体优先
    fontSizePt: number;
    lineHeight: number;
    paragraphIndentEm: number;
    paragraphSpacingPt: number;
  };
  chapters: { startOnNewPage: boolean; startOnOddPage?: boolean };
  headerFooter: { showPageNumbers: boolean; headerText?: string; footerText?: string };
  includeToc: boolean;
}
```

**预览一致性要求**：正式 PDF 由同一排版流水线生成；成品预览直接打开实际生成的临时 PDF 字节，而非用一套独立 HTML 样式模拟最终 PDF。检查满意后将该 PDF 副本导出到用户选择的位置，以避免预览和导出采用不同引擎导致分页漂移。

**技术验证**：Paged.js + print CSS 可负责 HTML 分页规则；若使用固定的 Chromium/headless PDF 生成后端，需要考虑 Tauri sidecar 的跨平台打包、体积与许可。Pandoc 生成 PDF 可能依赖额外排版引擎，不能把“安装 Pandoc”直接等同于“无额外依赖地导出 PDF”。P1 在完成技术验证后选定一条一致的出版流水线。

---

## 12. 原生系统能力与安全权限

### 12.1 首版插件

- `@tauri-apps/plugin-dialog`：选择工作区、导入文件和导出位置。
- `@tauri-apps/plugin-fs`：授权范围内的读、写、复制、创建、监听。
- `@tauri-apps/plugin-sql`：可重建索引缓存和迁移。
- `@tauri-apps/plugin-shell`：**P1 按需**执行受控 Pandoc / headless converter sidecar；不得允许用户内容任意拼接命令行。

### 12.2 权限与路径校验

Tauri 2 的文件插件遵循**命令权限 + 路径 scope**，二者必须同时满足。选择工作区目录后，需为该目录建立受控的访问能力，并验证重启后仍可访问；需要时使用 persisted scope 插件或受限 Rust 命令处理工作区授权。不能为了方便直接授予整个用户主目录的任意读写权。

验证输入路径：

1. 拒绝路径穿越（`..`）和越界绝对路径，统一做 canonicalize 与根目录校验。
2. 明确处理符号链接、Windows junction、大小写差异和 Unicode 文件名。
3. 拒绝把应用缓存/索引文件伪装成允许导入的照片或 PDF。
4. 文件选择对话框得到的路径必须经过独立校验，拷贝/打开遵守 scope。
5. PDF/Markdown/HTML 中的链接仅允许明确许可的目标，防止读取任意本地文件和脚本执行。
6. 离线优先：无遥测、无自动上传；远程媒体不自动加载。

### 12.3 保存的完整性与冲突处理

```text
编辑器内变更
  → 标记 dirty
  → 延时自动保存
  → 检查磁盘内容版本/哈希
  → 写入同目录临时文件
  → flush / 同步（按平台能力）
  → 安全替换目标文件
  → 更新元数据与索引
  → 保存成功提示
```

- 编辑器维护 `lastSavedHash`，检测到外部修改时暂停覆写并提供**比较、重新加载、保留副本**等选择。
- Rust 原生的安全写入命令若使用 rename/replace，需要对 Windows 文件占用、替换行为与异常断电作专项验证；不得宣称简单 `writeTextFile` 自动具有跨平台原子替换保证。
- 重命名、删除、移动操作优先软删除或事务日志。批量导入采用 staging 临时目录，成功后才提交新 Item 元数据。
- `item.json` 与 `.md` 的多文件修改没有天然单一事务；需要以操作日志、顺序提交和启动修复保证可恢复。
- 自动保存建议初始 800–1500ms 去抖；切换文章/关闭窗口时主动 flush，未保存完成则提示。

---

## 13. UI / UX 技术规范（已确认风格）

### 13.1 设计基调

Leafor 的主页应保持**现代极简、安静、平面、阅读优先**。产品中文内容的默认字体使用**宋体体系**。主色是深青绿，底色为白灰；不追求层层嵌套的后台式属性面板。

```css
:root {
  --leafor-primary: #164f47;
  --leafor-primary-hover: #1e665c;
  --leafor-bg: #fafaf8;
  --leafor-surface: #ffffff;
  --leafor-surface-muted: #f1f2f0;
  --leafor-text: #17211f;
  --leafor-muted: #6e7773;
  --leafor-border: #e3e8e4;

  /* 所有中文 UI、标题、导航、正文默认宋体；系统字体按平台回退 */
  --leafor-font-serif:
    "SimSun", "Songti SC", "STSong", "Source Han Serif SC",
    "Noto Serif CJK SC", serif;

  --leafor-icon-rail-width: 52px;
  --leafor-toc-width: 204px;
  --leafor-card-radius: 4px;
}
```

**字体说明**：Windows 首选 SimSun，macOS 首选 Songti SC；无该字体时落到其他宋体/衬线。实现需检测字体存在性，避免静默改为无衬线。第三方字体如需要随软件分发，必须先单独核实许可；目前优先引用用户系统已有字体。

### 13.2 窗口布局

```text
┌────┬─────────────────────────────────────────────────────┐
│Logo│ Leafor                       搜索       视图 / 新建 │
│────┼─────────────────────────────────────────────────────┤
│ ⌂  │ 作品库  · 24 项                                      │
│ ▤  │ 全部  图书  系列文章  博客集  摄影集  纯文本  PDF     │
│ ▧  │                                                     │
│ ✎  │ [2D封面] [2D封面] [2D封面] [2D封面] [2D封面]         │
│ ◇  │  书名      名称      名称      名称      名称          │
│    │                                                     │
│ ⚙  │ [2D封面] [2D封面] [2D封面] [2D封面] [2D封面]         │
└────┴─────────────────────────────────────────────────────┘
```

- **全局导航栏**：仅图标，默认 48–56px，推荐 `52px`；不在主页同时展开第二个宽大导航栏。
- **内容目录**：进入图书、PDF、系列文章后才显示可折叠的 190–220px 目录栏；展开宽度默认 `204px`，允许拖动调节；可一键收起。
- **主页**：大面积主内容区域；封面网格优先，不强加右侧详情属性栏。标签与状态可放轻量弹层。
- **封面**：**平面 2D 竖向矩形**，无 3D 厚度、书脊、侧面或透视；建议常规书籍 2:3 比例。摄影集封面可采用同一网格边框内的照片裁切，不强迫改变原始图片。
- **阅读器**：简短顶栏 + 左侧可隐藏目录 + 中央大区域；普通 PDF 阅读器风格；可选双页仅指平面页面并列，绝不引入实体翻书视觉。
- **输入工具条**：编辑/预览/分屏与常用操作保留；属性面板默认隐藏，随用随开。
- **缩放与窄屏**：主阅读区优先，窗口缩小时目录自动隐藏，卡片按可用宽度动态列数排列。

### 13.3 交互基线

- 图标导航需有悬浮提示和键盘焦点态；全局搜索与创建快捷入口常驻。
- `Ctrl/Cmd+S` 保存，`Ctrl/Cmd+F` 当前文档查找，`Ctrl/Cmd+K` 全局搜索（具体与编辑器快捷键冲突需检查）。
- 拖动 Item、章节、照片和系列文章时给出清晰插入位置。
- `状态`、`标签` 的变更无需打开庞大的右侧属性面板。
- UI 浅色主题为首版基线；深色阅读主题可后续加入，不能改变宋体约束。

---

## 14. 核心服务接口（实现草案）

```ts
interface WorkspaceRepository {
  create(rootPath: string, name: string): Promise<Workspace>;
  open(rootPath: string): Promise<Workspace>;
  inspect(rootPath: string): Promise<WorkspaceValidation>;
  rebuildIndex(workspaceId: string): Promise<void>;
}

interface LibraryRepository {
  listCollections(workspaceId: string): Promise<Collection[]>;
  createCollection(workspaceId: string, title: string): Promise<Collection>;
  createItem(collectionId: string, type: ItemType, title: string): Promise<ItemBase>;
  updateItem(itemId: UUID, patch: Partial<ItemBase>): Promise<void>;
  reorderItems(collectionId: UUID, orderedIds: UUID[]): Promise<void>;
  moveItem(itemId: UUID, targetCollectionId: UUID, position: number): Promise<void>;
  trashItem(itemId: UUID): Promise<void>;
}

interface ContentRepository {
  readMarkdown(unitId: UUID): Promise<{ text: string; hash: string }>;
  saveMarkdown(
    unitId: UUID,
    text: string,
    expectedHash: string
  ): Promise<{ newHash: string }>;
  reorderUnits(itemId: UUID, orderedIds: UUID[]): Promise<void>;
  updateUnitMetadata(unitId: UUID, patch: Partial<ContentUnit>): Promise<void>;
}

interface PdfReadService {
  loadPdf(itemId: UUID): Promise<Uint8Array>;
  readOutline(itemId: UUID): Promise<PdfOutlineNode[]>;
  updateReaderState(itemId: UUID, lastPage: number, zoom: number): Promise<void>;
  verifyOriginal(itemId: UUID): Promise<boolean>;
}

interface ExportService {
  exportMarkdown(targetId: UUID, destination: string): Promise<ExportResult>;
  exportHtml(targetId: UUID, destination: string): Promise<ExportResult>;
  // P1：由 Markdown 生成成品；只返回 PDF 文件，不编辑已有 PDF
  buildPrintPreview(bookId: UUID, profileId: UUID): Promise<PreviewArtifact>;
  savePreviewPdf(previewId: UUID, destination: string): Promise<ExportResult>;
}
```

接口中的 `Workspace`、`WorkspaceValidation`、`PdfOutlineNode` 等公共 DTO 在领域层统一定义；此处展示边界，**不是可直接编译的完整源文件**。

### 14.1 启动与恢复流程

```text
启动 Leafor
  → 读取最近打开工作区记录
  → 请求/恢复目录访问权限
  → 校验 workspace.json schemaVersion
  → 扫描目录并与索引核对
  → 路由到作品库
  → 按需加载封面和内容
  → 检查 recovery 日志并提示恢复
```

### 14.2 创建与编辑流程

```text
新建 Collection
  → 创建 collection.json + Item 容器
新建 Book
  → 创建 item.json + chapters/ + assets/
新建章节
  → 创建单章 .md + 章节元数据
编辑章节
  → CodeMirror state → 预览 → 自动保存
关闭重启
  → 从文件扫描恢复章节、顺序、标签与编辑结果
```

---

## 15. 性能、稳定性与异常策略

| 场景 | 初版策略 | 验证指标 / 测试方式 |
|---|---|---|
| 500+ 卡片 | 缩略图缓存、虚拟列表/按需渲染 | 滚动响应无明显卡顿；真机测量 |
| 100+ 张照片导入 | staging 批量复制 + 进度回调 | 中断后无半创建的有效 Item |
| 长文档 | CodeMirror 编辑器、渲染去抖、按章挂载 | 超过 10 万字仍可编辑和切章 |
| 大型 PDF | PDF.js 延迟渲染页面、释放不可见页 | 大文件专项内存测试 |
| 意外退出 | dirty 状态恢复、同目录临时保存 | 重新启动可恢复最近未写入修改 |
| 外部修改 `.md` | 文件监听 + hash 冲突检测 | 不能静默覆盖磁盘新版本 |
| 数据库损坏 | 删除缓存后重建 | 所有源内容仍可读取 |
| 文件名特殊字符 | Unicode / 中文 / 空格路径测试 | 导入、保存、导出行为正确 |
| 丢失资源 | 报错占位、保持 Markdown 原文 | 不因缺图清空文档 |
| 布局模板字体缺失 | 回退提示与排版重新检查 | PDF 预览/导出完全一致 |

> 性能数值是**测试样本规模与工程目标**，不作为尚未测量的性能承诺。实际验收阈值在 M0 基准测试后填写。

---

## 16. 测试设计与验收

### 16.1 测试层次

1. **Unit / Vitest**：排序、状态标签、路径构造、博客时间线、系列上一篇/下一篇、Markdown 格式识别。
2. **Component / React Testing Library**：窄侧栏、卡片网格、目录折叠、编辑/预览/分屏、标签弹层。
3. **Integration**：真实临时工作区上的读写、导入、重命名、崩溃恢复、索引重建。
4. **Desktop E2E**：Tauri 真机窗口、文件对话框、权限恢复、拖放、快捷键、PDF 只读。
5. **Golden fixtures**：长篇中文 Markdown、复杂 LaTeX、DOCX 标题层级、图片、音符、加密/无书签 PDF、损坏文件。
6. **Cross-platform**：首发 Windows；后续 macOS / Linux 的宋体回退、路径及 PDF 渲染专项测试。

### 16.2 核心验收清单

- [ ] 创建本地工作区，关闭并重新打开，无网络时可使用。
- [ ] 在同一 Collection 内新建图书、摄影集、博客集、系列文章、纯文本和 PDF Item。
- [ ] Markdown 编辑、LaTeX 渲染、预览及分屏在切换后保持源文件逐字不变（未编辑情况下）。
- [ ] 图书章节可以按目录跳转和重新排序，顺序重启后不丢失。
- [ ] 摄影照片可批量导入，`待P图` 状态保存且图片字节不变。
- [ ] 博客发布文章按日期归档，草稿独立显示。
- [ ] 系列文章可重排序，上一篇/下一篇导航与目录一致。
- [ ] 外部 PDF 以特殊 Item 打开并可阅读、缩放和跳转；标签/备注变更后 PDF SHA-256 不变。
- [ ] Markdown / HTML 导出保留章节、图片与公式。
- [ ] DOCX 导入、图书排版设置、PDF 成品预览及导出在 P1 验收。
- [ ] 无法访问或损坏 SQLite 缓存时，仍可从本地源文件恢复作品。
- [ ] 主页中文为宋体，图标侧栏维持窄幅，所有封面为 **2D 平面竖向矩形**。
- [ ] 不存在 PDF 正文编辑、PDF OCR 转 Markdown 或 PDF 拆章入口。

### 16.3 对产品 Spec 的需求映射

| 产品 Spec 功能组 | 技术章节 | 计划阶段 |
|---|---|---|
| FR-01~03 工作区、集合、章节 | §5、§6、§12、§14 | M1 |
| FR-04~07 Markdown、LaTeX、图书阅读 | §8、§10.1、§13 | M1 |
| FR-08~10 摄影、标记、筛选 | §7、§10.2、§13 | M1 / 搜索增强 M2 |
| FR-11~16 导入、导出、封面 | §9、§10、§11 | M1 / DOCX、PDF M2 |
| FR-17~18 保存恢复、书页原位编辑 | §12、§15 | M1 / 原位编辑 M3 |
| FR-19~28 博客/系列、归档、汇编 | §5、§10.3~10.4、§11 | M1 / 导出增强 M2 / 站点 M3 |
| FR-29~32 PDF 只读、排版配置与成品预览 | §9、§11.3、§12 | PDF 只读 M1；出版 M2 |

---

## 17. 里程碑与交付物

### M0 — 技术验证与可点击外壳

**交付**：可运行的 Tauri 2 桌面应用，品牌 Leafor、宋体、极窄导航栏、平面封面网格；模拟数据即可切换主页和详情页。

**验证实验**：
- Tauri 目录选择与访问 scope 在 Windows 重启后可用。
- CodeMirror 中文输入、Markdown 预览及 KaTeX。
- PDF.js 打开来自本地授权工作区的 PDF，并测量 100 页以上 PDF 的使用情况。
- SQLite 索引的创建/重建；安全保存 Markdown 的最小原型。

### M1 — 可自用的本地核心版本

**交付**：
- 工作区/Collection/Item CRUD 与本地 JSON 存储。
- 图书、摄影集、博客集、系列文章、纯文本、外部 PDF 特殊对象。
- Markdown 编辑/预览/分屏、LaTeX、目录导航、状态与标签。
- 本地 PDF 只读阅读、原样保存及 SHA-256 完整性验证。
- 自动保存、冲突提示、基础 Markdown/HTML 导入导出。
- 博客时间线、草稿；系列排序、上一篇/下一篇。

### M2 — 完整内容与出版链路

**交付**：
- DOCX 导入与分章、Word 导出。
- Markdown 图书的出版排版配置、只读 PDF 成品预览与最终 PDF 导出。
- 全局全文搜索、中文搜索改良、批量标签/照片操作、历史恢复。
- 博客集离线 HTML 归档、系列合并导出、分卷/分组。
- 性能、稳定性与跨平台适配强化。

### M3 — 高级扩展

**候选**：
- 书籍阅读视图中的直接编辑与重分页。
- 更多出版样式、可复用模板、跨类型内容复制/引用。
- 本地静态博客站点和 RSS 生成。
- 仍然**不包含外部 PDF 编辑与 PDF → Markdown**。

---

## 18. 风险与架构决策记录（ADR 候选）

| 编号 | 风险 / 待定事项 | 当前决策 / 处理 |
|---|---|---|
| ADR-001 | 容器选择 Tauri 或 Electron | 采用 Tauri 2；以轻量和本地文件能力为优先 |
| ADR-002 | 文件与 SQLite 谁保存权威内容 | 文件 + JSON 是权威；SQLite 缓存可重建 |
| ADR-003 | SQL 插件默认 DB 路径与工作区可迁移性 | DB 在 AppData；工作区 JSON 独立可迁移，重建索引 |
| ADR-004 | 是否以所见即所得为默认编辑器 | CodeMirror 主编辑；Milkdown 暂列可选适配器 |
| ADR-005 | 外部 PDF 的角色 | 永久只读特殊 Item，不进入 Markdown 编辑链路 |
| ADR-006 | 图书 PDF 预览/导出一致性 | **先生成最终 PDF，再用同一份字节预览/导出** |
| ADR-007 | 严格宋体与跨平台字体 | Windows SimSun、macOS Songti SC；其他平台有许可的宋体回退 |
| ADR-008 | 工作区路径与 Tauri fs scopes | 以用户授权目录为根，拒绝全盘宽权限 |
| ADR-009 | 原子写入/撤销/异常恢复 | M0 验证，必要时实现少量 Rust 安全写入命令 |
| ADR-010 | 首页 UI 信息密度 | 52px 窄图标栏、无常驻大右栏、纯 2D 竖向封面 |
| ADR-011 | 中文全文搜索 | M1 标题/状态/标签/子串；M2 针对中文选分词或 N-gram |
| ADR-012 | Pandoc / PDF 排版引擎随应用打包 | M2 前测量体积、许可证、离线依赖、字体和保真 |

---

## 19. 开发顺序与首个可执行任务

建议第一批 PR 依次为：

1. `chore/bootstrap-tauri`：创建 Tauri 2 + React + Vite + TypeScript 工程，配置 lint、format、Vitest、构建脚本。
2. `feat/design-system`：实现宋体字体栈、深青绿 Tokens、52px 窄导航栏、极简顶部栏与 2D 平面封面组件。
3. `feat/workspace-model`：领域模型、JSON schema、工作区文件夹初始化、最小示例数据。
4. `feat/library`：集合卡片、按 Item 类型筛选、创建/打开/重命名、集合混合类型。
5. `feat/markdown`：CodeMirror + Markdown/KaTeX 预览 + 章节目录 + 持久化保存。
6. `feat/pdf-readonly`：PDF 特殊对象导入、PDF.js 只读、保存标签/状态、校验 SHA-256。
7. `feat/content-types`：摄影集、博客时间线、系列文章目录和排序。
8. `feat/index-recovery`：SQLite 索引、自动恢复、基础筛选和完整性测试。

**第一条垂直功能链**：`创建工作区 → 新建集合 → 新建图书 → 新建章节 → Markdown + LaTeX 编辑 → 保存 → 重启 → 完整恢复`。这条路径通过后，其他 Item 类型再逐项接入统一仓储模型。

---

## 20. 官方资料与查阅入口

以下是本设计参考的项目文档；依赖版本、命令参数与许可证在实施前仍需再次锁定。

1. Tauri 2 文件系统插件：<https://v2.tauri.app/plugin/file-system/>
2. Tauri 2 权限配置：<https://v2.tauri.app/learn/security/using-plugin-permissions/>
3. Tauri 2 Dialog API（文件选择与持久范围）：<https://v2.tauri.app/reference/javascript/dialog/>
4. Tauri 2 SQLite 插件与迁移：<https://v2.tauri.app/plugin/sql/>
5. Tauri 2 sidecar 打包：<https://v2.tauri.app/develop/sidecar/>
6. CodeMirror Markdown 支持：<https://github.com/codemirror/lang-markdown>
7. remark-math / rehype-katex：<https://github.com/remarkjs/remark-math>
8. react-markdown 安全与公式集成：<https://github.com/remarkjs/react-markdown>
9. PDF.js 官方入门：<https://mozilla.github.io/pdf.js/getting_started/>
10. Pandoc 用户手册：<https://pandoc.org/MANUAL.html>
11. Paged.js 打印排版：<https://pagedjs.org/en/documentation/>

---

## 21. 文档边界与版本演进

本文是一份**可用于拆分代码任务的技术架构基线**，并非已经完成的系统或未经验证的性能保证。与产品 Spec v0.3 相比，本文确定了正式产品名 **Leafor**、主技术栈和最新视觉规则，并把数据库位置、路径权限、编辑器保真以及 PDF 的只读边界细化为可测试的实现约束。

后续变更应遵循：**保留既有功能选项、Markdown/LaTeX 语法兼容、数据迁移能力和已确定的 UI 样式**；如需删改，需要在 ADR 中记录原因和影响，并以用户明确的变更要求为准。
