#!/usr/bin/env node
// Génère le profil GitHub façon « dashboard » sombre (SVG), à partir des vraies données GitHub.
// Usage : GITHUB_TOKEN=... GH_USER=duckysface node scripts/generate-dashboard.mjs dist
// Zéro dépendance (Node 20+).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] || 'dist';
const USER = process.env.GH_USER || 'duckysface';
const TOKEN = process.env.GITHUB_TOKEN || '';
const NOW = new Date();
const DAY = 86400000;
const TZ = 'Europe/Zurich';

// ─────────────────────────── Contenu statique du profil ───────────────────────────
const PROFILE = {
  greeting: `Salut, moi c'est ${USER}`,
  tagline: 'Builder · Design-to-Dev · IA',
  place: 'Suisse',
  languages: 'Français, English',
  motto: 'Calme en surface, ça pédale en dessous',
  focus: [
    { icon: 'layers', color: '#a78bfa', name: 'design-to-dev', sub: 'Skill Claude Code · design → code' },
    { icon: 'chart', color: '#4ade80', name: 'dashboards', sub: "Apps web & dashboards d'entreprise" },
    { icon: 'bot', color: '#fbbf24', name: 'agents-ia', sub: 'Agents & automatisations IA' },
  ],
  stack: [
    { label: 'Langages', sub: 'Au quotidien', items: ['Python', 'JavaScript', 'TypeScript', 'HTML', 'CSS'] },
    { label: 'Frameworks & data', sub: 'Front, back, base', items: ['React', 'Next.js', 'Tailwind', 'Node.js', 'Supabase', 'Postgres'] },
    { label: 'Design & workflow', sub: 'Outils', items: ['Figma', 'Git', 'GitHub', 'VS Code', 'Vercel', 'Notion'] },
    { label: 'IA', sub: 'Automatisation', items: ['Claude Code', 'Skills', 'Agents', 'MCP'] },
  ],
  learning: 'SaaS · Supabase · data viz',
};

// ─────────────────────────── Palette (reprise des maquettes) ───────────────────────────
const C = {
  page: '#0a0a0b', side: '#0b0b0c', card: '#0e0e10', cardHi: '#121215', inset: '#141417',
  border: '#202024', border2: '#2a2a2f', line: '#1a1a1d',
  text: '#f4f4f5', text2: '#d4d4d8', muted: '#a1a1aa', faint: '#71717a', faint2: '#52525b',
  purple: '#8b5cf6', purpleL: '#a78bfa', purpleBtn: '#8b7cf6',
  green: '#22c55e', greenL: '#4ade80', teal: '#2dd4bf', red: '#ef4444', redL: '#f87171', amber: '#f59e0b', amberL: '#fbbf24',
  chip: '#1c1c20',
};
const SANS = "Inter, 'Segoe UI', -apple-system, Roboto, Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Consolas, monospace";

// ─────────────────────────── API GitHub ───────────────────────────
const HEADERS = {
  'User-Agent': 'profile-dashboard',
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};
async function rest(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}
async function gql(query, variables) {
  if (!TOKEN) throw new Error('GraphQL : pas de token');
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(`GraphQL → ${r.status} ${JSON.stringify(j.errors || '')}`);
  return j.data;
}
async function safe(promise, fallback) {
  try { return await promise; } catch (e) { console.warn('⚠', e.message); return fallback; }
}
async function b64(url, headers = {}) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return { type: r.headers.get('content-type') || 'application/octet-stream', data: Buffer.from(await r.arrayBuffer()).toString('base64') };
}

