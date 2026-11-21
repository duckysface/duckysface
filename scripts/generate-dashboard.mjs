#!/usr/bin/env node
// Génère les cartes SVG du profil GitHub (style dashboard sombre), à partir des vraies données GitHub.
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

// ─────────────────────────── Cartes du profil ───────────────────────────
const W = 840, P = 24;

// Enveloppe commune : fond de carte, bord, polices
function frame(name, h, inner, defs = '', fonts = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-labelledby="t-${name}">
<title id="t-${name}">${esc(name)}</title>
<style>${fonts}</style>
<defs>${defs}<clipPath id="c-${name}"><rect x="1" y="1" width="${W - 2}" height="${h - 2}" rx="15"/></clipPath></defs>
<rect x=".5" y=".5" width="${W - 1}" height="${h - 1}" rx="16" fill="${C.card}" stroke="${C.border}"/>
<g clip-path="url(#c-${name})">${inner}</g>
</svg>`;
}
// En-tête de carte : titre + petite info à droite
function head(title, right) {
  let s = t(P, 38, title, { size: 15, weight: 600 });
  if (right) s += t(W - P, 38, right, { size: 11.5, fill: C.faint, anchor: 'end' });
  return s + hline(1, W - 1, 58, C.border);
}

function metrics(d) {
  const days = d.days;
  const last30 = days.slice(-30), prev30 = days.slice(-60, -30);
  const sum = (a) => a.reduce((s, x) => s + x.count, 0);
  const active = (a) => a.filter((x) => x.count > 0).length;
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) streak++;
    else if (i === days.length - 1) continue;
    else break;
  }
  let best = 0, run = 0;
  for (const x of days) { run = x.count ? run + 1 : 0; best = Math.max(best, run); }
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7).reduce((a, x) => a + x.count, 0));
  const week = d.activity.filter((a) => NOW - a.date < 7 * DAY);
  return {
    last30, prev30, s30: sum(last30), p30: sum(prev30), a30: active(last30), ap30: active(prev30),
    activeYear: active(days), streak, best, weeks,
    pushes7: week.length, failed7: week.filter((a) => a.status === 'failed').length,
    stars: d.own.reduce((a, r) => a + r.stargazers_count, 0),
    active30: d.own.filter((r) => NOW - new Date(r.pushed_at) < 30 * DAY).length,
    nRepos: d.user.public_repos ?? d.own.length,
  };
}

// 1. Accueil
function heroCard(d, m) {
  const h = 266;
  const defs = `<pattern id="dots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".9" fill="#2a2a30"/></pattern>
<linearGradient id="fadeL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.card}"/><stop offset=".4" stop-color="${C.card}" stop-opacity="0"/></linearGradient>
<radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(0 0) scale(420 260)"><stop offset="0" stop-color="${C.purple}" stop-opacity=".13"/><stop offset="1" stop-color="${C.purple}" stop-opacity="0"/></radialGradient>`;
  const s = [];
  s.push(`<rect width="${W}" height="${h}" fill="url(#glow)"/>`);
  s.push(`<rect x="${W * 0.5}" width="${W * 0.5}" height="${h}" fill="url(#dots)"/><rect x="${W * 0.5}" width="${W * 0.5}" height="${h}" fill="url(#fadeL)"/>`);
  if (d.avatar) s.push(`<clipPath id="av"><circle cx="${P + 13}" cy="33" r="13"/></clipPath><image href="data:${d.avatar.type};base64,${d.avatar.data}" x="${P}" y="20" width="26" height="26" clip-path="url(#av)"/>`);
  s.push(t(P + (d.avatar ? 36 : 0), 37.5, `@${USER} · ${PROFILE.place}`, { size: 12, fill: C.faint }));
  s.push(t(P, 80, PROFILE.greeting, { size: 26, weight: 700 }));
  s.push(`<circle cx="${P + 4}" cy="105" r="3.5" fill="${C.green}"/>`, t(P + 15, 109.5, `${PROFILE.tagline}. ${PROFILE.motto}.`, { size: 12.5, fill: C.text2 }));
  const kpis = [
    { label: 'Dépôts publics', value: nf(m.nRepos), extra: `/ ${nf(m.active30)} actifs` },
    { label: 'Étoiles', value: nf(m.stars) },
    { label: 'Contributions (1 an)', value: nf(d.totals.year) },
  ];
  let kx = P;
  kpis.forEach((k, i) => {
    s.push(t(kx, 152, k.label, { size: 11.5, fill: C.faint }), t(kx, 182, k.value, { size: 22, weight: 700 }));
    if (k.extra) s.push(t(kx + tw(k.value, 22, { bold: true }) + 6, 182, k.extra, { size: 12, fill: C.faint }));
    const bw = Math.max(tw(k.label, 11.5), tw(k.value, 22, { bold: true }) + (k.extra ? tw(k.extra, 12) + 6 : 0));
    kx += bw + 22;
    if (i < kpis.length - 1) s.push(vline(kx, 138, 188));
    kx += 22;
  });
  let cx = P;
  for (const p of ['design', 'automatisation', 'trading', 'français', 'english']) { const c = chip(cx, 214, p, { size: 11 }); s.push(c.svg); cx += c.w + 7; }
  // Panneau « En ce moment »
  const pw = 318, px = W - P - pw, py = P, rowH = 58, ph = 44 + rowH * PROFILE.focus.length;
  s.push(rect(px + 0.5, py + 0.5, pw - 1, ph - 1, 12, C.card, C.border2));
  s.push(t(px + 16, py + 27, 'En ce moment', { size: 12.5, weight: 600 }));
  s.push(rect(px + pw - 36, py + 14, 22, 19, 5, '#2a2110'), t(px + pw - 25, py + 27.5, String(PROFILE.focus.length), { size: 11, weight: 600, anchor: 'middle', fill: C.amberL }));
  PROFILE.focus.forEach((f, i) => {
    const ry = py + 44 + i * rowH;
    s.push(hline(px + 1, px + pw - 1, ry, C.border));
    s.push(rect(px + 14.5, ry + 13.5, 31, 31, 8, '#18181b', C.border2), icon(f.icon, px + 22, ry + 21, 16, f.color));
    s.push(t(px + 58, ry + 26, f.name, { size: 12.5, mono: true, weight: 500 }), t(px + 58, ry + 43, f.sub, { size: 11, fill: C.faint }));
  });
  return frame('Accueil', h, s.join(''), defs, d.fonts);
}

