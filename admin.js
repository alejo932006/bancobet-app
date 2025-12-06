const API_URL = 'http://localhost:3000/api/admin';
let usuarioActualId = null;
let transaccionesCache = []; 
let usuariosCache = []; 

document.addEventListener('DOMContentLoaded', () => {
    const vistaGuardada = localStorage.getItem('admin_vista_actual') || 'dashboard';
    const hoy = moment().format('YYYY-MM-DD');
    const inputInicio = document.getElementById('dash-inicio');
    const inputFin = document.getElementById('dash-fin');
    
    if(inputInicio && inputFin) {
        inputInicio.value = hoy;
        inputFin.value = hoy;
    }

    cargarVista(vistaGuardada);
    cargarCacheUsuarios(); 
});

async function cargarCacheUsuarios() {
    try {
        const res = await fetch(`${API_URL}/usuarios`);
        usuariosCache = await res.json();
    } catch (e) { console.error("Error cargando usuarios", e); }
}

function cargarVista(vista) {
    // 1. Ocultar todo
    document.querySelectorAll('.vista-seccion').forEach(v => v.classList.add('hidden'));
    
    // 2. Mostrar la vista seleccionada
    const seccion = document.getElementById(`vista-${vista}`);
    if (seccion) {
        seccion.classList.remove('hidden');
        // [MEJORA] Guardar en memoria dónde estamos
        localStorage.setItem('admin_vista_actual', vista);
    }

    // 3. Cargar datos específicos
    if (vista === 'dashboard') cargarResumen();
    if (vista === 'usuarios') cargarUsuarios();
    if (vista === 'movimientos') cargarMovimientosGlobales();
}

// [NUEVO] Función para cerrar sesión explícitamente
function cerrarSesion() {
    if(confirm('¿Seguro que deseas salir del sistema?')) {
        localStorage.removeItem('usuario_banco');      // Borrar credenciales
        localStorage.removeItem('admin_vista_actual'); // Borrar rastro de navegación
        window.location.href = 'login.html';
    }
}

// --- 1. DASHBOARD ---
// --- 1. DASHBOARD ---
async function cargarResumen() {
    try {
        // 1. Obtener fechas de los inputs
        const inicio = document.getElementById('dash-inicio').value;
        const fin = document.getElementById('dash-fin').value;

        // 2. Actualizar texto informativo
        if(inicio === fin) {
            document.getElementById('dash-rango-texto').innerText = `Actividad del día: ${inicio}`;
        } else {
            document.getElementById('dash-rango-texto').innerText = `Rango: ${inicio} a ${fin}`;
        }

        // 3. Llamar a la API con parámetros
        const res = await fetch(`${API_URL}/resumen?fechaInicio=${inicio}&fechaFin=${fin}`);
        const data = await res.json();
        
        const fmt = (valor) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(valor || 0);
        
        // --- PINTAR LOS DATOS (Esto sigue igual que antes) ---
        
        // NOTA: 'totalBanco' y 'totalUsuarios' suelen ser snapshots actuales (no dependen de fecha), 
        // pero 'ganancias' y los desgloses SÍ respetarán el filtro.
        document.getElementById('dash-total-banco').innerText = fmt(data.totalBanco);
        document.getElementById('dash-usuarios').innerText = data.totalUsuarios;
        document.getElementById('dash-ganancias').innerText = fmt(data.totalGanancias);

        const ops = data.desgloseOperaciones || {};
        document.getElementById('dash-retiros').innerText = fmt(ops['RETIRO']);
        document.getElementById('dash-abonos').innerText = fmt(ops['ABONO_CAJA']);
        document.getElementById('dash-recargas').innerText = fmt(ops['RECARGA']);
        document.getElementById('dash-consignaciones').innerText = fmt(ops['CONSIGNACION']);
        document.getElementById('dash-traslados').innerText = fmt(ops['TRASLADO']);

        // Stats Kairoplay (Si las implementaste en el paso anterior)
        if (data.kairo) {
            document.getElementById('kairo-retiros').innerText = fmt(data.kairo.retiros);
            document.getElementById('kairo-recargas').innerText = fmt(data.kairo.recargas);
            const saldoEl = document.getElementById('kairo-saldo');
            saldoEl.innerText = fmt(data.kairo.saldo);
            
            if (data.kairo.saldo < 0) {
                saldoEl.className = "text-2xl font-bold mt-1 text-red-600";
            } else {
                saldoEl.className = "text-2xl font-bold mt-1 text-green-600";
            }
        }

    } catch (e) { console.error("Error cargando resumen:", e); }
}

