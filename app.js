'use strict';
// Grok Desk app (plan B). Reads ONE encrypted file from the public repo's `data` branch and decrypts it
// in this browser with AES-GCM (WebCrypto). The key lives only in the open-link fragment (#d=...) and localStorage.
const REPO = 'telmexlumiar20-ai/grok-desk';
const REF_API = `https://api.github.com/repos/${REPO}/git/ref/heads/data`;
const RAW = `https://raw.githubusercontent.com/${REPO}/`;
const POLL_MS = 20000;
const $ = id => document.getElementById(id);
let S = null, KEY = null, PATH = null, lastSha = null, slowPath = false, coinSel = null, lastAuditShown = null;

const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const usd = v => v == null ? '—' : '$' + Number(v).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const kusd = v => v == null ? '?' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Number(v).toFixed(0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const lis = ts => new Date(ts * 1000).toLocaleTimeString('pt-PT', {timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit'});
const lisIso = iso => lis(Date.parse(iso) / 1000);

function keyFromHash(h) { const m = /[#&]d=([A-Za-z0-9_-]{40,})/.exec(h || ''); return m ? m[1] : null; }

async function unlock(k) {
  KEY = await crypto.subtle.importKey('raw', b64u(k), 'AES-GCM', false, ['decrypt']);
  PATH = 'd/' + hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('path:' + k))).slice(0, 24) + '.bin';
}

async function decrypt(buf) {
  const b = new Uint8Array(buf);
  if (b[0] !== 71 || b[1] !== 68 || b[2] !== 49) throw new Error('formato');
  const pt = await crypto.subtle.decrypt({name: 'AES-GCM', iv: b.slice(3, 15)}, KEY, b.slice(15));
  return JSON.parse(new TextDecoder().decode(pt));
}

async function poll() {
  try {
    let url;
    try {
      const r = await fetch(REF_API, {cache: 'no-cache'});   // ETag revalidation: 304s don't count against GitHub's limit
      if (!r.ok) throw new Error('api ' + r.status);
      const sha = (await r.json()).object.sha;
      slowPath = false;
      if (sha === lastSha && S) return renderFresh();
      url = RAW + sha + '/' + PATH; lastSha = sha;            // immutable per commit: no CDN staleness
    } catch (e) {
      slowPath = true; url = RAW + 'data/' + PATH + '?t=' + Date.now();   // fallback: branch URL, CDN up to ~5 min old
    }
    const r2 = await fetch(url, {cache: 'no-store'});
    if (!r2.ok) throw new Error('raw ' + r2.status);
    S = await decrypt(await r2.arrayBuffer());
    window.__deskState = {ok: true, ts: S.ts};
    render();
  } catch (e) {
    window.__deskState = {ok: false, err: String(e)};
    $('fresh').textContent = e.message === 'formato' || e.name === 'OperationError' ? 'chave errada' : 'sem ligação · ' + e.message;
    $('fresh').className = 'fresh stale';
  }
}

function renderFresh() {
  if (!S) return;
  const age = Math.round(Date.now() / 1000 - (S.publishedAt || S.ts));
  const lim = (S.planB?.publishIntervalS || 90) * 2 + 60;
  $('fresh').textContent = `dados de há ${age < 90 ? age + 's' : Math.round(age / 60) + ' min'}` + (slowPath ? ' · via cache' : '');
  $('fresh').className = 'fresh' + (age > lim ? ' stale' : '');
}

// ---------- hand-drawn canvas helpers
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function setup(cv, h) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 340;
  cv.width = w * dpr; cv.height = (h || cv.height / (cv._dpr || 1)) * dpr; cv._dpr = dpr; cv.style.height = (h || cv.height / dpr) + 'px';
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.lineCap = 'round'; c.lineJoin = 'round';
  return [c, w, cv.height / dpr];
}
function rough(c, pts, color, width, r, dash) {
  c.save(); c.strokeStyle = color; c.lineWidth = width; if (dash) c.setLineDash(dash);
  for (let pass = 0; pass < 2; pass++) {
    c.globalAlpha = pass ? .45 : 1; c.beginPath();
    pts.forEach(([x, y], i) => { const jx = (r() - .5) * 1.6, jy = (r() - .5) * 1.6; i ? c.lineTo(x + jx, y + jy) : c.moveTo(x + jx, y + jy); });
    c.stroke();
  }
  c.restore();
}
function roughRect(c, x, y, w, h, color, r) {
  c.save(); c.fillStyle = color; c.globalAlpha = .85;
  c.beginPath(); c.moveTo(x + (r() - .5), y + (r() - .5)); c.lineTo(x + w + (r() - .5), y + (r() - .5));
  c.lineTo(x + w + (r() - .5), y + h + (r() - .5)); c.lineTo(x + (r() - .5), y + h + (r() - .5)); c.closePath(); c.fill(); c.restore();
  rough(c, [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], color, 1.2, r);
}
function ring(cv, score, min) {
  const [c, w, h] = setup(cv, 92), r = rng(score + 7), cx = 46, cy = 46, R = 36;
  const arc = (a0, a1, col, lw) => { const p = []; for (let a = a0; a <= a1; a += .08) p.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]); rough(c, p, col, lw, r); };
  arc(0, Math.PI * 2, '#232a36', 8);
  if (score != null) arc(-Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * score / 100, score >= min ? '#2ecc71' : '#ff9f1a', 8);
  c.fillStyle = '#e8ecf3'; c.font = '700 22px -apple-system,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(score == null ? '—' : score, cx, cy);
}
function disc(cv, layers, beam) {
  const [c] = setup(cv, 92), r = rng(42), cx = 46, cy = 46;
  for (let i = 0; i < 8; i++) {
    const a0 = -Math.PI / 2 + i * Math.PI / 4 + .04, a1 = a0 + Math.PI / 4 - .08, L = layers[i];
    const col = L ? (L.pass ? '#2ecc71' : '#ff5a5f') : (i === beam ? '#33d6ff' : '#232a36');
    const p = []; for (let a = a0; a <= a1; a += .06) p.push([cx + Math.cos(a) * 36, cy + Math.sin(a) * 36]);
    rough(c, p, col, i === beam ? 12 : 9, r);
  }
  if (beam != null && beam < 8) { const a = -Math.PI / 2 + (beam + .5) * Math.PI / 4; rough(c, [[cx, cy], [cx + Math.cos(a) * 30, cy + Math.sin(a) * 30]], '#33d6ff', 3, r); }
}

