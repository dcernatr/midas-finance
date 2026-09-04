/* eslint-disable @typescript-eslint/no-require-imports */
// Run on your own computer: node configurar-midas.cjs
// Only creates missing Production variables in dct4/midas-finance.
// No deployment, SQL, deletion, token extraction or changes to other projects.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');

const TARGET = Object.freeze({
  team: 'dct4', project: 'midas-finance', repoOwner: 'dcernatr',
  neonProject: 'morning-rice-11813850', branch: 'br-misty-hill-auhsz1mi',
  database: 'midas', role: 'midas_owner',
  databaseHost: 'ep-green-king-aucebfm8-pooler.c-10.us-east-1.aws.neon.tech',
  authUrl: 'https://ep-green-king-aucebfm8.neonauth.c-10.us-east-1.aws.neon.tech/midas/auth',
});
const PACKAGES = Object.freeze({ vercel: 'vercel@59.11.2', neon: 'neon@4.14.0' });
const REQUIRED = ['DATABASE_URL', 'NEON_AUTH_BASE_URL', 'NEON_AUTH_COOKIE_SECRET', 'MIDAS_ADMIN_EMAIL'];

function parseJson(text, label) {
  try { return JSON.parse(text); }
  catch { throw new Error(`${label}: respuesta no reconocida. Se detuvo sin mostrar datos privados.`); }
}
function validateDatabase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Neon no devolvio una conexion PostgreSQL valida.'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || url.hostname !== TARGET.databaseHost ||
      url.pathname !== '/' + TARGET.database || decodeURIComponent(url.username) !== TARGET.role ||
      !url.password || !['require', 'verify-full', 'verify-ca'].includes(url.searchParams.get('sslmode'))) {
    throw new Error('La conexion no coincide con la base MIDAS esperada. No se guardara.');
  }
  return value;
}
function productionKeys(payload) {
  if (!Array.isArray(payload.envs)) throw new Error('Vercel no devolvio una lista de variables valida.');
  if (payload.pagination?.next) throw new Error('La lista de variables esta paginada; revisar antes de continuar.');
  return new Set(payload.envs.filter(e => Array.isArray(e.target) && e.target.includes('production')).map(e => e.key));
}

async function configure(io) {
  io.log('MIDAS: configuracion de variables, NO publicacion.');
  io.log('Se usaran las herramientas oficiales Vercel 59.11.2 y Neon 4.14.0 mediante npm.');
  io.log('Destino exclusivo: dct4/midas-finance. Neon: morning-rice-11813850 / midas.');
  io.log('No se crean proyectos, no se migra historial y no se toca Appwrite.');
  if ((await io.ask('Escribe SI para continuar: ')).trim().toUpperCase() !== 'SI') {
    io.log('Cancelado. No se guardaron variables.'); return { cancelled: true };
  }
  io.log('Comprobando Node, npm y acceso a Vercel. La primera descarga puede tardar.');
  if (!io.probe('vercel', ['whoami'])) {
    io.log('Autoriza Vercel en el navegador con la cuenta del equipo dct4.');
    io.call('vercel', ['login'], { interactive: true });
  }
  const api = (endpoint, options = {}) => {
    const args = ['api', endpoint, '--raw'];
    if (options.body) args.push('--method', 'POST', '--input', '-');
    const output = io.call('vercel', args, { input: options.body ? JSON.stringify(options.body) : undefined });
    return parseJson(output, 'Vercel');
  };
  const teams = api('/v2/teams?limit=100');
  const team = teams.teams?.find(t => t.slug === TARGET.team);
  if (!team || !/^team_[A-Za-z0-9]+$/.test(team.id)) throw new Error('La cuenta de Vercel no tiene acceso al equipo dct4.');
  const project = api(`/v9/projects/${TARGET.project}?teamId=${team.id}`);
  if (!/^prj_[A-Za-z0-9]+$/.test(project.id) || project.name !== TARGET.project || project.accountId !== team.id)
    throw new Error('El proyecto no coincide con dct4/midas-finance. No se modificara nada.');
  if (project.link?.type !== 'github' || project.link?.org !== TARGET.repoOwner || project.link?.repo !== TARGET.project)
    throw new Error('MIDAS aun no esta vinculado a GitHub dcernatr/midas-finance. Conectalo en Settings > Git.');
  const envEndpoint = `/v9/projects/${project.id}/env?teamId=${team.id}`;
  // Values, if the API includes them, are never logged or written to a file.
  const existing = productionKeys(api(envEndpoint));
  io.log('Proyecto y repositorio verificados.');
  if (REQUIRED.every(key => existing.has(key))) {
    io.log('Las cuatro variables ya existen. No se reemplazaron ni se comprobaron sus valores.');
    io.log('Pendiente: validar Neon, migracion y acceso antes de publicar.');
    return { created: [], preserved: REQUIRED };
  }

  const profiles = parseJson(io.call('neon', ['profile', 'list', '--output', 'json']), 'Perfiles Neon');
  const authenticated = io.hasNeonApiKey || (Array.isArray(profiles) && profiles.some(p => p.active === '*' && p.account && p.account !== '-'));
  if (!authenticated) {
    io.log('Autoriza Neon en el navegador con la cuenta propietaria de MIDAS.');
    io.call('neon', ['auth'], { interactive: true });
  }
  const projectResponse = parseJson(io.call('neon', ['projects', 'get', TARGET.neonProject, '--output', 'json']), 'Proyecto Neon');
  const neonProject = projectResponse.project || projectResponse;
  if (neonProject.id !== TARGET.neonProject || neonProject.name !== 'MIDAS')
    throw new Error('El proyecto Neon no coincide con MIDAS. No se guardaran variables.');

  const values = {};
  if (!existing.has('DATABASE_URL')) {
    values.DATABASE_URL = validateDatabase(io.call('neon', ['connection-string', TARGET.branch,
      '--project-id', TARGET.neonProject, '--database-name', TARGET.database,
      '--role-name', TARGET.role, '--pooled', '--ssl', 'require']).trim());
  }
  if (!existing.has('NEON_AUTH_BASE_URL')) values.NEON_AUTH_BASE_URL = TARGET.authUrl;
  if (!existing.has('NEON_AUTH_COOKIE_SECRET')) values.NEON_AUTH_COOKIE_SECRET = io.randomSecret();
  if (!existing.has('MIDAS_ADMIN_EMAIL')) {
    const email = (await io.ask('Correo que usaras y verificaras para ser administrador de MIDAS: ')).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Correo invalido. Ejecuta nuevamente; no se guardaron variables.');
    values.MIDAS_ADMIN_EMAIL = email;
  }
  const created = [];
  try {
    for (const key of REQUIRED) {
      if (existing.has(key)) { io.log(`Conservada: ${key} (sin revisar su valor).`); continue; }
      // Create only: no upsert flag. A concurrent change fails rather than replacing it.
      api(envEndpoint, { body: { key, value: values[key], type: 'sensitive', target: ['production'] } });
      created.push(key);
      delete values[key];
      io.log(`Guardada: ${key} [Production / Sensitive].`);
    }
    const verified = productionKeys(api(envEndpoint));
    if (!REQUIRED.every(key => verified.has(key))) throw new Error('No se confirmaron todas las variables.');
  } catch (error) {
    io.log(`Operacion incompleta. Variables confirmadas en esta ejecucion: ${created.join(', ') || 'ninguna'}.`);
    io.log('No se borrara lo guardado. Puedes repetir el script; conserva las variables existentes.');
    throw error;
  } finally {
    for (const key of Object.keys(values)) delete values[key];
  }
  io.log('CONFIGURACION GUARDADA: las cuatro variables estan presentes en Production.');
  io.log('No se ha publicado ni probado el inicio de sesion.');
  io.log('Pendiente: migracion validada, dominio autorizado en Neon Auth y prueba aislada antes del corte.');
  io.log('Puedes enviar una captura de este resumen; no contiene contrasenas.');
  return { created, preserved: REQUIRED.filter(key => existing.has(key)) };
}

