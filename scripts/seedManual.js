// scripts/seedManual.js
//
// Crea TODA la estructura de los dos manuales (Coordinador Logístico /
// Conductores) de una sola vez: secciones, pasos, textos e íconos.
//
// Es SEGURO volver a correrlo: borra únicamente lo que este script haya
// creado antes (usa el mismo `titulo` como llave) y lo vuelve a crear, así
// que no duplica secciones si lo ejecutas dos veces.
//
// LO ÚNICO QUE QUEDA PENDIENTE: copiar los archivos de video finales a
//   /var/www/cooespatrans/uploads/manual/
// con estos nombres exactos (ya vienen así en la carpeta clips_finales/):
//   01_cargar_datos_excel.mp4
//   01b_app_movil_mis_viajes.mp4
//   02_generar_ruta_mapa.mp4
//   03_datos_del_viaje.mp4
//   04_resumen_confirmar.mp4
//   05_seguimiento_tiempo_real.mp4
//   06_conductor_completa_entrega.mp4
// Los pasos que ya tienen video real apuntan directo a esos nombres; el
// resto de pasos queda con tipoMedia:'ninguno' — se les sube contenido
// después desde Admin > Manual, sin tocar este script otra vez.
//
// CÓMO EJECUTARLO (desde la raíz del proyecto backend, junto a server.js):
//   node scripts/seedManual.js
//
// Usa la misma variable MONGODB_URI del .env del proyecto.

require('dotenv').config();
const mongoose = require('mongoose');
const ManualSeccion = require('../models/ManualSeccion');

const VIDEO_BASE = '/uploads/manual';
const v = (nombre) => `${VIDEO_BASE}/${nombre}`;

// ─────────────────────────────────────────────
// Helper para armar un paso rápido
// ─────────────────────────────────────────────
function paso(orden, titulo, instruccion, videoNombre = null) {
  return {
    orden,
    titulo,
    instruccion,
    tipoMedia: videoNombre ? 'video' : 'ninguno',
    videoUrl: videoNombre ? v(videoNombre) : null,
    imagenUrl: null,
  };
}