// ---------- screens
function render() {
  renderFresh();
  const m = $('mode'); m.textContent = S.mode + (S.paused ? ' · pausa' : ''); m.className = 'pill ' + S.mode.toLowerCase();
  $('stack').textContent = usd(S.stack); $('free').textContent = usd(S.free); $('night').textContent = S.night;
  const t = $('ticket'); if (S.ticket) { t.textContent = '⚠ ' + S.ticket.text; t.classList.remove('hidden'); } else t.classList.add('hidden');
  renderCards(); renderActivity(); renderCoin(); renderReport(); renderAccount();
}

function hbBadge(a) { const h = S.heartbeats?.[a]; if (!h) return '<span class="pill red">sem sinal</span>'; const age = S.ts - h.ts; return age > 120 ? `<span class="pill red">${Math.round(age / 60)} min</span>` : '<span class="pill green">vivo</span>'; }

function renderCards() {
  const sc = S.scanner, au = S.auditor, an = S.analyst, ex = S.executor, rk = S.risk, set = S.settings;
  const feed = sc.feed.slice(0, 25).map(s => s.verdict === 'pass'
    ? `<div class="row pass"><span class="n">${esc(s.name)} · liq $${kusd(s.liquidityUsd)} · → auditor</span><span class="r">pass</span></div>`
    : `<div class="row kill"><span class="n">${esc(s.name || s.mint.slice(0, 6))}</span><span class="r">${esc(s.reason)}</span></div>`).join('') || '<div class="muted">À espera da primeira moeda graduada…</div>';
  const last = au.recent[0];
  const strips = au.layers.map((n, i) => { const L = last?.layers?.[i]; const run = au.running && !L;
    return `<div class="strip ${L ? (L.pass ? 'ok' : 'bad') : ''} ${run && i === (last?.layers?.length || 0) ? 'run' : ''}"><b>${i + 1} ${esc(n)}</b>${L ? esc(L.value) : 'not checked'}</div>`; }).join('');
  const auLine = au.running ? 'taking apart…' : last ? (last.passed ? '8/8 → Executor' : esc(last.reason)) : '—';
  const a0 = an.recent[0];
  const e0 = ex.recent[0], pr = ex.progress;
  let bar = '';
  if (pr) { const dur = pr.mode === 'PAPER' ? (set.paper_fill_s || 1.2) : set.live_buy_window_min * 60; const pct = Math.min(99, Math.round(100 * (S.ts - pr.t0) / dur)); bar = `<div class="muted">Executing... ${pct}%</div><div class="bar"><i style="width:${pct}%"></i></div>`; }
  else if (e0 && e0.status === 'bought') bar = `<div class="muted">✓ Filled</div><div class="bar"><i style="width:100%;background:#2ecc71"></i></div>`;
  const lastExit = rk.lastExit ? (rk.lastExit.reason === 'trail' ? 'Trailed out' : rk.lastExit.reason === 'stop' ? 'Stopped' : 'Exited') + ' · ' + esc(rk.lastExit.name) : '—';
  $('cards').innerHTML = `
  <div class="card"><div class="hd"><b>1 · Scanner</b>${hbBadge('scanner')}</div><div class="big">${sc.pools} pools</div>
    <div class="muted">${sc.room} na sala de espera · ${sc.passed} → auditor</div><div class="feed">${feed}</div></div>
  <div class="card"><div class="hd"><b>2 · Auditor</b>${hbBadge('auditor')}</div>
    <div class="flex"><canvas id="disc" style="width:92px;flex:none"></canvas><div><div class="big">${au.audited} taken apart</div><div class="muted">${auLine}${last ? ' · ' + esc(last.mint.slice(0, 4)) + '…' : ''}</div><div class="muted">${au.rejected} rejected${au.gpaDown ? ' · <b style="color:#ff5a5f">layer 8 down</b>' : ''}</div></div></div>
    <div class="strips">${strips}</div></div>
  <div class="card"><div class="hd"><b>3 · Analyst${an.mode === 'rules' ? ' (rules)' : ''}</b>${hbBadge('analyst')}</div>
    <div class="flex"><canvas id="ring" style="width:92px;flex:none"></canvas><div><div class="big">Scoring</div>
    <div class="muted">${an.scored} avaliadas${a0 ? ' · ' + (a0.passed ? 'passou' : esc(a0.failed[0])) : ''}</div>
    ${a0 ? `<div class="muted">alive ${(+a0.answers.alive_6h || 0).toFixed(2)} · organic ${(+a0.answers.organic || 0).toFixed(2)} · flush ${(+a0.answers.flush || 0).toFixed(2)} · chase ${(+a0.answers.chase || 0).toFixed(2)}</div>` : ''}</div></div></div>
  <div class="card"><div class="hd"><b>4 · Executor</b>${hbBadge('executor')}</div><div class="big">${ex.trades} trades</div>
    <div class="muted">${e0 && e0.sizeUsd ? usd(e0.sizeUsd) + ' · ' + e0.stackPct + '% of stack' : 'sem sinais ainda'}</div>${bar}</div>
  <div class="card"><div class="hd"><b>5 · Risk</b>${hbBadge('risk')}</div><div class="big">${rk.open ? 'Guarding' : 'Idle'}</div>
    <div class="muted">${rk.open} abertas · último: ${lastExit}</div>
    <div style="margin-top:6px"><span class="pill red">stop -${rk.stopPct}%</span><span class="pill green">trail ${rk.trailPct}%</span></div></div>`;
  ring($('ring'), a0 ? a0.score : null, set.min_score);
  animateDisc(last, au.running);
}

