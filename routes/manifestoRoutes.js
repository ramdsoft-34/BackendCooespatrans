// routes/manifestoRoutes.js
const express = require('express');
const router = express.Router();
const ReporteManifiesto = require('../models/ReporteManifiesto');
const VehiculoManifiesto = require('../models/VehiculoManifiesto');
const BodegaManifiesto = require('../models/BodegaManifiesto');
const { protect } = require('../controllers/authController');

const MUNICIPIOS = [
  // ── AMAZONAS ──
  'EL ENCANTO - AMAZONAS','LA CHORRERA - AMAZONAS','LA PEDRERA - AMAZONAS',
  'LA VICTORIA - AMAZONAS','LETICIA - AMAZONAS','MIRITÍ-PARANÁ - AMAZONAS',
  'PUERTO ALEGRÍA - AMAZONAS','PUERTO ARICA - AMAZONAS','PUERTO NARIÑO - AMAZONAS',
  'PUERTO SANTANDER - AMAZONAS','TARAPACÁ - AMAZONAS',
  // ── ANTIOQUIA ──
  'ABEJORRAL - ANTIOQUIA','ABRIAQUÍ - ANTIOQUIA','ALEJANDRÍA - ANTIOQUIA',
  'AMAGÁ - ANTIOQUIA','AMALFI - ANTIOQUIA','ANDES - ANTIOQUIA',
  'ANGELÓPOLIS - ANTIOQUIA','ANGOSTURA - ANTIOQUIA','ANORÍ - ANTIOQUIA',
  'ANZÁ - ANTIOQUIA','APARTADÓ - ANTIOQUIA','ARBOLETES - ANTIOQUIA',
  'ARGELIA - ANTIOQUIA','BARBOSA - ANTIOQUIA','BELLO - ANTIOQUIA',
  'BELMIRA - ANTIOQUIA','BETANIA - ANTIOQUIA','BETULIA - ANTIOQUIA',
  'BRICEÑO - ANTIOQUIA','BURITICÁ - ANTIOQUIA','CÁCERES - ANTIOQUIA',
  'CAICEDO - ANTIOQUIA','CALDAS - ANTIOQUIA','CAMPAMENTO - ANTIOQUIA',
  'CAÑASGORDAS - ANTIOQUIA','CARACOLÍ - ANTIOQUIA','CARAMANTA - ANTIOQUIA',
  'CAREPA - ANTIOQUIA','CAROLINA - ANTIOQUIA','CAUCASIA - ANTIOQUIA',
  'CHIGORODÓ - ANTIOQUIA','CISNEROS - ANTIOQUIA','CIUDAD BOLÍVAR - ANTIOQUIA',
  'COCORNÁ - ANTIOQUIA','CONCEPCIÓN - ANTIOQUIA','CONCORDIA - ANTIOQUIA',
  'COPACABANA - ANTIOQUIA','DABEIBA - ANTIOQUIA','DON MATÍAS - ANTIOQUIA',
  'EBÉJICO - ANTIOQUIA','EL BAGRE - ANTIOQUIA','EL CARMEN DE VIBORAL - ANTIOQUIA',
  'EL SANTUARIO - ANTIOQUIA','ENTRERRÍOS - ANTIOQUIA','ENVIGADO - ANTIOQUIA',
  'FREDONIA - ANTIOQUIA','FRONTINO - ANTIOQUIA','GIRALDO - ANTIOQUIA',
  'GIRARDOTA - ANTIOQUIA','GÓMEZ PLATA - ANTIOQUIA','GRANADA - ANTIOQUIA',
  'GUADALUPE - ANTIOQUIA','GUARNE - ANTIOQUIA','GUATAPÉ - ANTIOQUIA',
  'HELICONIA - ANTIOQUIA','HISPANIA - ANTIOQUIA','ITAGÜÍ - ANTIOQUIA',
  'ITUANGO - ANTIOQUIA','JARDÍN - ANTIOQUIA','JERICÓ - ANTIOQUIA',
  'LA CEJA - ANTIOQUIA','LA ESTRELLA - ANTIOQUIA','LA PINTADA - ANTIOQUIA',
  'LA UNIÓN - ANTIOQUIA','LIBORINA - ANTIOQUIA','MACEO - ANTIOQUIA',
  'MARINILLA - ANTIOQUIA','MEDELLÍN - ANTIOQUIA','MONTEBELLO - ANTIOQUIA',
  'MURINDÓ - ANTIOQUIA','MUTATÁ - ANTIOQUIA','NARIÑO - ANTIOQUIA',
  'NECHÍ - ANTIOQUIA','NECOCLÍ - ANTIOQUIA','OLAYA - ANTIOQUIA',
  'PEÑOL - ANTIOQUIA','PEQUE - ANTIOQUIA','PUEBLORRICO - ANTIOQUIA',
  'PUERTO BERRÍO - ANTIOQUIA','PUERTO NARE - ANTIOQUIA','PUERTO TRIUNFO - ANTIOQUIA',
  'REMEDIOS - ANTIOQUIA','RETIRO - ANTIOQUIA','RIONEGRO - ANTIOQUIA',
  'SABANALARGA - ANTIOQUIA','SABANETA - ANTIOQUIA','SALGAR - ANTIOQUIA',
  'SAN ANDRÉS DE CUERQUIA - ANTIOQUIA','SAN CARLOS - ANTIOQUIA',
  'SAN FRANCISCO - ANTIOQUIA','SAN JERÓNIMO - ANTIOQUIA',
  'SAN JOSÉ DE LA MONTAÑA - ANTIOQUIA','SAN JUAN DE URABÁ - ANTIOQUIA',
  'SAN LUIS - ANTIOQUIA','SAN PEDRO DE LOS MILAGROS - ANTIOQUIA',
  'SAN PEDRO DE URABÁ - ANTIOQUIA','SAN RAFAEL - ANTIOQUIA',
  'SAN ROQUE - ANTIOQUIA','SAN VICENTE - ANTIOQUIA','SANTA BÁRBARA - ANTIOQUIA',
  'SANTA FE DE ANTIOQUIA - ANTIOQUIA','SANTA ROSA DE OSOS - ANTIOQUIA',
  'SANTO DOMINGO - ANTIOQUIA','SEGOVIA - ANTIOQUIA','SONSÓN - ANTIOQUIA',
  'SOPETRÁN - ANTIOQUIA','TARAZÁ - ANTIOQUIA','TARSO - ANTIOQUIA',
  'TITIRIBÍ - ANTIOQUIA','TOLEDO - ANTIOQUIA','TURBO - ANTIOQUIA',
  'URAMITA - ANTIOQUIA','URRAO - ANTIOQUIA','VALDIVIA - ANTIOQUIA',
  'VALPARAÍSO - ANTIOQUIA','VEGACHÍ - ANTIOQUIA','VENECIA - ANTIOQUIA',
  'VIGÍA DEL FUERTE - ANTIOQUIA','YALÍ - ANTIOQUIA','YARUMAL - ANTIOQUIA',
  'YOLOMBÓ - ANTIOQUIA','YONDÓ - ANTIOQUIA','ZARAGOZA - ANTIOQUIA',
  // ── ARAUCA ──
  'ARAUCA - ARAUCA','ARAUQUITA - ARAUCA','CRAVO NORTE - ARAUCA',
  'FORTUL - ARAUCA','PUERTO RONDÓN - ARAUCA','SARAVENA - ARAUCA','TAME - ARAUCA',
  // ── ATLÁNTICO ──
  'BARRANQUILLA - ATLÁNTICO','BARANOA - ATLÁNTICO','CAMPO DE LA CRUZ - ATLÁNTICO',
  'CANDELARIA - ATLÁNTICO','GALAPA - ATLÁNTICO','JUAN DE ACOSTA - ATLÁNTICO',
  'LURUACO - ATLÁNTICO','MALAMBO - ATLÁNTICO','MANATÍ - ATLÁNTICO',
  'PALMAR DE VARELA - ATLÁNTICO','PIOJÓ - ATLÁNTICO','POLONUEVO - ATLÁNTICO',
  'PONEDERA - ATLÁNTICO','PUERTO COLOMBIA - ATLÁNTICO','REPELÓN - ATLÁNTICO',
  'SABANAGRANDE - ATLÁNTICO','SABANALARGA - ATLÁNTICO','SANTA LUCÍA - ATLÁNTICO',
  'SANTO TOMÁS - ATLÁNTICO','SOLEDAD - ATLÁNTICO','SUÁN - ATLÁNTICO',
  'TUBARÁ - ATLÁNTICO','USIACURÍ - ATLÁNTICO',
  // ── BOLÍVAR ──
  'CARTAGENA - BOLÍVAR','ACHÍ - BOLÍVAR','ALTOS DEL ROSARIO - BOLÍVAR',
  'ARENAL - BOLÍVAR','ARJONA - BOLÍVAR','ARROYOHONDO - BOLÍVAR',
  'BARRANCO DE LOBA - BOLÍVAR','CALAMAR - BOLÍVAR','CANTAGALLO - BOLÍVAR',
  'CICUCO - BOLÍVAR','CLEMENCIA - BOLÍVAR','CÓRDOBA - BOLÍVAR',
  'EL CARMEN DE BOLÍVAR - BOLÍVAR','EL GUAMO - BOLÍVAR','EL PEÑÓN - BOLÍVAR',
  'HATILLO DE LOBA - BOLÍVAR','MAGANGUÉ - BOLÍVAR','MAHATES - BOLÍVAR',
  'MARGARITA - BOLÍVAR','MARÍA LA BAJA - BOLÍVAR','MOMPÓS - BOLÍVAR',
  'MONTECRISTO - BOLÍVAR','MORALES - BOLÍVAR','NOROSÍ - BOLÍVAR',
  'PINILLOS - BOLÍVAR','REGIDOR - BOLÍVAR','RÍO VIEJO - BOLÍVAR',
  'SAN CRISTÓBAL - BOLÍVAR','SAN ESTANISLAO - BOLÍVAR','SAN FERNANDO - BOLÍVAR',
  'SAN JACINTO - BOLÍVAR','SAN JACINTO DEL CAUCA - BOLÍVAR',
  'SAN JUAN NEPOMUCENO - BOLÍVAR','SAN MARTÍN DE LOBA - BOLÍVAR',
  'SAN PABLO - BOLÍVAR','SANTA CATALINA - BOLÍVAR','SANTA ROSA - BOLÍVAR',
  'SANTA ROSA DEL SUR - BOLÍVAR','SIMITÍ - BOLÍVAR','SOPLAVIENTO - BOLÍVAR',
  'TALAIGUA NUEVO - BOLÍVAR','TIQUISIO - BOLÍVAR','TURBACO - BOLÍVAR',
  'TURBANÁ - BOLÍVAR','VILLANUEVA - BOLÍVAR','ZAMBRANO - BOLÍVAR',
  // ── BOYACÁ ──
  'TUNJA - BOYACÁ','ALMEIDA - BOYACÁ','AQUITANIA - BOYACÁ','ARCABUCO - BOYACÁ',
  'BELÉN - BOYACÁ','BERBEO - BOYACÁ','BETÉITIVA - BOYACÁ','BOAVITA - BOYACÁ',
  'BOYACÁ - BOYACÁ','BRICEÑO - BOYACÁ','BUENAVISTA - BOYACÁ','BUSBANZÁ - BOYACÁ',
  'CALDAS - BOYACÁ','CAMPOHERMOSO - BOYACÁ','CERINZA - BOYACÁ',
  'CHINAVITA - BOYACÁ','CHIQUINQUIRÁ - BOYACÁ','CHISCAS - BOYACÁ',
  'CHITA - BOYACÁ','CHITARAQUE - BOYACÁ','CHIVATÁ - BOYACÁ','CIÉNEGA - BOYACÁ',
  'CÓMBITA - BOYACÁ','COPER - BOYACÁ','CORRALES - BOYACÁ','COVARACHÍA - BOYACÁ',
  'CUBARÁ - BOYACÁ','CUCAITA - BOYACÁ','CUÍTIVA - BOYACÁ','DUITAMA - BOYACÁ',
  'EL COCUY - BOYACÁ','EL ESPINO - BOYACÁ','FIRAVITOBA - BOYACÁ',
  'FLORESTA - BOYACÁ','GACHANTIVÁ - BOYACÁ','GÁMEZA - BOYACÁ','GARAGOA - BOYACÁ',
  'GUACAMAYAS - BOYACÁ','GUATEQUE - BOYACÁ','GUAYATÁ - BOYACÁ','GÜICÁN - BOYACÁ',
  'IZA - BOYACÁ','JENESANO - BOYACÁ','JERICÓ - BOYACÁ','LA CAPILLA - BOYACÁ',
  'LA UVITA - BOYACÁ','LA VICTORIA - BOYACÁ','LABRANZAGRANDE - BOYACÁ',
  'MACANAL - BOYACÁ','MARIPÍ - BOYACÁ','MIRAFLORES - BOYACÁ','MONGUA - BOYACÁ',
  'MONGUÍ - BOYACÁ','MONIQUIRÁ - BOYACÁ','MOTAVITA - BOYACÁ','MUZO - BOYACÁ',
  'NOBSA - BOYACÁ','NUEVO COLÓN - BOYACÁ','OICATÁ - BOYACÁ','OTANCHE - BOYACÁ',
  'PACHAVITA - BOYACÁ','PÁEZ - BOYACÁ','PAIPA - BOYACÁ','PAJARITO - BOYACÁ',
  'PANQUEBA - BOYACÁ','PAUNA - BOYACÁ','PAYA - BOYACÁ','PAZ DE RÍO - BOYACÁ',
  'PESCA - BOYACÁ','PISBA - BOYACÁ','PUERTO BOYACÁ - BOYACÁ','QUÍPAMA - BOYACÁ',
  'RAMIRIQUÍ - BOYACÁ','RÁQUIRA - BOYACÁ','RONDÓN - BOYACÁ','SABOYÁ - BOYACÁ',
  'SÁCHICA - BOYACÁ','SAMACÁ - BOYACÁ','SAN EDUARDO - BOYACÁ',
  'SAN JOSÉ DE PARE - BOYACÁ','SAN LUIS DE GACENO - BOYACÁ','SAN MATEO - BOYACÁ',
  'SAN MIGUEL DE SEMA - BOYACÁ','SAN PABLO DE BORBUR - BOYACÁ',
  'SANTA MARÍA - BOYACÁ','SANTA ROSA DE VITERBO - BOYACÁ','SANTA SOFÍA - BOYACÁ',
  'SANTANA - BOYACÁ','SATIVANORTE - BOYACÁ','SATIVASUR - BOYACÁ',
  'SIACHOQUE - BOYACÁ','SOATÁ - BOYACÁ','SOCOTÁ - BOYACÁ','SOCHA - BOYACÁ',
  'SOGAMOSO - BOYACÁ','SOMONDOCO - BOYACÁ','SORA - BOYACÁ','SORACÁ - BOYACÁ',
  'SOTAQUIRÁ - BOYACÁ','SUSACÓN - BOYACÁ','SUTAMARCHÁN - BOYACÁ',
  'SUTATENZA - BOYACÁ','TASCO - BOYACÁ','TENZA - BOYACÁ','TIBANÁ - BOYACÁ',
  'TIBASOSA - BOYACÁ','TINJACÁ - BOYACÁ','TIPACOQUE - BOYACÁ','TOCA - BOYACÁ',
  'TOGÜÍ - BOYACÁ','TÓPAGA - BOYACÁ','TOTA - BOYACÁ','TURMEQUÉ - BOYACÁ',
  'TUTA - BOYACÁ','TUTAZÁ - BOYACÁ','ÚMBITA - BOYACÁ','VENTAQUEMADA - BOYACÁ',
  'VILLA DE LEYVA - BOYACÁ','VIRACACHÁ - BOYACÁ','ZETAQUIRA - BOYACÁ',
  // ── CALDAS ──
  'MANIZALES - CALDAS','AGUADAS - CALDAS','ANSERMA - CALDAS','ARANZAZU - CALDAS',
  'BELALCÁZAR - CALDAS','CHINCHINÁ - CALDAS','FILADELFIA - CALDAS',
  'LA DORADA - CALDAS','LA MERCED - CALDAS','MANZANARES - CALDAS',
  'MARMATO - CALDAS','MARQUETALIA - CALDAS','MARULANDA - CALDAS','NEIRA - CALDAS',
  'NORCASIA - CALDAS','PÁCORA - CALDAS','PALESTINA - CALDAS','PENSILVANIA - CALDAS',
  'RIOSUCIO - CALDAS','RISARALDA - CALDAS','SALAMINA - CALDAS','SAMANÁ - CALDAS',
  'SAN JOSÉ - CALDAS','SUPÍA - CALDAS','VICTORIA - CALDAS','VILLAMARÍA - CALDAS',
  'VITERBO - CALDAS',
  // ── CAQUETÁ ──
  'FLORENCIA - CAQUETÁ','ALBANIA - CAQUETÁ','BELÉN DE LOS ANDAQUÍES - CAQUETÁ',
  'CARTAGENA DEL CHAIRÁ - CAQUETÁ','CURILLO - CAQUETÁ','EL DONCELLO - CAQUETÁ',
  'EL PAUJIL - CAQUETÁ','LA MONTAÑITA - CAQUETÁ','MILÁN - CAQUETÁ',
  'MORELIA - CAQUETÁ','PUERTO RICO - CAQUETÁ','SAN JOSÉ DEL FRAGUA - CAQUETÁ',
  'SAN VICENTE DEL CAGUÁN - CAQUETÁ','SOLANO - CAQUETÁ','SOLITA - CAQUETÁ',
  'VALPARAÍSO - CAQUETÁ',
  // ── CASANARE ──
  'YOPAL - CASANARE','AGUAZUL - CASANARE','CHÁMEZA - CASANARE',
  'HATO COROZAL - CASANARE','LA SALINA - CASANARE','MANÍ - CASANARE',
  'MONTERREY - CASANARE','NUNCHÍA - CASANARE','OROCUÉ - CASANARE',
  'PAZ DE ARIPORO - CASANARE','PORE - CASANARE','RECETOR - CASANARE',
  'SABANALARGA - CASANARE','SÁCAMA - CASANARE','SAN LUIS DE PALENQUE - CASANARE',
  'TÁMARA - CASANARE','TAURAMENA - CASANARE','TRINIDAD - CASANARE',
  'VILLANUEVA - CASANARE',
  // ── CAUCA ──
  'POPAYÁN - CAUCA','ALMAGUER - CAUCA','ARGELIA - CAUCA','BALBOA - CAUCA',
  'BOLÍVAR - CAUCA','BUENOS AIRES - CAUCA','CAJIBÍO - CAUCA','CALDONO - CAUCA',
  'CALOTO - CAUCA','CORINTO - CAUCA','EL TAMBO - CAUCA','FLORENCIA - CAUCA',
  'GUACHENÉ - CAUCA','GUAPÍ - CAUCA','INZÁ - CAUCA','JAMBALÓ - CAUCA',
  'LA SIERRA - CAUCA','LA VEGA - CAUCA','LÓPEZ DE MICAY - CAUCA',
  'MERCADERES - CAUCA','MIRANDA - CAUCA','MORALES - CAUCA','PADILLA - CAUCA',
  'PÁEZ - CAUCA','PATÍA - CAUCA','PIAMONTE - CAUCA','PIENDAMÓ - CAUCA',
  'PUERTO TEJADA - CAUCA','PURACÉ - CAUCA','ROSAS - CAUCA',
  'SAN SEBASTIÁN - CAUCA','SANTA ROSA - CAUCA','SANTANDER DE QUILICHAO - CAUCA',
  'SILVIA - CAUCA','SOTARA - CAUCA','SUÁREZ - CAUCA','SUCRE - CAUCA',
  'TIMBÍO - CAUCA','TIMBIQUÍ - CAUCA','TORIBÍO - CAUCA','TOTORÓ - CAUCA',
  'VILLA RICA - CAUCA',
  // ── CESAR ──
  'VALLEDUPAR - CESAR','AGUACHICA - CESAR','AGUSTÍN CODAZZI - CESAR',
  'ASTREA - CESAR','BECERRIL - CESAR','BOSCONIA - CESAR','CHIMICHAGUA - CESAR',
  'CHIRIGUANÁ - CESAR','CURUMANÍ - CESAR','EL COPEY - CESAR','EL PASO - CESAR',
  'GAMARRA - CESAR','GONZÁLEZ - CESAR','LA GLORIA - CESAR',
  'LA JAGUA DE IBIRICO - CESAR','LA PAZ - CESAR','MANAURE - CESAR',
  'PAILITAS - CESAR','PELAYA - CESAR','PUEBLO BELLO - CESAR','RÍO DE ORO - CESAR',
  'SAN ALBERTO - CESAR','SAN DIEGO - CESAR','SAN MARTÍN - CESAR',
  'TAMALAMEQUE - CESAR',
  // ── CHOCÓ ──
  'QUIBDÓ - CHOCÓ','ACANDÍ - CHOCÓ','ALTO BAUDÓ - CHOCÓ','ATRATO - CHOCÓ',
  'BAGADÓ - CHOCÓ','BAHÍA SOLANO - CHOCÓ','BAJO BAUDÓ - CHOCÓ','BOJAYÁ - CHOCÓ',
  'CANTÓN DE SAN PABLO - CHOCÓ','CARMEN DEL DARIÉN - CHOCÓ','CÉRTEGUI - CHOCÓ',
  'CONDOTO - CHOCÓ','EL CARMEN DE ATRATO - CHOCÓ','EL LITORAL DEL SAN JUAN - CHOCÓ',
  'ISTMINA - CHOCÓ','JURADÓ - CHOCÓ','LLORÓ - CHOCÓ','MEDIO ATRATO - CHOCÓ',
  'MEDIO BAUDÓ - CHOCÓ','MEDIO SAN JUAN - CHOCÓ','NÓVITA - CHOCÓ','NUQUÍ - CHOCÓ',
  'RÍO IRÓ - CHOCÓ','RÍO QUITO - CHOCÓ','RIOSUCIO - CHOCÓ',
  'SAN JOSÉ DEL PALMAR - CHOCÓ','SIPÍ - CHOCÓ','TADÓ - CHOCÓ',
  'UNGUÍA - CHOCÓ','UNIÓN PANAMERICANA - CHOCÓ',
  // ── CÓRDOBA ──
  'MONTERÍA - CÓRDOBA','AYAPEL - CÓRDOBA','BUENAVISTA - CÓRDOBA',
  'CANALETE - CÓRDOBA','CERETÉ - CÓRDOBA','CHIMÁ - CÓRDOBA','CHINÚ - CÓRDOBA',
  'CIÉNAGA DE ORO - CÓRDOBA','COTORRA - CÓRDOBA','LA APARTADA - CÓRDOBA',
  'LORICA - CÓRDOBA','LOS CÓRDOBAS - CÓRDOBA','MOMIL - CÓRDOBA',
  'MONTELÍBANO - CÓRDOBA','MOÑITOS - CÓRDOBA','PLANETA RICA - CÓRDOBA',
  'PUEBLO NUEVO - CÓRDOBA','PUERTO ESCONDIDO - CÓRDOBA',
  'PUERTO LIBERTADOR - CÓRDOBA','PURÍSIMA - CÓRDOBA','SAHAGÚN - CÓRDOBA',
  'SAN ANDRÉS DE SOTAVENTO - CÓRDOBA','SAN ANTERO - CÓRDOBA',
  'SAN BERNARDO DEL VIENTO - CÓRDOBA','SAN CARLOS - CÓRDOBA',
  'SAN JOSÉ DE URÉ - CÓRDOBA','SAN PELAYO - CÓRDOBA','TIERRALTA - CÓRDOBA',
  'TUCHÍN - CÓRDOBA','VALENCIA - CÓRDOBA',
  // ── CUNDINAMARCA ──
  'BOGOTÁ D.C. - CUNDINAMARCA','AGUA DE DIOS - CUNDINAMARCA','ALBÁN - CUNDINAMARCA',
  'ANAPOIMA - CUNDINAMARCA','ANOLAIMA - CUNDINAMARCA','ARBELÁEZ - CUNDINAMARCA',
  'BELTRÁN - CUNDINAMARCA','BITUIMA - CUNDINAMARCA','BOJACÁ - CUNDINAMARCA',
  'CABRERA - CUNDINAMARCA','CACHIPAY - CUNDINAMARCA','CAJICÁ - CUNDINAMARCA',
  'CAPARRAPÍ - CUNDINAMARCA','CÁQUEZA - CUNDINAMARCA',
  'CARMEN DE CARUPA - CUNDINAMARCA','CHAGUANÍ - CUNDINAMARCA',
  'CHÍA - CUNDINAMARCA','CHIPAQUE - CUNDINAMARCA','CHOACHÍ - CUNDINAMARCA',
  'CHOCONTÁ - CUNDINAMARCA','COGUA - CUNDINAMARCA','COTA - CUNDINAMARCA',
  'CUCUNUBÁ - CUNDINAMARCA','EL COLEGIO - CUNDINAMARCA','EL PEÑÓN - CUNDINAMARCA',
  'EL ROSAL - CUNDINAMARCA','FACATATIVÁ - CUNDINAMARCA','FOMEQUE - CUNDINAMARCA',
  'FOSCA - CUNDINAMARCA','FUNZA - CUNDINAMARCA','FÚQUENE - CUNDINAMARCA',
  'FUSAGASUGÁ - CUNDINAMARCA','GACHALÁ - CUNDINAMARCA','GACHANCIPÁ - CUNDINAMARCA',
  'GACHETÁ - CUNDINAMARCA','GAMA - CUNDINAMARCA','GIRARDOT - CUNDINAMARCA',
  'GRANADA - CUNDINAMARCA','GUACHETÁ - CUNDINAMARCA','GUADUAS - CUNDINAMARCA',
  'GUASCA - CUNDINAMARCA','GUATAQUÍ - CUNDINAMARCA','GUATAVITA - CUNDINAMARCA',
  'GUAYABAL DE SÍQUIMA - CUNDINAMARCA','GUAYABETAL - CUNDINAMARCA',
  'GUTIÉRREZ - CUNDINAMARCA','JERUSALÉN - CUNDINAMARCA','JUNÍN - CUNDINAMARCA',
  'LA CALERA - CUNDINAMARCA','LA MESA - CUNDINAMARCA','LA PALMA - CUNDINAMARCA',
  'LA PEÑA - CUNDINAMARCA','LA VEGA - CUNDINAMARCA','LENGUAZAQUE - CUNDINAMARCA',
  'MACHETÁ - CUNDINAMARCA','MADRID - CUNDINAMARCA','MANTA - CUNDINAMARCA',
  'MEDINA - CUNDINAMARCA','MOSQUERA - CUNDINAMARCA','NARIÑO - CUNDINAMARCA',
  'NEMOCÓN - CUNDINAMARCA','NILO - CUNDINAMARCA','NIMAIMA - CUNDINAMARCA',
  'NOCAIMA - CUNDINAMARCA','PACHO - CUNDINAMARCA','PAIME - CUNDINAMARCA',
  'PANDI - CUNDINAMARCA','PARATEBUENO - CUNDINAMARCA','PASCA - CUNDINAMARCA',
  'PUERTO SALGAR - CUNDINAMARCA','PULÍ - CUNDINAMARCA',
  'QUEBRADANEGRA - CUNDINAMARCA','QUETAME - CUNDINAMARCA',
  'QUIPILE - CUNDINAMARCA','RICAURTE - CUNDINAMARCA',
  'SAN ANTONIO DEL TEQUENDAMA - CUNDINAMARCA','SAN BERNARDO - CUNDINAMARCA',
  'SAN CAYETANO - CUNDINAMARCA','SAN FRANCISCO - CUNDINAMARCA',
  'SAN JUAN DE RÍO SECO - CUNDINAMARCA','SASAIMA - CUNDINAMARCA',
  'SESQUILÉ - CUNDINAMARCA','SIBATÉ - CUNDINAMARCA','SILVANIA - CUNDINAMARCA',
  'SIMIJACA - CUNDINAMARCA','SOACHA - CUNDINAMARCA','SOPÓ - CUNDINAMARCA',
  'SUBACHOQUE - CUNDINAMARCA','SUESCA - CUNDINAMARCA','SUPATÁ - CUNDINAMARCA',
  'SUSA - CUNDINAMARCA','SUTATAUSA - CUNDINAMARCA','TABIO - CUNDINAMARCA',
  'TAUSA - CUNDINAMARCA','TENA - CUNDINAMARCA','TENJO - CUNDINAMARCA',
  'TIBACUY - CUNDINAMARCA','TIBIRITA - CUNDINAMARCA','TOCAIMA - CUNDINAMARCA',
  'TOCANCIPÁ - CUNDINAMARCA','TOPAIPÍ - CUNDINAMARCA','UBALÁ - CUNDINAMARCA',
  'UBAQUE - CUNDINAMARCA','UBATE - CUNDINAMARCA','UNE - CUNDINAMARCA',
  'ÚTICA - CUNDINAMARCA','VENECIA - CUNDINAMARCA','VERGARA - CUNDINAMARCA',
  'VIANÍ - CUNDINAMARCA','VILLAGÓMEZ - CUNDINAMARCA','VILLAPINZÓN - CUNDINAMARCA',
  'VILLETA - CUNDINAMARCA','VIOTÁ - CUNDINAMARCA','YACOPÍ - CUNDINAMARCA',
  'ZIPACÓN - CUNDINAMARCA','ZIPAQUIRÁ - CUNDINAMARCA',
  // ── GUAINÍA ──
  'INÍRIDA - GUAINÍA','BARRANCO MINAS - GUAINÍA','CACAHUAL - GUAINÍA',
  'LA GUADALUPE - GUAINÍA','MAPIRIPANA - GUAINÍA','MORICHAL - GUAINÍA',
  'PANA PANA - GUAINÍA','PUERTO COLOMBIA - GUAINÍA','SAN FELIPE - GUAINÍA',
  // ── GUAVIARE ──
  'SAN JOSÉ DEL GUAVIARE - GUAVIARE','CALAMAR - GUAVIARE',
  'EL RETORNO - GUAVIARE','MIRAFLORES - GUAVIARE',
  // ── HUILA ──
  'NEIVA - HUILA','ACEVEDO - HUILA','AGRADO - HUILA','AIPE - HUILA',
  'ALGECIRAS - HUILA','ALTAMIRA - HUILA','BARAYA - HUILA',
  'CAMPOALEGRE - HUILA','COLOMBIA - HUILA','ELÍAS - HUILA','GARZÓN - HUILA',
  'GIGANTE - HUILA','GUADALUPE - HUILA','HOBO - HUILA','IQUIRA - HUILA',
  'ISNOS - HUILA','LA ARGENTINA - HUILA','LA PLATA - HUILA','NÁTAGA - HUILA',
  'OPORAPA - HUILA','PAICOL - HUILA','PALERMO - HUILA','PALESTINA - HUILA',
  'PITAL - HUILA','PITALITO - HUILA','RIVERA - HUILA','SALADOBLANCO - HUILA',
  'SAN AGUSTÍN - HUILA','SANTA MARÍA - HUILA','SUAZA - HUILA','TARQUI - HUILA',
  'TELLO - HUILA','TERUEL - HUILA','TESALIA - HUILA','TIMANÁ - HUILA',
  'VILLAVIEJA - HUILA','YAGUARÁ - HUILA',
  // ── LA GUAJIRA ──
  'RIOHACHA - LA GUAJIRA','ALBANIA - LA GUAJIRA','BARRANCAS - LA GUAJIRA',
  'DIBULLA - LA GUAJIRA','DISTRACCIÓN - LA GUAJIRA','EL MOLINO - LA GUAJIRA',
  'FONSECA - LA GUAJIRA','HATONUEVO - LA GUAJIRA',
  'LA JAGUA DEL PILAR - LA GUAJIRA','MAICAO - LA GUAJIRA',
  'MANAURE - LA GUAJIRA','SAN JUAN DEL CESAR - LA GUAJIRA',
  'URIBIA - LA GUAJIRA','URUMITA - LA GUAJIRA','VILLANUEVA - LA GUAJIRA',
  // ── MAGDALENA ──
  'SANTA MARTA - MAGDALENA','ALGARROBO - MAGDALENA','ARACATACA - MAGDALENA',
  'ARIGUANÍ - MAGDALENA','CERRO DE SAN ANTONIO - MAGDALENA','CHIBOLO - MAGDALENA',
  'CIÉNAGA - MAGDALENA','CONCORDIA - MAGDALENA','EL BANCO - MAGDALENA',
  'EL PIÑÓN - MAGDALENA','EL RETÉN - MAGDALENA','FUNDACIÓN - MAGDALENA',
  'GUAMAL - MAGDALENA','NUEVA GRANADA - MAGDALENA','PEDRAZA - MAGDALENA',
  'PIJIÑO DEL CARMEN - MAGDALENA','PIVIJAY - MAGDALENA','PLATO - MAGDALENA',
  'PUEBLOVIEJO - MAGDALENA','REMOLINO - MAGDALENA',
  'SABANAS DE SAN ÁNGEL - MAGDALENA','SALAMINA - MAGDALENA',
  'SAN SEBASTIÁN DE BUENAVISTA - MAGDALENA','SAN ZENÓN - MAGDALENA',
  'SANTA ANA - MAGDALENA','SANTA BÁRBARA DE PINTO - MAGDALENA',
  'SITIONUEVO - MAGDALENA','TENERIFE - MAGDALENA','ZAPAYÁN - MAGDALENA',
  'ZONA BANANERA - MAGDALENA',
  // ── META ──
  'VILLAVICENCIO - META','ACACÍAS - META','BARRANCA DE UPÍA - META',
  'CABUYARO - META','CASTILLA LA NUEVA - META','CUBARRAL - META',
  'CUMARAL - META','EL CALVARIO - META','EL CASTILLO - META',
  'EL DORADO - META','FUENTE DE ORO - META','GRANADA - META','GUAMAL - META',
  'LA MACARENA - META','LEJANÍAS - META','MAPIRIPÁN - META','MESETAS - META',
  'PUERTO CONCORDIA - META','PUERTO GAITÁN - META','PUERTO LLERAS - META',
  'PUERTO LÓPEZ - META','PUERTO RICO - META','RESTREPO - META',
  'SAN CARLOS DE GUAROA - META','SAN JUAN DE ARAMA - META',
  'SAN JUANITO - META','SAN MARTÍN - META','URIBE - META','VISTAHERMOSA - META',
  // ── NARIÑO ──
  'PASTO - NARIÑO','TUMACO - NARIÑO','IPIALES - NARIÑO','TÚQUERRES - NARIÑO',
  'LA UNIÓN - NARIÑO','SAMANIEGO - NARIÑO','BARBACOAS - NARIÑO',
  'RICAURTE - NARIÑO','CUMBAL - NARIÑO','GUAITARILLA - NARIÑO',
  'SANDONÁ - NARIÑO','ANCUYA - NARIÑO','ARBOLEDA - NARIÑO','BELÉN - NARIÑO',
  'BUESACO - NARIÑO','CHACHAGÜÍ - NARIÑO','COLÓN - NARIÑO','CONSACÁ - NARIÑO',
  'CONTADERO - NARIÑO','CÓRDOBA - NARIÑO','CUASPUD - NARIÑO',
  'CUMBITARA - NARIÑO','EL CHARCO - NARIÑO','EL PEÑOL - NARIÑO',
  'EL ROSARIO - NARIÑO','EL TABLÓN DE GÓMEZ - NARIÑO','EL TAMBO - NARIÑO',
  'FUNES - NARIÑO','GÜACHUCAL - NARIÑO','ILES - NARIÑO','IMUÉS - NARIÑO',
  'LA CRUZ - NARIÑO','LA FLORIDA - NARIÑO','LA LLANADA - NARIÑO',
  'LA TOLA - NARIÑO','LEIVA - NARIÑO','LINARES - NARIÑO','LOS ANDES - NARIÑO',
  'MAGÜÍ - NARIÑO','MALLAMA - NARIÑO','MOSQUERA - NARIÑO','NARIÑO - NARIÑO',
  'OLAYA HERRERA - NARIÑO','OSPINA - NARIÑO','FRANCISCO PIZARRO - NARIÑO',
  'POLICARPA - NARIÑO','POTOSÍ - NARIÑO','PROVIDENCIA - NARIÑO',
  'PUERRES - NARIÑO','PUPIALES - NARIÑO','ROBERTO PAYÁN - NARIÑO',
  'SAN BERNARDO - NARIÑO','SAN LORENZO - NARIÑO','SAN PABLO - NARIÑO',
  'SAN PEDRO DE CARTAGO - NARIÑO','SANTA BÁRBARA - NARIÑO',
  'SANTACRUZ - NARIÑO','SAPUYES - NARIÑO','TAMINANGO - NARIÑO',
  'TANGUA - NARIÑO','TEORAMA - NARIÑO','TOLA - NARIÑO','TORTUGAS - NARIÑO',
  'YACUANQUER - NARIÑO',
  // ── NORTE DE SANTANDER ──
  'CÚCUTA - NORTE DE SANTANDER','ABREGO - NORTE DE SANTANDER',
  'ARBOLEDAS - NORTE DE SANTANDER','BOCHALEMA - NORTE DE SANTANDER',
  'BUCARASICA - NORTE DE SANTANDER','CÁCOTA - NORTE DE SANTANDER',
  'CACHIRÁ - NORTE DE SANTANDER','CHINÁCOTA - NORTE DE SANTANDER',
  'CHITAGÁ - NORTE DE SANTANDER','CONVENCIÓN - NORTE DE SANTANDER',
  'CUCUTILLA - NORTE DE SANTANDER','DURANIA - NORTE DE SANTANDER',
  'EL CARMEN - NORTE DE SANTANDER','EL TARRA - NORTE DE SANTANDER',
  'EL ZULIA - NORTE DE SANTANDER','GRAMALOTE - NORTE DE SANTANDER',
  'HACARÍ - NORTE DE SANTANDER','HERRÁN - NORTE DE SANTANDER',
  'LABATECA - NORTE DE SANTANDER','LA ESPERANZA - NORTE DE SANTANDER',
  'LA PLAYA - NORTE DE SANTANDER','LOS PATIOS - NORTE DE SANTANDER',
  'LOURDES - NORTE DE SANTANDER','MUTISCUA - NORTE DE SANTANDER',
  'OCAÑA - NORTE DE SANTANDER','PAMPLONA - NORTE DE SANTANDER',
  'PAMPLONITA - NORTE DE SANTANDER','PUERTO SANTANDER - NORTE DE SANTANDER',
  'RAGONVALIA - NORTE DE SANTANDER','SALAZAR - NORTE DE SANTANDER',
  'SAN CALIXTO - NORTE DE SANTANDER','SAN CAYETANO - NORTE DE SANTANDER',
  'SANTIAGO - NORTE DE SANTANDER','SARDINATA - NORTE DE SANTANDER',
  'SILOS - NORTE DE SANTANDER','TIBÚ - NORTE DE SANTANDER',
  'TOLEDO - NORTE DE SANTANDER','VILLA CARO - NORTE DE SANTANDER',
  'VILLA DEL ROSARIO - NORTE DE SANTANDER',
  // ── PUTUMAYO ──
  'MOCOA - PUTUMAYO','COLÓN - PUTUMAYO','LEGUÍZAMO - PUTUMAYO',
  'ORITO - PUTUMAYO','PUERTO ASÍS - PUTUMAYO','PUERTO CAICEDO - PUTUMAYO',
  'PUERTO GUZMÁN - PUTUMAYO','PUERTO LEGUÍZAMO - PUTUMAYO',
  'SAN FRANCISCO - PUTUMAYO','SAN MIGUEL - PUTUMAYO','SANTIAGO - PUTUMAYO',
  'SIBUNDOY - PUTUMAYO','VALLE DEL GUAMUEZ - PUTUMAYO','VILLAGARZÓN - PUTUMAYO',
  // ── QUINDÍO ──
  'ARMENIA - QUINDÍO','BUENAVISTA - QUINDÍO','CALARCÁ - QUINDÍO',
  'CIRCASIA - QUINDÍO','CÓRDOBA - QUINDÍO','FILANDIA - QUINDÍO',
  'GÉNOVA - QUINDÍO','LA TEBAIDA - QUINDÍO','MONTENEGRO - QUINDÍO',
  'PIJAO - QUINDÍO','QUIMBAYA - QUINDÍO','SALENTO - QUINDÍO',
  // ── RISARALDA ──
  'PEREIRA - RISARALDA','APÍA - RISARALDA','BALBOA - RISARALDA',
  'BELÉN DE UMBRÍA - RISARALDA','DOSQUEBRADAS - RISARALDA','GUÁTICA - RISARALDA',
  'LA CELIA - RISARALDA','LA VIRGINIA - RISARALDA','MARSELLA - RISARALDA',
  'MISTRATÓ - RISARALDA','PUEBLO RICO - RISARALDA','QUINCHÍA - RISARALDA',
  'SANTA ROSA DE CABAL - RISARALDA','SANTUARIO - RISARALDA',
  // ── SAN ANDRÉS Y PROVIDENCIA ──
  'SAN ANDRÉS - SAN ANDRÉS Y PROVIDENCIA',
  'PROVIDENCIA - SAN ANDRÉS Y PROVIDENCIA',
  // ── SANTANDER ──
  'BUCARAMANGA - SANTANDER','AGUADA - SANTANDER','ALBANIA - SANTANDER',
  'ARATOCA - SANTANDER','BARBOSA - SANTANDER','BARICHARA - SANTANDER',
  'BARRANCABERMEJA - SANTANDER','BETULIA - SANTANDER','BOLÍVAR - SANTANDER',
  'CABRERA - SANTANDER','CALIFORNIA - SANTANDER','CAPITANEJO - SANTANDER',
  'CARCASÍ - SANTANDER','CEPITÁ - SANTANDER','CERRITO - SANTANDER',
  'CHARALÁ - SANTANDER','CHARTA - SANTANDER','CHIMA - SANTANDER',
  'CHIPATÁ - SANTANDER','CIMITARRA - SANTANDER','CONCEPCIÓN - SANTANDER',
  'CONFINES - SANTANDER','CONTRATACIÓN - SANTANDER','COROMORO - SANTANDER',
  'CURITÍ - SANTANDER','EL CARMEN DE CHUCURÍ - SANTANDER',
  'EL GUACAMAYO - SANTANDER','EL PEÑÓN - SANTANDER','EL PLAYÓN - SANTANDER',
  'ENCINO - SANTANDER','ENCISO - SANTANDER','FLORIÁN - SANTANDER',
  'FLORIDABLANCA - SANTANDER','GALÁN - SANTANDER','GÁMBITA - SANTANDER',
  'GIRÓN - SANTANDER','GUACA - SANTANDER','GUADALUPE - SANTANDER',
  'GUAPOTÁ - SANTANDER','GUAVATÁ - SANTANDER','GÜEPSA - SANTANDER',
  'HATO - SANTANDER','JESÚS MARÍA - SANTANDER','JORDÁN - SANTANDER',
  'LA BELLEZA - SANTANDER','LA PAZ - SANTANDER','LANDÁZURI - SANTANDER',
  'LEBRIJA - SANTANDER','LOS SANTOS - SANTANDER','MACARAVITA - SANTANDER',
  'MÁLAGA - SANTANDER','MATANZA - SANTANDER','MOGOTES - SANTANDER',
  'MOLAGAVITA - SANTANDER','OCAMONTE - SANTANDER','OIBA - SANTANDER',
  'ONZAGA - SANTANDER','PALMAR - SANTANDER','PALMAS DEL SOCORRO - SANTANDER',
  'PÁRAMO - SANTANDER','PIEDECUESTA - SANTANDER','PINCHOTE - SANTANDER',
  'PUENTE NACIONAL - SANTANDER','PUERTO PARRA - SANTANDER',
  'PUERTO WILCHES - SANTANDER','RIONEGRO - SANTANDER',
  'SABANA DE TORRES - SANTANDER','SAN ANDRÉS - SANTANDER',
  'SAN BENITO - SANTANDER','SAN GIL - SANTANDER','SAN JOAQUÍN - SANTANDER',
  'SAN JOSÉ DE MIRANDA - SANTANDER','SAN MIGUEL - SANTANDER',
  'SAN VICENTE DE CHUCURÍ - SANTANDER','SANTA BÁRBARA - SANTANDER',
  'SANTA HELENA DEL OPÓN - SANTANDER','SIMACOTA - SANTANDER',
  'SOCORRO - SANTANDER','SUAITA - SANTANDER','SUCRE - SANTANDER',
  'SURATÁ - SANTANDER','TONA - SANTANDER','VALLE DE SAN JOSÉ - SANTANDER',
  'VÉLEZ - SANTANDER','VETAS - SANTANDER','VILLANUEVA - SANTANDER',
  'ZAPATOCA - SANTANDER',
  // ── SUCRE ──
  'SINCELEJO - SUCRE','BUENAVISTA - SUCRE','CAIMITO - SUCRE','CHALÁN - SUCRE',
  'COLOSÓ - SUCRE','COROZAL - SUCRE','COVEÑAS - SUCRE','EL ROBLE - SUCRE',
  'GALERAS - SUCRE','GUARANDA - SUCRE','LA UNIÓN - SUCRE','LOS PALMITOS - SUCRE',
  'MAJAGUAL - SUCRE','MORROA - SUCRE','OVEJAS - SUCRE','PALMITO - SUCRE',
  'SAMPUÉS - SUCRE','SAN BENITO ABAD - SUCRE','SAN JUAN DE BETULIA - SUCRE',
  'SAN MARCOS - SUCRE','SAN ONOFRE - SUCRE','SAN PEDRO - SUCRE',
  'SAN LUIS DE SINCÉ - SUCRE','SANTIAGO DE TOLÚ - SUCRE','SUCRE - SUCRE',
  'TOLÚ VIEJO - SUCRE',
  // ── TOLIMA ──
  'IBAGUÉ - TOLIMA','ALPUJARRA - TOLIMA','ALVARADO - TOLIMA','AMBALEMA - TOLIMA',
  'ANZOÁTEGUI - TOLIMA','ARMERO - TOLIMA','ATACO - TOLIMA','CAJAMARCA - TOLIMA',
  'CARMEN DE APICALÁ - TOLIMA','CASABIANCA - TOLIMA','CHAPARRAL - TOLIMA',
  'COELLO - TOLIMA','COYAIMA - TOLIMA','CUNDAY - TOLIMA','DOLORES - TOLIMA',
  'ESPINAL - TOLIMA','FALAN - TOLIMA','FLANDES - TOLIMA','FRESNO - TOLIMA',
  'GUAMO - TOLIMA','HERVEO - TOLIMA','HONDA - TOLIMA','ICONONZO - TOLIMA',
  'LÉRIDA - TOLIMA','LÍBANO - TOLIMA','MARIQUITA - TOLIMA','MELGAR - TOLIMA',
  'MURILLO - TOLIMA','NATAGAIMA - TOLIMA','ORTEGA - TOLIMA',
  'PALOCABILDO - TOLIMA','PIEDRAS - TOLIMA','PLANADAS - TOLIMA','PRADO - TOLIMA',
  'PURIFICACIÓN - TOLIMA','RIOBLANCO - TOLIMA','RONCESVALLES - TOLIMA',
  'ROVIRA - TOLIMA','SALDAÑA - TOLIMA','SAN ANTONIO - TOLIMA',
  'SAN LUIS - TOLIMA','SANTA ISABEL - TOLIMA','SUÁREZ - TOLIMA',
  'VALLE DE SAN JUAN - TOLIMA','VENADILLO - TOLIMA','VILLAHERMOSA - TOLIMA',
  'VILLARRICA - TOLIMA',
  // ── VALLE DEL CAUCA ──
  'CALI - VALLE DEL CAUCA','ALCALÁ - VALLE DEL CAUCA','ANDALUCÍA - VALLE DEL CAUCA',
  'ANSERMANUEVO - VALLE DEL CAUCA','ARGELIA - VALLE DEL CAUCA',
  'BOLÍVAR - VALLE DEL CAUCA','BUENAVENTURA - VALLE DEL CAUCA',
  'BUGA - VALLE DEL CAUCA','BUGALAGRANDE - VALLE DEL CAUCA',
  'CAICEDONIA - VALLE DEL CAUCA','CALIMA - VALLE DEL CAUCA',
  'CANDELARIA - VALLE DEL CAUCA','CARTAGO - VALLE DEL CAUCA',
  'DAGUA - VALLE DEL CAUCA','EL ÁGUILA - VALLE DEL CAUCA',
  'EL CAIRO - VALLE DEL CAUCA','EL CERRITO - VALLE DEL CAUCA',
  'EL DOVIO - VALLE DEL CAUCA','FLORIDA - VALLE DEL CAUCA',
  'GINEBRA - VALLE DEL CAUCA','GUACARÍ - VALLE DEL CAUCA',
  'GUADALAJARA DE BUGA - VALLE DEL CAUCA','JAMUNDÍ - VALLE DEL CAUCA',
  'LA CUMBRE - VALLE DEL CAUCA','LA UNIÓN - VALLE DEL CAUCA',
  'LA VICTORIA - VALLE DEL CAUCA','OBANDO - VALLE DEL CAUCA',
  'PALMIRA - VALLE DEL CAUCA','PRADERA - VALLE DEL CAUCA',
  'RESTREPO - VALLE DEL CAUCA','RIOFRÍO - VALLE DEL CAUCA',
  'ROLDANILLO - VALLE DEL CAUCA','SAN PEDRO - VALLE DEL CAUCA',
  'SEVILLA - VALLE DEL CAUCA','TORO - VALLE DEL CAUCA',
  'TRUJILLO - VALLE DEL CAUCA','TULUÁ - VALLE DEL CAUCA',
  'ULLOA - VALLE DEL CAUCA','VERSALLES - VALLE DEL CAUCA',
  'VIJES - VALLE DEL CAUCA','YOTOCO - VALLE DEL CAUCA',
  'YUMBO - VALLE DEL CAUCA','ZARZAL - VALLE DEL CAUCA',
  // ── VAUPÉS ──
  'MITÚ - VAUPÉS','CARURÚ - VAUPÉS','PACOA - VAUPÉS',
  'PAPUNAUA - VAUPÉS','TARAIRA - VAUPÉS','YAVARATÉ - VAUPÉS',
  // ── VICHADA ──
  'PUERTO CARREÑO - VICHADA','CUMARIBO - VICHADA',
  'LA PRIMAVERA - VICHADA','SANTA ROSALÍA - VICHADA',
];