// ═════════════════════════════════════════════
// MANUAL 1: COORDINADOR LOGÍSTICO (uso de la página web)
// ═════════════════════════════════════════════
const MANUAL_WEB = [
  {
    titulo: 'Primeros pasos',
    icono: 'Monitor',
    descripcion: 'Cómo entrar a la plataforma y ubicarte',
    pasos: [
      paso(0, '1. Iniciar sesión', 'Ingresa a www.cooespatrans.com, escribe tu correo y contraseña, y pulsa "Iniciar sesión". Si olvidaste tu contraseña, usa el enlace "¿Olvidaste tu contraseña?" en la misma pantalla.'),
      paso(1, '2. Ubicar el menú lateral', 'Al entrar verás un menú a la izquierda con las secciones disponibles según tu rol: Bodegas, Viajes, Conductores, Reportes y Chat.'),
    ],
  },
  {
    titulo: 'Bodegas y Planillas',
    icono: 'Warehouse',
    descripcion: 'Cargar y organizar los clientes por planilla',
    pasos: [
      paso(0, '1. Cargar clientes desde Excel', 'Entra a la bodega, pulsa "Cargar Datos", selecciona el archivo Excel con tus clientes y confirma. La plataforma organiza los clientes automáticamente por número de planilla.', '01_cargar_datos_excel.mp4'),
      paso(1, '2. Crear una bodega nueva', 'Desde la pantalla de Bodegas, pulsa "Nueva Bodega", escribe el nombre y la dirección, y guarda.'),
      paso(2, '3. Crear una planilla manual', 'Si no tienes un Excel, pulsa "Agregar planilla", escribe el número y empieza a agregarle clientes uno por uno.'),
    ],
  },
  {
    titulo: 'Gestión de Clientes',
    icono: 'Users',
    descripcion: 'Agregar y mantener actualizados los datos de cada cliente',
    pasos: [
      paso(0, '1. Agregar un cliente manualmente', 'Dentro de una planilla, pulsa "Agregar Cliente" y completa nombre, dirección, teléfono, valor a recibir y tipo de factura (contado o crédito).'),
      paso(1, '2. Editar un cliente', 'Pulsa el ícono de lápiz junto al cliente que quieras corregir, actualiza los datos y guarda.'),
    ],
  },
  {
    titulo: 'Crear un viaje',
    icono: 'Truck',
    descripcion: 'De la planilla al viaje: ruta, flete y conductor',
    pasos: [
      paso(0, '1. Generar la ruta en el mapa', 'Con la planilla y sus clientes listos, pulsa "Generar viaje". La plataforma calcula automáticamente la ruta más eficiente en el mapa.', '02_generar_ruta_mapa.mp4'),
      paso(1, '2. Ingresar el flete y el conductor', 'Escribe el valor del flete (puedes usar atajos como "1.5m" para 1.500.000), el anticipo si aplica, y selecciona el conductor disponible de la lista.', '03_datos_del_viaje.mp4'),
      paso(2, '3. Revisar y confirmar', 'Revisa el resumen del viaje (planilla, conductor, flete, clientes) y pulsa "Confirmar y Generar Viaje". El conductor recibe la notificación al instante.', '04_resumen_confirmar.mp4'),
      paso(3, '4. Cambiar el conductor asignado', 'Si el viaje aún está "pendiente" (el conductor no lo ha aceptado), puedes cambiar el conductor desde el detalle del viaje.'),
      paso(4, '5. Cancelar un viaje', 'Desde el listado de viajes, abre el menú de acciones y pulsa "Cancelar viaje". Los clientes vuelven a quedar disponibles para un nuevo viaje.'),
    ],
  },
  {
    titulo: 'Seguimiento en tiempo real',
    icono: 'MapPin',
    descripcion: 'Ver dónde va cada conductor mientras el viaje está en curso',
    pasos: [
      paso(0, '1. Ver el mapa en vivo', 'Abre el viaje en curso y verás el mapa actualizarse con la posición del conductor cada pocos segundos.', '05_seguimiento_tiempo_real.mp4'),
      paso(1, '2. Interpretar los estados', 'Pendiente: creado, esperando que el conductor lo acepte. Aceptado: en curso. Completado: todas las entregas quedaron registradas.'),
      paso(2, '3. Ver el historial de un viaje completado', 'Desde Viajes, filtra por "Completados" y abre cualquiera para ver el recorrido completo que hizo el conductor.'),
    ],
  },
  {
    titulo: 'Gestión de Conductores',
    icono: 'UserCog',
    descripcion: 'Mantener actualizada la lista de conductores disponibles',
    pasos: [
      paso(0, '1. Agregar un conductor', 'Desde Conductores, pulsa "Nuevo Conductor" y completa nombre, teléfono, placa y correo.'),
      paso(1, '2. Ver disponibilidad', 'La lista marca en verde a los conductores libres y en azul a los que ya están en un viaje activo.'),
    ],
  },
  {
    titulo: 'Reportes y Liquidación',
    icono: 'BarChart3',
    descripcion: 'Analizar la operación y generar los pagos por quincena',
    pasos: [
      paso(0, '1. Filtrar reportes', 'Elige la bodega y el rango de fechas para ver el total de facturas de contado y crédito de ese periodo.'),
      paso(1, '2. Generar la liquidación', 'El reporte de liquidación por quincena lo genera cada conductor desde su propia app; aquí puedes consultar los reportes ya generados.'),
    ],
  },
  {
    titulo: 'Mensajería',
    icono: 'MessageCircle',
    descripcion: 'Comunicarte directamente con un conductor',
    pasos: [
      paso(0, '1. Enviar un mensaje', 'Abre el chat desde el ícono de mensajes, elige al conductor y escribe — el mensaje le llega como notificación en su app.'),
    ],
  },
  {
    titulo: 'Bitácora de viajes',
    icono: 'NotebookPen',
    descripcion: 'Registrar cada cargue con su tarifa, flete, anticipo, saldo y utilidad',
    pasos: [
      paso(0, '1. Registrar un viaje', 'En Bitácora > Registro de viajes pulsa "Nuevo viaje". Elige la empresa y el destino: la tarifa, el flete, el anticipo habitual y el peso se llenan solos. Al escribir el conductor se completa su placa. El número de registro y la fecha se asignan automáticamente.'),
      paso(1, '2. Buscar, editar o eliminar', 'Filtra por empresa, fechas o texto. El lápiz abre el viaje para corregirlo (conserva su número y fecha) y la papelera lo elimina sin afectar la numeración de los demás.'),
      paso(2, '3. Hojas por empresa y exportes', 'En "Por empresa" ves los totales de cada cliente (tarifa, flete, anticipos, saldo y utilidad) y descargas su hoja en PDF o Excel. Desde el registro descargas la bitácora completa.'),
      paso(3, '4. Reporte de WhatsApp y correo de salida', 'En "Reportes y envíos" genera un mensaje por empresa con los vehículos del día (cópialo o ábrelo en WhatsApp y márcalo como reportado) y envía el correo de autorización de salida de Corbeta.'),
      paso(4, '5. Enviar manifiestos y nuevo periodo', 'Marca los viajes en la columna "Enviar" y envía sus manifiestos por correo a la empresa, o adjunta los PDF. Al terminar el periodo usa "Iniciar nuevo periodo": los viajes quedan archivados como respaldo y la numeración vuelve a 1.'),
    ],
  },
  {
    titulo: 'Relación de fletes',
    icono: 'Receipt',
    descripcion: 'Facturación por empresa, pago a conductores y utilidad',
    pasos: [
      paso(0, '1. Elegir empresa y periodo', 'En el panel elige la empresa y escribe el periodo (ej. 1-15 de septiembre de 2026); el mes define el número del archivo.'),
      paso(1, '2. Registrar cargues', 'Pulsa "Registrar cargue": placa (busca por placa o nombre), destino, fecha, cantidad y si lleva auxiliar. La tabla calcula tarifa, total cobrado, flete y auxiliar pagados y la utilidad.'),
      paso(2, '3. Generar los informes', 'Descarga la relación para facturación, la relación de pago a conductores y el informe de utilidad con gráficas (Excel o PDF). Puedes marcar los cargues como facturados.'),
      paso(3, '4. Empezar una relación nueva', '"Nueva relación" deja la tabla en blanco; los cargues anteriores quedan archivados.'),
    ],
  },
  {
    titulo: 'Despacho RNDC',
    icono: 'FileCheck2',
    descripcion: 'Remesas y manifiestos ante el Ministerio de Transporte',
    pasos: [
      paso(0, '1. Traer viajes', 'En RNDC > Viajes por enviar pulsa "Traer viajes de la bitácora", elige la fecha y marca los viajes. Se completan la cédula, el titular, el PBV, los códigos DANE y la sede del destinatario.'),
      paso(1, '2. Revisar y corregir', 'Revisa los avisos en rojo, corrige con el lápiz y usa el ojo para ver exactamente lo que se enviará. "Validar conductores" compara nombres y cédulas con el maestro del RNDC.'),
      paso(2, '3. Numerar y enviar', 'Marca los viajes; los números de remesa y manifiesto se asignan en orden desde el consecutivo indicado. En modo PRUEBA solo se simula; en modo REAL escribe la clave del RNDC (no se guarda) y envía.'),
      paso(3, '4. Manifiestos PDF y correos', 'En "Manifiestos PDF" ves e imprimes cada manifiesto aceptado con su código QR, descargas todos en un ZIP y envías los PDF pendientes a cada empresa.'),
    ],
  },
  {
    titulo: 'Maestros de logística',
    icono: 'Database',
    descripcion: 'Empresas, tarifas, conductores y carga de la plantilla de Excel',
    pasos: [
      paso(0, '1. Empresas y correos', 'Registra cada empresa con su NIT, a quién van dirigidos los correos y sus destinatarios.'),
      paso(1, '2. Tarifas por destino', 'Elige la empresa y registra lo que se cobra y lo que se paga al conductor por cada destino. "Guardar" actualiza el destino si ya existe.'),
      paso(2, '3. Conductores y vehículos', 'Registra conductor, vehículo, tenedor y datos de pago. Al salir de la cédula o la placa se completan datos desde el maestro del RNDC; los vencimientos próximos se resaltan.'),
      paso(3, '4. Importar la plantilla', '"Importar plantilla" carga la información del Excel de viajes sin borrar ni duplicar lo existente.'),
    ],
  },
];