function animateDisc(last, running) {
  const cv = $('disc'); if (!cv) return;
  const key = last ? last.mint + last.ts : 'none';
  if (running) return disc(cv, [], 0);
  if (!last || key === lastAuditShown) return disc(cv, last ? last.layers : [], null);
  lastAuditShown = key; let i = 0;                       // replay layers as they arrived: cyan beam, then green or red
  const step = () => { if (!$('disc')) return; disc($('disc'), last.layers.slice(0, i), i < last.layers.length ? i : null); if (i++ < last.layers.length) setTimeout(step, 350); };
  step();
}

function renderActivity() {
  $('actlist').innerHTML = S.activity.map(a => `<div class="act ${a.kind}"><div><div class="t">${esc(a.title)}</div><div class="s">${esc(a.sub)} · ${lisIso(a.ts)}</div></div><div class="x">${esc(a.right)}</div></div>`).join('') || '<p class="muted">Nada ainda esta noite.</p>';
}

function coinList() {
  const seen = new Set(), out = [];
  S.positions.forEach(p => { if (!seen.has(p.mint)) { seen.add(p.mint); out.push(p.mint); } });
  Object.keys(S.prices).forEach(m => { if (!seen.has(m) && S.prices[m].length) { seen.add(m); out.push(m); } });
  return out;
}

