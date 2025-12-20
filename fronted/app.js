let offsetHistorial = 0;
let notifInterval;
const LIMITE_USER = 20; // <--- Aquí definimos que sea de 10 en 10
let offsetNotif = 0;
const LIMIT_NOTIF = 10;


const CONFIG = {
    usuario: JSON.parse(localStorage.getItem('usuario_banco')),
    apiURL: 'https://api.prismanet.org/api',
    historialCache: [],
    usuariosLista: [] // [NUEVO] Cache para guardar nombres de usuarios
};

const UI = {
    vistaOperar: document.getElementById('vista-operar'),
    vistaHistorial: document.getElementById('vista-historial'),
    btnNavOperar: document.getElementById('btn-nav-operar'),
    btnNavHistorial: document.getElementById('btn-nav-historial'),
    inputFiltroInicio: document.getElementById('filtro_inicio'),
    inputFiltroFin: document.getElementById('filtro_fin'),
    selectOperacion: document.getElementById('tipoOperacion'),
    form: document.getElementById('formTransaccion'),
    listaHistorial: document.getElementById('lista-historial'),
    camposGrupos: document.querySelectorAll('.campos-grupo'),
    selectDestino: document.getElementById('cliente_destino') // Referencia al listbox
};

const ESTILOS_OPERACION = {
    'RETIRO': { icono: 'fa-arrow-down', color: 'text-green-600', bg: 'bg-green-100', signo: '+' },
    'ABONO_CAJA': { icono: 'fa-donate', color: 'text-green-600', bg: 'bg-green-100', signo: '+' },
    'ABONO_TRASLADO': { icono: 'fa-hand-holding-usd', color: 'text-green-600', bg: 'bg-green-100', signo: '+' }, // Recibiste dinero
    'RECARGA': { icono: 'fa-gamepad', color: 'text-red-600', bg: 'bg-red-100', signo: '-' },
    'TRASLADO': { icono: 'fa-exchange-alt', color: 'text-red-600', bg: 'bg-red-100', signo: '-' }, // Enviaste dinero
    'CONSIGNACION': { icono: 'fa-university', color: 'text-orange-600', bg: 'bg-orange-100', signo: '-' },
    'DESCUENTO': { icono: 'fa-percentage', color: 'text-pink-600', bg: 'bg-pink-100', signo: '-' }
};
const ESTILOS_ESTADO = {
    'PENDIENTE': 'bg-yellow-100 text-yellow-800',
    'APROBADO': 'bg-green-100 text-green-800',
    'RECHAZADO': 'bg-red-100 text-red-800',
    'REVERSADO': 'bg-gray-200 text-gray-500 line-through decoration-2'
};

const PUBLIC_VAPID_KEY = 'BAn_3XUQwgftg7mDA70h8Ffcq_a3wXgIeyL65Wl9EdGJzrAGvIsfKiknop7vCPiZMCR17J0iD9h9cER_Ro9wMug';

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

document.addEventListener('DOMContentLoaded', () => {
    if (CONFIG.usuario) {
        actualizarUIUsuario(CONFIG.usuario);
        setInterval(sincronizarDatosUsuario, 5000);
        cargarListaDestinatarios(); // [NUEVO] Cargar usuarios al inicio
        notifInterval = setInterval(verificarBadgeNotificaciones, 10000);
        if (Notification.permission === 'default' || Notification.permission === 'granted') {
            activarNotificacionesPush();
        }
    }
});

// [NUEVO] Función para llenar el select de usuarios y guardar en CACHE
async function cargarListaDestinatarios() {
    try {
        const res = await fetch(`${CONFIG.apiURL}/lista-usuarios`);
        const usuarios = await res.json();
        
        CONFIG.usuariosLista = usuarios; // Guardamos la lista completa para usarla en el historial

        UI.selectDestino.innerHTML = '<option value="">Seleccione usuario...</option>';
        
        usuarios.forEach(u => {
            // No mostrarse a uno mismo en la lista
            if (u.id !== CONFIG.usuario.id) {
                const option = document.createElement('option');
                option.value = u.id;
                option.textContent = `${u.nombre_completo} (${u.cedula})`;
                UI.selectDestino.appendChild(option);
            }
        });
    } catch (e) { console.error("Error cargando usuarios", e); }
}

// En app.js

// app.js

async function sincronizarDatosUsuario() {
    try {
        const res = await fetch(`${CONFIG.apiURL}/usuario/${CONFIG.usuario.id}`);
        
        // 1. Caso Usuario Borrado (404)
        if (res.status === 404) {
            localStorage.removeItem('usuario_banco');
            window.location.href = 'login.html';
            return;
        }

        const data = await res.json();

        // 2. [NUEVO] Caso Usuario Desactivado
        if (data.success && data.usuario.activo === false) {
            // Opcional: Mostrar alerta antes de sacar
            alert("Tu cuenta ha sido desactivada por el administrador.");
            
            localStorage.removeItem('usuario_banco');
            window.location.href = 'login.html';
            return;
        }

        // 3. Caso Normal (Actualizar saldo)
        if (data.success && data.usuario.saldo_actual !== CONFIG.usuario.saldo_actual) {
            CONFIG.usuario = data.usuario;
            localStorage.setItem('usuario_banco', JSON.stringify(data.usuario));
            actualizarUIUsuario(data.usuario);
            // Si estamos en el historial, recargamos para ver nuevos movimientos
            if (!UI.vistaHistorial.classList.contains('hidden')) cargarHistorial();
        }
    } catch (e) {
        // Ignorar errores de red temporales
    }
}

function actualizarUIUsuario(u) {
    document.getElementById('userNombre').innerHTML = `<i class="fas fa-user mr-2"></i>${u.nombre_completo.split(' ')[0]}`;
    document.getElementById('userSaldo').innerText = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(u.saldo_actual);
}

