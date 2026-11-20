# Problemas conocidos y pendientes

Revisión: 19/11/2026 sobre develop 71f8b2c y los ajustes locales de preparación.

| ID | Problema / reproducción | Impacto | Estado |
|---|---|---|---|
| DEF-01 | Importar un environment antiguo o credenciales de otra instalación | Alto: autenticación/IDs incorrectos | Exportación e instrucciones corregidas; usar los accesos de la instalación actual |
| DEF-02 | Ejecutar H6/H23 después de incorporar H19: la limpieza intenta borrar pedidos referenciados por puntos | Medio: falla el hook de prueba y deja fixtures | Limpieza ajustada para borrar primero lealtad de los clientes exclusivos del fixture |
| DEF-03 | Newman ejecuta H22 y cambia la regla global de puntos | Medio: altera configuración local después de verificar | Runner ajustado para restaurar la regla original |
| ENT-01 | No hay release v1.0.0 ni URLs HTTPS verificadas | Alto | Configuración Railway + Supabase preparada; infraestructura y publicación pendientes |
| ENT-02 | Suites de Marcelo sin commit; H1–H3 backend integradas por PR general #67 sin reviews | Alto | 18 PR #68–85 con aprobación independiente comprobada; H1–H3 requieren revisión y trazabilidad; cards sin verificar |
| ENT-03 | Pruebas manuales, capturas y aceptación desplegada | Alto | Pendientes; las pruebas automatizadas no las sustituyen |
| ENT-04 | Solo hay backend; no existe frontend en este repositorio | Alto | La guía exige interfaz pública; falta cubrir el requisito o confirmar excepción con cátedra |
| ENT-05 | URLs, datos académicos, tablero y accesos docentes incompletos/no verificados | Medio | Completar README, forma de trabajo y trazabilidad antes de entregar |
| ENT-06 | Semilla y acceso de producción | Alto | Semilla incluye H19–H22; ejecución y logins en Supabase pendientes |

Los defectos corregidos deben incorporarse a la versión entregada.
