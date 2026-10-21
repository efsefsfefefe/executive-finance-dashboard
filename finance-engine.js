/* FinIntel · Panel financiero ejecutivo — JS vanilla + Chart.js + localStorage */
'use strict';

/* ───────── 1. CONFIGURACIÓN ───────── */
const CURRENCY = { locale: 'es-PE', code: 'PEN' }; // cambia aquí tu moneda
const STORAGE_KEY = 'finintel.v1';
const COLOR = { ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', blue: '#3b82f6' };

// Regla 50/30/20: cada categoría de gasto pertenece a un "bucket"
const BUCKETS = {
  needs:   { label: 'Necesidades',        target: 50, color: COLOR.blue },
  wants:   { label: 'Gustos',             target: 30, color: COLOR.warn },
  savings: { label: 'Ahorro / Inversión', target: 20, color: COLOR.ok }
};
const CATEGORIES = {
  gasto: {
    'Vivienda': 'needs', 'Alimentación': 'needs', 'Transporte': 'needs', 'Salud': 'needs',
    'Servicios': 'needs', 'Educación': 'needs',
    'Restaurantes': 'wants', 'Ocio': 'wants', 'Compras': 'wants', 'Suscripciones': 'wants', 'Viajes': 'wants',
    'Ahorro': 'savings', 'Inversión': 'savings'
  },
  ingreso: { 'Salario': 'income', 'Freelance': 'income', 'Otros ingresos': 'income' }
};

/* ───────── 2. HELPERS, ESTADO Y PERSISTENCIA ───────── */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmt = n => new Intl.NumberFormat(CURRENCY.locale, { style: 'currency', currency: CURRENCY.code }).format(n || 0);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = load();
let pendingFile = null, donut = null, bars = null;

function load() {
  const base = { tx: [], settings: { initialNetWorth: 0, monthlyBudget: 0 }, view: 'month', period: todayISO().slice(0, 7) };
  try { return { ...base, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) }; } catch { return base; }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.warn('No se pudo guardar', e); }
}

/* ───────── 3. CÁLCULOS ───────── */
const prefix = () => (state.view === 'year' ? state.period.slice(0, 4) : state.period);
const inPeriod = () => state.tx.filter(t => t.date.startsWith(prefix()));

