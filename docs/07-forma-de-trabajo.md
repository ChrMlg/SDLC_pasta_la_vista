# Forma de trabajo

Organizamos el trabajo por historias del tablero de GitHub. Antes de programar revisamos su ID, sus criterios de aceptación y las dependencias con los módulos del equipo.

Usamos una rama `feature/<ID>-<descripcion>` por historia. Los cambios se integran en `develop` después de la revisión de otro integrante. `main` queda para la versión publicada. Para corregir defectos usamos `bugfix/<ID>-<descripcion>`; para publicar, `release/<version>`; y para correcciones urgentes de producción, `hotfix/<descripcion>`.

En los commits incluimos el ID y explicamos el cambio, por ejemplo `feat(H14): registrar movimientos de inventario`. Usamos `feat` para funcionalidades, `fix` para correcciones, `test` para pruebas y `docs` para documentación. Cuando hace falta, explicamos el motivo en el cuerpo del commit.

El PR lleva el ID, un resumen de lo que hicimos, las pruebas ejecutadas y el enlace a la historia. Otro integrante lo revisa y aprueba antes de fusionarlo. Después agregamos el enlace del PR a la card y actualizamos su estado. Las pruebas nuevas también pasan por este flujo, desde la rama de la historia o una rama `feature/<ID>-pruebas`.

## Publicación de la versión 1.0.0

1. Comprobar que el PR de `bugfix/H1-H35-preparacion-railway` hacia `develop` fue aprobado por otra persona, se fusionó y las acciones automáticas terminaron sin fallos.
2. Desde `develop` actualizado crear `release/1.0.0`. En esa rama realizar solamente los ajustes finales de versión y documentación.
3. Crear PR `release/1.0.0` → `main`, obtener revisión y aprobación de otro integrante y fusionarlo.
4. Incorporar también el contenido de `release/1.0.0` en `develop`, comprobando que ambas ramas tienen los cambios publicados.
5. Crear en GitHub la release **v1.0.0** apuntando al commit publicado de `main`, con una lista breve de módulos e historias incluidas. No crear la etiqueta antes de fusionar a `main`.
6. Configurar Railway para desplegar `main`, comprobar el SHA del despliegue, `/api/health`, Swagger y los accesos de evaluación. Un cambio posterior en producción debe seguir `hotfix/<descripcion>` y pasar a `main` y `develop`, publicando `v1.0.1`.

Para la nota individual de Marcelo (00148023), documentar los PR aprobados de los **módulos 3, 4, 5, 8 y 10**: H6–H15, H23–H25 y H31–H35, detallados en [historias](08-historias.md). Confirmar sus tarjetas en **Hecho**. **H1–H3 quedan excluidas de su evaluación individual.**

Las historias están en [GitHub Issues](https://github.com/ChrMlg/SDLC_pasta_la_vista/issues). El equipo debe añadir el enlace directo al tablero compartido; no asumir que un issue cerrado significa que la tarjeta ya está en **Hecho**.