function renderCoin() {
  const list = coinList();
  if (!coinSel || !list.includes(coinSel)) coinSel = list[0] || null;
  $('coinpick').innerHTML = list.map(m => `<button data-m="${m}" class="${m === coinSel ? 'on' : ''}">${esc(S.coins[m]?.name || m.slice(0, 6))}</button>`).join('');
  $('coinpick').querySelectorAll('button').forEach(b => b.onclick = () => { coinSel = b.dataset.m; renderCoin(); });
  if (!coinSel) { $('coinname').textContent = 'Sem moedas para mostrar'; $('coinmeta').textContent = 'O gráfico aparece quando o Scanner passa uma moeda.'; setup($('candles'), 260); return; }
  const c = S.coins[coinSel] || {}, pos = S.positions.find(p => p.mint === coinSel), au = S.auditor.recent.find(a => a.mint === coinSel);
  $('coinname').textContent = c.name || coinSel.slice(0, 8);
  $('coinmeta').innerHTML = `${esc(coinSel.slice(0, 4))}…${esc(coinSel.slice(-4))} · holders ${c.holders ?? '—'}` + (pos ? ` · entrada ${pos.entry_price.toPrecision(4)} · ${usd(pos.size_usd)} · ${esc(pos.status)}` : '');
  $('coinlayers').innerHTML = au ? au.layers.map(L => `<div class="strip ${L.pass ? 'ok' : 'bad'}"><b>${L.n} ${esc(L.name)}</b>${esc(L.value)}</div>`).join('') : '';
  const a = $('coinlink'); if (c.link) { a.href = c.link; a.classList.remove('hidden'); } else a.classList.add('hidden');
  candles($('candles'), S.prices[coinSel] || [], pos);
}

function candles(cv, pts, pos) {
  const [c, w, h] = setup(cv, 260), r = rng(pts.length + 3);
  const B = 60, by = new Map();
  pts.forEach(([t, p]) => { const k = Math.floor(t / B); const o = by.get(k); if (!o) by.set(k, {o: p, h: p, l: p, c: p}); else { o.h = Math.max(o.h, p); o.l = Math.min(o.l, p); o.c = p; } });
  const cs = [...by.values()].slice(-60);
  c.fillStyle = '#8b95a7'; c.font = '12px -apple-system,sans-serif';
  if (!cs.length) { c.fillText('Ainda sem preços', 12, h / 2); return; }
  let lo = Math.min(...cs.map(x => x.l)), hi = Math.max(...cs.map(x => x.h));
  const lines = [];
  if (pos) { lines.push(['entry', pos.entry_price, '#8b95a7', null]); if (pos.exitLine) lines.push(['Risk trailing stop', pos.exitLine, '#ff9f1a', [7, 6]]); }
  lines.forEach(l => { lo = Math.min(lo, l[1]); hi = Math.max(hi, l[1]); });
  const pad = (hi - lo) * .08 || hi * .02 || 1e-9; lo -= pad; hi += pad;
  const Y = v => 10 + (h - 30) * (1 - (v - lo) / (hi - lo)), cw = (w - 56) / Math.max(cs.length, 20);
  for (let g = 0; g <= 3; g++) { const v = lo + (hi - lo) * g / 3; rough(c, [[0, Y(v)], [w - 52, Y(v)]], '#1b212c', 1, r); c.fillText(v.toPrecision(3), w - 50, Y(v) + 4); }
  cs.forEach((k, i) => {
    const x = 4 + i * cw + cw / 2, up = k.c >= k.o, col = up ? '#2ecc71' : '#ff5a5f';
    rough(c, [[x, Y(k.h)], [x, Y(k.l)]], col, 1.3, r);
    const top = Y(Math.max(k.o, k.c)), bh = Math.max(2, Math.abs(Y(k.o) - Y(k.c)));
    roughRect(c, x - cw * .32, top, cw * .64, bh, col, r);
  });
  lines.forEach(([label, v, col, dash]) => { rough(c, [[0, Y(v)], [w - 52, Y(v)]], col, 2, r, dash); c.fillStyle = col; c.fillText(label, 6, Y(v) - 5); });
  c.fillStyle = '#8b95a7'; c.fillText(lis(pts[0][0]) + ' → ' + lis(pts[pts.length - 1][0]) + ' Lisboa', 6, h - 6);
}

