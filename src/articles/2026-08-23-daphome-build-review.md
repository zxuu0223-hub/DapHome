---
title: 从 MoeHome 到可持续更新的个人主页：DapHome 一日构建与纠错复盘
date: 2026-08-23T22:30:00+08:00
tags: [MoeHome, Vercel, GitHub, Markdown, 前端工程]
summary: 记录 DapHome 从个人资料配置、Markdown 动态、文章系统到 GitHub/Vercel 自动部署的完整实现，并逐段解释关键代码、错误原因与修复方法。
---

## 一、项目目标

今天完成的目标不是只生成一个临时主页，而是搭建一个以后可以由我自己持续维护的个人网站。

最终网站具备以下能力：

- 使用 MoeHome 的暗色终端风格展示个人资料
- 自动读取 GitHub 公开仓库并生成项目卡片
- 使用 Markdown 文件发布生活动态
- 在首页展示最新一条动态
- 使用 Markdown 文件发布技术文章
- 在首页展示最新五篇文章标题
- 提供文章目录和独立全文页面
- GitHub 每次推送后由 Vercel 自动构建和部署
- 不依赖 OpenAI、数据库、Memos 或云服务器

整个数据流可以概括为：

```text
编辑 Markdown
      ↓
推送到 GitHub main
      ↓
Vercel 执行 npm run build
      ↓
构建脚本生成静态 HTML 和 JSON
      ↓
CDN 发布最新网站
```

这种方案成本低、结构简单，而且动态和文章都保存在 Git 历史中，方便回滚和长期维护。

## 二、个人资料与站点配置

网站的个人信息集中保存在 `src/config.js` 中。核心配置如下：

```javascript
site: {
  name: "DapWeb",
  tagline: "莫纳什数据科学硕士 · 待业中（来点活吧宝贝）",
  url: "",
  ogImage: "/images/avatar.webp",
}
```

### 代码解释

`name` 是站点名称，会显示在导航栏和页面标题中。

`tagline` 是首页身份介绍，用于快速说明教育背景和当前求职状态。

`url` 必须保持为空。这样 MoeHome 构建器会生成相对资源路径，例如：

```html
<link rel="stylesheet" href="style.css">
<script src="app.js"></script>
```

如果提前把尚未启用的自定义域名写入 `url`，构建器会生成绝对地址：

```html
<link rel="stylesheet" href="https://dapweb.us.kg/style.css">
```

当该域名还没有完成 DNS 配置时，CSS 和 JavaScript 都无法加载，页面就会停留在骨架屏状态。这是今天遇到的第一个重要问题。

### 纠错结论

在自定义域名正式上线前，静态网站应优先使用相对路径。相对路径既能适配 Vercel 的部署域名，也能在以后绑定自定义域名时继续工作。

## 三、将 Memos 动态改造成 Markdown 动态

最初计划使用自托管 Memos，但这需要一台长期在线的服务器。为了降低维护成本，最终改成：

```text
src/moments/*.md
        ↓
scripts/build-moments.js
        ↓
src/moments-data.json
        ↓
dist/moments.json
        ↓
Moments 页面渲染
```

一条动态的 Markdown 文件格式如下：

```markdown
---
date: 2026-08-24T20:30:00+08:00
tags: [生活, 学习, 求职]
pinned: false
images: []
---

今天完成了个人主页的自动部署与动态系统。
```

### 构建脚本的主要逻辑

```javascript
const memos = fs.readdirSync(inputDir)
  .filter((name) => name.toLowerCase().endsWith(".md"))
  .map(parseFile)
  .sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      new Date(b.createTime) - new Date(a.createTime)
  );
```

### 逐段解释

`readdirSync(inputDir)` 读取 `src/moments` 目录中的所有文件。

`filter` 只保留扩展名为 `.md` 的 Markdown 文件，避免 README 或图片被错误解析。

`map(parseFile)` 读取每个文件的 Front Matter 和正文，并转换成原 MoeHome Moments 组件理解的数据结构。

排序首先比较 `pinned`。置顶动态会显示在普通动态之前；同一优先级内再按照创建时间倒序排列。