// ═════════════════════════════════════════════
// MANUAL 2: CONDUCTORES (uso de la app móvil SurTrack)
// ═════════════════════════════════════════════
const MANUAL_APP = [
  {
    titulo: 'Primeros pasos en la app',
    icono: 'Smartphone',
    descripcion: 'Iniciar sesión y conocer tu pantalla principal',
    pasos: [
      paso(0, '1. Iniciar sesión', 'Abre SurTrack, escribe tu correo y contraseña que te dio tu coordinador, y pulsa "Ingresar".'),
      paso(1, '2. Completar tu perfil', 'La primera vez que entras, completa tus datos y los de tu vehículo (placa, capacidad).'),
      paso(2, '3. Revisar tus viajes asignados', 'En "Mis Viajes" verás el viaje que te asignaron, con el número de planilla y la cantidad de clientes.', '01b_app_movil_mis_viajes.mp4'),
    ],
  },
  {
    titulo: 'Checklist del vehículo',
    icono: 'FileText',
    descripcion: 'Revisión semanal obligatoria antes de salir a ruta',
    pasos: [
      paso(0, '1. Llenar el checklist semanal', 'Desde el menú, entra a "Checklist" y marca cada punto de revisión del vehículo (llantas, luces, documentos). Debes completarlo antes de poder aceptar un viaje.'),
    ],
  },
  {
    titulo: 'Aceptar y navegar un viaje',
    icono: 'MapPin',
    descripcion: 'Del viaje asignado a la entrega en la puerta del cliente',
    pasos: [
      paso(0, '1. Aceptar el viaje', 'Cuando te llega la notificación de un nuevo viaje, ábrelo y pulsa "Aceptar viaje" para empezar a compartir tu ubicación.'),
      paso(1, '2. Navegar y completar cada entrega', 'La app te guía con el mapa hasta cada cliente en el orden más eficiente; al llegar, marca la entrega como completada.', '06_conductor_completa_entrega.mp4'),
    ],
  },
  {
    titulo: 'Entregas y evidencias',
    icono: 'Users',
    descripcion: 'Dejar constancia de cada entrega realizada',
    pasos: [
      paso(0, '1. Registrar firma y foto', 'En cada cliente, antes de marcar la entrega como completa, pide la firma del receptor y toma una foto como soporte.'),
      paso(1, '2. Marcar entregas parciales o devoluciones', 'Si no se entregó todo, elige "Parcial" o "Devolución" y escribe el motivo — esto queda visible para el coordinador.'),
    ],
  },
  {
    titulo: 'Tu reporte de liquidación',
    icono: 'BarChart3',
    descripcion: 'Generar el reporte de tus viajes para el pago quincenal',
    pasos: [
      paso(0, '1. Generar el reporte', 'Desde Historial, pulsa el ícono de PDF, elige la quincena (1-15 o 16-fin de mes) y pulsa "Generar reporte". Puedes descargarlo o enviarlo directamente.'),
      paso(1, '2. Revisar reportes anteriores', 'Desde la misma pantalla puedes ver y volver a descargar cualquier reporte que hayas generado antes.'),
    ],
  },
  {
    titulo: 'Mensajería',
    icono: 'MessageCircle',
    descripcion: 'Comunicación directa con tu coordinador',
    pasos: [
      paso(0, '1. Recibir y responder mensajes', 'Las notificaciones de nuevos mensajes aparecen en la campana de la app; ábrela para responder a tu coordinador.'),
    ],
  },
];