UI.selectOperacion.addEventListener('change', actualizarFormulario);
UI.form.addEventListener('submit', procesarTransaccion);

function cambiarVista(vista) {
    if (vista === 'operar') {
        UI.vistaOperar.classList.remove('hidden');
        UI.vistaHistorial.classList.add('hidden');
        UI.btnNavOperar.classList.add('text-blue-900', 'font-bold'); UI.btnNavOperar.classList.remove('text-gray-400');
        UI.btnNavHistorial.classList.add('text-gray-400'); UI.btnNavHistorial.classList.remove('text-blue-900', 'font-bold');
        cargarListaDestinatarios(); // Recargar lista por si hay usuarios nuevos
    } else {
        UI.vistaOperar.classList.add('hidden');
        UI.vistaHistorial.classList.remove('hidden');
        UI.btnNavHistorial.classList.add('text-blue-900', 'font-bold'); UI.btnNavHistorial.classList.remove('text-gray-400');
        UI.btnNavOperar.classList.add('text-gray-400'); UI.btnNavOperar.classList.remove('text-blue-900', 'font-bold');
        cargarHistorial();
    }
}

// --- HISTORIAL ---
async function cargarHistorial(reset = true) {
    const btn = document.getElementById('btn-cargar-mas-user');
    const msg = document.getElementById('msg-fin-user');
    const lista = document.getElementById('lista-historial');

    // Obtener valores de los filtros
    const inicio = document.getElementById('filtro_inicio').value;
    const fin = document.getElementById('filtro_fin').value;
    const busqueda = document.getElementById('filtro_busqueda').value;

    if (reset) {
        offsetHistorial = 0;
        CONFIG.historialCache = []; 
        lista.innerHTML = '<div class="text-center py-10 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl"></i></div>';
        btn.classList.add('hidden');
        msg.classList.add('hidden');
    } else {
        btn.innerText = "Cargando...";
        btn.disabled = true;
    }

    try {
        // Construcción de URL con todos los parámetros
        let url = `${CONFIG.apiURL}/historial/${CONFIG.usuario.id}?limit=${LIMITE_USER}&offset=${offsetHistorial}`;
        
        if (inicio && fin) url += `&fechaInicio=${inicio}&fechaFin=${fin}`;
        if (busqueda) url += `&busqueda=${encodeURIComponent(busqueda)}`;

        const res = await fetch(url);
        const data = await res.json();
        
        if (data.success) {
            if (reset) lista.innerHTML = ''; 

            CONFIG.historialCache = CONFIG.historialCache.concat(data.datos);
            renderizarLista(data.datos, reset);

            offsetHistorial += LIMITE_USER;

            if (data.datos.length < LIMITE_USER) {
                btn.classList.add('hidden');
                // Si no es reset (es paginación) o si es reset pero hay datos, mostramos fin
                // Si es reset y no hay datos, el renderizarLista ya mostró "No hay movimientos"
                if (!reset && CONFIG.historialCache.length > 0) msg.classList.remove('hidden');
            } else {
                btn.classList.remove('hidden');
                msg.classList.add('hidden');
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-arrow-down mr-1"></i> Ver movimientos anteriores';
            }
        } else {
            if(reset) lista.innerHTML = '<div class="text-center py-4">Error al cargar.</div>';
        }
    } catch (e) { console.error(e); }
}

function aplicarFiltro() {
    const inicio = UI.inputFiltroInicio.value;
    const fin = UI.inputFiltroFin.value;
    if (!CONFIG.historialCache.length) return;
    
    const filtrados = CONFIG.historialCache.filter(tx => {
        const fecha = moment(tx.fecha_transaccion).format('YYYY-MM-DD');
        let cumple = true;
        if(inicio && fecha < inicio) cumple = false;
        if(fin && fecha > fin) cumple = false;
        return cumple;
    });
    renderizarLista(filtrados);
    cargarHistorial(true);
}

