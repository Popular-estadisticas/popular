import { mkdir, writeFile, readFile, access } from 'node:fs/promises';

const BASE = 'https://site.api.espn.com/apis';
const L = 'sports/soccer/arg.1';
const H = { 'User-Agent': 'Mozilla/5.0 (popular-prototype)' };

// Fechas en hora argentina (UTC-3)
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const ar = Date.now() - 3 * 3600 * 1000;
const dias = [-1, 0, 1].map((n) => ymd(new Date(ar + n * 864e5)));

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: H });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((ok) => setTimeout(ok, 2000));
    }
  }
}
const existe = (f) => access(f).then(() => true, () => false);
const leer = async (f) => {
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; }
};

await mkdir('data', { recursive: true });
let ok = 0;

// Partidos de ayer, hoy y mañana (un pedido por día)
const fechas = {};
for (const d of dias) {
  try {
    fechas[d] = await get(`${BASE}/site/v2/${L}/scoreboard?dates=${d}`);
    console.log('OK scoreboard', d);
  } catch (e) {
    console.error('FALLO scoreboard', d, e.message);
  }
}
if (Object.keys(fechas).length > 0) {
  await writeFile('data/scoreboard.json', JSON.stringify({ actualizado: new Date().toISOString(), fechas }));
  ok++;
}

// Tabla de posiciones actual
let st = null;
try {
  st = await get(`${BASE}/v2/${L}/standings`);
  await writeFile('data/standings.json', JSON.stringify(st));
  console.log('OK standings');
  ok++;
} catch (e) {
  console.error('FALLO standings', e.message);
  st = await leer('data/standings.json');
}

// Equipos y escudos: solo la primera vez
if (!(await existe('data/teams.json'))) {
  try {
    await writeFile('data/teams.json', JSON.stringify(await get(`${BASE}/site/v2/${L}/teams`)));
    console.log('OK teams');
    ok++;
  } catch (e) {
    console.error('FALLO teams', e.message);
  }
}

// Tablas de temporadas anteriores: se guardan una sola vez
const hist = [
  ['hist-2026-1.json', 'season=2026&seasontype=1'],
  ['hist-2025-1.json', 'season=2025&seasontype=1'],
  ['hist-2025-6.json', 'season=2025&seasontype=6'],
  ['hist-2024.json', 'season=2024'],
];
for (const [archivo, q] of hist) {
  if (await existe('data/' + archivo)) continue;
  try {
    await writeFile('data/' + archivo, JSON.stringify(await get(`${BASE}/v2/${L}/standings?${q}`)));
    console.log('OK', archivo);
  } catch (e) {
    console.error('FALLO', archivo, e.message);
  }
}

// ---- Calendario completo del torneo en curso (se actualiza cada 6 horas) ----

// Versión corta de un partido: solo lo que usa la página
const corto = (e) => {
  const c = e.competitions && e.competitions[0];
  if (!c) return null;
  const h = c.competitors.find((x) => x.homeAway === 'home');
  const a = c.competitors.find((x) => x.homeAway === 'away');
  if (!h || !a) return null;
  const t = (x) => ({
    n: x.team.displayName,
    s: (x.team.shortDisplayName || '').trim(),
    l: x.team.logo,
    g: x.score,
  });
  const tipo = (c.status && c.status.type) || {};
  return { id: e.id, d: e.date, s: tipo.state, n: tipo.name, c: c.status && c.status.displayClock, h: t(h), a: t(a) };
};

// Primer y último día del torneo en curso (por ejemplo, Clausura y sus playoffs)
function rango(s) {
  try {
    const g = s.children[0].standings;
    const temp = s.seasons.find((x) => x.year === g.season);
    const tipo = temp.types.find((x) => String(x.id) === String(g.seasonType));
    const clave = tipo.name.replace(/^Torneo\s+/i, '').split(/\s+/)[0];
    const tipos = temp.types.filter((x) => x.name.includes(clave));
    const ini = Math.min(...tipos.map((x) => +new Date(x.startDate)));
    const fin = Math.max(...tipos.map((x) => +new Date(x.endDate)));
    return [ini, fin];
  } catch {
    return null;
  }
}

const previo = await leer('data/fixture.json');
const vencido = !previo || Date.now() - new Date(previo.actualizado) > 6 * 3600 * 1000;
const r = st && rango(st);

if (r && vencido) {
  const todos = [];
  for (let t = r[0]; t <= r[1]; t += 864e5) {
    const k = ymd(new Date(t - 3 * 3600 * 1000));
    if (!todos.includes(k)) todos.push(k);
  }
  const eventos = new Map(((previo && previo.eventos) || []).map((e) => [e.id, e]));
  const hechos = new Set((previo && previo.diasOk) || []);
  const desdeAyer = dias[0];
  const pendientes = todos.filter((k) => !hechos.has(k) || k >= desdeAyer);

  for (let i = 0; i < pendientes.length; i += 6) {
    await Promise.all(
      pendientes.slice(i, i + 6).map(async (k) => {
        try {
          const j = await get(`${BASE}/site/v2/${L}/scoreboard?dates=${k}`);
          for (const e of j.events || []) {
            const c = corto(e);
            if (c) eventos.set(c.id, c);
          }
          hechos.add(k);
        } catch (e) {
          console.error('FALLO calendario', k, e.message);
        }
      })
    );
  }

  const lista = [...eventos.values()].sort((a, b) => new Date(a.d) - new Date(b.d));
  await writeFile(
    'data/fixture.json',
    JSON.stringify({
      actualizado: new Date().toISOString(),
      desde: todos[0],
      hasta: todos[todos.length - 1],
      diasOk: [...hechos],
      eventos: lista,
    })
  );
  console.log('OK calendario:', lista.length, 'partidos,', pendientes.length, 'días consultados');
  ok++;
} else {
  console.log(r ? 'Calendario al día, no hace falta actualizarlo' : 'No pude determinar el torneo en curso');
}

if (ok === 0) process.exit(1);
