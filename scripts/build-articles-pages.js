const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const data = JSON.parse(fs.readFileSync(path.join(root, 'src', 'articles-data.json'), 'utf8'));
const articles = data.articles || [];

function esc(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+|mailto:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
function markdown(md) {
  const lines = md.split(/\r?\n/); let html = ''; let inCode = false; let list = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (list) { html += '</ul>'; list = false; }
      html += inCode ? '</code></pre>' : '<pre><code>';
      inCode = !inCode; continue;
    }
    if (inCode) { html += esc(line) + '\n'; continue; }
    if (/^###\s+/.test(line)) { if(list){html+='</ul>';list=false;} html += '<h3>' + inline(line.replace(/^###\s+/,'')) + '</h3>'; continue; }
    if (/^##\s+/.test(line)) { if(list){html+='</ul>';list=false;} html += '<h2>' + inline(line.replace(/^##\s+/,'')) + '</h2>'; continue; }
    if (/^#\s+/.test(line)) { if(list){html+='</ul>';list=false;} html += '<h1>' + inline(line.replace(/^#\s+/,'')) + '</h1>'; continue; }
    if (/^-\s+/.test(line)) { if(!list){html+='<ul>';list=true;} html += '<li>' + inline(line.replace(/^-\s+/,'')) + '</li>'; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (line.trim()) html += '<p>' + inline(line) + '</p>';
  }
  if (list) html += '</ul>';
  if (inCode) html += '</code></pre>';
  return html;
}
function shell(title, body, prefix) {
  return '<!doctype html><html lang="zh-CN" data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + ' | DapWeb</title><link rel="stylesheet" href="' + prefix + 'style.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"></head><body><nav class="article-nav"><a href="/">$ DapWeb</a><div><a href="/moments/">动态</a><a href="/articles/">文章</a></div></nav><main class="articles-page">' + body + '</main></body></html>';
}

const list = articles.map(a => '<a class="article-list-item" href="/articles/' + encodeURIComponent(a.slug) + '/"><div><h2>' + esc(a.title) + '</h2><p>' + esc(a.summary) + '</p><div class="article-tags">' + a.tags.map(t => '<span>#' + esc(t) + '</span>').join('') + '</div></div><time>' + new Date(a.date).toLocaleDateString('zh-CN') + '</time></a>').join('');
const indexBody = '<header class="articles-hero"><p>$ ~/articles</p><h1>文章</h1><span>代码、项目与学习总结</span></header><section class="article-list">' + (list || '<p class="article-empty">暂无文章</p>') + '</section>';
fs.mkdirSync(path.join(dist, 'articles'), { recursive: true });
fs.writeFileSync(path.join(dist, 'articles', 'index.html'), shell('文章', indexBody, '../'), 'utf8');

for (const a of articles) {
  const dir = path.join(dist, 'articles', a.slug);
  fs.mkdirSync(dir, { recursive: true });
  const body = '<article class="article-detail"><a class="article-back" href="/articles/"><i class="fa-solid fa-arrow-left"></i> 所有文章</a><header><h1>' + esc(a.title) + '</h1><time>' + new Date(a.date).toLocaleDateString('zh-CN') + '</time><div class="article-tags">' + a.tags.map(t => '<span>#' + esc(t) + '</span>').join('') + '</div></header><div class="article-body">' + markdown(a.content) + '</div></article>';
  fs.writeFileSync(path.join(dir, 'index.html'), shell(a.title, body, '../../'), 'utf8');
}
console.log('Article pages:', articles.length);