// [MODIFICADO] Renderizar lista con detalles de Casa de Apuestas
function renderizarLista(datos, limpiar = true) {
    if (limpiar) {
        UI.listaHistorial.innerHTML = '';
        if (datos.length === 0) {
            UI.listaHistorial.innerHTML = '<div class="text-center py-10 opacity-50"><p>No hay movimientos.</p></div>';
            return;
        }
    }

    datos.forEach(tx => {
        const estilo = ESTILOS_OPERACION[tx.tipo_operacion] || { icono: 'fa-circle', color: 'text-gray-500', bg: 'bg-gray-100', signo: '' };
        const claseEstado = ESTILOS_ESTADO[tx.estado] || 'bg-gray-100';
        const fecha = moment(tx.fecha_transaccion).format('D MMM, h:mm a');
        const monto = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(tx.monto);
        
        const esReversada = tx.estado === 'REVERSADO';

        // Solo mostramos el botón si es RECARGA, no está reversada y NO es Kairoplay
        const botonRepetir = (tx.tipo_operacion === 'RECARGA' && !esReversada && tx.cc_casino !== 'KAIROPLAY') 
            ? `<button onclick="event.stopPropagation(); repetirRecarga(${tx.id})" 
                    class="ml-2 p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-full transition-colors shadow-sm border border-blue-100" 
                    title="Repetir esta recarga Betplay">
                <i class="fas fa-redo-alt text-[10px]"></i>
            </button>` 
            : '';
            
        const claseOpacidad = esReversada ? 'opacity-60 grayscale' : '';

        // 1. Lógica de "Editado"
        const htmlEditado = tx.editado 
            ? `<span class="text-[9px] text-orange-400 italic ml-1 font-normal"><i class="fas fa-pen-nib"></i> Ajustado</span>` 
            : '';

        // 2. Lógica de Comisión
        let htmlComision = '';
        if (!esReversada && tx.comision > 0) {
            const comisionFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(tx.comision);
            htmlComision = `<p class="text-[10px] text-red-400 font-bold mt-0.5">(- ${comisionFmt} 3%)</p>`;
        }

        // --- [NUEVO] 3. Lógica para mostrar Casa y ID ---
        let htmlInfoCasa = '';
        
        if (['RETIRO', 'RECARGA'].includes(tx.tipo_operacion)) {
            let nombreCasa = 'BETPLAY';
            let colorCasa = 'text-blue-600';
            let idCasa = '---';

            // Detectar si es Kairoplay
            if (tx.cc_casino === 'KAIROPLAY') {
                nombreCasa = 'KAIROPLAY';
                colorCasa = 'text-purple-600';
                // En Kairo guardamos el ID en pin_retiro
                idCasa = tx.pin_retiro || '---';
            } else {
                // Es RECARGA
                // En recargas Betplay, el ID es cedula_destino
                idCasa = tx.cedula_destino || tx.pin_retiro || '---';
                
                // [NUEVO] Si hay nombre titular, lo mostramos al lado
                if(tx.nombre_titular) {
                    idCasa += ` (${tx.nombre_titular})`; 
                }
            }

            htmlInfoCasa = `
                <div class="flex items-center text-[10px] mt-1 font-mono bg-gray-50 rounded px-1 w-fit">
                    <span class="${colorCasa} font-bold mr-1">${nombreCasa}</span>
                    <span class="text-gray-400 mr-1">|</span>
                    <span class="text-gray-600 truncate max-w-[80px]">${idCasa}</span>
                </div>
            `;
        }
        // -----------------------------------------------

        const html = `
        <div onclick="abrirModalDetalle(${tx.id})" class="cursor-pointer bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between animate-fade-in-up ${claseOpacidad} hover:bg-blue-50 transition">
            <div class="flex items-center space-x-3 overflow-hidden">
                <div class="p-3 rounded-full ${estilo.bg} ${estilo.color} flex-shrink-0"><i class="fas ${estilo.icono} text-lg"></i></div>
                <div class="min-w-0"> 
                    <p class="font-bold text-gray-800 text-sm truncate pr-2">${tx.tipo_operacion.replace(/_/g, ' ')}</p>
                    <p class="text-xs text-gray-400">${fecha}</p>
                    ${htmlInfoCasa}
                </div>
            </div>
            <div class="text-right flex-shrink-0 ml-2">
                <p class="font-bold ${esReversada ? 'line-through text-gray-400' : estilo.color} flex items-center justify-end">
                    ${estilo.signo} ${monto} ${htmlEditado} ${botonRepetir}
                </p>
                ${htmlComision}
                <div class="mt-1">
                     <span class="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${claseEstado}">${tx.estado}</span>
                </div>
            </div>
        </div>`;
        
        UI.listaHistorial.innerHTML += html;
    });
}

