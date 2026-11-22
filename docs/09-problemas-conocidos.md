# Problemas conocidos

Durante el desarrollo y las pruebas del backend de Bistro se identificaron las siguientes incidencias.

| Código | Incidencia | Solución o seguimiento |
|---|---|---|
| DEF-01 | Algunos entornos anteriores de Postman utilizaban datos de acceso e identificadores de otra instalación. | Se actualizaron las instrucciones y la exportación del entorno de Postman para utilizar los datos de la instalación local. |
| DEF-02 | La limpieza de las pruebas de H6 y H23 fallaba cuando los pedidos tenían registros asociados al programa de lealtad. | Se ajustó el orden de limpieza de los datos creados por las pruebas. |
| DEF-03 | Las pruebas de H22 modificaban la configuración global de puntos. | Se ajustó el proceso de prueba para restaurar la configuración original. |
| DOC-01 | Swagger agrupaba varios endpoints en la categoría `default`. | Se añadieron las etiquetas correspondientes para organizar los endpoints por módulo. |
| DAT-01 | Se observaron platillos cuyos nombres incluyen un UUID, con el mismo formato utilizado en las pruebas de Postman. | Revisar los registros y sus relaciones con pedidos antes de corregirlos o eliminarlos de la base de datos. |

Los cambios de código y las correcciones se gestionan mediante Pull Requests, siguiendo el proceso descrito en [Forma de trabajo](07-forma-de-trabajo.md).