function renderReport() {
  const d = S.report;
  const L = [];
  if (d.gpaKilled) L.push(`⚠ Camada 8 em baixo: ${d.gpaKilled} moedas mortas por "no data: delegations"`);
  L.push(`Noite ${d.night} · ${d.mode}`, `Scanner: ${d.scanned} decididas, ${d.scanPassed} passaram`);
  if (d.killReasons.length) L.push('  cortes: ' + d.killReasons.map(([r, n]) => `${r} ×${n}`).join(', '));
  L.push(`Auditor: ${d.audited} desmontadas, ${d.auditPassed} com 8/8`);
  if (d.auditReasons.length) L.push('  vermelhos: ' + d.auditReasons.map(([r, n]) => `${r} ×${n}`).join(', '));
  L.push(`Analyst: ${d.scored} avaliadas, ${d.analystPassed} passaram`, `Trades: ${d.trades} (${d.open} abertas) · PnL ${d.pnl >= 0 ? '+' : ''}${usd(d.pnl)} · ${d.wins} ganhos`);
  d.positions.forEach(p => L.push(`  ${p.name}: ${p.status} ${p.exit_reason || ''} ${usd(p.pnl_usd || 0)}`));
  if (d.skips.length) L.push('Skips: ' + d.skips.map(s => `${s.name} (${s.reason})`).join(', '));
  if (d.mode === 'PAPER') L.push(`Saldo paper ${usd(d.balance)}`);
  $('reporttxt').textContent = L.join('\n');
  const [c, w, h] = setup($('balance'), 180), r = rng(9);
  let bal = S.paperStart; const pts = [[S.startedAt, bal]]; S.balanceHistory.forEach(([t, p]) => { bal += p; pts.push([t, bal]); }); pts.push([S.ts, bal]);
  const lo = Math.min(...pts.map(p => p[1])) * .98, hi = Math.max(...pts.map(p => p[1])) * 1.02, t0 = pts[0][0], t1 = Math.max(pts[pts.length - 1][0], t0 + 1);
  const P = pts.map(([t, v]) => [8 + (w - 16) * (t - t0) / (t1 - t0), 10 + (h - 30) * (1 - (v - lo) / (hi - lo))]);
  rough(c, P, bal >= S.paperStart ? '#2ecc71' : '#ff5a5f', 2.4, r);
  c.fillStyle = '#8b95a7'; c.font = '12px -apple-system,sans-serif'; c.fillText(`saldo ${usd(bal)} (início ${usd(S.paperStart)})`, 8, h - 6);
}

function renderAccount() {
  $('pushinfo').textContent = S.planB.webPush;
  const set = S.settings, spec = S.spec;
  $('settings').innerHTML = S.groups.map(g => `<h3>${esc(g)}</h3>` + Object.keys(spec).filter(k => spec[k][0] === g)
    .map(k => `<div class="set"><div>${esc(spec[k][1])}<br><code>${k}</code></div><b>${esc(set[k] ?? '—')}</b></div>`).join('')).join('');
  $('changes').innerHTML = S.changes.map(c => `<div class="set"><div>${esc(c.key)} <code>${esc(c.source)}</code></div><b>${esc(c.old)} → ${esc(c.new)}</b></div>`).join('') || '<p class="muted">Nenhuma.</p>';
}

// ---------- boot
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('main .screen').forEach(s => s.classList.toggle('hidden', s.id !== b.dataset.t));
  if (S) render();
});
$('forget').onclick = () => { localStorage.removeItem('deskKey'); location.hash = ''; location.reload(); };
$('keybtn').onclick = () => { const k = keyFromHash($('keyin').value) || ($('keyin').value.trim().length >= 40 ? $('keyin').value.trim() : null); if (!k) { $('lockerr').textContent = 'Link sem chave.'; return; } localStorage.setItem('deskKey', k); location.reload(); };

(async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const k = keyFromHash(location.hash) || localStorage.getItem('deskKey');
  if (!k) { document.querySelectorAll('main .screen').forEach(s => s.classList.toggle('hidden', s.id !== 'lock')); $('tabs').classList.add('hidden'); $('fresh').textContent = 'bloqueado'; return; }
  localStorage.setItem('deskKey', k);
  await unlock(k);
  await poll();
  setInterval(poll, POLL_MS);
  setInterval(renderFresh, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