function abrirModalDetalle(id) {
    const tx = CONFIG.historialCache.find(t => t.id === id);
    if (!tx) return;

    document.getElementById('modal-titulo').innerText = tx.tipo_operacion.replace(/_/g, ' ');
    document.getElementById('modal-id').innerText = `ID: ${tx.referencia_externa}`;
    document.getElementById('modal-monto').innerText = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(tx.monto);
    document.getElementById('modal-estado').innerText = tx.estado;
    document.getElementById('modal-fecha').innerText = moment(tx.fecha_transaccion).format('YYYY-MM-DD HH:mm');
    document.getElementById('modal-cliente').innerText = CONFIG.usuario.nombre_completo;
    document.getElementById('modal-cedula').innerText = CONFIG.usuario.cedula;
    

    const div = document.getElementById('modal-contenido-dinamico');
    let html = '';

    if(tx.comision > 0) {
        const comFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(tx.comision);
        const neto = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(tx.monto - tx.comision);
        html += `<div class="bg-red-50 p-3 rounded-lg mb-3 border border-red-100">
                    <p class="text-xs text-red-500 font-bold uppercase mb-1">Desglose</p>
                    <div class="flex justify-between text-xs mb-1"><span>Solicitado:</span> <span>${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(tx.monto)}</span></div>
                    <div class="flex justify-between text-xs text-red-600 font-bold mb-1"><span>Comisión (3%):</span> <span>- ${comFmt}</span></div>
                    <div class="flex justify-between text-sm font-bold border-t border-red-200 pt-1 text-gray-800"><span>Recibes:</span> <span>${neto}</span></div>
                 </div>`;
    }

    if (tx.tipo_operacion === 'RETIRO') {
        // Detectamos si es Kairo o Betplay
        if (tx.cc_casino === 'KAIROPLAY') {
             html += `<div class="mt-2 text-center">
                        <span class="bg-purple-100 text-purple-800 text-xs font-bold px-2 py-1 rounded">KAIROPLAY</span>
                      </div>
                      <p class="mt-2"><strong>ID Transferencia:</strong> ${tx.pin_retiro || '---'}</p>`;
        } else {
             // Si no es Kairo, ES BETPLAY
             // tx.cc_casino contiene la Cédula registrada, así que la mostramos como tal.
             html += `<div class="mt-2 text-center">
                        <span class="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded">BETPLAY</span>
                      </div>
                      <p class="mt-2 text-xs"><strong>C.C en Casino:</strong> ${tx.cc_casino || 'N/A'}</p>
                      <p class="text-xs"><strong>Titular:</strong> ${tx.nombre_cedula || 'N/A'}</p>
                      <p class="text-xs"><strong>PIN:</strong> ${tx.pin_retiro || 'N/A'}</p>`;
        }
    }
    else if (tx.tipo_operacion === 'RECARGA') {
        if (tx.cc_casino === 'KAIROPLAY') {
             html += `<div class="mt-2 text-center">
                        <span class="bg-purple-100 text-purple-800 text-xs font-bold px-2 py-1 rounded">KAIROPLAY</span>
                      </div>
                      <p class="mt-2"><strong>ID Usuario:</strong> ${tx.pin_retiro || '---'}</p>`;
        } else {
             html += `<div class="mt-2 text-center">
                        <span class="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded">BETPLAY</span>
                      </div>
                      <p class="mt-2"><strong>Cédula a Recargar:</strong> ${tx.cedula_destino || tx.pin_retiro || 'N/A'}</p>`;
        }
    }
    else if (tx.tipo_operacion === 'DESCUENTO') {
        html += `<div class="bg-pink-50 p-3 rounded-xl border border-pink-100 text-center mt-2">
                    <p class="text-xs text-pink-500 font-bold uppercase mb-1"><i class="fas fa-info-circle mr-1"></i> Detalle del cargo</p>
                    <p class="text-gray-800 font-bold text-md">"${tx.referencia_externa || 'Ajuste administrativo'}"</p>
                 </div>`;
    }
    else if (tx.tipo_operacion === 'CONSIGNACION') html += `<p><strong>Llave:</strong> ${tx.llave_bre_b}</p><p><strong>Titular:</strong> ${tx.titular_cuenta}</p>`;
    else if (tx.tipo_operacion === 'ABONO_CAJA') html += '<p class="italic text-gray-500">Depósito Bancario</p>';
    
    // [MODIFICADO] Mostrar nombres en los traslados
    else if (tx.tipo_operacion === 'TRASLADO') {
        const usuarioDest = CONFIG.usuariosLista.find(u => u.id === tx.usuario_destino_id);
        const nombreDest = usuarioDest ? usuarioDest.nombre_completo : 'Desconocido';
        html += `<div class="mt-2 p-2 bg-gray-50 rounded border text-center">
                    <p class="text-xs text-gray-500 italic">Enviado a:</p>
                    <p class="font-bold text-gray-800">${nombreDest}</p>
                 </div>`;
    }
    else if (tx.tipo_operacion === 'ABONO_TRASLADO') {
        const usuarioOrigen = CONFIG.usuariosLista.find(u => u.id === tx.usuario_destino_id);
        const nombreOrigen = usuarioOrigen ? usuarioOrigen.nombre_completo : 'Desconocido';
        html += `<div class="mt-2 p-2 bg-green-50 rounded border border-green-100 text-center">
                    <p class="text-xs text-green-600 italic">Recibido de:</p>
                    <p class="font-bold text-green-900">${nombreOrigen}</p>
                 </div>`;
    }
    
    div.innerHTML = html;

    if (tx.tipo_operacion === 'RECARGA' && tx.estado !== 'REVERSADO') {
        html += `
            <div class="mt-4">
                <button onclick="repetirRecarga(${tx.id})" class="w-full bg-blue-600 text-white font-bold py-2 rounded-lg shadow hover:bg-blue-700 transition active:scale-95">
                    <i class="fas fa-redo mr-2"></i> Repetir esta Recarga
                </button>
            </div>
        `;
    }

    const imgContainer = document.getElementById('modal-comprobante-container');
    if (tx.comprobante_ruta) {
        imgContainer.classList.remove('hidden');
        let cleanPath = tx.comprobante_ruta.replace(/\\/g, '/');
        if (cleanPath.includes('uploads/')) cleanPath = '/uploads/' + cleanPath.split('uploads/')[1];
        const baseUrl = CONFIG.apiURL.replace('/api', '');
        const fullUrl = cleanPath.startsWith('http') ? cleanPath : `${baseUrl}${cleanPath}`;
        
        document.getElementById('modal-comprobante-img').src = fullUrl;
        document.getElementById('modal-comprobante-img').className = "w-full h-auto max-h-[60vh] object-contain rounded-lg border bg-gray-50"; 
        document.getElementById('modal-comprobante-link').href = fullUrl;
    } else {
        imgContainer.classList.add('hidden');
    }

    document.getElementById('modal-detalle-tx').classList.remove('hidden');
}

// [NUEVO] Función para los botones de acceso rápido
function seleccionarRapido(tipo) {
    const select = document.getElementById('tipoOperacion');
    select.value = tipo;
    
    // Disparar el evento change manualmente para que ejecute la lógica existente
    const evento = new Event('change');
    select.dispatchEvent(evento);
}