// Call npx-cli.js through Node directly: no shell, no secrets in arguments,
// and no dependency on PowerShell execution-policy settings.
function findNpx() {
  const roots = [path.dirname(process.execPath), ...(process.env.PATH || '').split(path.delimiter)];
  const candidates = roots.flatMap(root => [
    path.join(root, 'node_modules/npm/bin/npx-cli.js'),
    path.resolve(root, '../lib/node_modules/npm/bin/npx-cli.js'),
  ]);
  candidates.push('/usr/share/nodejs/npm/bin/npx-cli.js');
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('No se encontro npm. Instala Node.js LTS con npm desde https://nodejs.org y vuelve a abrir el script.');
  return found;
}
function runCli(npx, cwd, tool, args, options = {}) {
  if (!PACKAGES[tool]) throw new Error('Herramienta no autorizada.');
  const result = spawnSync(process.execPath, [npx, '--yes', '--package=' + PACKAGES[tool], tool, ...args], {
    cwd, shell: false, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    timeout: options.interactive ? 15 * 60 * 1000 : 5 * 60 * 1000,
    stdio: options.interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'], input: options.input,
    env: { ...process.env, NO_COLOR: '1', VERCEL_TELEMETRY_DISABLED: '1', npm_config_update_notifier: 'false' },
  });
  if (options.probe) return result.status === 0;
  if (result.status !== 0 || result.error) {
    // Never include raw stderr/stdout: a provider might repeat the request body.
    throw new Error(`${tool}: no se completo ${args[0]}. Revisa inicio de sesion, permisos y conexion. No se intentara otro proyecto.`);
  }
  return result.stdout || '';
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Instala Node.js LTS 22 o superior desde https://nodejs.org.');
  const npx = findNpx();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'midas-config-'));
  try {
    await configure({
      log: text => console.log(text),
      ask: async text => {
        const input = createInterface({ input: process.stdin, output: process.stdout });
        try { return await input.question(text); } finally { input.close(); }
      },
      call: (tool, args, options) => runCli(npx, cwd, tool, args, options),
      probe: (tool, args) => runCli(npx, cwd, tool, args, { probe: true }),
      hasNeonApiKey: Boolean(process.env.NEON_API_KEY),
      randomSecret: () => crypto.randomBytes(32).toString('base64'),
    });
  } finally {
    // Remove only our empty temporary directory, never recursively.
    try { fs.rmdirSync(cwd); } catch { /* Official CLI caches may remain here. */ }
  }
}
module.exports = { configure, validateDatabase, productionKeys, runCli, TARGET, REQUIRED };
if (require.main === module) main().catch(error => { console.error('DETENIDO: ' + error.message); process.exitCode = 1; });