// Días totales y transcurridos del período (para la tasa de gasto diario)
function periodDays() {
  const y = +state.period.slice(0, 4), m = +state.period.slice(5, 7) - 1, DAY = 864e5;
  const start = state.view === 'year' ? new Date(y, 0, 1) : new Date(y, m, 1);
  const end = state.view === 'year' ? new Date(y, 11, 31) : new Date(y, m + 1, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const total = Math.round((end - start) / DAY) + 1;
  const elapsed = today < start ? 1 : Math.min(total, Math.round((Math.min(today, end) - start) / DAY) + 1);
  return { total, elapsed };
}

function summarize(list) {
  const s = { income: 0, needs: 0, wants: 0, savings: 0 };
  list.forEach(t => { if (t.type === 'ingreso') s.income += t.amount; else s[t.bucket] += t.amount; });
  s.spent = s.needs + s.wants; // gasto real (el ahorro sigue siendo patrimonio)
  return s;
}

// Health Score 0–100: necesidades 30% · gustos 25% · ahorro 45%, con penalización por déficit
function healthScore(s) {
  if (s.income <= 0) return null;
  const pct = v => (v / s.income) * 100;
  const sNeeds = Math.max(0, 100 - Math.max(0, pct(s.needs) - 50) * 2.5);
  const sWants = Math.max(0, 100 - Math.max(0, pct(s.wants) - 30) * 3);
  const sSave = Math.min(100, (pct(s.savings) / 20) * 100);
  let score = sNeeds * 0.30 + sWants * 0.25 + sSave * 0.45;
  if (s.spent + s.savings > s.income) score -= 15; // gastas más de lo que ingresa
  return Math.round(Math.max(0, Math.min(100, score)));
}
const tier = sc => sc >= 70 ? { c: COLOR.ok, t: 'Saludable' } : sc >= 40 ? { c: COLOR.warn, t: 'En observación' } : { c: COLOR.bad, t: 'Crítico' };

function metrics(s) {
  const { total, elapsed } = periodDays();
  const fixed = state.settings.monthlyBudget;
  const budget = fixed > 0 ? fixed * (state.view === 'year' ? 12 : 1) : s.income * 0.8; // 50% + 30% de los ingresos
  return { total, elapsed, budget, burn: s.spent / elapsed, rec: budget / total };
}

function netWorth() {
  const all = summarize(state.tx);
  return state.settings.initialNetWorth + all.income - all.spent;
}

/* ───────── 4. RENDER ───────── */
function render() {
  const list = inPeriod(), s = summarize(list), m = metrics(s);
  renderKPIs(s, m); renderRule(s); renderBudget(s, m); renderTable(); renderCharts(list); runSim();
}

function renderKPIs(s, m) {
  $('kpiNet').textContent = fmt(netWorth());
  $('kpiBurn').textContent = `${fmt(m.burn)} / día`;
  $('kpiBurn').style.color = m.budget > 0 && m.burn > m.rec ? COLOR.bad : '';
  $('kpiBurnSub').textContent = m.budget > 0 ? `Límite recomendado: ${fmt(m.rec)} / día` : 'Registra ingresos para calcular tu límite diario';
  const sc = healthScore(s), bar = $('scoreBar'), lbl = $('kpiScoreLabel'), val = $('kpiScore');
  if (sc === null) { val.textContent = '–'; val.style.color = ''; lbl.textContent = 'Sin datos'; lbl.style.color = '#94a3b8'; bar.style.width = '0'; return; }
  const t = tier(sc);
  val.textContent = sc; val.style.color = t.c; lbl.textContent = t.t; lbl.style.color = t.c;
  bar.style.width = sc + '%'; bar.style.background = t.c;
}

function renderRule(s) {
  $('rule').innerHTML = Object.entries(BUCKETS).map(([k, b]) => {
    const v = s.income > 0 ? (s[k] / s.income) * 100 : 0;
    const good = k === 'savings' ? v >= b.target : v <= b.target;
    return `<div>
      <div class="flex justify-between text-sm mb-1"><span>${b.label} <span class="text-slate-500">(meta ${b.target}%)</span></span>
        <span class="num font-semibold" style="color:${good || !s.income ? '#e2e8f0' : COLOR.bad}">${v.toFixed(1)}%</span></div>
      <div class="bar"><div class="bar-fill" style="width:${Math.min(100, v)}%;background:${b.color}"></div><i class="mark" style="left:${b.target}%"></i></div>
      <p class="num text-xs text-slate-500 mt-1">${fmt(s[k])}</p></div>`;
  }).join('');
}

function renderBudget(s, m) {
  const pct = m.budget > 0 ? (s.spent / m.budget) * 100 : 0;
  $('budgetText').textContent = m.budget > 0 ? `${fmt(s.spent)} de ${fmt(m.budget)} (${pct.toFixed(0)}%)` : 'Sin presupuesto definido';
  const bar = $('budgetBar');
  bar.style.width = Math.min(100, pct) + '%';
  bar.style.background = pct < 75 ? COLOR.ok : pct < 100 ? COLOR.warn : COLOR.bad;
  const el = $('budgetAlert'), over = m.budget > 0 && m.burn > m.rec;
  if (m.budget <= 0) {
    el.className = 'mt-3 rounded-lg border p-3 text-sm bg-slate-500/10 border-slate-500/30 text-slate-300';
    el.textContent = 'Registra tus ingresos o fija un presupuesto para activar las alertas.';
  } else if (over) {
    el.className = 'mt-3 rounded-lg border p-3 text-sm bg-red-500/10 border-red-500/30 text-red-300';
    el.textContent = `Gastas ${fmt(m.burn)} al día y tu límite es ${fmt(m.rec)}. Si sigues así, cerrarás el período con ${fmt(m.burn * m.total)} de gasto.`;
  } else {
    el.className = 'mt-3 rounded-lg border p-3 text-sm bg-emerald-500/10 border-emerald-500/30 text-emerald-300';
    el.textContent = `Vas dentro del límite: ${fmt(m.burn)} al día frente a ${fmt(m.rec)} recomendados.`;
  }
}

function renderTable() {
  const q = $('tSearch').value.toLowerCase(), ty = $('tType').value, ca = $('tCat').value;
  const rows = inPeriod()
    .filter(t => (!ty || t.type === ty) && (!ca || t.category === ca) && (!q || `${t.desc} ${t.category}`.toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 100);
  $('txBody').innerHTML = rows.length ? rows.map(t => `<tr>
      <td class="num whitespace-nowrap text-slate-400">${t.date}</td>
      <td>${esc(t.desc) || '<span class="text-slate-600">Sin descripción</span>'}${t.voucher ? `<div class="text-xs text-slate-500">Comprobante: ${esc(t.voucher)}</div>` : ''}</td>
      <td><span class="tag">${esc(t.category)}</span></td>
      <td class="num text-right font-semibold whitespace-nowrap" style="color:${t.type === 'ingreso' ? COLOR.ok : '#e2e8f0'}">${t.type === 'ingreso' ? '+' : '−'}${fmt(t.amount)}</td>
      <td class="text-right"><button class="text-slate-500 hover:text-red-400 text-xs" data-del="${t.id}" aria-label="Eliminar movimiento">Eliminar</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="text-center text-slate-500 py-6">No hay movimientos en este período. Registra uno o carga los datos demo.</td></tr>';
}

/* ───────── 5. GRÁFICOS (Chart.js) ───────── */
const PALETTE = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b', '#22d3ee', '#a3e635', '#e879f9', '#facc15', '#94a3b8'];

function initCharts() {
  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = 'Manrope, system-ui, sans-serif';
  const money = { callbacks: { label: c => ` ${c.label || c.dataset.label}: ${fmt(c.raw)}` } };
  donut = new Chart($('chartDonut'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], borderColor: '#1e293b', borderWidth: 2 }] },
    options: { maintainAspectRatio: false, cutout: '66%', plugins: { legend: { position: 'right' }, tooltip: money } }
  });
  bars = new Chart($('chartBars'), {
    type: 'bar',
    data: { labels: [], datasets: [
      { label: 'Ingresos', data: [], backgroundColor: COLOR.ok, borderRadius: 4 },
      { label: 'Gastos', data: [], backgroundColor: COLOR.blue, borderRadius: 4 },
      { label: 'Ahorro', data: [], backgroundColor: COLOR.warn, borderRadius: 4 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw)}` } } },
      scales: { y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,.1)' } }, x: { grid: { display: false } } } }
  });
}