const generarNumeros = async () => {
  const ultimo = await ReporteManifiesto.findOne()
    .sort({ createdAt: -1 })
    .select('numeroRemesa secuencia');

  let siguiente;
  if (ultimo?.numeroRemesa) {
    // Extrae los dígitos del último numeroRemesa y suma 1
    const digitos = ultimo.numeroRemesa.replace(/\D/g, '');
    siguiente = parseInt(digitos, 10) + 1;
  } else {
    siguiente = 1;
  }

  const pad = String(siguiente).padStart(8, '0');
  return {
    secuencia: siguiente,
    numeroRemesa: `R${pad}`,
    numeroManifiesto: `M${pad}`,
  };
};
// GET /api/manifiestos/municipios
router.get('/municipios', protect, (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json({ municipios: [] });
  const query = q.toUpperCase().trim();
  const resultados = MUNICIPIOS.filter(m => m.toUpperCase().includes(query)).slice(0, 10);
  res.json({ municipios: resultados });
});

// GET /api/manifiestos/siguiente-numero
router.get('/siguiente-numero', protect, async (req, res) => {
  try {
    const nums = await generarNumeros();
    res.json({ success: true, ...nums });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/manifiestos/vehiculos/buscar?placa=ABC
router.get('/vehiculos/buscar', protect, async (req, res) => {
  try {
    const { placa } = req.query;
    if (!placa || placa.trim().length < 2) return res.json({ vehiculos: [] });
    const regex = new RegExp(placa.trim().toUpperCase(), 'i');
    const vehiculos = await VehiculoManifiesto.find({ placa: regex, activo: true })
      .select('placa nombreConductor cedulaConductor nombreTitular cedulaTitular capacidadToneladas')
      .limit(8);
    res.json({ vehiculos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/manifiestos/vehiculos
router.get('/vehiculos', protect, async (req, res) => {
  try {
    const vehiculos = await VehiculoManifiesto.find({ activo: true }).sort({ placa: 1 });
    res.json({ success: true, vehiculos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/manifiestos/vehiculos
router.post('/vehiculos', protect, async (req, res) => {
  try {
   const { placa, nombreConductor, cedulaConductor, nombreTitular, cedulaTitular, capacidadToneladas } = req.body;
    if (!placa || !nombreConductor || !cedulaConductor || !nombreTitular || !cedulaTitular) {
      return res.status(400).json({ success: false, message: 'Todos los campos son requeridos' });
    }
    const existe = await VehiculoManifiesto.findOne({ placa: placa.toUpperCase().trim() });
    if (existe) return res.status(409).json({ success: false, message: `La placa ${placa} ya está registrada` });
    const vehiculo = await VehiculoManifiesto.create({
      placa: placa.toUpperCase().trim(),
      nombreConductor: nombreConductor.toUpperCase().trim(),
      cedulaConductor: cedulaConductor.trim(),
      nombreTitular: nombreTitular.toUpperCase().trim(),
      cedulaTitular: cedulaTitular.trim(),
     capacidadToneladas: capacidadToneladas != null ? Number(capacidadToneladas) : null,
    });
    res.status(201).json({ success: true, vehiculo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/manifiestos/vehiculos/:id
router.put('/vehiculos/:id', protect, async (req, res) => {
  try {
   const { placa, nombreConductor, cedulaConductor, nombreTitular, cedulaTitular, capacidadToneladas } = req.body;
    const vehiculo = await VehiculoManifiesto.findById(req.params.id);
    if (!vehiculo) return res.status(404).json({ success: false, message: 'Vehículo no encontrado' });
    if (placa) vehiculo.placa = placa.toUpperCase().trim();
    if (nombreConductor) vehiculo.nombreConductor = nombreConductor.toUpperCase().trim();
    if (cedulaConductor) vehiculo.cedulaConductor = cedulaConductor.trim();
    if (nombreTitular) vehiculo.nombreTitular = nombreTitular.toUpperCase().trim();
    if (cedulaTitular) vehiculo.cedulaTitular = cedulaTitular.trim();
    if (capacidadToneladas !== undefined) {
  vehiculo.capacidadToneladas = capacidadToneladas != null ? Number(capacidadToneladas) : null;
}
    await vehiculo.save();
    res.json({ success: true, vehiculo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/manifiestos/vehiculos/:id
router.delete('/vehiculos/:id', protect, async (req, res) => {
  try {
    const vehiculo = await VehiculoManifiesto.findById(req.params.id);
    if (!vehiculo) return res.status(404).json({ success: false, message: 'Vehículo no encontrado' });
    vehiculo.activo = false;
    await vehiculo.save();
    res.json({ success: true, message: 'Vehículo eliminado' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── BODEGAS ──────────────────────────────────────────────────────────────

// GET /api/manifiestos/bodegas
router.get('/bodegas', protect, async (req, res) => {
  try {
    const bodegas = await BodegaManifiesto.find({ activa: true }).sort({ nombre: 1 });
    res.json({ success: true, bodegas });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/manifiestos/bodegas
router.post('/bodegas', protect, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['admin', 'adminSede', 'coordLogistico'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Sin permisos' });
    }
    const { nombre, nit } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ success: false, message: 'El nombre es requerido' });
    }
    const nombreUpper = nombre.toUpperCase().trim();
    const existe = await BodegaManifiesto.findOne({ nombre: nombreUpper });
    if (existe) {
      if (!existe.activa) {
        existe.activa = true;
        if (nit !== undefined) existe.nit = nit.trim();
        await existe.save();
        return res.json({ success: true, bodega: existe, reactivada: true });
      }
      return res.status(409).json({ success: false, message: `La bodega ${nombreUpper} ya existe` });
    }
    const bodega = await BodegaManifiesto.create({
      nombre: nombreUpper,
      nit: (nit || '').trim(),
    });
    res.status(201).json({ success: true, bodega });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/manifiestos/bodegas/:id
router.put('/bodegas/:id', protect, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['admin', 'adminSede', 'coordLogistico'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Sin permisos' });
    }
    const { nombre, nit } = req.body;
    const bodega = await BodegaManifiesto.findById(req.params.id);
    if (!bodega) return res.status(404).json({ success: false, message: 'Bodega no encontrada' });
    if (nombre) bodega.nombre = nombre.toUpperCase().trim();
    if (nit !== undefined) bodega.nit = nit.trim();
    await bodega.save();
    res.json({ success: true, bodega });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Ya existe una bodega con ese nombre' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/manifiestos/bodegas/:id
router.delete('/bodegas/:id', protect, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['admin', 'adminSede', 'coordLogistico'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Sin permisos' });
    }
    await BodegaManifiesto.findByIdAndUpdate(req.params.id, { activa: false });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── REPORTES ─────────────────────────────────────────────────────────────

// GET /api/manifiestos/reportes
router.get('/reportes', protect, async (req, res) => {
  try {
    const { estado, bodega, page = 1, limit = 100 } = req.query;
    const filtro = {};
    if (estado && estado !== 'todos') filtro.estado = estado;
    if (bodega && bodega !== 'todas') filtro.bodegaNombre = bodega.toUpperCase();
    if (req.user.role === 'userManifiesto') {
      if (!filtro.estado) filtro.estado = { $in: ['pendiente', 'en_proceso'] };
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [reportes, total] = await Promise.all([
      ReporteManifiesto.find(filtro).sort({ secuencia: -1 }).skip(skip).limit(parseInt(limit)),
      ReporteManifiesto.countDocuments(filtro),
    ]);
    res.json({ success: true, reportes, total, paginas: Math.ceil(total / parseInt(limit)), paginaActual: parseInt(page) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/manifiestos/reportes
router.post('/reportes', protect, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['admin', 'adminSede', 'coordLogistico'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Sin permisos para crear reportes' });
    }
    const {
      bodegaNombre, placa, nombreConductor, cedulaConductor,
      nombreTitular, cedulaTitular, destino,
      valorFlete, valorAnticipo, ajuste,
      numeroRemesa: remesaManual, numeroManifiesto: manifiestoManual,
    } = req.body;
    if (!bodegaNombre || !placa || !nombreConductor || !cedulaConductor ||
        !nombreTitular || !cedulaTitular || !destino || valorFlete == null) {
      return res.status(400).json({ success: false, message: 'Faltan campos requeridos' });
    }
    const nums = await generarNumeros();
    let numeroRemesa = remesaManual?.trim().toUpperCase() || nums.numeroRemesa;
    let numeroManifiesto = manifiestoManual?.trim().toUpperCase() || nums.numeroManifiesto;
    if (numeroRemesa !== nums.numeroRemesa) {
      const existeR = await ReporteManifiesto.findOne({ numeroRemesa });
      if (existeR) return res.status(409).json({ success: false, message: `La remesa ${numeroRemesa} ya existe` });
    }
    if (numeroManifiesto !== nums.numeroManifiesto) {
      const existeM = await ReporteManifiesto.findOne({ numeroManifiesto });
      if (existeM) return res.status(409).json({ success: false, message: `El manifiesto ${numeroManifiesto} ya existe` });
    }
    const reporte = await ReporteManifiesto.create({
      bodegaNombre: bodegaNombre.toUpperCase().trim(),
      secuencia: nums.secuencia,
      numeroRemesa,
      numeroManifiesto,
      placa: placa.toUpperCase().trim(),
      nombreConductor: nombreConductor.toUpperCase().trim(),
      cedulaConductor: cedulaConductor.trim(),
      nombreTitular: nombreTitular.toUpperCase().trim(),
      cedulaTitular: cedulaTitular.trim(),
      destino: destino.toUpperCase().trim(),
      valorFlete: Number(valorFlete),
      valorAnticipo: Number(valorAnticipo || 0),
      ajuste: Number(ajuste || 0),
      creadoPor: req.user._id,
      creadoPorNombre: req.user.username,
    });
    res.status(201).json({ success: true, reporte });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Número de remesa o manifiesto ya existe' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/manifiestos/reportes/:id
router.put('/reportes/:id', protect, async (req, res) => {
  try {
    const reporte = await ReporteManifiesto.findById(req.params.id);
    if (!reporte) return res.status(404).json({ success: false, message: 'Reporte no encontrado' });
    const { role, _id } = req.user;
    if (role === 'userManifiesto') {
      if (!reporte.tomadoPor || reporte.tomadoPor.toString() !== _id.toString()) {
        return res.status(403).json({ success: false, message: 'No puedes editar un reporte que no tomaste' });
      }
      const { numeroRemesa, numeroManifiesto } = req.body;
      if (numeroRemesa) reporte.numeroRemesa = numeroRemesa.trim().toUpperCase();
      if (numeroManifiesto) reporte.numeroManifiesto = numeroManifiesto.trim().toUpperCase();
      await reporte.save();
      return res.json({ success: true, reporte });
    }
    const campos = ['bodegaNombre','placa','nombreConductor','cedulaConductor','nombreTitular','cedulaTitular','destino','valorFlete','valorAnticipo','ajuste','numeroRemesa','numeroManifiesto'];
    campos.forEach(k => {
      if (req.body[k] !== undefined) {
        const isNum = ['valorFlete','valorAnticipo','ajuste'].includes(k);
        const isUp = ['bodegaNombre','placa','nombreConductor','nombreTitular','destino','numeroRemesa','numeroManifiesto'].includes(k);
        reporte[k] = isNum ? Number(req.body[k]) : isUp ? String(req.body[k]).toUpperCase().trim() : String(req.body[k]).trim();
      }
    });
    await reporte.save();
    res.json({ success: true, reporte });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Número de remesa o manifiesto ya existe' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/manifiestos/reportes/:id/tomar
router.post('/reportes/:id/tomar', protect, async (req, res) => {
  try {
    const { role, _id, username } = req.user;
    if (!['userManifiesto', 'admin', 'adminSede', 'coordLogistico'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Sin permisos' });
    }
    const reporte = await ReporteManifiesto.findOneAndUpdate(
      { _id: req.params.id, estado: 'pendiente' },
      { estado: 'en_proceso', tomadoPor: _id, tomadoPorNombre: username, fechaTomado: new Date() },
      { new: true }
    );
    if (!reporte) {
      const actual = await ReporteManifiesto.findById(req.params.id).select('estado tomadoPorNombre');
      return res.status(409).json({
        success: false,
        message: actual?.estado === 'en_proceso'
          ? `Este reporte ya fue tomado por ${actual.tomadoPorNombre}`
          : 'Este reporte ya no está disponible',
      });
    }
    res.json({ success: true, reporte });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/manifiestos/reportes/:id/completar
router.post('/reportes/:id/completar', protect, async (req, res) => {
  try {
    const { role, _id } = req.user;
    const filtro = { _id: req.params.id, estado: 'en_proceso' };
    if (role === 'userManifiesto') filtro.tomadoPor = _id;
    const reporte = await ReporteManifiesto.findOneAndUpdate(
      filtro,
      { estado: 'completado', fechaCompletado: new Date() },
      { new: true }
    );
    if (!reporte) return res.status(404).json({ success: false, message: 'Reporte no encontrado o no puedes completarlo' });
    res.json({ success: true, reporte });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/manifiestos/reportes/:id
router.delete('/reportes/:id', protect, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['admin', 'adminSede', 'coordLogistico'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Sin permisos' });
    }
    await ReporteManifiesto.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Reporte eliminado' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;