// Polices embarquées (Inter + JetBrains Mono, sous-ensemble latin, licence OFL)
async function fontCss() {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  const css = await (await fetch('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap', { headers: { 'User-Agent': ua } })).text();
  const faces = new Map();
  for (const m of css.matchAll(/\/\*\s*latin\s*\*\/\s*@font-face\s*{([^}]*)}/g)) {
    const block = m[1];
    const family = block.match(/font-family:\s*'([^']+)'/)?.[1];
    const weight = Number(block.match(/font-weight:\s*(\d+)/)?.[1]);
    const url = block.match(/url\((https:[^)]+)\)/)?.[1];
    if (!family || !url) continue;
    const f = faces.get(url) || { family, weights: [] };
    f.weights.push(weight);
    faces.set(url, f);
  }
  let out = '';
  for (const [url, f] of faces) {
    const { data } = await b64(url);
    const w = f.weights.length > 1 ? `${Math.min(...f.weights)} ${Math.max(...f.weights)}` : f.weights[0];
    out += `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${w};src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  }
  return out;
}

// ─────────────────────────── Collecte des données ───────────────────────────
const dayKey = (d) => d.toISOString().slice(0, 10);

async function collect() {
  const [user, repos, events, cal, fonts, avatar] = await Promise.all([
    safe(rest(`/users/${USER}`), {}),
    safe(rest(`/users/${USER}/repos?per_page=100&sort=pushed&type=owner`), []),
    safe(rest(`/users/${USER}/events/public?per_page=100`), []),
    safe(gql(`query($login:String!){user(login:$login){contributionsCollection{
        totalCommitContributions totalPullRequestContributions totalIssueContributions
        contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}`, { login: USER }), null),
    safe(fontCss(), ''),
    safe(b64(`https://avatars.githubusercontent.com/${USER}?s=96`), null),
  ]);

  const own = repos.filter((r) => !r.fork);
  const defaultBranch = new Map(repos.map((r) => [r.full_name, r.default_branch]));

  // Langages (octets de code cumulés)
  const langBytes = {};
  await Promise.all(own.slice(0, 40).map(async (r) => {
    const l = await safe(rest(`/repos/${r.full_name}/languages`), {});
    for (const [k, v] of Object.entries(l)) langBytes[k] = (langBytes[k] || 0) + v;
  }));
  if (!Object.keys(langBytes).length) for (const r of own) if (r.language) langBytes[r.language] = (langBytes[r.language] || 0) + 1;
  const langTotal = Object.values(langBytes).reduce((a, b) => a + b, 0) || 1;
  const langs = Object.entries(langBytes).sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ name, pct: (v / langTotal) * 100 }));

  // Pushs récents + statut CI
  const pushes = events.filter((e) => e.type === 'PushEvent').slice(0, 25);
  const activity = await Promise.all(pushes.map(async (e) => {
    const repo = e.repo.name;
    const sha = e.payload.head || e.payload.after || '';
    const branch = (e.payload.ref || '').replace('refs/heads/', '');
    let message = e.payload.commits?.at(-1)?.message;
    if (!message && sha) message = (await safe(rest(`/repos/${repo}/commits/${sha}`), null))?.commit?.message;
    const runs = sha ? await safe(rest(`/repos/${repo}/commits/${sha}/check-runs?per_page=50`), null) : null;
    let status = 'none';
    const list = runs?.check_runs || [];
    if (list.some((r) => r.status !== 'completed')) status = 'running';
    else if (list.some((r) => ['failure', 'timed_out', 'action_required'].includes(r.conclusion))) status = 'failed';
    else if (list.length) status = 'success';
    return {
      title: (message || `Push sur ${branch}`).split('\n')[0],
      repo: repo.split('/')[1], sha: sha.slice(0, 7), branch,
      preview: branch && branch !== (defaultBranch.get(repo) || 'main'),
      commits: e.payload.size ?? e.payload.commits?.length ?? 1,
      date: new Date(e.created_at), status,
    };
  }));
  if (!activity.length) {
    for (const r of own.slice(0, 5)) activity.push({
      title: r.description || `Mise à jour de ${r.name}`, repo: r.name, sha: '', branch: r.default_branch,
      preview: false, commits: 1, date: new Date(r.pushed_at), status: 'none',
    });
  }

  // Calendrier de contributions (365 j) ; repli sur les événements si GraphQL indisponible
  let days = [];
  const cc = cal?.user?.contributionsCollection;
  if (cc) days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays).map((d) => ({ date: d.date, count: d.contributionCount }));
  else {
    const m = new Map();
    for (const e of events) { const k = e.created_at.slice(0, 10); m.set(k, (m.get(k) || 0) + (e.type === 'PushEvent' ? (e.payload.size || 1) : 1)); }
    for (let i = 364; i >= 0; i--) { const k = dayKey(new Date(NOW - i * DAY)); days.push({ date: k, count: m.get(k) || 0 }); }
  }
  const today = dayKey(NOW);
  days = days.filter((d) => d.date <= today).slice(-365);

  return {
    user, repos, own, langs, activity, days, fonts, avatar,
    totals: {
      year: cc?.contributionCalendar.totalContributions ?? days.reduce((a, d) => a + d.count, 0),
      commits: cc?.totalCommitContributions ?? null,
      prs: cc?.totalPullRequestContributions ?? null,
      issues: cc?.totalIssueContributions ?? null,
    },
  };
}

// ─────────────────────────── Outils de rendu ───────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const trunc = (s, n) => ([...s].length > n ? [...s].slice(0, n - 1).join('').trimEnd() + '…' : s);
const nf = (n, d = 0) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const plural = (n, one, many) => `${nf(n)} ${n > 1 ? many : one}`;

// Largeur approximative d'un texte (Inter / mono)
function tw(s, size, { mono = false, bold = false } = {}) {
  if (mono) return [...s].length * size * 0.6;
  let w = 0;
  for (const ch of s) {
    if (ch === ' ') w += 0.27;
    else if (/[il.,:;'!|·]/.test(ch)) w += 0.26;
    else if (/[fjrt()\-]/.test(ch)) w += 0.36;
    else if (/[mwMW]/.test(ch)) w += 0.84;
    else if (/[A-Z]/.test(ch)) w += 0.66;
    else if (/[0-9]/.test(ch)) w += 0.58;
    else w += 0.55;
  }
  return w * size * (bold ? 1.06 : 1);
}

function t(x, y, str, o = {}) {
  const { size = 13, weight = 400, fill = C.text, anchor = 'start', mono = false, ls, opacity } = o;
  return `<text x="${x}" y="${y}" font-family="${mono ? MONO : SANS}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${ls ? ` letter-spacing="${ls}"` : ''}${opacity ? ` opacity="${opacity}"` : ''}>${esc(str)}</text>`;
}
const rect = (x, y, w, h, r, fill, stroke, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}"` : ''}${extra}/>`;
const card = (x, y, w, h, fill = C.card) => rect(x + 0.5, y + 0.5, w - 1, h - 1, 14, fill, C.border);
const hline = (x1, x2, y, c = C.line) => `<line x1="${x1}" x2="${x2}" y1="${y + 0.5}" y2="${y + 0.5}" stroke="${c}"/>`;
const vline = (x, y1, y2, c = C.line) => `<line x1="${x + 0.5}" x2="${x + 0.5}" y1="${y1}" y2="${y2}" stroke="${c}"/>`;

// Icônes (tracés type Lucide, 24×24, trait 2)
const ICONS = {
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  updown: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  arrowR: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  ext: '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
  commit: '<circle cx="12" cy="12" r="3"/><path d="M3 12h6M15 12h6"/>',
  ok: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  ko: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  wait: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
  pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  sort: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  dots: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
};
const icon = (name, x, y, size = 16, color = C.muted, sw = 2) =>
  `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`;
const GH_MARK = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';

function button(x, y, label, { variant = 'dark', iconName, h = 32, size = 12.5 } = {}) {
  const pad = 12, iw = iconName ? 22 : 0;
  const w = Math.round(tw(label, size, { bold: true }) + pad * 2 + iw);
  const bg = variant === 'white' ? '#f4f4f5' : variant === 'purple' ? C.purpleBtn : C.card;
  const fg = variant === 'white' ? '#0a0a0b' : C.text;
  const stroke = variant === 'dark' ? C.border2 : null;
  let s = rect(x + 0.5, y + 0.5, w - 1, h - 1, 7, bg, stroke);
  if (iconName) s += icon(iconName, x + pad, y + h / 2 - 7, 14, fg);
  s += t(x + pad + iw, y + h / 2 + size * 0.36, label, { size, weight: 500, fill: fg });
  return { svg: s, w };
}

function chip(x, y, label, { mono = true, size = 11, fill = C.chip, color = C.text2, h = 22, stroke = C.border2, weight = 500 } = {}) {
  const w = Math.round(tw(label, size, { mono }) + 16);
  return { svg: rect(x + 0.5, y + 0.5, w - 1, h - 1, 5, fill, stroke) + t(x + 8, y + h / 2 + size * 0.36, label, { size, mono, fill: color, weight }), w };
}

function relTime(d) {
  const s = (NOW - d) / 1000;
  if (s < 90) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  if (s < 86400 * 30) return `il y a ${Math.round(s / 86400)} j`;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: TZ }).format(d);
}
const shortDate = (iso) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));

