const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'src', 'articles');
const out = path.join(root, 'src', 'articles-data.json');

function scalar(value) {
  const text = value.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^\[.*\]$/.test(text)) return text.slice(1, -1).split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return text.replace(/^['"]|['"]$/g, '');
}

function parse(filename) {
  const raw = fs.readFileSync(path.join(dir, filename), 'utf8').replace(/^\uFEFF/, '');
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  const meta = {}; let content = raw.trim();
  if (match) {
    match[1].split(/\r?\n/).forEach(line => {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = scalar(line.slice(i + 1));
    });
    content = match[2].trim();
  }
  const slug = filename.replace(/\.md$/i, '');
  const title = meta.title || content.match(/^#\s+(.+)$/m)?.[1] || slug;
  const date = new Date(meta.date || slug).toISOString();
  const tags = Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []);
  const summary = meta.summary || content.replace(/[#>*_`~\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  return { slug, title, date, tags, summary, content };
}

fs.mkdirSync(dir, { recursive: true });
const articles = fs.readdirSync(dir).filter(x => x.toLowerCase().endsWith('.md')).map(parse)
  .sort((a, b) => new Date(b.date) - new Date(a.date));
fs.writeFileSync(out, JSON.stringify({ articles }, null, 2) + '\n');
console.log('Markdown Articles:', articles.length);

