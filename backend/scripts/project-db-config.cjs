const { loadLocalConfig, root } = require('./local-stack.cjs');

function loadProjectConfig(target) {
  if (target !== 'local') throw new Error('El proyecto utiliza PostgreSQL local mediante Docker Compose');
  const values = loadLocalConfig();
  const url = `postgresql://${values.POSTGRES_USER}:${values.POSTGRES_PASSWORD}@127.0.0.1:${values.DB_PORT}/${values.POSTGRES_DB}?schema=public`;
  return { DATABASE_URL: url, DIRECT_URL: url, PORT: values.API_PORT,
    COOKIE_SECURE: values.COOKIE_SECURE || 'false', PROJECT_BASE_URL: `http://127.0.0.1:${values.API_PORT}/api` };
}
module.exports = { root, loadProjectConfig };