最终生成的数据结构如下：

```json
{
  "memos": [
    {
      "name": "moments/2026-08-24-my-update",
      "content": "动态正文",
      "createTime": "2026-08-24T12:30:00.000Z",
      "visibility": "PUBLIC",
      "pinned": false,
      "tags": ["生活", "学习"],
      "attachments": []
    }
  ],
  "nextPageToken": ""
}
```

保留 Memos 风格的数据结构有一个重要好处：可以继续复用 MoeHome 原有的动态卡片、标签、Markdown 渲染和图片功能，不需要大规模重写 UI。

## 四、动态页骨架屏问题的纠错

完成静态数据后，`moments.json` 已经能够正常访问，但动态页仍然一直显示骨架屏。

问题来自 `src/app.js` 中遗留的初始化条件：

```javascript
if (!config || !config.enabled || !config.memosUrl) {
  return;
}
```

这段代码的原意是：如果没有配置 Memos 地址，就不要启动动态模块。

但改成静态 Markdown 后，`memosUrl` 被有意设置为空，所以 MomentsFeed 永远不会初始化。

修复后的代码：

```javascript
if (!config || !config.enabled) {
  return;
}
```

### 纠错分析

数据源迁移不能只修改网络请求地址，还要检查初始化条件、错误处理、分页状态和附件 URL 等所有与旧数据源耦合的位置。

这次问题说明：“数据已经生成”不代表“页面一定会渲染”。完整验证必须覆盖：

```text
构建输入 → 生成数据 → 浏览器请求 → 初始化条件 → DOM 渲染
```

## 五、在首页展示最新动态

首页的最新动态由构建器直接生成静态 HTML。核心逻辑：

```javascript
memos.sort(
  (a, b) => new Date(b.createTime) - new Date(a.createTime)
);

const latest = memos[0];
```

这里重新按照时间排序，而不是沿用动态页的置顶排序。原因是首页模块的语义是“最新动态”，应该严格展示发布时间最近的一条。

首页卡片右上角提供历史入口：

```html
<a class="home-moment-history" href="/moments/">
  查看历史
</a>
```

这样首页只承担快速预览职责，完整的标签筛选和历史记录仍由 `/moments/` 页面负责。

## 六、Markdown 文章系统

文章文件存放在：

```text
src/articles/*.md
```

文章格式：

```markdown
---
title: 文章标题
date: 2026-08-23T22:00:00+08:00
tags: [Python, 项目总结]
summary: 显示在文章列表中的简短摘要。
---

## 项目背景

这里填写正文。
```

文章构建分为两个阶段。

### 第一阶段：提取文章数据

`scripts/build-articles-data.js` 扫描 Markdown 文件并生成文章列表数据：

```javascript
const articles = fs.readdirSync(dir)
  .filter((name) => name.toLowerCase().endsWith(".md"))
  .map(parse)
  .sort((a, b) => new Date(b.date) - new Date(a.date));
```

每篇文章被转换成：

```javascript
{
  slug,
  title,
  date,
  tags,
  summary,
  content
}
```

`slug` 来自文件名，会成为文章 URL。例如：

```text
src/articles/2026-08-23-daphome-review.md
```

会生成：

```text
/articles/2026-08-23-daphome-review/
```

### 第二阶段：生成文章页面

`scripts/build-articles-pages.js` 生成两类页面：

```text
dist/articles/index.html
dist/articles/<slug>/index.html
```

第一类是所有文章的标题目录，第二类是每篇文章的全文页面。

首页最多取五篇：

```javascript
const articles = Array.isArray(data.articles)
  ? data.articles.slice(0, 5)
  : [];
```

因为文章数据已经按照日期倒序排列，所以 `slice(0, 5)` 就是最新五篇。

每个标题链接到完整文章：

```javascript
'<a href="/articles/' +
  encodeURIComponent(article.slug) +
  '/">' +
  escapeHTML(article.title) +
  '</a>'
```

`encodeURIComponent` 防止文件名中的特殊字符破坏 URL。

