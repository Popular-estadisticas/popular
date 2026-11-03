import { mkdir, writeFile, access } from 'node:fs/promises';

const BASE = 'https://site.api.espn.com/apis';
const L = 'sports/soccer/arg.1';
const H = { 'User-Agent': 'Mozilla/5.0 (popular-prototype)' };

// Ayer, hoy y mañana en hora argentina (UTC-3)
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

await mkdir('data', { recursive: true });
let ok = 0;

// Partidos: un pedido por día
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

// Tabla de posiciones
try {
  await writeFile('data/standings.json', JSON.stringify(await get(`${BASE}/v2/${L}/standings`)));
  console.log('OK standings');
  ok++;
} catch (e) {
  console.error('FALLO standings', e.message);
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

if (ok === 0) process.exit(1);