// 2. Contributions sur 30 jours
function chartCard(d, m) {
  const h = 366, s = [];
  const delta = (a, b, kind) => {
    if (kind === 'pct') { if (!b) return a ? { s: 'nouveau', c: C.greenL } : { s: '=', c: C.faint }; const v = ((a - b) / b) * 100; return { s: `${v >= 0 ? '+' : ''}${nf(v, 1)} %`, c: v >= 0 ? C.greenL : C.redL }; }
    const v = a - b; return { s: v === 0 ? '=' : `${v > 0 ? '+' : ''}${nf(v, kind === 'dec' ? 1 : 0)}${kind === 'days' ? ' j' : ''}`, c: v > 0 ? C.greenL : v < 0 ? C.redL : C.faint };
  };
  const ck = [
    { label: 'Contributions', dot: C.purple, value: nf(m.s30), d: delta(m.s30, m.p30, 'pct'), color: C.text },
    { label: 'Jours actifs', dot: C.green, value: `${m.a30} / 30`, d: delta(m.a30, m.ap30, 'days'), color: C.muted },
    { label: 'Moyenne / jour', dot: C.teal, value: nf(m.s30 / 30, 1), d: delta(m.s30 / 30, m.p30 / 30, 'dec'), color: C.muted },
  ];
  let kx = P;
  ck.forEach((k, i) => {
    s.push(`<circle cx="${kx + 3.5}" cy="30" r="3.5" fill="${k.dot}"/>`, t(kx + 13, 34, k.label, { size: 11.5, fill: i ? C.faint : C.muted }));
    s.push(t(kx, 70, k.value, { size: 26, weight: 600, fill: k.color }));
    const vw = tw(k.value, 26, { bold: true });
    s.push(t(kx + vw + 8, 70, k.d.s, { size: 11, weight: 600, fill: k.d.c }));
    kx += Math.max(tw(k.label, 11.5) + 13, vw + 8 + tw(k.d.s, 11, { bold: true })) + 26;
    if (i < ck.length - 1) s.push(vline(kx, 22, 78));
    kx += 26;
  });
  s.push(chip(W - P - tw('30 derniers jours', 11, { mono: true }) - 16, 20, '30 derniers jours', { color: C.text, weight: 600 }).svg);
  const raw = m.last30.map((x) => x.count);
  const vals = raw.map((_, i) => { const w = raw.slice(Math.max(0, i - 1), i + 2); return w.reduce((a, b) => a + b, 0) / w.length; });
  const top = 104, bot = 314, x0 = P, x1 = W - P;
  const ymax = Math.max(4, Math.ceil((Math.max(...vals) * 1.2) / 4) * 4);
  for (let k = 4; k >= 1; k--) {
    const gy = bot - ((bot - top) * k) / 4;
    s.push(hline(x0, x1, gy, '#19191c'), t(x1, gy - 5, nf(Math.round((ymax * k) / 4)), { size: 9.5, mono: true, fill: C.faint2, anchor: 'end' }));
  }
  const pts = vals.map((v, i) => [x0 + (i * (x1 - x0)) / (vals.length - 1), bot - (v / ymax) * (bot - top)]);
  const line = smoothPath(pts);
  const defs = `<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.purple}" stop-opacity=".22"/><stop offset="1" stop-color="${C.purple}" stop-opacity="0"/></linearGradient><clipPath id="plot"><rect x="${x0}" y="${top - 6}" width="${x1 - x0}" height="${bot - top + 6}"/></clipPath>`;
  s.push(`<g clip-path="url(#plot)"><path d="${line} L${x1},${bot} L${x0},${bot} Z" fill="url(#area)"/><path d="${line}" fill="none" stroke="${C.purple}" stroke-width="1.8" stroke-linecap="round"/></g>`);
  [0, 7, 14, 22, 29].forEach((i, j) => {
    if (m.last30[i]) s.push(t(pts[i][0], 342, shortDate(m.last30[i].date), { size: 10, fill: C.faint, anchor: j === 0 ? 'start' : j === 4 ? 'end' : 'middle' }));
  });
  return frame('Contributions sur 30 jours', h, s.join(''), defs, d.fonts);
}