// --- 2. MONITOR GLOBAL ---
async function cargarMovimientosGlobales() {
    const inicio = document.getElementById('global-filtro-inicio').value;
    const fin = document.getElementById('global-filtro-fin').value;
    const texto = document.getElementById('global-filtro-texto').value;

    let url = `${API_URL}/transacciones?_t=${Date.now()}`;
    if(inicio && fin) url += `&fechaInicio=${inicio}&fechaFin=${fin}`;
    if(texto) url += `&busqueda=${encodeURIComponent(texto)}`;

    const res = await fetch(url);
    const txs = await res.json();
    transaccionesCache = txs;
    
    const tbody = document.getElementById('tabla-movimientos-globales');
    tbody.innerHTML = '';

    if(txs.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="text-center py-10 text-gray-400">Sin movimientos.</td></tr>'; return; }

    txs.forEach(tx => {
        const monto = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(tx.monto);
        const fecha = moment(tx.fecha_transaccion).format('YYYY-MM-DD HH:mm');
        const esReversada = tx.estado === 'REVERSADO';
        
        const claseFila = esReversada ? 'bg-gray-100 text-gray-400' : 'hover:bg-gray-50';
        const claseMonto = esReversada ? 'line-through text-gray-400' : (['RETIRO', 'ABONO_CAJA', 'ABONO_TRASLADO'].includes(tx.tipo_operacion) ? 'text-green-600' : 'text-red-600');
        const estadoLabel = esReversada ? '<span class="ml-2 text-[10px] bg-gray-200 text-gray-500 px-1 rounded uppercase">REVERSADO</span>' : '';

        let detalle = `<span class="font-bold">${tx.tipo_operacion.replace(/_/g, ' ')}</span> ${estadoLabel}`;
        if(tx.referencia_externa) detalle += `<br><span class="text-xs opacity-75">ID: ${tx.referencia_externa}</span>`;

        const btnReversar = esReversada 
            ? `<button disabled class="text-gray-300 cursor-not-allowed"><i class="fas fa-ban"></i></button>`
            : `<button onclick="eliminarTransaccion(${tx.id}, ${tx.monto})" class="text-red-400 hover:text-red-600 transition" title="Reversar"><i class="fas fa-undo"></i></button>`;

        const tr = `
            <tr class="border-b border-gray-100 ${claseFila}">
                <td class="px-5 py-3 text-xs opacity-75 whitespace-nowrap">${fecha}</td>
                <td class="px-5 py-3">
                    <div class="text-sm font-bold ${esReversada ? 'text-gray-500' : 'text-gray-700'} whitespace-nowrap">${tx.nombre_completo}</div>
                    <div class="text-xs opacity-60">${tx.cedula}</div>
                </td>
                <td class="px-5 py-3 text-sm whitespace-nowrap">${detalle}</td>
                <td class="px-5 py-3 text-right font-mono font-bold ${claseMonto} whitespace-nowrap">
                    ${['RETIRO', 'ABONO_CAJA', 'ABONO_TRASLADO'].includes(tx.tipo_operacion) ? '+' : '-'} ${monto}
                </td>
                <td class="px-5 py-3 text-center whitespace-nowrap">
                    <div class="flex items-center justify-center gap-2">
                        <button onclick="abrirModalDetalle(${tx.id})" class="text-blue-500 hover:text-blue-700 transition"><i class="fas fa-eye"></i></button>
                        ${btnReversar}
                    </div>
                </td>
            </tr>`;
        tbody.innerHTML += tr;
    });
}

async function cargarUsuarios() {
    const res = await fetch(`${API_URL}/usuarios`);
    const usuarios = await res.json();
    usuariosCache = usuarios; // Guardamos en cache para usarlos al editar
    
    const tbody = document.getElementById('tabla-usuarios');
    tbody.innerHTML = '';

    usuarios.forEach(u => {
        const saldo = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(u.saldo_actual);
        
        // Estilos según estado
        const estadoClass = u.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
        const estadoTexto = u.activo ? 'ACTIVO' : 'INACTIVO';
        const opacidad = u.activo ? '' : 'opacity-60 bg-gray-50'; // Usuarios inactivos se ven un poco apagados

        const tr = `
            <tr class="border-b border-gray-200 hover:bg-gray-50 ${opacidad}">
                <td class="px-5 py-4 whitespace-nowrap">
                    <div class="font-medium">${u.nombre_completo}</div>
                    <span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${estadoClass}">${estadoTexto}</span>
                </td>
                <td class="px-5 py-4 text-gray-500 whitespace-nowrap">${u.cedula}</td>
                <td class="px-5 py-4 text-right font-bold text-blue-900 whitespace-nowrap">${saldo}</td>
                <td class="px-5 py-4 text-center whitespace-nowrap">
                    <div class="flex items-center justify-center gap-2">
                        <button onclick="verHistorialUsuario(${u.id}, '${u.nombre_completo}')" class="text-blue-500 hover:text-blue-700 bg-blue-50 p-2 rounded-full shadow-sm" title="Historial"><i class="fas fa-list"></i></button>
                        
                        <button onclick="editarUsuario(${u.id})" class="text-orange-500 hover:text-orange-700 bg-orange-50 p-2 rounded-full shadow-sm" title="Editar / Desactivar"><i class="fas fa-edit"></i></button>
                        
                        <button onclick="eliminarUsuario(${u.id})" class="text-red-500 hover:text-red-700 bg-red-50 p-2 rounded-full shadow-sm" title="Eliminar"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>`;
        tbody.innerHTML += tr;
    });
}

async function abrirModalUsuario() {
    const { value: formValues } = await Swal.fire({
        title: '<h2 class="text-2xl font-bold text-gray-800">Nuevo Usuario</h2>',
        // HTML Personalizado con diseño profesional
        html: `
            <div class="text-left space-y-4 pt-2">
                
                <div class="bg-blue-50 p-3 rounded-lg border border-blue-100 mb-2">
                    <p class="text-xs font-bold text-blue-800 uppercase mb-2 border-b border-blue-200 pb-1">
                        <i class="fas fa-id-card mr-1"></i> Datos Personales
                    </p>
                    
                    <div class="mb-3">
                        <label class="block text-xs font-bold text-gray-500 mb-1">Nombre Completo</label>
                        <div class="relative">
                            <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400"><i class="fas fa-user"></i></span>
                            <input id="swal-nombre" class="w-full pl-9 pr-3 py-2 rounded border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition" placeholder="Ej: Juan Pérez">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 mb-1">Cédula</label>
                            <input id="swal-cedula" type="number" class="w-full px-3 py-2 rounded border border-gray-300 focus:border-blue-500 outline-none transition" placeholder="123456789">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 mb-1">Contraseña</label>
                            <input id="swal-pass" type="password" class="w-full px-3 py-2 rounded border border-gray-300 focus:border-blue-500 outline-none transition" placeholder="******">
                        </div>
                    </div>
                </div>

                <div class="bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <p class="text-xs font-bold text-gray-600 uppercase mb-2 border-b border-gray-200 pb-1">
                        <i class="fas fa-wallet mr-1"></i> Configuración Cuenta
                    </p>
                    
                    <div class="grid grid-cols-2 gap-3 mb-3">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 mb-1">Saldo Inicial</label>
                            <div class="relative">
                                <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400 text-xs">$</span>
                                <input id="swal-saldo" type="number" class="w-full pl-6 pr-3 py-2 rounded border border-gray-300 focus:border-green-500 outline-none transition font-mono" placeholder="0">
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 mb-1">Rol</label>
                            <select id="swal-rol" class="w-full px-3 py-2 rounded border border-gray-300 focus:border-blue-500 outline-none bg-white">
                                <option value="cliente">Cliente</option>
                                <option value="admin">Administrador</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 mb-1">Permisos de Plataforma</label>
                        <select id="swal-permisos" class="w-full px-3 py-2 rounded border border-gray-300 focus:border-indigo-500 outline-none bg-white font-medium text-gray-700">
                            <option value="AMBOS">🟢 Acceso Total (Betplay + Kairo)</option>
                            <option value="BETPLAY">🔵 Solo Betplay</option>
                            <option value="KAIROPLAY">🟣 Solo Kairoplay</option>
                        </select>
                    </div>
                </div>
            </div>
        `,
        focusConfirm: false,
        confirmButtonText: '<i class="fas fa-save mr-2"></i> Crear Usuario',
        confirmButtonColor: '#1e3a8a', // Un azul oscuro elegante
        showCancelButton: true,
        cancelButtonText: 'Cancelar',
        customClass: {
            popup: 'rounded-2xl shadow-xl', // Bordes más redondeados para el modal
            confirmButton: 'px-6 py-2 rounded-lg',
            cancelButton: 'px-6 py-2 rounded-lg'
        },
        preConfirm: () => {
            // Validación básica antes de enviar
            const nombre = document.getElementById('swal-nombre').value;
            const cedula = document.getElementById('swal-cedula').value;
            const password = document.getElementById('swal-pass').value;

            if (!nombre || !cedula || !password) {
                Swal.showValidationMessage('Por favor completa los campos obligatorios');
                return false;
            }

            return {
                nombre: nombre,
                cedula: cedula,
                password: password,
                saldoInicial: document.getElementById('swal-saldo').value,
                rol: document.getElementById('swal-rol').value,
                permisos: document.getElementById('swal-permisos').value
            };
        }
    });

    if (formValues) {
        try {
            const res = await fetch(`${API_URL}/usuarios`, { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify(formValues) 
            });
            
            if(res.ok) { 
                Swal.fire({
                    title: '¡Usuario Creado!',
                    text: `${formValues.nombre} ha sido registrado exitosamente.`,
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                }); 
                cargarUsuarios(); 
            } else { 
                Swal.fire('Error', 'No se pudo crear el usuario.', 'error'); 
            }
        } catch (e) {
            Swal.fire('Error', 'Fallo de conexión', 'error');
        }
    }
}

async function eliminarUsuario(id) {
    const { value: password } = await Swal.fire({
        title: 'Eliminar Usuario',
        text: "Ingresa la Clave Maestra:",
        input: 'password',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Sí, eliminar',
        inputValidator: (value) => !value && '¡Escribe la clave!'
    });

    if (password) {
        const res = await fetch(`${API_URL}/usuarios/${id}`, { method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ masterKey: password }) });
        const data = await res.json();
        if (data.success) { Swal.fire('Eliminado', 'Usuario borrado.', 'success'); cargarUsuarios(); }
        else Swal.fire('Error', data.message, 'error');
    }
}