// [MODIFICADO] Tu función actualizarFormulario existente
function actualizarFormulario() {
    const op = UI.selectOperacion.value;
    
    // Referencias a elementos de la interfaz
    const panelAccesos = document.getElementById('panel-accesos-rapidos');
    const seccionSelector = document.getElementById('seccion-selector');
    const divCasino = document.getElementById('campo-casino'); // El div que contiene el selector Betplay/Kairo

    // 1. Limpieza: Ocultar todos los grupos de campos primero
    UI.camposGrupos.forEach(g => g.classList.add('hidden'));

    // --- ESTADO 1: INICIO (Nada seleccionado) ---
    if (!op) {
        if(panelAccesos) panelAccesos.classList.remove('hidden'); // Mostrar botones grandes
        if(seccionSelector) seccionSelector.classList.add('hidden'); // Ocultar selector pequeño
        UI.form.classList.add('hidden'); // Ocultar formulario
        return;
    }

    // --- ESTADO 2: OPERANDO (Algo seleccionado) ---
    if(panelAccesos) panelAccesos.classList.add('hidden'); // Ocultar botones grandes
    if(seccionSelector) seccionSelector.classList.remove('hidden'); // Mostrar selector pequeño
    UI.form.classList.remove('hidden'); // Mostrar formulario
    
    // 2. Generar ID Seguro (Tu corrección para evitar repetidos)
    const timestamp = Math.floor(Date.now() / 1000);
    const random = Math.floor(Math.random() * 1000);
    document.getElementById('id_transaccion').value = `T-${timestamp}-${random}`;

    // 3. Lógica específica por operación
    if(op === 'RETIRO') {
        document.getElementById('campos-retiro').classList.remove('hidden');
        // Mostrar el selector de Casino y actualizar los inputs
        if(divCasino) divCasino.classList.remove('hidden');
        filtrarOpcionesCasino();
        actualizarCamposCasino(); // <--- IMPORTANTE: Llama a la lógica de Kairo/Betplay
    }
    else if(op === 'RECARGA') {
        document.getElementById('campos-recarga').classList.remove('hidden');
        // Mostrar el selector de Casino y actualizar los inputs
        if(divCasino) divCasino.classList.remove('hidden');
        actualizarCamposCasino(); // <--- IMPORTANTE: Llama a la lógica de Kairo/Betplay
    }
    else {
        // Para Abonos, Traslados y Consignaciones NO mostramos el selector de Casino
        if(divCasino) divCasino.classList.add('hidden');
        
        if(op === 'ABONO_CAJA') document.getElementById('campos-abono-caja').classList.remove('hidden');
        if(op === 'TRASLADO') document.getElementById('campos-traslado').classList.remove('hidden');
        if(op === 'CONSIGNACION') document.getElementById('campos-consignacion').classList.remove('hidden');
    }

    // 4. Actualizar título e icono del formulario (Estético)
    const estilo = ESTILOS_OPERACION[op];
    if(estilo) {
        document.getElementById('formTitulo').innerText = op.replace(/_/g, ' ');
        document.getElementById('formIcono').className = `fas ${estilo.icono} ${estilo.color} text-xl`;
    }
}

// 1. CONTROL DE VISIBILIDAD (Actualizada)
function actualizarCamposCasino() {
    const casino = document.getElementById('selector_casino').value;
    const op = UI.selectOperacion.value;

    // Referencias
    const grupoBetplayRetiro = document.getElementById('grupo-betplay-retiro');
    const grupoKairoRetiro = document.getElementById('grupo-kairo-retiro'); // Nuevo input div
    
    const grupoBetplayRecarga = document.getElementById('grupo-betplay-recarga');
    const grupoKairoRecarga = document.getElementById('grupo-kairo-recarga'); // Nuevo input div

    // Lógica RETIROS
    if (op === 'RETIRO') {
        if (casino === 'BETPLAY') {
            if(grupoBetplayRetiro) grupoBetplayRetiro.classList.remove('hidden');
            if(grupoKairoRetiro) grupoKairoRetiro.classList.add('hidden');
        } else {
            // KAIROPLAY
            if(grupoBetplayRetiro) grupoBetplayRetiro.classList.add('hidden');
            if(grupoKairoRetiro) grupoKairoRetiro.classList.remove('hidden'); // Mostramos input Kairo
        }
    }

    // Lógica RECARGAS
    if (op === 'RECARGA') {
        if (casino === 'BETPLAY') {
            if(grupoBetplayRecarga) grupoBetplayRecarga.classList.remove('hidden');
            if(grupoKairoRecarga) grupoKairoRecarga.classList.add('hidden');
        } else {
            // KAIROPLAY
            if(grupoBetplayRecarga) grupoBetplayRecarga.classList.add('hidden');
            if(grupoKairoRecarga) grupoKairoRecarga.classList.remove('hidden'); // Mostramos input Kairo
        }
    }
}

