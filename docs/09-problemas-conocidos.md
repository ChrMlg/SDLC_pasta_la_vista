# Problemas conocidos y pendientes

| ID | Problema / reproducción | Impacto | Estado |
|---|---|---|---|
| DEF-01 | Importar environment antiguo “SDLC QA privado” o usar credenciales de otra instalación | Alto: autenticación/IDs incorrectos | Instrucciones y exportación corregidas localmente; falta confirmación en el equipo de Christian |
| DEF-02 | Ejecutar npm test en el checkout backend: antes referenciaba archivos frontend ausentes | Alto | Comando corregido; resultado actual en evidencias locales |
| DEF-04 | Ejecutar Salud con solo baseUrl: el script previo reportaba «Falta branchId» aunque la API respondiera 200 | Alto | Corregido y verificado con Newman sin environment ni credenciales; healthcheck con URL local por defecto. Confirmación en el equipo de Christian pendiente |
| ENT-01 | No hay release v1.0.0 ni URLs HTTPS configuradas | Alto | DigitalOcean confirmado; servidor, dominio, revisión y publicación pendientes |
| ENT-02 | Verificar criterios de todas las historias contra suites .spec.ts Jest | Alto | Suites Jest incorporadas para las historias de Marcelo; falta revisión independiente de la matriz y criterios duplicados H1–H3 |
| ENT-03 | Pruebas manuales por criterio, capturas y aceptación independiente | Alto | Pendiente; no se registran como ejecutadas |
| ENT-04 | Frontend y módulos de lealtad H19–H22 no aparecen en este backend | Alto | Validar integración con responsables; no declarar terminadas sus historias |
| ENT-05 | Aprobaciones de PR, cards Hecho, carnets y URL de tablero | Medio | 18 PR aprobados y fusionados verificados; H1–H3, cards, carnets y URL de tablero por confirmar |
| ENT-06 | Semilla suficiente para todos los módulos y usuario cliente de evaluación | Alto | Semilla local de los módulos implementados verificada; lealtad y ejecución desplegada pendientes |

Los cambios de esta revisión están sin commit y sin push por instrucción de Marcelo. No hay PR correctivo que enlazar todavía. Fecha de revisión: 17/11/2026.

DEF-03: una ejecución paralela de regresiones, simultánea con escrituras de preparación, obtuvo 409 BILL_CONFLICT en H6. Confirmación secuencial: 259 comprobaciones aprobadas. El runner `test:stories` serializa las suites; no se modificó el contrato del servicio de cuentas.