// 3. Statistiques (tuiles)
function statsCard(d, m) {
  const tileW = (W - P * 2 - 24) / 3, tileH = 104, h = 58 + 20 + tileH * 2 + 12 + P;
  const s = [head('Statistiques', `sur 12 mois · mis à jour ${relTime(NOW)}`)];
  const tiles = [
    { title: 'Contributions', value: nf(d.totals.year), unit: '', cap: '12 derniers mois', spark: m.weeks.slice(-26) },
    { title: 'Activité du mois', value: nf(m.s30), unit: 'contrib.', cap: '30 derniers jours', spark: m.last30.map((x) => x.count) },
    { title: 'Jours actifs', value: nf(m.activeYear), unit: `/ ${nf(d.days.length)} j`, cap: 'Sur un an', bar: m.activeYear / (d.days.length || 1) },
    { title: 'Série record', value: nf(m.best), unit: 'j', cap: `Série en cours : ${plural(m.streak, 'jour', 'jours')}`, bar: m.best ? m.streak / m.best : 0 },
    { title: 'Commits', value: d.totals.commits != null ? nf(d.totals.commits) : '—', unit: '', cap: `PR : ${d.totals.prs ?? '—'} · Issues : ${d.totals.issues ?? '—'}`, spark: m.weeks.slice(-12) },
    { title: 'Dépôts actifs', value: nf(m.active30), unit: `/ ${nf(m.nRepos)}`, cap: 'Poussés ce mois-ci', bar: m.nRepos ? m.active30 / m.nRepos : 0 },
  ];
  tiles.forEach((tl, i) => {
    const tx = P + (i % 3) * (tileW + 12), ty = 78 + Math.floor(i / 3) * (tileH + 12);
    s.push(rect(tx + 0.5, ty + 0.5, tileW - 1, tileH - 1, 12, C.cardHi, C.border2));
    s.push(t(tx + 16, ty + 27, tl.title, { size: 12.5, weight: 600 }));
    s.push(t(tx + 16, ty + 63, tl.value, { size: 24, weight: 700 }));
    if (tl.unit) s.push(t(tx + 16 + tw(tl.value, 24, { bold: true }) + 6, ty + 63, tl.unit, { size: 11.5, fill: C.faint }));
    s.push(t(tx + 16, ty + 85, tl.cap, { size: 11, fill: C.faint }));
    if (tl.spark) s.push(sparkline(tx + tileW - 16 - 92, ty + 44, 92, 38, tl.spark));
    if (tl.bar != null) s.push(progress(tx + tileW - 16 - 92, ty + 56, 92, tl.bar));
  });
  return frame('Statistiques', h, s.join(''), '', d.fonts);
}