async function procesarTransaccion(e) {
    e.preventDefault();
    
    const formData = new FormData();
    // Datos fijos
    formData.append('usuario_id', CONFIG.usuario.id);
    formData.append('tipo_operacion', UI.selectOperacion.value);
    const rawMonto = document.getElementById('monto').value;
    const montoLimpio = rawMonto.replace(/\./g, '').replace(/,/g, '');

    formData.append('monto', montoLimpio);
    formData.append('id_transaccion', document.getElementById('id_transaccion').value);

    // Guardar el Casino seleccionado
    const casino = document.getElementById('selector_casino').value;

    if (UI.selectOperacion.value === 'RETIRO' && casino === 'BETPLAY') {
        const pin = document.getElementById('pin_retiro').value;
        
        // La expresión regular /^\d{6}$/ verifica que sean números y exactamente 6
        if (!pin || !/^\d{6}$/.test(pin)) {
            Swal.fire({
                icon: 'warning',
                title: 'PIN Inválido',
                text: 'El PIN de retiro para Betplay debe tener exactamente 6 dígitos.'
            });
            return; // Detiene la función, no se envía nada al servidor
        }
    }

    // --- LÓGICA ESPECIAL PARA GUARDAR DATOS SEGÚN EL CASINO ---
    if ( (UI.selectOperacion.value === 'RETIRO' || UI.selectOperacion.value === 'RECARGA') && casino === 'KAIROPLAY' ) {
        formData.append('cc_casino', 'KAIROPLAY'); 
        const idRetiro = document.getElementById('id_kairo_retiro').value;
        const idRecarga = document.getElementById('id_kairo_recarga').value;
        
        if(UI.selectOperacion.value === 'RETIRO') formData.append('pin_retiro', idRetiro);
        if(UI.selectOperacion.value === 'RECARGA') formData.append('pin_retiro', idRecarga); 
    } else {
        // LÓGICA NORMAL (BETPLAY u Otros)
        const agregar = (id, nombre) => { const val = document.getElementById(id)?.value; if(val) formData.append(nombre, val); };
        agregar('cc_casino', 'cc_casino');
        agregar('nombre_cedula', 'nombre_cedula');
        agregar('pin_retiro', 'pin_retiro');
        agregar('cedula_recarga', 'cedula_recarga');
        if (UI.selectOperacion.value === 'RECARGA') {
            const nombreRecarga = document.getElementById('nombre_recarga').value;
            if(nombreRecarga) formData.append('nombre_titular', nombreRecarga);
        }
    }

    // Campos comunes (Traslados, Consignaciones)
    const agregarComun = (id, nombre) => { const val = document.getElementById(id)?.value; if(val) formData.append(nombre, val); };
    agregarComun('cliente_destino', 'usuario_destino_id');
    agregarComun('llave_bre_b', 'llave_bre_b');
    agregarComun('titular_cuenta', 'titular_cuenta');
    
    const f = document.getElementById('comprobante_archivo'); 
    if(f && f.files.length) formData.append('comprobante_archivo', f.files[0]);

    // Enviar al servidor
    const btn = UI.form.querySelector('button'); btn.disabled=true; btn.innerText="Procesando...";
    
    try {
        const res = await fetch(`${CONFIG.apiURL}/transaccion`, { method: 'POST', body: formData });
        const data = await res.json();
        
        if(data.success) { 
            const tipo = UI.selectOperacion.value;
            const monto = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(document.getElementById('monto').value);
            const idTx = document.getElementById('id_transaccion').value;
            
            // CORRECCIÓN AQUÍ: Usamos 'nombreCliente' para que coincida con el mensaje de abajo
            const nombreCliente = CONFIG.usuario.nombre_completo; 
            
            let mensajeWhatsApp = "";

            // --- 1. CASO RETIRO (FORMATO NUEVO VERTICAL) ---
            if(tipo === 'RETIRO') {
                let infoEspecifica = "";

                if(casino === 'KAIROPLAY') {
                    // EN KAIROPLAY: Solo mostramos el PIN (ID de transferencia)
                    // Eliminamos la línea de "Cédula Registrada"
                    const pin = document.getElementById('id_kairo_retiro').value; 
                    infoEspecifica = `Pin de retiro: ${pin}`;
                } else {
                    // EN BETPLAY: Mantenemos ambos datos
                    const cedulaCasino = document.getElementById('cc_casino').value;
                    const pin = document.getElementById('pin_retiro').value;
                    infoEspecifica = `Cedula Registrada en casino: ${cedulaCasino}
Pin de retiro: ${pin}`;
                }

                mensajeWhatsApp = `
Casino:${casino}               
Usuario: ${nombreCliente}
Operación: Retiro
${infoEspecifica}
Valor del retiro: ${monto}
--------------------
ID referencia: ${idTx}`;
            }

            // --- 2. CASO RECARGA (FORMATO NUEVO VERTICAL) ---
            else if(tipo === 'RECARGA') {
                let infoRecarga = "";
                
                if(casino === 'KAIROPLAY') {
                    const idKairo = document.getElementById('id_kairo_recarga').value;
                    infoRecarga = `ID Kairoplay: ${idKairo}`;
                } else {
                    // BETPLAY
                    const cedula = document.getElementById('cedula_recarga').value;
                    // [NUEVO] Capturamos el nombre para el mensaje
                    const nombreTitular = document.getElementById('nombre_recarga').value || "Sin nombre";
                    infoRecarga = `Cedula a Recargar: ${cedula}
Titular: ${nombreTitular}`; // <--- Agregado al mensaje
                    }

                mensajeWhatsApp =`
Casino: ${casino}
Operacion: Recarga
Usuario: ${nombreCliente}
${infoRecarga}
Valor: ${monto}
----------------------
id referencia: ${idTx}`;
}

            // --- 3. OTROS CASOS (FORMATO ORIGINAL CONSERVADO) ---
            else {
                let detalles = "";
                
                if(tipo === 'TRASLADO') {
                    const selectDestino = document.getElementById('cliente_destino');
                    const nombreDestino = selectDestino.options[selectDestino.selectedIndex].text;
                    detalles = `Destinatario: *${nombreDestino}*\nTipo: *Transferencia Interna*`;
                }
                else if(tipo === 'CONSIGNACION') {
                    const banco = document.getElementById('llave_bre_b').value;
                    const titular = document.getElementById('titular_cuenta').value;
                    detalles = `Banco / Llave: *${banco}*\nTitular: *${titular}*`;
                }
                else if(tipo === 'ABONO_CAJA') {
                    if (data.comprobante_url) {
                        detalles = `Tipo: *Depósito Bancario*\nVer Comprobante: ${data.comprobante_url}`;
                    } else {
                        detalles = `Tipo: *Depósito Bancario*\n(Sin comprobante adjunto)`;
                    }
                }

                // Construimos el mensaje estilo antiguo para estos casos
                mensajeWhatsApp = `Hola, acabo de realizar una operación:\n\n📌 *${tipo.replace(/_/g, ' ')}*\n👤 Usuario: ${nombreCliente}\n💰 Monto: ${monto}\n🆔 Ref: ${idTx}\n--------------------------------\n${detalles}\n--------------------------------\nQuedo atento. Muchas gracias.`;
            }

            // Codificamos para URL
            const textoCodificado = encodeURIComponent(mensajeWhatsApp);

            // [MODIFICACIÓN] Bloqueo agresivo para obligar el envío a WhatsApp
            if (data.whatsapp_destino) {
                            
                let enviado = false;

                // Función recursiva: No te deja salir hasta que confirmes
                const obligarEnvio = () => {
                    Swal.fire({
                        title: '⚠️ PASO FINAL OBLIGATORIO',
                        html: `
                            <div class="text-left">
                                <p class="mb-2">Para validar tu <b>${tipo.replace(/_/g, ' ')}</b>, debes enviar el comprobante por WhatsApp.</p>
                                <p class="text-sm text-red-600 font-bold">🚫 Si no lo envías, la transacción no será procesada.</p>
                            </div>
                        `,
                        icon: 'warning',
                        showCancelButton: false, // ¡Sin botón de cancelar!
                        allowOutsideClick: false, // ¡Bloqueado clic afuera!
                        allowEscapeKey: false,    // ¡Bloqueado tecla Escape!
                        confirmButtonText: '<i class="fab fa-whatsapp"></i> Abrir WhatsApp y Enviar',
                        confirmButtonColor: '#25D366',
                        // Prevenir cierre automático inmediato para manejar la lógica
                        preConfirm: () => {
                            const numeroLimpio = data.whatsapp_destino.replace(/\D/g, '');
                            // Abrimos WhatsApp
                            window.open(`https://wa.me/${numeroLimpio}?text=${textoCodificado}`, '_blank');
                            return true; // Esto pasa al siguiente then
                        }
                    }).then(() => {
                        // Una vez que el usuario dio clic y (teóricamente) fue a WhatsApp y volvió:
                        confirmarEnvioReal();
                    });
                };

                const confirmarEnvioReal = () => {
                    Swal.fire({
                        title: '¿Ya enviaste el mensaje?',
                        text: 'Debes presionar el botón de enviar en WhatsApp para terminar.',
                        icon: 'question',
                        showCancelButton: true,
                        allowOutsideClick: false,
                        allowEscapeKey: false,
                        confirmButtonText: 'Sí, ya lo envié',
                        confirmButtonColor: '#3085d6',
                        cancelButtonText: 'No, volver a abrir WhatsApp',
                        cancelButtonColor: '#d33'
                    }).then((result) => {
                        if (result.isConfirmed) {
                            // AQUÍ RECIÉN permitimos limpiar y seguir
                            Swal.fire('¡Proceso Finalizado!', 'Tu transacción está en proceso.', 'success');
                            UI.form.reset(); 
                            resetearVista(); 
                            sincronizarDatosUsuario(); 
                            cambiarVista('historial');
                        } else {
                            // Si dice que NO, lo mandamos de vuelta al bucle
                            obligarEnvio();
                        }
                    });
                };

                // Iniciamos el ciclo
                obligarEnvio();

            } else {
                // Caso raro donde no haya número configurado
                Swal.fire('Éxito', 'Operación registrada correctamente', 'success');
                UI.form.reset(); resetearVista(); sincronizarDatosUsuario(); cambiarVista('historial');
            }
        }
        else {
            // Manejo de errores
            if (data.error && (data.error.includes('Horario') || data.error.includes('cerrado'))) {
                Swal.fire({
                    title: 'Estamos Descansando',
                    text: data.error,
                    icon: 'info',
                    confirmButtonText: 'Entendido'
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Hubo un problema',
                    text: data.error,
                    confirmButtonColor: '#d33'
                });
            }
        }
    } catch(e) { 
        console.error(e);
        Swal.fire({ icon: 'warning', title: 'Sin conexión', text: 'No pudimos conectar con el servidor.' });
    }
    
    btn.disabled = false; 
    btn.innerText = "Confirmar Operación";
}

