# Forma de trabajo

Organizamos nuestro trabajo por historias del tablero de GitHub. Antes de programar revisamos su ID, sus criterios de aceptación y las dependencias con los módulos del equipo.

Usamos una rama `feature/<ID>-<descripcion>` por historia. Los cambios se integran en `develop` después de la revisión de otro integrante. `main` queda para la versión publicada. Para corregir defectos usamos `bugfix/<ID>-<descripcion>`; para publicar, `release/<version>`; y para correcciones urgentes de producción, `hotfix/<descripcion>`.

En los commits incluimos el ID y explicamos el cambio, por ejemplo `feat(H14): registrar movimientos de inventario`. Usamos `feat` para funcionalidades, `fix` para correcciones, `test` para pruebas y `docs` para documentación. Cuando hace falta, explicamos el motivo en el cuerpo del commit.

El PR lleva el ID, un resumen de lo que hicimos, las pruebas ejecutadas y el enlace a la historia. Otro integrante lo revisa y aprueba antes de fusionarlo. Después agregamos el enlace del PR a la card y actualizamos su estado. Las pruebas nuevas también pasan por este flujo, desde la rama de la historia o una rama `feature/<ID>-pruebas`.

Las historias están en [GitHub Issues](https://github.com/ChrMlg/SDLC_pasta_la_vista/issues). Falta agregar el enlace directo al tablero del equipo.