import { mkdir, writeFile, access } from 'node:fs/promises';

const BASE = 'https://site.api.espn.com/apis';
const L = 'sports/soccer/arg.1';

// Fechas en hora argentina (UTC-3): de ayer a mañana
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const ar = new Date(Date.now() - 3 * 3600 * 1000);
const desde = ymd(new Date(ar.getTime() - 864e5));
const hasta = ymd(new Date(ar.getTime() + 864e5));

const tareas = [
  ['scoreboard.json', `${BASE}/site/v2/${L}/scoreboard?dates=${desde}-${hasta}`],
  ['standings.json', `${BASE}/v2/${L}/standings`],
];

await mkdir('data', { recursive: true });
const existe = (f) => access(f).then(() => true, () => false);
if (!(await existe('data/teams.json'))) {
  tareas.push(['teams.json', `${BASE}/site/v2/${L}/teams`]);
}

let fallas = 0;
for (const [archivo, url] of tareas) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'popular-prototype' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    await writeFile('data/' + archivo, JSON.stringify(await r.json()));
    console.log('OK', archivo);
  } catch (e) {
    fallas++;
    console.error('FALLO', archivo, e.message);
  }
}
if (fallas === tareas.length) process.exit(1);
