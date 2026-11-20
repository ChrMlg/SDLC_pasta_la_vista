const validDomain = value => typeof value === 'string' && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);

function validateProduction(config) {
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    let url;
    try { url = new URL(config[key]); } catch { throw new Error(`Configure ${key} con una URL PostgreSQL válida.`); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password || !url.pathname.slice(1))
      throw new Error(`${key} requiere usuario, contraseña y base de datos.`);
    if (!url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.supabase.com'))
      throw new Error(`${key} debe apuntar al host copiado desde Connect en Supabase.`);
    if (url.searchParams.get('sslmode') !== 'require') throw new Error(`${key} requiere sslmode=require.`);
    if (key === 'DIRECT_URL' && (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true'))
      throw new Error('DIRECT_URL requiere conexión directa o Session pooler (5432), no Transaction pooler.');
    if (key === 'DATABASE_URL' && url.port === '6543' && url.searchParams.get('pgbouncer') !== 'true')
      throw new Error('DATABASE_URL en Transaction pooler requiere pgbouncer=true con Prisma 5.');
  }
  if (!/^[a-f0-9]{64}$/.test(config.LOCAL_ACCESS_KEY || '')) throw new Error('LOCAL_ACCESS_KEY requiere 64 caracteres hexadecimales.');
  if (config.COOKIE_SECURE !== 'true') throw new Error('COOKIE_SECURE debe ser true en producción.');
  let api;
  try { api = new URL(config.PUBLIC_API_URL); } catch { throw new Error('Configure PUBLIC_API_URL.'); }
  if (api.protocol !== 'https:' || !validDomain(api.hostname) || api.pathname !== '/api' || api.search || api.hash || api.username || api.password)
    throw new Error('PUBLIC_API_URL debe ser https://DOMINIO/api.');
  for (const value of (config.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)) {
    let origin;
    try { origin = new URL(value); } catch { throw new Error('CORS_ORIGINS contiene un origen inválido.'); }
    if (origin.protocol !== 'https:' || origin.origin !== value) throw new Error('CORS_ORIGINS requiere orígenes HTTPS exactos, sin rutas ni barra final.');
  }
}

if (require.main === module) {
  try { validateProduction(process.env); console.log('Configuración de producción validada.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validateProduction, validDomain };