function monthKeys() {
  const y = +state.period.slice(0, 4), m = +state.period.slice(5, 7) - 1;
  if (state.view === 'year') return Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`);
  return Array.from({ length: 6 }, (_, i) => { const d = new Date(y, m - 5 + i, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; });
}

function renderCharts(list) {
  const cat = {};
  list.filter(t => t.type === 'gasto').forEach(t => { cat[t.category] = (cat[t.category] || 0) + t.amount; });
  const labels = Object.keys(cat), empty = !labels.length;
  donut.data.labels = empty ? ['Sin datos'] : labels;
  donut.data.datasets[0].data = empty ? [1] : Object.values(cat);
  donut.data.datasets[0].backgroundColor = empty ? ['#334155'] : PALETTE;
  donut.update();

  const keys = monthKeys(), sums = keys.map(k => summarize(state.tx.filter(t => t.date.startsWith(k))));
  bars.data.labels = keys.map(k => new Date(+k.slice(0, 4), +k.slice(5) - 1, 1).toLocaleDateString('es', { month: 'short' }));
  bars.data.datasets[0].data = sums.map(s => s.income);
  bars.data.datasets[1].data = sums.map(s => s.spent);
  bars.data.datasets[2].data = sums.map(s => s.savings);
  bars.update();
}

/* ───────── 6. SIMULADOR WHAT-IF ───────── */
// Promedio mensual de los últimos 3 meses con datos
function baseline() {
  const months = [...new Set(state.tx.map(t => t.date.slice(0, 7)))].sort().slice(-3);
  if (!months.length) return { inc: 0, exp: 0, n: 0 };
  const s = summarize(state.tx.filter(t => months.includes(t.date.slice(0, 7))));
  return { inc: s.income / months.length, exp: s.spent / months.length, n: months.length };
}

function runSim() {
  const out = $('simOut');
  const P = +$('simAmount').value, n = Math.max(1, Math.round(+$('simMonths').value || 1)), r = (+$('simRate').value || 0) / 100;
  if (!(P > 0)) { out.innerHTML = '<p class="text-sm text-slate-500">Ingresa el monto y las cuotas para ver cómo cambia tu flujo de caja a 3, 6 y 12 meses.</p>'; return; }

  const cuota = r > 0 ? (P * r) / (1 - Math.pow(1 + r, -n)) : P / n;
  const b = baseline(), free = b.inc - b.exp, net = netWorth();
  const rows = [3, 6, 12].map(m => { const sin = free * m, con = sin - cuota * Math.min(m, n); return { m, sin, con, imp: con - sin, pat: net + con }; });

  let tone = 'emerald', msg = `La cuota representa ${((cuota / free) * 100).toFixed(0)}% de tu excedente mensual: es una compra absorbible.`;
  if (!b.n) { tone = 'slate'; msg = 'Aún no hay historial. Registra movimientos para proyectar con tus datos reales.'; }
  else if (cuota > free) { tone = 'red'; msg = `La cuota (${fmt(cuota)}) supera tu excedente mensual promedio (${fmt(free)}). Tu flujo se vuelve negativo.`; }
  else if (cuota > free * 0.5) { tone = 'amber'; msg = `La cuota consume ${((cuota / free) * 100).toFixed(0)}% de tu excedente mensual. Queda poco margen para imprevistos.`; }

  const red = v => (v < 0 ? `style="color:${COLOR.bad}"` : '');
  out.innerHTML = `
    <div class="grid sm:grid-cols-3 gap-3 mb-4">
      <div><p class="lbl">Cuota mensual</p><p class="num text-xl font-bold">${fmt(cuota)}</p></div>
      <div><p class="lbl">Total a pagar</p><p class="num text-xl font-bold">${fmt(cuota * n)}</p></div>
      <div><p class="lbl">Excedente mensual base</p><p class="num text-xl font-bold" ${red(free)}>${fmt(free)}</p></div>
    </div>
    <div class="overflow-x-auto"><table class="tbl w-full"><thead><tr><th>Horizonte</th><th class="!text-right">Flujo sin compra</th><th class="!text-right">Flujo con compra</th><th class="!text-right">Impacto</th><th class="!text-right">Patrimonio proyectado</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td>${x.m} meses</td><td class="num text-right" ${red(x.sin)}>${fmt(x.sin)}</td><td class="num text-right font-semibold" ${red(x.con)}>${fmt(x.con)}</td><td class="num text-right" style="color:${COLOR.bad}">${fmt(x.imp)}</td><td class="num text-right" ${red(x.pat)}>${fmt(x.pat)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="mt-4 rounded-lg border p-3 text-sm bg-${tone}-500/10 border-${tone}-500/30 text-${tone}-300">${msg}</div>`;
}

/* ───────── 7. FORMULARIO, COMPROBANTES Y DATOS DEMO ───────── */
function fillCats() {
  $('fCat').innerHTML = Object.keys(CATEGORIES[$('fType').value]).map(c => `<option>${c}</option>`).join('');
}

function setFile(f) {
  if (!f) return;
  pendingFile = f;
  $('dzPreview').innerHTML = f.type.startsWith('image/')
    ? `<img src="${URL.createObjectURL(f)}" alt="Vista previa" class="h-20 rounded-lg mx-auto mb-1"><span>${esc(f.name)}</span>`
    : `<span>${esc(f.name)}</span>`;
}

function addTx(e) {
  e.preventDefault();
  const type = $('fType').value, category = $('fCat').value, amount = Math.round(parseFloat($('fAmount').value) * 100) / 100;
  if (!(amount > 0) || !$('fDate').value) return;
  state.tx.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type, amount, category,
    bucket: CATEGORIES[type][category], desc: $('fDesc').value.trim(), date: $('fDate').value,
    voucher: pendingFile ? pendingFile.name : null // solo el nombre: localStorage tiene ~5 MB
  });
  save();
  pendingFile = null; $('dzPreview').textContent = 'Arrastra un comprobante aquí o haz clic para elegirlo';
  $('fAmount').value = ''; $('fDesc').value = ''; $('dzInput').value = '';
  if (!$('fDate').value.startsWith(prefix())) { state.period = $('fDate').value.slice(0, 7); $('period').value = state.period; save(); }
  render();
}

function seedDemo() {
  const now = new Date(), vary = v => Math.round(v * (0.9 + Math.random() * 0.2) * 100) / 100;
  const plan = [['ingreso', 'Salario', 4500, 1], ['ingreso', 'Freelance', 600, 15], ['gasto', 'Vivienda', 1200, 3], ['gasto', 'Alimentación', 650, 8],
    ['gasto', 'Transporte', 220, 10], ['gasto', 'Servicios', 260, 12], ['gasto', 'Restaurantes', 340, 18], ['gasto', 'Ocio', 180, 20],
    ['gasto', 'Suscripciones', 60, 5], ['gasto', 'Compras', 250, 22], ['gasto', 'Ahorro', 700, 2], ['gasto', 'Inversión', 300, 2]];
  for (let k = 2; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    plan.forEach(([type, category, amount, day]) => {
      const dd = k === 0 ? Math.min(day, now.getDate()) : day;
      state.tx.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), type, category, bucket: CATEGORIES[type][category],
        amount: type === 'ingreso' && category === 'Salario' ? amount : vary(amount), desc: 'Movimiento demo', voucher: null,
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(dd)}` });
    });
  }
  save(); render();
}

