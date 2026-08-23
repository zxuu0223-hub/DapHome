const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const inputDir = path.join(root, 'src', 'moments');
const outputFile = path.join(root, 'src', 'moments-data.json');
function scalar(value) {
  const text = value.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^\[.*\]$/.test(text)) return text.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return text.replace(/^['"]|['"]$/g, '');
}
function parseFile(filename) {
  const raw = fs.readFileSync(path.join(inputDir, filename), 'utf8').replace(/^\uFEFF/, '');
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  const meta = {}; let content = raw.trim();
  if (match) {
    match[1].split(/\r?\n/).forEach((line) => { const divider = line.indexOf(':'); if (divider > 0) meta[line.slice(0, divider).trim()] = scalar(line.slice(divider + 1)); });
    content = match[2].trim();
  }
  const slug = filename.replace(/\.md$/i, '');
  const tags = Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []);
  const images = Array.isArray(meta.images) ? meta.images : (meta.images ? [meta.images] : []);
  const createTime = new Date(meta.date || slug).toISOString();
  return { name: 'moments/' + slug, content, createTime, updateTime: createTime, visibility: 'PUBLIC', pinned: meta.pinned === true, tags, attachments: images.map((url, index) => ({ name: 'local/' + slug + '-' + index, filename: path.basename(url), type: 'image/' + (path.extname(url).slice(1) || 'jpeg'), externalLink: url })) };
}
fs.mkdirSync(inputDir, { recursive: true });
const memos = fs.readdirSync(inputDir).filter((name) => name.toLowerCase().endsWith('.md')).map(parseFile).sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.createTime) - new Date(a.createTime));
fs.writeFileSync(outputFile, JSON.stringify({ memos, nextPageToken: '' }, null, 2) + '\n');
console.log('Markdown Moments:', memos.length);