// 4. Activité récente
function activityCard(d) {
  const rows = d.activity.slice(0, 5), rh = 62, h = 58 + Math.max(1, rows.length) * rh + 4;
  const s = [head('Activité récente', 'derniers pushs publics · statut des tests GitHub')];
  const ST = {
    success: { i: 'ok', c: C.green, l: 'Réussi' }, failed: { i: 'ko', c: C.red, l: 'Échec' },
    running: { i: 'wait', c: C.amber, l: 'En cours' }, none: { i: 'ok', c: C.green, l: 'Publié' },
  };
  rows.forEach((a, i) => {
    const ry = 58 + i * rh;
    if (i) s.push(hline(1, W - 1, ry, C.line));
    s.push(rect(P + 0.5, ry + 11.5, 39, 39, 9, '#18181b', C.border2), icon('commit', P + 11, ry + 22, 17, C.text2));
    const title = trunc(a.title, a.preview ? 44 : 54);
    s.push(t(P + 54, ry + 28, title, { size: 13, weight: 600 }));
    if (a.preview) s.push(chip(P + 54 + tw(title, 13, { bold: true }) + 8, ry + 15, 'Preview', { mono: false, size: 10, h: 18, fill: '#1f1f23', color: C.text2, weight: 600 }).svg);
    s.push(t(P + 54, ry + 46, [a.repo, a.sha, a.branch].filter(Boolean).join(' · '), { size: 11, fill: C.faint }));
    const st = ST[a.status];
    s.push(icon(st.i, 570, ry + 24, 14, st.c), t(590, ry + 35, st.l, { size: 12.5 }));
    s.push(chip(W - P - tw(relTime(a.date), 11, { mono: true }) - 16, ry + 20, relTime(a.date), { size: 11 }).svg);
  });
  if (!rows.length) s.push(t(P, 96, 'Aucune activité publique pour le moment.', { size: 12.5, fill: C.faint }));
  return frame('Activité récente', h, s.join(''), '', d.fonts);
}

