# Forma de trabajo

El backend de Bistro se organizó en historias de usuario registradas en [GitHub Issues](https://github.com/ChrMlg/SDLC_pasta_la_vista/issues). Para cada historia se revisaron sus criterios de aceptación y su relación con los demás módulos antes de comenzar el desarrollo.

## Ramas de trabajo

- `feature/<ID>-<descripcion>`: desarrollo de historias de usuario.
- `bugfix/<ID>-<descripcion>`: corrección de defectos.
- `release/<version>`: preparación de una publicación.
- `hotfix/<descripcion>`: correcciones sobre una versión publicada, partiendo de `main`.

`develop` se utiliza para integrar el trabajo del equipo. `main` contiene el código aprobado para publicación. Los hotfixes se integran en ambas ramas para mantenerlas sincronizadas.

## Commits y Pull Requests

Los commits describen el cambio realizado y, cuando corresponde, incluyen el identificador de la historia. Por ejemplo:

```text
feat(H14): registrar movimientos de inventario
```

Usamos los prefijos `feat`, `fix`, `test` y `docs` según el tipo de cambio.

Cada Pull Request incluye una descripción del trabajo, las pruebas realizadas y la historia relacionada. El otro integrante revisa los cambios antes de aprobar la integración. Después se actualiza la tarjeta correspondiente en GitHub Projects.

## Verificación

El proyecto dispone de comandos para comprobar el funcionamiento del backend:

```bash
npm test
npm run typecheck
npm run build
```

Las pruebas de los endpoints y sus flujos también se realizan mediante Postman. La guía de [instalación local](05-instalacion-local.md) explica la preparación del entorno y la ejecución de las colecciones.

## Distribución del backend

| Integrante | GitHub | Módulos | Historias |
|---|---|---|---|
| **Marcelo Enrique Campos Reyes (00148023)** | [Marceloereyes](https://github.com/Marceloereyes) | 3: Cocina (H6–H9); 4: Reservaciones (H10–H12); 5: Inventario (H13–H15); 8: Reseñas (H23–H25); 10: Reportes (H31–H35). | **18** |
| **Christian Eduardo Melgar Canizalez (00110219)** | [ChrMlg](https://github.com/ChrMlg) | 1: Menú (H1–H3); 2: Pedidos (H4–H5); 6: Pagos (H16–H18); 7: Lealtad (H19–H22); 9: Notificaciones (H26–H30). | **17** |

El detalle de las **35 historias de usuario** se encuentra en [Historias de usuario](08-historias.md).