`escapeHTML` 防止文章标题中的特殊字符被浏览器误认为 HTML 标签，也能降低内容注入风险。

## 七、首页、动态与文章导航

桌面端和移动端菜单都加入了文章入口：

```javascript
const articlesActive =
  activePage === "articles" ? " active" : "";

links.push(
  `<a href="/articles/" class="nav-link${articlesActive}">
    <i class="fa-solid fa-code"></i>
    <span>文章</span>
  </a>`
);
```

### 代码解释

`activePage` 表示当前页面类型。

当访问文章页时，导航链接添加 `active` 类，用户可以直观看出当前所在位置。

所有链接都使用以 `/` 开头的站内绝对路径，因此无论用户处在首页、动态页还是文章全文页，都能正确跳转。

## 八、GitHub 与 Vercel 自动部署

最终部署流程由 GitHub 和 Vercel Git Integration 完成。

`package.json` 中的构建命令依次执行：

```json
{
  "scripts": {
    "build": "node scripts/build-moments.js && node scripts/build-articles-data.js && node scripts/build.js && node scripts/build-articles-pages.js"
  }
}
```

执行顺序非常重要：

- 先生成动态数据
- 再生成文章数据
- 然后构建 MoeHome 首页和动态页
- 最后在已经生成的 `dist` 目录中写入文章目录和全文页面

如果文章页面在 `build.js` 之前生成，`build.js` 清理 `dist` 时会把它们删除。

每次更新流程：

```text
编辑 src/moments 或 src/articles
             ↓
git commit
             ↓
git push origin main
             ↓
Vercel 自动执行 npm run build
             ↓
生成新的 Production Deployment
```

## 九、今天遇到的主要问题与纠错总结

### 问题一：域名过早写入配置

现象：CSS、JavaScript 和头像无法加载，首页一直显示骨架屏。

原因：构建器把尚未启用的 `dapweb.us.kg` 写入所有静态资源地址。

修复：将 `site.url` 留空，使用相对路径。

### 问题二：静态动态没有启动

现象：`moments.json` 返回正确数据，但动态页面没有内容。

原因：初始化逻辑仍要求 `memosUrl` 非空。

修复：删除旧数据源特有的初始化限制。

### 问题三：远端提交导致 push 被拒绝

现象：GitHub 网页上新增 Markdown 后，本地 push 出现 `fetch first`。

原因：远端 `main` 已经比本地多出新提交。

正确处理：

```bash
git fetch origin main
git rebase origin/main
git push origin HEAD:main
```

这种方式可以保留网页端新增的文章或动态，再把本地修复安全地放到最新提交之上。不能使用强制推送覆盖用户内容。

### 问题四：每次部署的网址都会变化

现象：Vercel 地址中包含不同的随机字符串。

原因：每次部署都有一个不可变的唯一 URL，用于版本追踪和回滚。

解决方案：在 Vercel Domains 中设置固定 Production Domain。唯一部署 URL 仍然有价值，因为它能准确定位某一次构建产物。

### 问题五：邮箱和身份说明发生重叠

原因：邮箱容器使用了负的上边距，压到了上一行介绍文字。

修复思路：

```css
.tagline {
  margin-bottom: 14px;
}

.profile-emails {
  margin: 0 0 34px;
}
```

取消负边距，让布局按照正常文档流排列。同时把邮箱做成高对比胶囊按钮，提高可见性和点击体验。

## 十、最终总结

今天最重要的成果不是完成了多少页面，而是建立了一条可持续维护的内容工作流。

动态和文章都使用 Markdown，内容归自己所有；GitHub 保存全部历史；Vercel 自动完成构建和发布；MoeHome 继续负责视觉展示。

最终架构没有数据库、没有云服务器、没有后台服务，也不依赖 OpenAI 才能修改内容。

后续只需要维护两个目录：

```text
src/moments   日常动态
src/articles  技术文章
```

对个人作品集而言，这套方案兼顾了展示效果、维护成本、版本追踪和求职可解释性。它不仅是一个主页，也可以作为简历中的完整前端工程与自动部署案例。