// Courbe lissée (Catmull-Rom → Bézier)
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

let uid = 0;
function sparkline(x, y, w, h, values) {
  const id = `sp${uid++}`;
  const max = Math.max(1, ...values), n = values.length;
  const pts = values.map((v, i) => [x + (i * w) / (n - 1), y + h - 3 - (v / max) * (h - 6)]);
  const line = 'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L');
  const last = pts.at(-1);
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.purple}" stop-opacity=".32"/><stop offset="1" stop-color="${C.purple}" stop-opacity=".12"/></linearGradient>`
    + `<path d="${line} L${x + w},${y + h} L${x},${y + h} Z" fill="url(#${id})"/>`
    + `<path d="${line}" fill="none" stroke="${C.purpleL}" stroke-width="1.4" stroke-linejoin="round"/>`
    + `<circle cx="${last[0]}" cy="${last[1]}" r="3" fill="${C.purpleL}"/>`;
}
const progress = (x, y, w, ratio) => rect(x, y, w, 7, 3.5, '#26262b') + rect(x, y, Math.max(7, w * Math.min(1, ratio)), 7, 3.5, C.purpleBtn);

// ─────────────────────────── Dashboard ───────────────────────────
function render(d) {
  const W = 1080, SW = 220, CX = 252, CW = 796, R = CX + CW;
  const days = d.days;
  const last30 = days.slice(-30), prev30 = days.slice(-60, -30);
  const sum = (a) => a.reduce((s, x) => s + x.count, 0);
  const active = (a) => a.filter((x) => x.count > 0).length;
  const s30 = sum(last30), p30 = sum(prev30);
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) streak++;
    else if (i === days.length - 1) continue; // aujourd'hui pas encore commencé
    else break;
  }
  let best = 0, run = 0;
  for (const x of days) { run = x.count ? run + 1 : 0; best = Math.max(best, run); }

  const week = d.activity.filter((a) => NOW - a.date < 7 * DAY);
  const failed7 = week.filter((a) => a.status === 'failed').length;
  const running = d.activity.filter((a) => a.status === 'running').length;
  const pushes7 = week.length;
  const stars = d.own.reduce((a, r) => a + r.stargazers_count, 0);
  const active30 = d.own.filter((r) => NOW - new Date(r.pushed_at) < 30 * DAY).length;
  const followers = d.user.followers ?? 0, following = d.user.following ?? 0;
  const nRepos = d.user.public_repos ?? d.own.length;

  const body = [];
  const defs = [];
  let y = 0;

  // ── Barre du haut ──
  defs.push(`<linearGradient id="top" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0a0e18"/><stop offset=".55" stop-color="#0b1520"/><stop offset="1" stop-color="#0d2a31"/></linearGradient>`);
  body.push(`<rect width="${W}" height="48" fill="url(#top)"/>`, hline(0, W, 47.5, '#18202a'));
  body.push(t(18, 30, USER.toUpperCase(), { size: 15, weight: 700, ls: 0.8 }));
  const logoW = tw(USER.toUpperCase(), 15, { bold: true }) + USER.length * 0.8 + 18;
  body.push(icon('panel', logoW + 14, 17, 14, C.muted));
  const pillX = logoW + 42;
  const pillW = tw(USER, 12, { bold: true }) + 58;
  body.push(rect(pillX + 0.5, 11.5, pillW, 25, 12.5, 'rgba(255,255,255,0.03)', '#2b3340'));
  body.push(d.avatar ? `<clipPath id="pa"><circle cx="${pillX + 15}" cy="24" r="8"/></clipPath><image href="data:${d.avatar.type};base64,${d.avatar.data}" x="${pillX + 7}" y="16" width="16" height="16" clip-path="url(#pa)"/>` : `<circle cx="${pillX + 15}" cy="24" r="8" fill="${C.purple}"/>`);
  body.push(t(pillX + 29, 28, USER, { size: 12, weight: 600 }), icon('updown', pillX + pillW - 18, 18, 11, C.muted));
  const sx = 380, sw = 360;
  body.push(rect(sx + 0.5, 9.5, sw, 29, 14.5, 'rgba(255,255,255,0.025)', '#2b3340'));
  body.push(icon('search', sx + 13, 17, 14, C.text2), t(sx + 36, 28.5, 'Rechercher un projet, un dépôt, un commit…', { size: 12, fill: C.text2 }));
  body.push(rect(sx + sw - 38, 14, 30, 20, 6, '#232a36'), t(sx + sw - 23, 28, '⌘K', { size: 10.5, weight: 600, anchor: 'middle', fill: C.text2 }));
  body.push(rect(W - 82.5, 9.5, 29, 29, 8, 'rgba(255,255,255,0.02)', '#2b3340'), icon('bell', W - 75, 17, 14, C.text2));
  if (pushes7) body.push(`<circle cx="${W - 55}" cy="11" r="7" fill="${C.red}"/>`, t(W - 55, 14.5, String(Math.min(pushes7, 9)), { size: 9, weight: 700, anchor: 'middle' }));
  body.push(d.avatar ? `<clipPath id="ta"><circle cx="${W - 30}" cy="24" r="13"/></clipPath><image href="data:${d.avatar.type};base64,${d.avatar.data}" x="${W - 43}" y="11" width="26" height="26" clip-path="url(#ta)"/>` : `<circle cx="${W - 30}" cy="24" r="13" fill="${C.purple}"/>`);

  y = 76;

  // ── 1. Accueil ──
  const heroH = 266;
  defs.push(`<pattern id="dots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".9" fill="#2a2a30"/></pattern>`,
    `<linearGradient id="fadeL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.card}"/><stop offset=".35" stop-color="${C.card}" stop-opacity="0"/></linearGradient>`,
    `<clipPath id="heroClip"><rect x="${CX + 1}" y="${y + 1}" width="${CW - 2}" height="${heroH - 2}" rx="13"/></clipPath>`);
  body.push(card(CX, y, CW, heroH));
  body.push(`<g clip-path="url(#heroClip)"><rect x="${CX + CW * 0.52}" y="${y}" width="${CW * 0.48}" height="${heroH}" fill="url(#dots)"/><rect x="${CX + CW * 0.52}" y="${y}" width="${CW * 0.48}" height="${heroH}" fill="url(#fadeL)"/></g>`);
  const dateStr = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(NOW);
  body.push(t(CX + 28, y + 36, dateStr[0].toUpperCase() + dateStr.slice(1), { size: 11.5, fill: C.faint }));
  body.push(t(CX + 28, y + 70, PROFILE.greeting, { size: 25, weight: 700 }));
  const ok = failed7 === 0;
  const statusTxt = ok
    ? `${pushes7 ? plural(pushes7, 'push', 'pushs') + ' cette semaine' : 'Semaine calme'}, tout fonctionne normalement.`
    : `${plural(failed7, 'build en échec', 'builds en échec')} cette semaine, le reste fonctionne normalement.`;
  body.push(`<circle cx="${CX + 32}" cy="${y + 104}" r="3.5" fill="${ok ? C.green : C.amber}"/>`, t(CX + 43, y + 108.5, statusTxt, { size: 12.5, fill: C.text2 }));
  const kpis = [
    { label: 'Dépôts publics', value: nf(nRepos), extra: `/ ${nf(active30)} actifs` },
    { label: 'Étoiles', value: nf(stars) },
    { label: 'Contributions (1 an)', value: nf(d.totals.year) },
  ];
  let kx = CX + 28;
  kpis.forEach((k, i) => {
    body.push(t(kx, y + 148, k.label, { size: 11.5, fill: C.faint }));
    body.push(t(kx, y + 178, k.value, { size: 22, weight: 700 }));
    if (k.extra) body.push(t(kx + tw(k.value, 22, { bold: true }) + 6, y + 178, k.extra, { size: 12, fill: C.faint }));
    const bw = Math.max(tw(k.label, 11.5), tw(k.value, 22, { bold: true }) + (k.extra ? tw(k.extra, 12) + 6 : 0));
    kx += bw + 24;
    if (i < kpis.length - 1) body.push(vline(kx, y + 134, y + 184));
    kx += 24;
  });
  const b1 = button(CX + 28, y + 206, 'Voir mes projets', { variant: 'white', iconName: 'plus' });
  const b2 = button(CX + 28 + b1.w + 8, y + 206, 'design-to-dev', { iconName: 'rocket' });
  body.push(b1.svg, b2.svg);
  // Panneau « En ce moment »
  const pw = 344, px = R - 26 - pw, py = y + 26, rowH = 58, ph = 44 + rowH * PROFILE.focus.length;
  body.push(rect(px + 0.5, py + 0.5, pw - 1, ph - 1, 12, C.card, C.border2));
  body.push(t(px + 16, py + 27, 'En ce moment', { size: 12.5, weight: 600 }));
  body.push(rect(R - 26 - 36, py + 14, 22, 19, 5, '#2a2110'), t(R - 26 - 25, py + 27.5, String(PROFILE.focus.length), { size: 11, weight: 600, anchor: 'middle', fill: C.amberL }));
  PROFILE.focus.forEach((f, i) => {
    const ry = py + 44 + i * rowH;
    body.push(hline(px + 1, px + pw - 1, ry, C.border));
    body.push(rect(px + 14.5, ry + 13.5, 31, 31, 8, '#18181b', C.border2), icon(f.icon, px + 22, ry + 21, 16, f.color));
    body.push(t(px + 58, ry + 26, f.name, { size: 12.5, mono: true, weight: 500 }), t(px + 58, ry + 43, f.sub, { size: 11, fill: C.faint }));
    body.push(icon('right', px + pw - 28, ry + 22, 13, C.faint));
  });
  y += heroH + 16;

  // ── 2. Graphique 30 jours ──
  const chartH = 386;
  body.push(card(CX, y, CW, chartH));
  const delta = (a, b, kind) => {
    if (kind === 'pct') { if (!b) return a ? { s: 'nouveau', c: C.greenL } : { s: '=', c: C.faint }; const v = ((a - b) / b) * 100; return { s: `${v >= 0 ? '+' : ''}${nf(v, 1)} %`, c: v >= 0 ? C.greenL : C.redL }; }
    const v = a - b; return { s: v === 0 ? '=' : `${v > 0 ? '+' : ''}${nf(v, kind === 'dec' ? 1 : 0)}${kind === 'days' ? ' j' : ''}`, c: v > 0 ? C.greenL : v < 0 ? C.redL : C.faint };
  };
  const ck = [
    { label: 'Contributions', dot: C.purple, value: nf(s30), d: delta(s30, p30, 'pct'), color: C.text },
    { label: 'Jours actifs', dot: C.green, value: `${active(last30)} / 30`, d: delta(active(last30), active(prev30), 'days'), color: C.muted },
    { label: 'Moyenne / jour', dot: C.teal, value: nf(s30 / 30, 1), d: delta(s30 / 30, p30 / 30, 'dec'), color: C.muted },
  ];
  kx = CX + 24;
  ck.forEach((k, i) => {
    body.push(`<circle cx="${kx + 3.5}" cy="${y + 30}" r="3.5" fill="${k.dot}"${i ? ' opacity=".8"' : ''}/>`, t(kx + 13, y + 34, k.label, { size: 11.5, fill: i ? C.faint : C.muted }));
    body.push(t(kx, y + 70, k.value, { size: 26, weight: 600, fill: k.color }));
    const vw = tw(k.value, 26, { bold: true });
    body.push(t(kx + vw + 8, y + 70, k.d.s, { size: 11, weight: 600, fill: k.d.c }));
    const bw = Math.max(tw(k.label, 11.5) + 13, vw + 8 + tw(k.d.s, 11, { bold: true }));
    kx += bw + 28;
    if (i < ck.length - 1) body.push(vline(kx, y + 22, y + 78));
    kx += 28;
  });
  body.push(chip(R - 24 - tw('30 derniers jours', 11, { mono: true }) - 16, y + 20, '30 derniers jours', { color: C.text, weight: 600 }).svg);
  // tracé (moyenne glissante 3 j pour une courbe lisible)
  const raw = last30.map((x) => x.count);
  const vals = raw.map((_, i) => { const w = raw.slice(Math.max(0, i - 1), i + 2); return w.reduce((a, b) => a + b, 0) / w.length; });
  const top = y + 104, bot = y + 334, x0 = CX + 24, x1 = R - 24;
  const ymax = Math.max(4, Math.ceil((Math.max(...vals) * 1.2) / 4) * 4);
  for (let k = 4; k >= 1; k--) {
    const gy = bot - ((bot - top) * k) / 4;
    body.push(hline(x0, x1, gy, '#19191c'), t(x1, gy - 5, nf(Math.round((ymax * k) / 4)), { size: 9.5, mono: true, fill: C.faint2, anchor: 'end' }));
  }
  const pts = vals.map((v, i) => [x0 + (i * (x1 - x0)) / (vals.length - 1), bot - (v / ymax) * (bot - top)]);
  const line = smoothPath(pts);
  defs.push(`<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.purple}" stop-opacity=".22"/><stop offset="1" stop-color="${C.purple}" stop-opacity="0"/></linearGradient>`,
    `<clipPath id="plot"><rect x="${x0}" y="${top - 6}" width="${x1 - x0}" height="${bot - top + 6}"/></clipPath>`);
  body.push(`<g clip-path="url(#plot)"><path d="${line} L${x1},${bot} L${x0},${bot} Z" fill="url(#area)"/><path d="${line}" fill="none" stroke="${C.purple}" stroke-width="1.8" stroke-linecap="round"/></g>`);
  [0, 7, 14, 22, 29].forEach((i, j) => {
    if (!last30[i]) return;
    body.push(t(pts[i][0], y + 362, shortDate(last30[i].date), { size: 10, fill: C.faint, anchor: j === 0 ? 'start' : j === 4 ? 'end' : 'middle' }));
  });
  y += chartH + 16;

  // ── 3. Activité récente + Langages ──
  const gap = 16, lw = 448, rw = CW - lw - gap, rows = 5, rh = 66, colH = 50 + rows * rh;
  body.push(card(CX, y, lw, colH), card(CX + lw + gap, y, rw, colH));
  body.push(t(CX + 20, y + 30, 'Activité récente', { size: 13.5, weight: 600 }));
  body.push(t(CX + lw - 38, y + 30, 'Tout voir', { size: 11.5, fill: C.muted, anchor: 'end' }), icon('arrowR', CX + lw - 33, y + 21, 12, C.muted));
  const ST = {
    success: { i: 'ok', c: C.green, l: 'Réussi' }, failed: { i: 'ko', c: C.red, l: 'Échec' },
    running: { i: 'wait', c: C.amber, l: 'En cours' }, none: { i: 'ok', c: C.green, l: 'Publié' },
  };
  d.activity.slice(0, rows).forEach((a, i) => {
    const ry = y + 50 + i * rh;
    body.push(hline(CX + 1, CX + lw - 1, ry, C.border));
    body.push(rect(CX + 20.5, ry + 13.5, 39, 39, 9, '#18181b', C.border2), icon('commit', CX + 31, ry + 24, 17, C.text2));
    const maxChars = a.preview ? 19 : 27;
    const title = trunc(a.title, maxChars);
    body.push(t(CX + 74, ry + 30, title, { size: 13, weight: 600 }));
    if (a.preview) {
      const bx = CX + 74 + tw(title, 13, { bold: true }) + 8;
      body.push(chip(bx, ry + 17, 'Preview', { mono: false, size: 10, h: 18, fill: '#1f1f23', color: C.text2, weight: 600 }).svg);
    }
    body.push(t(CX + 74, ry + 48, [a.repo, a.sha, a.branch].filter(Boolean).join(' · '), { size: 11, fill: C.faint }));
    const st = ST[a.status];
    body.push(icon(st.i, CX + 286, ry + 26, 14, st.c), t(CX + 306, ry + 37, st.l, { size: 12.5 }));
    body.push(t(CX + lw - 20, ry + 37, relTime(a.date), { size: 11.5, fill: C.faint, anchor: 'end' }));
  });
  if (!d.activity.length) body.push(t(CX + 20, y + 90, 'Aucune activité publique pour le moment.', { size: 12.5, fill: C.faint }));

  const LX = CX + lw + gap;
  body.push(t(LX + 20, y + 30, 'Langages', { size: 13.5, weight: 600 }));
  body.push(t(LX + rw - 38, y + 30, 'Dépôts', { size: 11.5, fill: C.muted, anchor: 'end' }), icon('arrowR', LX + rw - 33, y + 21, 12, C.muted));
  const LC = { TypeScript: '#3178c6', JavaScript: '#e0b712', Python: '#3572a5', HTML: '#e34c26', CSS: '#663399', Go: '#00add8', Rust: '#b7410e', Shell: '#4eaa25', PowerShell: '#2b5797', Java: '#b07219', Vue: '#41b883', Svelte: '#ff3e00', 'C#': '#178600', 'C++': '#f34b7d', C: '#555', Dockerfile: '#384d54', MDX: '#e0a800', SCSS: '#c6538c', PLpgSQL: '#336791', Kotlin: '#a97bff', Swift: '#f05138', Dart: '#00b4ab', Lua: '#000080', Ruby: '#cc342d', PHP: '#4f5d95' };
  const abbr = (n) => ({ TypeScript: 'TS', JavaScript: 'JS', Python: 'Py', PowerShell: 'PS', Dockerfile: 'Dk', PLpgSQL: 'SQL', 'C#': 'C#', 'C++': 'C++' }[n] || n.slice(0, 2));
  d.langs.slice(0, rows).forEach((l, i) => {
    const ry = y + 50 + i * rh;
    body.push(hline(LX + 1, LX + rw - 1, ry, C.border));
    const col = LC[l.name] || C.purple;
    body.push(rect(LX + 20, ry + 13, 40, 40, 10, col), t(LX + 40, ry + 37.5, abbr(l.name), { size: 12, weight: 700, anchor: 'middle', fill: '#fff' }));
    body.push(t(LX + 74, ry + 29, l.name.toLowerCase(), { size: 12.5, mono: true, weight: 500 }));
    const segs = Math.max(1, Math.round(l.pct / 25));
    for (let s = 0; s < 4; s++) body.push(rect(LX + 74 + s * 32, ry + 40, 27, 4, 2, s < segs ? C.purpleBtn : '#2a2a30'));
    body.push(t(LX + 74 + 4 * 32 + 6, ry + 45, `${nf(l.pct, l.pct < 10 ? 1 : 0)} % du code`, { size: 11, fill: C.faint }));
  });
  if (!d.langs.length) body.push(t(LX + 20, y + 90, 'Pas encore de code public.', { size: 12.5, fill: C.faint }));
  y += colH + 40;

  // ── 4. Monitoring ──
  body.push(t(CX, y, 'Monitoring', { size: 22, weight: 600 }));
  y += 22;
  const tileW = (CW - 48 - 24) / 3, tileH = 108;
  const monH = 24 + 50 + 16 + 42 + 16 + tileH * 2 + 12 + 24;
  body.push(card(CX, y, CW, monH));
  defs.push(`<linearGradient id="ib" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a40"/><stop offset="1" stop-color="#1c1c20"/></linearGradient>`);
  body.push(rect(CX + 24.5, y + 24.5, 47, 47, 11, 'url(#ib)', '#3a3a40'), icon('pulse', CX + 37, y + 37, 22, C.text));
  body.push(t(CX + 86, y + 44, 'Profil', { size: 17, weight: 600 }));
  const ac = chip(CX + 86 + tw('Profil', 17, { bold: true }) + 12, y + 28, plural(active30, 'dépôt actif', 'dépôts actifs'), { mono: false, size: 11.5, fill: '#2a2110', stroke: null, color: C.amberL, weight: 600 });
  body.push(ac.svg);
  body.push(t(CX + 86, y + 65, `${plural(nRepos, 'dépôt public', 'dépôts publics')} · ${PROFILE.place} · ${PROFILE.languages}`, { size: 11.5, fill: C.faint }));
  const gb = button(0, 0, 'design-to-dev', { iconName: null, h: 34 });
  const gx = R - 24 - gb.w - 18;
  const gbb = button(gx, y + 31, 'design-to-dev', { h: 34 });
  body.push(gbb.svg, icon('ext', gx + gb.w - 6, y + 43, 11, C.text2));
  const fwLabel = 'Suivre sur GitHub';
  const fw = Math.round(tw(fwLabel, 12.5, { bold: true }) + 34);
  const fx = gx - 10 - fw - 38;
  body.push(`<path d="M${fx + 7},${y + 30} H${fx + fw + 38 - 7} a7,7 0 0 1 7,7 V${y + 61} a7,7 0 0 1 -7,7 H${fx + 7} a7,7 0 0 1 -7,-7 V${y + 37} a7,7 0 0 1 7,-7 Z" fill="${C.purpleBtn}"/>`);
  body.push(t(fx + fw / 2, y + 53.5, fwLabel, { size: 12.5, weight: 600, anchor: 'middle' }), vline(fx + fw, y + 30, y + 68, 'rgba(255,255,255,0.25)'), icon('down', fx + fw + 12, y + 42, 14, C.text));
  let iy = y + 24 + 50 + 16;
  body.push(rect(CX + 24, iy, CW - 48, 42, 10, C.inset));
  const since = d.user.created_at ? new Date(d.user.created_at).getFullYear() : '—';
  const lastAct = d.activity[0] ? relTime(d.activity[0].date) : '—';
  const info = [['Followers : ', nf(followers), true], ['Membre depuis : ', String(since), true], ['Dernière activité : ', lastAct, false]];
  let ix = CX + 42;
  info.forEach(([k, v, mono], i) => {
    body.push(t(ix, iy + 26, k, { size: 12, fill: C.muted }));
    const kw = tw(k, 12);
    body.push(t(ix + kw + 4, iy + 26, v, { size: 12, weight: 600, mono, fill: C.text }));
    ix += kw + 4 + tw(v, 12, { mono, bold: true }) + 16;
    if (i < info.length - 1) { body.push(vline(ix, iy + 13, iy + 29, C.border2)); ix += 16; }
  });
  body.push(t(R - 42, iy + 26, 'Ça pédale en dessous', { size: 12, weight: 600, fill: C.purpleL, anchor: 'end' }));
  iy += 42 + 16;
  // Tuiles
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7).reduce((a, x) => a + x.count, 0));
  const activeYear = active(days);
  const tiles = [
    { title: 'Contributions', value: nf(d.totals.year), unit: '', cap: '12 derniers mois', spark: weeks.slice(-26) },
    { title: 'Activité du mois', value: nf(s30), unit: 'contrib.', cap: '30 derniers jours', spark: raw },
    { title: 'Jours actifs', value: nf(activeYear), unit: `/ ${nf(days.length)} j`, cap: 'Sur un an', bar: activeYear / (days.length || 1) },
    { title: 'Série record', value: nf(best), unit: 'j', cap: `Série en cours : ${plural(streak, 'jour', 'jours')}`, bar: best ? streak / best : 0 },
    { title: 'Commits', value: d.totals.commits != null ? nf(d.totals.commits) : '—', unit: '', cap: `PR : ${d.totals.prs ?? '—'} · Issues : ${d.totals.issues ?? '—'}`, spark: weeks.slice(-12) },
    { title: 'Dépôts actifs', value: nf(active30), unit: `/ ${nf(nRepos)}`, cap: 'Poussés ce mois-ci', bar: nRepos ? active30 / nRepos : 0 },
  ];
  tiles.forEach((tl, i) => {
    const tx = CX + 24 + (i % 3) * (tileW + 12), ty = iy + Math.floor(i / 3) * (tileH + 12);
    body.push(rect(tx + 0.5, ty + 0.5, tileW - 1, tileH - 1, 12, C.card, C.border2));
    body.push(t(tx + 18, ty + 28, tl.title, { size: 12.5, weight: 600 }), icon('right', tx + tileW - 28, ty + 17, 13, C.faint));
    body.push(t(tx + 18, ty + 66, tl.value, { size: 24, weight: 700 }));
    if (tl.unit) body.push(t(tx + 18 + tw(tl.value, 24, { bold: true }) + 6, ty + 66, tl.unit, { size: 11.5, fill: C.faint }));
    body.push(t(tx + 18, ty + 88, tl.cap, { size: 11, fill: C.faint }));
    if (tl.spark) body.push(sparkline(tx + tileW - 18 - 104, ty + 48, 104, 40, tl.spark));
    if (tl.bar != null) body.push(progress(tx + tileW - 18 - 104, ty + 58, 104, tl.bar));
  });
  y += monH + 16;

  // ── 5. Mini-tuiles ──
  const mini = [
    { i: 'users', l: 'Followers', v: nf(followers) }, { i: 'star', l: 'Étoiles', v: nf(stars) },
    { i: 'file', l: 'Gists', v: nf(d.user.public_gists ?? 0) }, { i: 'code', l: 'Langages', v: nf(d.langs.length) },
  ];
  const mw = (CW - 3 * 12) / 4;
  mini.forEach((m, i) => {
    const mx = CX + i * (mw + 12);
    body.push(card(mx, y, mw, 70), icon(m.i, mx + 18, y + 18, 13, C.muted), t(mx + 38, y + 29, m.l, { size: 12.5, fill: C.muted }));
    body.push(t(mx + 18, y + 54, m.v, { size: 15, weight: 700 }), icon('right', mx + mw - 30, y + 29, 13, C.faint));
  });
  y += 70 + 40;

  // ── 6. Stack ──
  body.push(t(CX, y, 'Stack & outils', { size: 22, weight: 600 }));
  y += 22;
  const srh = 58, stackH = 44 + PROFILE.stack.length * srh;
  body.push(card(CX, y, CW, stackH));
  body.push(t(CX + 24, y + 27, 'Catégorie', { size: 11.5, weight: 500, fill: C.muted }), icon('sort', CX + 24 + tw('Catégorie', 11.5) + 6, y + 17.5, 12, C.faint));
  body.push(t(CX + 230, y + 27, 'Outils', { size: 11.5, weight: 500, fill: C.text }), icon('sort', CX + 230 + tw('Outils', 11.5) + 6, y + 17.5, 12, C.text2));
  PROFILE.stack.forEach((s, i) => {
    const ry = y + 44 + i * srh;
    body.push(hline(CX + 1, R - 1, ry, C.border));
    body.push(t(CX + 24, ry + 26, s.label, { size: 13, weight: 600 }), t(CX + 24, ry + 43, s.sub, { size: 11, fill: C.faint }));
    let cx2 = CX + 230;
    for (const it of s.items) { const c = chip(cx2, ry + 18, it.toLowerCase(), { size: 11.5 }); body.push(c.svg); cx2 += c.w + 8; }
    body.push(rect(R - 24 - 29.5, ry + 15.5, 28, 28, 7, C.card, C.border2), icon('dots', R - 24 - 22, ry + 23, 14, C.text2));
  });
  y += stackH + 36;

  const H = Math.round(y);
  // ── Barre latérale (hauteur totale) ──
  const side = [];
  side.push(`<rect x="0" y="48" width="${SW}" height="${H - 48}" fill="${C.side}"/>`, vline(SW - 1, 48, H, C.line));
  const nav = [
    { s: 'PILOTAGE' },
    { i: 'gauge', l: "Vue d'ensemble", active: true },
    { i: 'layers', l: 'Projets' },
    { i: 'rocket', l: 'Activité', badge: pushes7 },
    { i: 'chart', l: 'Monitoring' },
    { i: 'shield', l: 'Sécurité' },
    { s: 'RESSOURCES' },
    { i: 'book', l: 'Dépôts', n: nRepos },
    { i: 'star', l: 'Étoiles', n: stars },
    { i: 'users', l: 'Followers', n: followers },
    { i: 'userPlus', l: 'Abonnements', n: following },
    { i: 'code', l: 'Langages', n: d.langs.length },
    { s: 'PLATEFORME' },
    { i: 'file', l: 'Gists', n: d.user.public_gists ?? 0 },
    { i: 'settings', l: 'Paramètres' },
  ];
  let ny = 76, first = true;
  for (const it of nav) {
    if (it.s) { if (!first) ny += 4; side.push(t(18, ny, it.s, { size: 9.5, weight: 500, fill: C.faint, ls: 1 })); ny += 30; first = false; continue; }
    if (it.active) side.push(rect(12, ny - 17, SW - 26, 34, 8, '#1c1c1f'));
    side.push(icon(it.i, 22, ny - 8, 15, it.active ? C.text : C.muted), t(46, ny + 4.5, it.l, { size: 13.5, weight: 500, fill: it.active ? C.text : '#e4e4e7' }));
    if (it.badge) side.push(`<circle cx="${SW - 30}" cy="${ny}" r="8.5" fill="${C.green}"/>`, t(SW - 30, ny + 3.8, String(Math.min(it.badge, 99)), { size: 10, weight: 700, anchor: 'middle', fill: '#052e16' }));
    else if (it.n != null) side.push(t(SW - 24, ny + 4, nf(it.n), { size: 11, fill: C.faint, anchor: 'end' }));
    ny += 38;
  }
  const fy = H - 64;
  side.push(hline(0, SW - 1, fy, C.line));
  side.push(d.avatar ? `<clipPath id="sa"><circle cx="34" cy="${fy + 32}" r="15"/></clipPath><image href="data:${d.avatar.type};base64,${d.avatar.data}" x="19" y="${fy + 17}" width="30" height="30" clip-path="url(#sa)"/>` : `<circle cx="34" cy="${fy + 32}" r="15" fill="${C.purple}"/>`);
  side.push(`<circle cx="45" cy="${fy + 43}" r="4.5" fill="${C.green}" stroke="${C.side}" stroke-width="2"/>`);
  side.push(t(58, fy + 29, USER, { size: 12.5, weight: 600 }), t(58, fy + 45, 'Builder · IA · ' + PROFILE.place, { size: 10.5, fill: C.faint }));
  side.push(icon('updown', SW - 34, fy + 25, 13, C.muted));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="ttl">
