# Guía de uso

| Rol | Funciones |
|---|---|
| CUSTOMER | Menú, pedidos, reservas propias, pagos, lealtad, reseñas y notificaciones |
| WAITER | Pedidos en mesa, seguimiento, recogida y entrega en su sucursal |
| KITCHEN | Cola, toma/liberación de comandas y marcado de platillos listos |
| MANAGER | Catálogo, inventario, ocupación y reseñas de su sucursal |
| GENERAL_MANAGER | Gestión global, configuración de lealtad y reportes comparativos |

## Flujos principales

- Catálogo: iniciar sesión como gerente, listar platillos, crear o editar y cambiar disponibilidad.
- Reservas: cliente elige sucursal, fecha, hora y cantidad; consulta sus reservas y cancela con dos horas de anticipación. Gerencia consulta ocupación.
- Inventario: gerente consulta existencias, registra entrada/salida con motivo y revisa alertas.
- Cocina y entrega: cocina toma la comanda, marca platillos listos; mesero confirma recogida y entrega.
- Reseñas: cliente califica un pedido entregado dentro de 720 horas; consulta reseñas y gerencia consulta promedios.
- Lealtad: el cliente consulta saldo e historial, selecciona un beneficio activo y lo canjea en una cuenta abierta; puede liberarlo antes del pago. Gerencia consulta reglas y beneficios; gerencia general los modifica.
- Reportes: gerente general selecciona rango y sucursales para ventas, comparación, platillos, horarios pico y desempeño.

Para utilizar Postman contra producción, configurar como base `https://practical-transformation-staging.up.railway.app/api` e iniciar sesión con las cuentas de evaluación entregadas por un canal privado. Mantener la cookie HttpOnly `bistro_session`, que la API utiliza para autenticar las peticiones. Para desarrollo local, seguir [instalación](05-instalacion-local.md).

El frontend no forma parte de este repositorio. Las solicitudes HTTP a Postman no sustituyen las pruebas de sistema desde la interfaz ni las pruebas de aceptación independientes exigidas por la cátedra. Las credenciales y las capturas con secretos **no** deben almacenarse en Git.