/* ───────── 8. INICIO ───────── */
function init() {
  $('viewMode').value = state.view; $('period').value = state.period;
  $('initNet').value = state.settings.initialNetWorth || ''; $('budgetInput').value = state.settings.monthlyBudget || '';
  $('fDate').value = todayISO(); fillCats();
  $('tCat').innerHTML = '<option value="">Todas las categorías</option>' +
    [...Object.keys(CATEGORIES.gasto), ...Object.keys(CATEGORIES.ingreso)].map(c => `<option>${c}</option>`).join('');
  initCharts();

  $('viewMode').onchange = e => { state.view = e.target.value; save(); render(); };
  $('period').onchange = e => { if (e.target.value) { state.period = e.target.value; save(); render(); } };
  $('initNet').oninput = e => { state.settings.initialNetWorth = parseFloat(e.target.value) || 0; save(); render(); };
  $('budgetInput').oninput = e => { state.settings.monthlyBudget = parseFloat(e.target.value) || 0; save(); render(); };
  $('fType').onchange = fillCats;
  $('txForm').onsubmit = addTx;
  ['tSearch', 'tType', 'tCat'].forEach(id => $(id).addEventListener('input', renderTable));
  ['simAmount', 'simMonths', 'simRate'].forEach(id => $(id).addEventListener('input', runSim));
  $('txBody').onclick = e => {
    const id = e.target.dataset.del;
    if (id) { state.tx = state.tx.filter(t => t.id !== id); save(); render(); }
  };
  $('btnDemo').onclick = seedDemo;
  $('btnReset').onclick = () => {
    if (confirm('¿Borrar todos los movimientos y ajustes guardados?')) {
      state.tx = []; state.settings = { initialNetWorth: 0, monthlyBudget: 0 };
      $('initNet').value = ''; $('budgetInput').value = ''; save(); render();
    }
  };

  // Drag & drop de comprobantes
  const dz = $('dz');
  dz.onclick = () => $('dzInput').click();
  dz.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('dzInput').click(); } };
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));
  $('dzInput').onchange = e => setFile(e.target.files[0]);

  render();
}
document.addEventListener('DOMContentLoaded', init);