// [NUEVO] Función para volver al estado inicial (Solo botones)
function resetearVista() {
    UI.selectOperacion.value = ""; // Reseteamos el select
    actualizarFormulario(); // Actualizamos la UI
}

function filtrarOpcionesCasino() {
    const selector = document.getElementById('selector_casino');
    const permisos = CONFIG.usuario.permisos_casino || 'AMBOS'; // Si es viejo, asume AMBOS
    
    // Limpiamos el selector
    selector.innerHTML = '';

    // Creamos las opciones
    const opBet = new Option('Betplay', 'BETPLAY');
    const opKairo = new Option('Kairoplay', 'KAIROPLAY');

    // Lógica de inserción
    if (permisos === 'AMBOS') {
        selector.add(opBet);
        selector.add(opKairo);
    } 
    else if (permisos === 'BETPLAY') {
        selector.add(opBet);
    } 
    else if (permisos === 'KAIROPLAY') {
        selector.add(opKairo);
    }

    // Seleccionar la primera opción disponible por defecto
    selector.selectedIndex = 0;
    
    // Forzar actualización de campos visuales (para que se muestren los inputs correctos)
    actualizarCamposCasino();
}


async function marcarLeida(id, elemento) {
    if (elemento.classList.contains('bg-gray-100')) return; // Ya está leída

    try {
        await fetch(`${CONFIG.apiURL}/notificaciones/leer/${id}`, { method: 'PUT' });
        // Visualmente marcar como leída
        elemento.classList.remove('bg-white', 'border-l-4', 'border-blue-500', 'shadow-sm');
        elemento.classList.add('bg-gray-100', 'opacity-75', 'border', 'border-gray-200');
        
        // Actualizar badge localmente
        const badge = document.getElementById('badge-notif');
        const aunSinLeer = document.querySelectorAll('#lista-notificaciones .bg-white').length; // Contar visuales
        if(aunSinLeer === 0) badge.classList.add('hidden');

    } catch(e) { console.error(e); }
}

async function verificarBadgeNotificaciones() {
    try {
        // Pedimos pocas solo para ver el estado reciente
        const res = await fetch(`${CONFIG.apiURL}/notificaciones/${CONFIG.usuario.id}?limit=5&offset=0`);
        const data = await res.json();
        
        const badge = document.getElementById('badge-notif');
        // Si alguna de las recientes no está leída, mostramos badge
        const hayNoLeidas = data.some(n => !n.leido);
        
        if(hayNoLeidas) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    } catch (e) { console.error("Error badge", e); }
}

