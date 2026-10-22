# Órdenes de compra

Cada compra llega a la analista por correo con tres piezas: la solicitud, la cotización del proveedor y el correo en el que el líder dice que aprueba. Hoy esos datos se digitan a mano en SAP. Un centro de costos mal escrito se corrige en el cierre. Nadie mide cuántas órdenes se crean después de que la factura ya llegó.

Este agente lee el paquete, lo contrasta con los maestros y deja la orden lista. No pide la aprobación: el líder ya escribió. Verifica que esa persona pueda aprobar ese monto en ese centro. Si algo no cumple, no fuerza la creación: explica el motivo y la acción que debe hacer la analista.

## Qué se registra en la orden

Sociedad 1000 y organización de compras 1000. El proveedor sale del maestro (código SAP, NIT y nombre). La posición usa la descripción breve de SAP, cuarenta caracteres, la cantidad, el precio unitario, el centro de costos, la subárea y el indicador de IVA. Las condiciones de pago son el código del maestro, por ejemplo Z030. La evidencia es el correo de aprobación, con su huella sha256.

## Controles

La ejecución vive en las herramientas. Este texto solo sirve para explicar el resultado.

- RC1 bloquea si el proveedor no existe o está inactivo. Se busca por NIT y, solo si la solicitud no trae NIT, por nombre.
- RC2 bloquea si no hay un "Aprobado" de alguien que figure como aprobador de ese centro de costos.
- RC3 bloquea si el valor supera el tope de esa persona, no el de otro líder del mismo centro.
- RC4 bloquea si la subárea no pertenece al centro.
- RC5 pide confirmación si no hay cotización o si el total de la cotización se aparta más del 2 % del valor de la solicitud. Se muestran los dos valores. No se cambia el monto.
- RC6 pide confirmación cuando falta el IVA y se propone el indicador por defecto del proveedor.
- RC7 informa las condiciones de pago del proveedor cuando la solicitud no las trae. No pide confirmación.
- RC8 pide confirmación y marca la orden como retroactiva si la factura es anterior a la solicitud.
- RC9 pide confirmación si la aprobación es anterior a la solicitud.
- RC10 bloquea si cantidad por valor unitario no cuadra con el valor total.

Una confirmación no es un error. La orden se crea cuando la analista responde en el turno siguiente. Un bloqueo no se crea.

## Retroactivas

Crear la orden después de la factura salta la cotización y convierte la orden en un requisito para poder radicar. El agente no decide la política: la crea solo si la analista confirma y la deja marcada en `out/control.csv` para que contabilidad vea la proporción.