// --- 4. HISTORIAL DETALLADO ---
async function verHistorialUsuario(id, nombre) {
    usuarioActualId = id;
    document.getElementById('detalle-nombre-usuario').innerText = nombre;
    document.getElementById('hist-filtro-inicio').value = '';
    document.getElementById('hist-filtro-fin').value = '';
    cargarVista('detalle-usuario');
    filtrarHistorialDetalle();
}

async function filtrarHistorialDetalle() {
    if(!usuarioActualId) return;
    const inicio = document.getElementById('hist-filtro-inicio').value;
    const fin = document.getElementById('hist-filtro-fin').value;
    let url = `${API_URL}/usuario/${usuarioActualId}/historial`;
    if(inicio && fin) url += `?fechaInicio=${inicio}&fechaFin=${fin}`;

    const res = await fetch(url);
    const txs = await res.json();
    transaccionesCache = txs;
    
    const tbody = document.getElementById('tabla-detalle-historial');
    tbody.innerHTML = '';

    if(txs.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-400">Sin movimientos.</td></tr>'; return; }

    txs.forEach(tx => {
        const monto = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(tx.monto);
        
        let htmlComision = '';
        if (tx.comision > 0) {
            const comisionFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(tx.comision);
            htmlComision = `<div class="text-[10px] text-red-400 font-normal mt-1">(- ${comisionFmt} 3%)</div>`;
        }

        const fecha = moment(tx.fecha_transaccion).format('YYYY-MM-DD HH:mm');
        const esReversada = tx.estado === 'REVERSADO';
        
        const claseFila = esReversada ? 'bg-gray-100 text-gray-400' : 'hover:bg-gray-50';
        const claseTextoMonto = esReversada ? 'line-through text-gray-400' : 'text-gray-800';
        let detalle = tx.tipo_operacion.replace(/_/g, ' ');
        if(esReversada) detalle += ' (REVERSADO)';
        
        const btnReversar = esReversada
            ? `<span class="text-xs font-bold text-gray-400 border border-gray-300 px-2 py-1 rounded">ANULADO</span>`
            : `<button onclick="eliminarTransaccion(${tx.id}, ${tx.monto})" class="bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700 px-3 py-1 rounded text-xs font-bold transition"><i class="fas fa-undo"></i> Reversar</button>`;

        const tr = `
            <tr class="border-b border-gray-100 ${claseFila}">
                <td class="px-5 py-3 text-xs opacity-75 whitespace-nowrap">${fecha}</td>
                <td class="px-5 py-3 font-bold text-sm whitespace-nowrap">${detalle}</td>
                <td class="px-5 py-3 text-right font-mono ${claseTextoMonto} whitespace-nowrap">
                    ${monto}
                    ${esReversada ? '' : htmlComision}
                </td>
                <td class="px-5 py-3 text-xs opacity-75 whitespace-nowrap">Ref: ${tx.referencia_externa || tx.id}</td>
                <td class="px-5 py-3 text-center whitespace-nowrap">
                    <div class="flex items-center justify-center gap-2">
                        <button onclick="abrirModalDetalle(${tx.id})" class="text-blue-500 hover:text-blue-700 transition"><i class="fas fa-eye"></i></button>
                        ${btnReversar}
                    </div>
                </td>
            </tr>`;
        tbody.innerHTML += tr;
    });
}

// --- 5. REVERSAR ---
async function eliminarTransaccion(id) {
    const result = await Swal.fire({
        title: '¿Reversar?',
        text: "Se anulará el registro y se ajustará el saldo.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Sí, reversar'
    });

    if (result.isConfirmed) {
        const res = await fetch(`${API_URL}/transacciones/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            Swal.fire('Reversado', 'Operación anulada.', 'success');
            if(document.getElementById('vista-movimientos').classList.contains('hidden') === false) cargarMovimientosGlobales();
            else filtrarHistorialDetalle();
        } else Swal.fire('Error', 'No se pudo reversar', 'error');
    }
}

async function editarUsuario(id) {
    // Buscar usuario en cache para pre-llenar los datos
    const u = usuariosCache.find(user => user.id === id);
    if (!u) return;

    const { value: formValues } = await Swal.fire({
        title: '<h2 class="text-2xl font-bold text-gray-800">Editar Usuario</h2>',
        // HTML Estilizado (Igual que el de Crear, pero adaptado para Editar)
        html: `
            <div class="text-left space-y-4 pt-2">
                
                <div class="bg-blue-50 p-3 rounded-lg border border-blue-100">
                    <p class="text-xs font-bold text-blue-800 uppercase mb-2 border-b border-blue-200 pb-1">
                        <i class="fas fa-user-edit mr-1"></i> Datos Personales
                    </p>
                    
                    <div class="mb-3">
                        <label class="block text-xs font-bold text-gray-500 mb-1">Nombre Completo</label>
                        <input id="edit-nombre" class="w-full px-3 py-2 rounded border border-gray-300 focus:border-blue-500 outline-none transition" value="${u.nombre_completo}">
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 mb-1">Cédula</label>
                            <input id="edit-cedula" type="number" class="w-full px-3 py-2 rounded border border-gray-300 focus:border-blue-500 outline-none transition" value="${u.cedula}">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 mb-1">Contraseña</label>
                            <input id="edit-pass" type="password" class="w-full px-3 py-2 rounded border border-gray-300 focus:border-blue-500 outline-none transition" placeholder="Dejar vacío para mantener">
                            <p class="text-[9px] text-gray-400 mt-0.5">Solo escribe si deseas cambiarla</p>
                        </div>
                    </div>
                </div>

                <div class="bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <p class="text-xs font-bold text-gray-600 uppercase mb-2 border-b border-gray-200 pb-1">
                        <i class="fas fa-user-shield mr-1"></i> Accesos y Permisos
                    </p>
                    
                    <div class="grid grid-cols-2 gap-3 mb-3">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 mb-1">Rol</label>
                            <select id="edit-rol" class="w-full px-3 py-2 rounded border border-gray-300 focus:border-blue-500 outline-none bg-white">
                                <option value="cliente" ${u.rol === 'cliente' ? 'selected' : ''}>Cliente</option>
                                <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>Administrador</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 mb-1">Permisos Casino</label>
                            <select id="edit-permisos" class="w-full px-3 py-2 rounded border border-gray-300 focus:border-indigo-500 outline-none bg-white">
                                <option value="AMBOS" ${u.permisos_casino === 'AMBOS' ? 'selected' : ''}>🟢 Todos (Bet+Kairo)</option>
                                <option value="BETPLAY" ${u.permisos_casino === 'BETPLAY' ? 'selected' : ''}>🔵 Solo Betplay</option>
                                <option value="KAIROPLAY" ${u.permisos_casino === 'KAIROPLAY' ? 'selected' : ''}>🟣 Solo Kairoplay</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="p-3 rounded-lg border-2 ${u.activo ? 'border-green-100 bg-green-50' : 'border-red-100 bg-red-50'}">
                    <label class="block text-xs font-bold ${u.activo ? 'text-green-800' : 'text-red-800'} uppercase mb-1">
                        <i class="fas ${u.activo ? 'fa-check-circle' : 'fa-ban'} mr-1"></i> Estado de la cuenta
                    </label>
                    <select id="edit-activo" class="w-full px-3 py-2 rounded border ${u.activo ? 'border-green-300 text-green-900' : 'border-red-300 text-red-900'} outline-none font-bold bg-white">
                        <option value="true" ${u.activo ? 'selected' : ''}>✅ ACTIVO (Puede ingresar)</option>
                        <option value="false" ${!u.activo ? 'selected' : ''}>⛔ DESACTIVADO (Bloqueado)</option>
                    </select>
                    <p class="text-[10px] opacity-70 mt-1">
                        ${u.activo ? 'El usuario puede operar con normalidad.' : 'El usuario NO podrá iniciar sesión.'}
                    </p>
                </div>

            </div>
        `,
        focusConfirm: false,
        confirmButtonText: '<i class="fas fa-save mr-2"></i> Guardar Cambios',
        confirmButtonColor: '#ea580c', // Un naranja quemado (diferente al azul de crear para distinguir)
        showCancelButton: true,
        cancelButtonText: 'Cancelar',
        customClass: {
            popup: 'rounded-2xl shadow-xl',
            confirmButton: 'px-6 py-2 rounded-lg',
            cancelButton: 'px-6 py-2 rounded-lg'
        },
        preConfirm: () => {
            return {
                nombre: document.getElementById('edit-nombre').value,
                cedula: document.getElementById('edit-cedula').value,
                password: document.getElementById('edit-pass').value,
                rol: document.getElementById('edit-rol').value,
                permisos: document.getElementById('edit-permisos').value,
                activo: document.getElementById('edit-activo').value === 'true'
            };
        }
    });

    if (formValues) {
        try {
            const res = await fetch(`${API_URL}/usuarios/${id}`, { 
                method: 'PUT', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify(formValues) 
            });
            
            if(res.ok) { 
                Swal.fire({
                    title: '¡Actualizado!',
                    text: 'Los datos del usuario han sido guardados.',
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                }); 
                cargarUsuarios(); 
            } else { 
                Swal.fire('Error', 'No se pudo actualizar.', 'error'); //me
            }
        } catch (e) {
            Swal.fire('Error', 'Fallo de conexión', 'error');
        }
    }
}


if (vista === 'config') { cargarConfigWhatsapp(); cargarHorario(); }

async function cargarConfigWhatsapp() {
    try {
        const res = await fetch(`${API_URL}/../admin/config-whatsapp`); // Ajusta la ruta según tu API
        const data = await res.json();
        
        const setVal = (id, val) => { if(document.getElementById(id)) document.getElementById(id).value = val || ''; };
        
        setVal('conf-RETIRO', data.RETIRO);
        setVal('conf-RECARGA', data.RECARGA);
        setVal('conf-ABONO_CAJA', data.ABONO_CAJA);
        // Asignamos el mismo de abonos a los otros por simplicidad inicial
        setVal('conf-TRASLADO', data.TRASLADO || data.ABONO_CAJA);
        setVal('conf-CONSIGNACION', data.CONSIGNACION || data.ABONO_CAJA);
    } catch (e) { console.error(e); }
}

async function guardarConfigWhatsapp(e) {
    e.preventDefault();
    const numeros = {
        RETIRO: document.getElementById('conf-RETIRO').value,
        RECARGA: document.getElementById('conf-RECARGA').value,
        ABONO_CAJA: document.getElementById('conf-ABONO_CAJA').value,
        TRASLADO: document.getElementById('conf-ABONO_CAJA').value, // Reutilizamos
        CONSIGNACION: document.getElementById('conf-ABONO_CAJA').value // Reutilizamos
    };

    const res = await fetch(`${API_URL}/../admin/config-whatsapp`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ numeros })
    });
    
    if(res.ok) Swal.fire('Guardado', 'Números actualizados', 'success');
}

// --- 6. MODAL DETALLE ---
function abrirModalDetalle(id) {
    const tx = transaccionesCache.find(t => t.id === id);
    if (!tx) return;

    document.getElementById('modal-titulo').innerText = tx.tipo_operacion.replace(/_/g, ' ');
    document.getElementById('modal-id').innerText = `ID Interno: ${tx.id} | Ref: ${tx.referencia_externa || 'N/A'}`;
    document.getElementById('modal-monto').innerText = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(tx.monto);
    document.getElementById('modal-estado').innerText = tx.estado;
    document.getElementById('modal-fecha').innerText = moment(tx.fecha_transaccion).format('YYYY-MM-DD HH:mm:ss');
    
    const nombreCliente = tx.nombre_completo || document.getElementById('detalle-nombre-usuario')?.innerText || 'Desconocido';
    const cedulaCliente = tx.cedula || '---';
    document.getElementById('modal-cliente').innerText = nombreCliente;
    document.getElementById('modal-cedula').innerText = cedulaCliente;

    const estadoEl = document.getElementById('modal-estado');
    estadoEl.className = `px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
        tx.estado === 'APROBADO' ? 'bg-green-100 text-green-700' : 
        tx.estado === 'REVERSADO' ? 'bg-gray-200 text-gray-500' : 'bg-yellow-100 text-yellow-700'
    }`;

    const divDinamico = document.getElementById('modal-contenido-dinamico');
    let html = '';
    
    if(tx.comision > 0) {
        const comFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(tx.comision);
        const neto = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(tx.monto - tx.comision);
        html += `<div class="bg-red-50 p-2 rounded mb-2 border border-red-100">
                    <p class="text-xs text-red-500 font-bold">Resumen Financiero</p>
                    <div class="flex justify-between text-xs mt-1"><span>Monto Bruto:</span> <span>${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(tx.monto)}</span></div>
                    <div class="flex justify-between text-xs text-red-600 font-bold"><span>Comisión (3%):</span> <span>- ${comFmt}</span></div>
                    <div class="flex justify-between text-xs font-bold border-t border-red-200 mt-1 pt-1 text-gray-800"><span>Neto al Cliente:</span> <span>${neto}</span></div>
                 </div>`;
    }

    if (tx.tipo_operacion === 'RETIRO') html += `<p><strong>Casino:</strong> ${tx.cc_casino || 'N/A'}</p><p><strong>Nombre:</strong> ${tx.nombre_cedula || 'N/A'}</p><p><strong>PIN:</strong> ${tx.pin_retiro || 'N/A'}</p>`;
    else if (tx.tipo_operacion === 'CONSIGNACION') html += `<p><strong>Llave:</strong> ${tx.llave_bre_b || 'N/A'}</p><p><strong>Titular:</strong> ${tx.titular_cuenta || 'N/A'}</p>`;
    else if (tx.tipo_operacion === 'ABONO_CAJA') html += `<p class="text-gray-500 italic">Depósito bancario.</p>`;
    
    else if (tx.tipo_operacion === 'TRASLADO') {
        const usuarioDest = usuariosCache.find(u => u.id === tx.usuario_destino_id);
        const nombreDest = usuarioDest ? usuarioDest.nombre_completo : 'ID: ' + tx.usuario_destino_id;
        html += `<div class="mt-2 p-2 bg-gray-50 rounded border text-center">
                    <p class="text-xs text-gray-500 italic">Enviado a:</p>
                    <p class="font-bold text-gray-800">${nombreDest}</p>
                 </div>`;
    }
    else if (tx.tipo_operacion === 'ABONO_TRASLADO') {
        const usuarioOrigen = usuariosCache.find(u => u.id === tx.usuario_destino_id);
        const nombreOrigen = usuarioOrigen ? usuarioOrigen.nombre_completo : 'ID: ' + tx.usuario_destino_id;
        html += `<div class="mt-2 p-2 bg-green-50 rounded border border-green-100 text-center">
                    <p class="text-xs text-green-600 italic">Recibido de:</p>
                    <p class="font-bold text-green-900">${nombreOrigen}</p>
                 </div>`;
    }

    divDinamico.innerHTML = html;

    const imgContainer = document.getElementById('modal-comprobante-container');
    if (tx.comprobante_ruta) {
        imgContainer.classList.remove('hidden');
        let cleanPath = tx.comprobante_ruta.replace(/\\/g, '/');
        if (cleanPath.includes('uploads/')) cleanPath = '/uploads/' + cleanPath.split('uploads/')[1];
        const baseUrl = API_URL.replace('/api/admin', '');
        const fullUrl = cleanPath.startsWith('http') ? cleanPath : `${baseUrl}${cleanPath}`;
        document.getElementById('modal-comprobante-img').src = fullUrl;
        document.getElementById('modal-comprobante-img').className = "w-full h-auto max-h-[60vh] object-contain rounded-lg border bg-gray-50"; 
        document.getElementById('modal-comprobante-link').href = fullUrl;
    } else imgContainer.classList.add('hidden');

    document.getElementById('modal-detalle-tx').classList.remove('hidden');
}

async function cargarHorario() {
    try {
        const res = await fetch(`${API_URL}/../admin/config-horario`);
        const data = await res.json();
        if (data.hora_apertura) document.getElementById('conf-apertura').value = data.hora_apertura;
        if (data.hora_cierre) document.getElementById('conf-cierre').value = data.hora_cierre;
    } catch (e) { console.error(e); }
}

async function guardarHorario() {
    const apertura = document.getElementById('conf-apertura').value;
    const cierre = document.getElementById('conf-cierre').value;
    
    if(!apertura || !cierre) return Swal.fire('Error', 'Debes definir ambas horas', 'warning');

    const res = await fetch(`${API_URL}/../admin/config-horario`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ apertura, cierre })
    });
    
    if(res.ok) Swal.fire('Horario Actualizado', 'El sistema respetará el nuevo horario.', 'success');
}