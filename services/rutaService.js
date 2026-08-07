// services/rutaService.js
const axios = require('axios');

const GEOCODING_API_KEY = 'AIzaSyDw3aYcykXZUl7tqD4Iyf0kyTFf57jGAM0';

const log  = (msg, data) => console.log(`[rutaService] ${msg}`, data !== undefined ? data : '');
const warn = (msg, data) => console.warn(`[rutaService] ⚠️  ${msg}`, data !== undefined ? data : '');
const err  = (msg, data) => console.error(`[rutaService] ❌ ${msg}`, data !== undefined ? data : '');
const ok   = (msg, data) => console.log(`[rutaService] ✅ ${msg}`, data !== undefined ? data : '');

const geocodificarDireccion = async (direccion) => {
  if (!direccion) { warn('dirección vacía/null'); return null; }
  const direccionCompleta = `${direccion}, Pasto, Nariño, Colombia`;
  log(`Geocodificando: "${direccionCompleta}"`);
  try {
    const { data } = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: direccionCompleta, key: GEOCODING_API_KEY },
      timeout: 8000,
    });
    log(`Geocoding status para "${direccion}": ${data.status}`);
    if (data.status === 'OK' && data.results.length > 0) {
      const { lat, lng } = data.results[0].geometry.location;
      ok(`Geocodificado "${direccion}" → lat:${lat}, lng:${lng}`);
      return { lat, lng };
    }
    warn(`No se pudo geocodificar "${direccion}" — status: ${data.status}${data.error_message ? ' — ' + data.error_message : ''}`);
    return null;
  } catch (error) {
    err(`Error geocodificando "${direccion}": ${error.message}`);
    return null;
  }
};

const calcularRutaOptima = async (puntos) => {
  if (!puntos || puntos.length < 2) { warn('Se necesitan al menos 2 puntos'); return null; }
  const ORS_KEY = process.env.ORS_API_KEY;
  if (!ORS_KEY) { err('ORS_API_KEY no definida en .env'); return null; }
  log(`Calculando ruta con OpenRouteService (heigit.org) para ${puntos.length} puntos`);
  try {
    const coordinates = puntos.map(p => [p.lng, p.lat]);
    log(`Coordenadas enviadas a ORS: ${JSON.stringify(coordinates)}`);
    const { data } = await axios.post(
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      { coordinates },
      {
        headers: {
          'Authorization': ORS_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json, application/geo+json',
        },
        timeout: 15000,
      }
    );
    const feature = data.features?.[0];
    if (!feature) { err('ORS no retornó features'); log('Respuesta ORS:', JSON.stringify(data)); return null; }
    const coordenadas = feature.geometry.coordinates.map(coord => ({ lat: coord[1], lng: coord[0] }));
    const summary = feature.properties.summary;
    const ordenIndices = puntos.map((_, i) => i);
    ok(`Ruta ORS calculada: ${coordenadas.length} puntos, ${(summary.distance/1000).toFixed(2)} km, ${Math.round(summary.duration/60)} min`);
    return { coordenadas, ordenIndices, distanciaTotal: Math.round(summary.distance), duracionEstimada: Math.round(summary.duration) };
  } catch (error) {
    if (error.response) {
      err(`HTTP ${error.response.status} en OpenRouteService`, JSON.stringify(error.response.data));
    } else {
      err(`Error en OpenRouteService: ${error.message}`);
    }
    return null;
  }
};

const generarRutaParaViaje = async (bodega, clientes) => {
  log('═══════════════════════════════════════════════');
  log(`Iniciando generación de ruta`);
  log(`Bodega: ${bodega?.nombre} | Dir: "${bodega?.direccion}"`);
  if (!bodega || !bodega.direccion) { err('Bodega inválida o sin dirección'); return null; }
  if (!clientes || clientes.length === 0) { err('Array de clientes vacío'); return null; }

  log('Paso 1: Geocodificando bodega...');
  const coordBodega = await geocodificarDireccion(bodega.direccion);
  if (!coordBodega) { err('No se pudo geocodificar la bodega'); return null; }

  log('Paso 2: Geocodificando clientes...');
  const coordenadasClientes = [];
  const clientesConCoords = [];
  const LOTE = 5;
  for (let i = 0; i < clientes.length; i += LOTE) {
    const lote = clientes.slice(i, i + LOTE);
    const resultados = await Promise.all(lote.map(c => geocodificarDireccion(c.direccion)));
    resultados.forEach((coords, idx) => {
      const cliente = lote[idx];
      if (coords) { coordenadasClientes.push(coords); clientesConCoords.push(cliente); ok(`Cliente geocodificado: "${cliente.nombre}"`); }
      else { warn(`Cliente SIN coordenadas: "${cliente.nombre}" — dir: "${cliente.direccion}"`); }
    });
  }
  log(`Geocodificación: ${clientesConCoords.length}/${clientes.length} clientes con coordenadas`);
  if (clientesConCoords.length === 0) { err('Ningún cliente pudo geocodificarse'); return null; }

  log('Paso 3: Calculando ruta óptima...');
  const todosPuntos = [coordBodega, ...coordenadasClientes];
  log(`Total puntos para ORS: ${todosPuntos.length}`);
  const resultado = await calcularRutaOptima(todosPuntos);
  if (!resultado) { err('calcularRutaOptima retornó null'); return null; }

  log('Paso 4: Mapeando orden de clientes...');
  const ordenClientes = resultado.ordenIndices
    .filter(i => i > 0)
    .map(i => clientesConCoords[i - 1]?._id)
    .filter(Boolean);

  const rutaFinal = {
    coordenadas: resultado.coordenadas,
    ordenClientes,
    distanciaTotal: resultado.distanciaTotal,
    duracionEstimada: resultado.duracionEstimada,
  };
  ok(`Ruta generada: ${rutaFinal.coordenadas.length} coords, ${(rutaFinal.distanciaTotal/1000).toFixed(2)} km, ~${Math.round(rutaFinal.duracionEstimada/60)} min`);
  log('═══════════════════════════════════════════════');
  return rutaFinal;
};

module.exports = { generarRutaParaViaje, geocodificarDireccion, calcularRutaOptima };