// 5. Langages
function langCard(d) {
  const LC = { TypeScript: '#3178c6', JavaScript: '#e0b712', Python: '#3572a5', HTML: '#e34c26', CSS: '#663399', Go: '#00add8', Rust: '#b7410e', Shell: '#4eaa25', PowerShell: '#2b5797', Java: '#b07219', Vue: '#41b883', Svelte: '#ff3e00', 'C#': '#178600', 'C++': '#f34b7d', Dockerfile: '#384d54', SCSS: '#c6538c', PLpgSQL: '#336791', Kotlin: '#a97bff', Swift: '#f05138', Dart: '#00b4ab', Ruby: '#cc342d', PHP: '#4f5d95' };
  const langs = d.langs.slice(0, 6);
  const rows = Math.ceil(langs.length / 2), h = 58 + 26 + 18 + rows * 36 + 12;
  const s = [head('Langages', 'part du code dans mes dépôts')];
  let bx = P; const bw = W - P * 2;
  s.push(`<clipPath id="bar"><rect x="${P}" y="80" width="${bw}" height="10" rx="5"/></clipPath><g clip-path="url(#bar)"><rect x="${P}" y="80" width="${bw}" height="10" fill="#26262b"/>`);
  langs.forEach((l) => { const w = (bw * l.pct) / 100; s.push(`<rect x="${bx}" y="80" width="${Math.max(w, 2)}" height="10" fill="${LC[l.name] || C.purple}"/>`); bx += w; });
  s.push('</g>');
  const colW = (W - P * 2 - 32) / 2;
  langs.forEach((l, i) => {
    const x = P + (i % 2) * (colW + 32), y = 108 + Math.floor(i / 2) * 36;
    s.push(`<circle cx="${x + 5}" cy="${y + 13}" r="5" fill="${LC[l.name] || C.purple}"/>`);
    s.push(t(x + 20, y + 17.5, l.name.toLowerCase(), { size: 12.5, mono: true, weight: 500 }));
    s.push(t(x + colW, y + 17.5, `${nf(l.pct, l.pct < 10 ? 1 : 0)} %`, { size: 12, mono: true, fill: C.muted, anchor: 'end' }));
    s.push(hline(x, x + colW, y + 30, C.line));
  });
  if (!langs.length) s.push(t(P, 120, 'Pas encore de code public.', { size: 12.5, fill: C.faint }));
  return frame('Langages', h, s.join(''), '', d.fonts);
}

// 6. Stack & outils
function stackCard(d) {
  const srh = 56, h = 58 + PROFILE.stack.length * srh + 4;
  const s = [head('Stack & outils', `en apprentissage : ${PROFILE.learning}`)];
  PROFILE.stack.forEach((st, i) => {
    const ry = 58 + i * srh;
    if (i) s.push(hline(1, W - 1, ry, C.line));
    s.push(t(P, ry + 25, st.label, { size: 13, weight: 600 }), t(P, ry + 42, st.sub, { size: 11, fill: C.faint }));
    let cx = 200;
    for (const it of st.items) { const c = chip(cx, ry + 17, it.toLowerCase(), { size: 11.5 }); s.push(c.svg); cx += c.w + 8; }
  });
  return frame('Stack et outils', h, s.join(''), '', d.fonts);
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
const m = metrics(data);
const cards = { hero: heroCard, contributions: chartCard, stats: statsCard, activity: activityCard, languages: langCard, stack: stackCard };
for (const [name, fn] of Object.entries(cards)) await writeFile(join(OUT, `${name}.svg`), fn(data, m));
await writeFile(join(OUT, 'btn-github.svg'), buttonSvg(`Suivre ${USER}`, { variant: 'purple', mark: true, fonts: data.fonts }));
await writeFile(join(OUT, 'btn-design-to-dev.svg'), buttonSvg('design-to-dev', { variant: 'dark', iconName: 'rocket', fonts: data.fonts }));
await writeFile(join(OUT, 'btn-repos.svg'), buttonSvg('Voir mes projets', { variant: 'white', iconName: 'layers', fonts: data.fonts }));
console.log(`✓ ${OUT} : ${Object.keys(cards).length} cartes · ${data.activity.length} pushs · ${data.langs.length} langages · ${data.days.length} jours · polices ${data.fonts ? 'embarquées' : 'système'}`);