// ─────────────────────────────────────────────
// EJECUCIÓN
// ─────────────────────────────────────────────
async function sembrar(tipo, definicion) {
  console.log(`\n📖 Sembrando manual "${tipo}"...`);
  for (let i = 0; i < definicion.length; i++) {
    const s = definicion[i];
    // Idempotente: si ya existe una sección con este título en este
    // manual, se reemplaza por completo (no se duplica).
    await ManualSeccion.findOneAndDelete({ tipo, titulo: s.titulo });
    await ManualSeccion.create({
      tipo,
      titulo: s.titulo,
      icono: s.icono,
      descripcion: s.descripcion,
      orden: i,
      activa: true,
      pasos: s.pasos,
    });
    console.log(`  ✅ ${s.titulo} (${s.pasos.length} pasos)`);
  }
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('❌ Falta MONGODB_URI en el .env');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado a MongoDB');

  await sembrar('web', MANUAL_WEB);
  await sembrar('app', MANUAL_APP);

  const totalWeb = MANUAL_WEB.reduce((s, sec) => s + sec.pasos.length, 0);
  const totalApp = MANUAL_APP.reduce((s, sec) => s + sec.pasos.length, 0);
  console.log('\n🎉 Listo.');
  console.log(`   Manual Coordinador (web): ${MANUAL_WEB.length} secciones, ${totalWeb} pasos`);
  console.log(`   Manual Conductores (app): ${MANUAL_APP.length} secciones, ${totalApp} pasos`);
  console.log('\n📁 Pendiente: copiar los 7 videos a /var/www/cooespatrans/uploads/manual/');
  console.log('   (los nombres exactos están al inicio de este archivo)');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error al sembrar el manual:', err);
  process.exit(1);
});
