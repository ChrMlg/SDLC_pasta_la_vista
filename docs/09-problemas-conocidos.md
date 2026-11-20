# Problemas conocidos y pendientes

Actualización documental: 20/11/2026, partiendo del commit `c3720b7` de la rama `bugfix/H1-H35-preparacion-railway`.

| ID | Problema / reproducción | Impacto | Estado |
|---|---|---|---|
| DEF-01 | Importar un environment antiguo o credenciales de otra instalación | Alto: autenticación/IDs incorrectos | Exportación e instrucciones corregidas; usar los accesos de la instalación actual |
| DEF-02 | Ejecutar H6/H23 después de incorporar H19: la limpieza intenta borrar pedidos referenciados por puntos | Medio: falla el hook de prueba y deja fixtures | Limpieza ajustada para borrar primero lealtad de los clientes exclusivos del fixture |
| DEF-03 | Newman ejecuta H22 y cambia la regla global de puntos | Medio: altera configuración local después de verificar | Runner ajustado para restaurar la regla original |
| ENT-01 | La versión final debe corresponder al commit publicado en main con la etiqueta v1.0.0 | Alto | Backend reportado como desplegado en Railway; falta comprobar PR, tag y SHA de main |
| ENT-02 | Trazabilidad de historias y pruebas | Alto | Suites de componente integradas en commit e010a63; 18 PR #68–85 de los módulos 3, 4, 5, 8 y 10 documentados; verificar tarjetas del tablero. H1–H3 excluidas de la evaluación individual de Marcelo; hay issues históricos duplicados #19–#21. |
| ENT-03 | Pruebas manuales, capturas y aceptación desplegada | Alto | Pendientes de evidencias y ejecución independiente; no se guardan dentro de este repositorio, sino en OneDrive según la guía |
| ENT-04 | Frontend fuera del repositorio backend | Medio | Documentar su repositorio y URL por separado al preparar la entrega común |
| ENT-05 | Tablero, colaboradores y accesos docentes no confirmados en este ZIP | Medio | Comprobar tarjetas Hecho, enlaces PR y que los docentes tengan acceso; credenciales solo por Moodle |
| ENT-06 | Semilla y acceso de producción | Alto | El equipo informó que la API responde en Postman; confirmar que existen cuentas de los cinco roles y datos de evaluación en Supabase, sin poner secretos en el repositorio |

Los defectos corregidos deben incorporarse a la versión entregada.