<title id="ttl">Tableau de bord GitHub de ${esc(USER)}</title>
<style>${d.fonts}</style>
<defs>${defs.join('')}<clipPath id="win"><rect width="${W}" height="${H}" rx="14"/></clipPath></defs>
<g clip-path="url(#win)">
<rect width="${W}" height="${H}" fill="${C.page}"/>
${side.join('\n')}
${body.join('\n')}
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="#1f1f23"/>
</svg>`;
}

// Bouton cliquable autonome pour le README
function buttonSvg(label, { variant, mark, iconName, fonts }) {
  const h = 40, size = 13.5, pad = 16, iw = 24;
  const w = Math.round(tw(label, size, { bold: true }) + pad * 2 + iw);
  const bg = variant === 'white' ? '#f4f4f5' : variant === 'purple' ? C.purpleBtn : C.card;
  const fg = variant === 'white' ? '#0a0a0b' : C.text;
  const ic = mark ? `<path transform="translate(${pad} ${h / 2 - 8})" d="${GH_MARK}" fill="${fg}"/>` : icon(iconName, pad, h / 2 - 8, 16, fg);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><style>${fonts}</style>`
    + rect(0.5, 0.5, w - 1, h - 1, 9, bg, variant === 'dark' ? C.border2 : null) + ic
    + t(pad + iw, h / 2 + size * 0.36, label, { size, weight: 500, fill: fg }) + '</svg>';
}

const data = await collect();
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'dashboard.svg'), render(data));
await writeFile(join(OUT, 'btn-github.svg'), buttonSvg(`Suivre ${USER}`, { variant: 'purple', mark: true, fonts: data.fonts }));
await writeFile(join(OUT, 'btn-design-to-dev.svg'), buttonSvg('design-to-dev', { variant: 'dark', iconName: 'rocket', fonts: data.fonts }));
await writeFile(join(OUT, 'btn-repos.svg'), buttonSvg('Voir mes projets', { variant: 'white', iconName: 'layers', fonts: data.fonts }));
console.log(`✓ ${OUT}/dashboard.svg · ${data.activity.length} pushs · ${data.langs.length} langages · ${data.days.length} jours · polices ${data.fonts ? 'embarquées' : 'système'}`);
