const { readFileSync, writeFileSync, chmodSync } = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { verifyPassword } = require('../dist/auth/credentials');
const { root, loadProjectConfig } = require('./project-db-config.cjs');
const data = require('../prisma/project-data.cjs');

async function main() {
  const credentials = JSON.parse(readFileSync(path.join(root, '.env.project.credentials'), 'utf8'));
  const db = new PrismaClient({ datasources: { db: { url: loadProjectConfig('local').DIRECT_URL } } });
  try {
    const users = await db.user.findMany({ where: { id: { in: data.users.map(user => user.id) } }, include: { branch: { select: { name: true } } } });
    const sections = { staff: [], customers: [] };
    for (const expected of data.users) {
      const user = users.find(row => row.id === expected.id), account = credentials[expected.label];
      if (!user || !account || !user.isActive || user.email !== account.email || user.role !== expected.role ||
        user.branchId !== expected.branchId || !user.passwordHash || !await verifyPassword(account.password, user.passwordHash))
        throw new Error('No se pudo verificar una cuenta; no se exportan accesos incorrectos');
      sections[user.role === 'CUSTOMER' ? 'customers' : 'staff'].push([
        `Rol: ${user.role}`, `Nombre: ${user.firstName || ''} ${user.lastName || ''}`.trim(),
        `Sucursal: ${user.branch?.name || 'Sin sucursal fija'}`, `Correo: ${account.email}`, `Contraseña: ${account.password}`,
      ].join('\n'));
    }
    const text = [
      'ACCESOS A LA APLICACIÓN — SDLC',
      'Base del proyecto: PostgreSQL local ejecutado por Docker Compose, con volumen persistente.',
      'Estas credenciales son para iniciar sesión en la aplicación; no dan acceso al panel ni a PostgreSQL.',
      'No hay una web publicada. Cada integrante inicia backend y base local con npm start desde la raíz. Las bases de computadoras distintas no se sincronizan automáticamente.',
      'Inicio de sesión: pantalla /login o POST /api/auth/login con email y password.',
      'El rol se obtiene de la cuenta guardada en la base; no se escoge al iniciar sesión.',
      '\nCUENTAS INTERNAS\n', sections.staff.join('\n\n'),
      '\nCLIENTES DE DEMOSTRACIÓN YA EXISTENTES (OPCIONALES)\n',
      'Los clientes nuevos se registran en /register o POST /api/auth/register/customer. No dependen de estos correos.',
      sections.customers.join('\n\n'),
      '\nLas demás cuentas y datos existentes se conservaron. No se cambiaron estas contraseñas.',
      'Archivo privado para el equipo: no incorporarlo a Git, issues ni pull requests.',
    ].join('\n') + '\n';
    const output = path.join(root, 'accesos-equipo-privado.txt');
    writeFileSync(output, text, { mode: 0o600 }); chmodSync(output, 0o600);
    console.log(`Accesos verificados: ${sections.staff.length} internos y ${sections.customers.length} clientes de demostración. Texto privado generado.`);
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('No se exportaron accesos: revise las cuentas y la configuración privada.'); process.exitCode = 1; });
