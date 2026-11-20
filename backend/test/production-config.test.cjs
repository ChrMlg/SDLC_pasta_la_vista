const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateProduction } = require('../scripts/validate-production.cjs');
const connection = 'postgresql://prisma.project:fake-test-value@aws-0-test.pooler.supabase.com:5432/postgres?sslmode=require';
const valid = () => ({ DATABASE_URL: connection, DIRECT_URL: connection, LOCAL_ACCESS_KEY: 'a'.repeat(64), COOKIE_SECURE: 'true', PUBLIC_API_URL: 'https://api.example.com/api', CORS_ORIGINS: '' });
test('acepta Session pooler y Swagger del mismo origen sin frontend', () => assert.doesNotThrow(() => validateProduction(valid())));
test('rechaza configuración incompleta sin revelar secretos', () => {
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'LOCAL_ACCESS_KEY', 'PUBLIC_API_URL']) {
    const config = valid(); delete config[key];
    assert.throws(() => validateProduction(config), error => error.message.includes(key) && !error.message.includes('fake-test-value'));
  }
});
test('exige TLS y evita conexiones locales en producción', () => {
  for (const value of [connection.replace('sslmode=require', 'sslmode=disable'), connection.replace('aws-0-test.pooler.supabase.com', 'localhost')])
    assert.throws(() => validateProduction({ ...valid(), DATABASE_URL: value }));
});
test('migraciones rechazan Transaction pooler; runtime Prisma 5 exige pgbouncer', () => {
  const transaction = connection.replace(':5432/', ':6543/');
  assert.throws(() => validateProduction({ ...valid(), DIRECT_URL: transaction }));
  assert.throws(() => validateProduction({ ...valid(), DATABASE_URL: transaction }));
  assert.doesNotThrow(() => validateProduction({ ...valid(), DATABASE_URL: transaction + '&pgbouncer=true' }));
});
test('cookies seguras y CORS con origen HTTPS exacto', () => {
  assert.throws(() => validateProduction({ ...valid(), COOKIE_SECURE: 'false' }));
  for (const value of ['*', 'http://web.example.com', 'https://web.example.com/', 'https://web.example.com/path'])
    assert.throws(() => validateProduction({ ...valid(), CORS_ORIGINS: value }));
  assert.doesNotThrow(() => validateProduction({ ...valid(), CORS_ORIGINS: 'https://web.example.com,https://other.example.com' }));
});