// 2. Función principal de carga (Con paginación)
async function cargarNotificacionesPanel(reset = true) {
    const lista = document.getElementById('lista-notificaciones');
    const btnMas = document.getElementById('btn-mas-notif');
    const msgFin = document.getElementById('msg-fin-notif');

    if (reset) {
        offsetNotif = 0;
        lista.innerHTML = ''; 
        btnMas.classList.add('hidden');
        msgFin.classList.add('hidden');
    } else {
        btnMas.innerText = "Cargando...";
        btnMas.disabled = true;
    }

    try {
        const res = await fetch(`${CONFIG.apiURL}/notificaciones/${CONFIG.usuario.id}?limit=${LIMIT_NOTIF}&offset=${offsetNotif}`);
        const data = await res.json();

        if (data.length > 0) {
            renderizarNotificaciones(data); // Append es false por defecto en render, necesitamos cambiar eso o hacerlo manual
            offsetNotif += LIMIT_NOTIF;

            if (data.length < LIMIT_NOTIF) {
                btnMas.classList.add('hidden');
                msgFin.classList.remove('hidden');
            } else {
                btnMas.classList.remove('hidden');
                msgFin.classList.add('hidden');
                btnMas.innerText = "Cargar más antiguas"; // Restaurar texto
                btnMas.innerHTML = '<i class="fas fa-plus-circle mr-1"></i> Cargar más antiguas';
                btnMas.disabled = false;
            }
        } else {
            if(reset) lista.innerHTML = '<div class="text-center text-gray-400 text-xs mt-10">Sin notificaciones.</div>';
            btnMas.classList.add('hidden');
            msgFin.classList.remove('hidden');
        }
    } catch (e) { console.error("Error cargando notif", e); }
}

function renderizarNotificaciones(datos) {
    const lista = document.getElementById('lista-notificaciones');
    
    // No limpiamos la lista aquí, solo añadimos (append)
    datos.forEach(n => {
        const fecha = moment(n.fecha).fromNow();
        const estiloNoLeido = !n.leido ? 'bg-white border-l-4 border-blue-500 shadow-sm' : 'bg-gray-100 opacity-75 border border-gray-200';
        const icono = n.tipo === 'ALERTA' ? '<i class="fas fa-exclamation-circle text-red-500"></i>' : '<i class="fas fa-info-circle text-blue-500"></i>';

        const html = `
            <div class="p-3 rounded mb-2 text-sm ${estiloNoLeido} transition hover:bg-white animate-fade" onclick="marcarLeida(${n.id}, this)">
                <div class="flex justify-between items-start mb-1">
                    <span class="font-bold text-gray-700">${icono} Sistema</span>
                    <span class="text-[10px] text-gray-400">${fecha}</span>
                </div>
                <p class="text-gray-600 text-xs leading-snug">${n.mensaje}</p>
            </div>
        `;
        lista.innerHTML += html;
    });
}

function toggleNotificaciones() {
    const panel = document.getElementById('panel-notificaciones');
    const overlay = document.getElementById('overlay-notif');
    
    if (panel.classList.contains('translate-x-full')) {
        // ABRIR
        panel.classList.remove('translate-x-full');
        overlay.classList.remove('hidden');
        // Cargamos desde cero al abrir
        cargarNotificacionesPanel(true);
    } else {
        // CERRAR
        panel.classList.add('translate-x-full');
        overlay.classList.add('hidden');
        // Al cerrar, actualizamos el badge por si leímos algo
        verificarBadgeNotificaciones();
    }
}

// 2. Función Principal: Activa el sistema en el celular
async function activarNotificacionesPush() {
    // Si el navegador no soporta esto, no hacemos nada
    if (!('serviceWorker' in navigator)) return;
    
    try {
        console.log("Iniciando registro de Push...");

        // A. Instalar el Service Worker (el archivo sw.js)
        const register = await navigator.serviceWorker.register('./sw-v4.js', {
            scope: './'
        });
        await navigator.serviceWorker.ready;

        // B. Suscribirse (Aquí el celular pregunta al usuario si acepta)
        const subscription = await register.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
        });

        // C. Enviar el ID del celular a tu Base de Datos
        await fetch(`${CONFIG.apiURL}/subscribe`, {
            method: 'POST',
            body: JSON.stringify({
                usuario_id: CONFIG.usuario.id,
                subscription: subscription
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log("✅ Notificaciones activadas y guardadas en BD.");

    } catch (err) {
        console.error("Error activando push (puede que el usuario bloqueara los permisos):", err);
    }
}

async function repetirRecarga(id) {
    const tx = CONFIG.historialCache.find(t => t.id === id);
    if (!tx) return;

    // 1. VALIDACIÓN: Solo permitir si es BETPLAY
    if (tx.cc_casino === 'KAIROPLAY') {
        Swal.fire({
            icon: 'info',
            title: 'No disponible',
            text: 'La repetición rápida solo está habilitada para recargas de Betplay.',
            confirmButtonColor: '#1e3a8a'
        });
        return;
    }

    // Aseguramos que el monto sea un entero sin decimales
    const montoEntero = Math.floor(tx.monto);

    // 2. Confirmación al usuario
    const { isConfirmed } = await Swal.fire({
        title: '¿Repetir Recarga Betplay?',
        text: `Se cargará de nuevo la recarga de ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(montoEntero)} para la cédula ${tx.cedula_destino || tx.pin_retiro}.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, cargar datos',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#1e3a8a'
    });

    if (!isConfirmed) return;

    // 3. Proceso de carga en el formulario
    cambiarVista('operar');
    UI.selectOperacion.value = 'RECARGA';
    actualizarFormulario();

    // Insertamos el monto limpio
    document.getElementById('monto').value = montoEntero.toString();
    
    // Forzamos selector a BETPLAY y activamos sus campos
    const selectorCasino = document.getElementById('selector_casino');
    selectorCasino.value = 'BETPLAY';
    actualizarCamposCasino();

    // Llenamos los campos específicos de Betplay
    document.getElementById('cedula_recarga').value = tx.cedula_destino || tx.pin_retiro;
    document.getElementById('nombre_recarga').value = tx.nombre_titular || '';

    // Scroll suave al formulario
    window.scrollTo({ top: 0, behavior: 'smooth' });
}


function cerrarSesion() { if(confirm('¿Salir?')) { localStorage.removeItem('usuario_banco'); window.location.href='login.html'; } }