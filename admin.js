(function() {
    // ⚠️ IMPORTANTE: Pon aquí la misma clave que tienes en tu archivo .env
    // En un sistema real esto vendría del login, pero para tu uso personal, esto funciona.
    const MASTER_KEY = 'Xk9mP2$vL5@nR8*qW4!zY7&bJ1^hC3'; 

    const originalFetch = window.fetch;
    window.fetch = function(url, config = {}) {
        // Solo inyectamos la clave si vamos a la zona de admin
        if (url.includes('/api/admin')) {
            config.headers = {
                ...config.headers, // Mantener headers existentes (como Content-Type)
                'x-master-key': MASTER_KEY
            };
        }
        return originalFetch(url, config);
    };
})();

const API_URL = 'https://dsc-avatar-outdoors-llp.trycloudflare.com/api/admin';
let usuarioActualId = null;
let transaccionesCache = []; 
let usuariosCache = []; 
let offsetMovimientos = 0;
let offsetHistorialUsuario = 0;
const LIMITE_CARGA = 50;

document.addEventListener('DOMContentLoaded', async () => { // <--- Nota el 'async' aquí
    const vistaGuardada = localStorage.getItem('admin_vista_actual') || 'dashboard';
    const hoy = moment().format('YYYY-MM-DD');
    
    // Inicializar inputs de fecha si existen
    const inputInicio = document.getElementById('dash-inicio');
    const inputFin = document.getElementById('dash-fin');
    if(inputInicio && inputFin) {
        inputInicio.value = hoy;
        inputFin.value = hoy;
    }

    // --- [SOLUCIÓN] ESPERAR A QUE CARGUEN LOS USUARIOS ANTES DE SEGUIR ---
    // Esto asegura que cuando entres a 'descuentos', la lista usuariosCache ya tenga datos.
    await cargarCacheUsuarios(); 
    // ---------------------------------------------------------------------

    // Lógica de recuperación de Historial (Tu arreglo anterior)
    if (vistaGuardada === 'detalle-usuario') {
        const idGuardado = localStorage.getItem('admin_detalle_id');
        const nombreGuardado = localStorage.getItem('admin_detalle_nombre');

        if (idGuardado && nombreGuardado) {
            usuarioActualId = idGuardado;
            const tituloNombre = document.getElementById('detalle-nombre-usuario');
            if(tituloNombre) tituloNombre.innerText = nombreGuardado;
            
            // Importante: No llamar a cargarVista aquí para evitar doble carga,
            // pero sí preparar la UI del detalle.
            document.querySelectorAll('.vista-seccion').forEach(v => v.classList.add('hidden'));
            const seccion = document.getElementById('vista-detalle-usuario');
            if (seccion) seccion.classList.remove('hidden');
            
            filtrarHistorialDetalle(true); 
            return; // Salimos para no ejecutar el cargarVista de abajo
        } else {
            // Si fallan los datos guardados, volvemos a una vista segura
            cargarVista('usuarios');
            return;
        }
    }

    // Carga normal para el resto de vistas
    cargarVista(vistaGuardada);
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
    if (vista === 'descuentos') {
        cargarUsuariosEnSelect(); // Función auxiliar para llenar el select
        cargarHistorialDescuentos();
        cargarHistorialPagosKairo();
    }
    if (vista === 'config') { cargarConfigWhatsapp(); cargarHorario(); cargarAjusteKairo();}
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

        if (data.betplay) {
            // Si no existe el elemento (por si acaso no has actualizado el HTML aún), validamos
            const elRecargas = document.getElementById('dash-ganancias-recargas');
            if (elRecargas) {
                // Usamos la variable que creamos en el servidor: comision_recargas
                elRecargas.innerText = fmt(data.betplay.comision_recargas || 0);
            }
        }

        const ops = data.desgloseOperaciones || {};
        // document.getElementById('dash-retiros').innerText = fmt(ops['RETIRO']);
        document.getElementById('dash-abonos').innerText = fmt(ops['ABONO_CAJA']);
        // document.getElementById('dash-recargas').innerText = fmt(ops['RECARGA']);
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

        if (data.betplay) {
            document.getElementById('betplay-retiros').innerText = fmt(data.betplay.retiros);
            document.getElementById('betplay-recargas').innerText = fmt(data.betplay.recargas);
            
            const saldoBet = document.getElementById('betplay-saldo');
            saldoBet.innerText = fmt(data.betplay.saldo);
            
            // Colores dinámicos para el saldo
            if (data.betplay.saldo < 0) {
                saldoBet.className = "text-2xl font-bold mt-1 text-red-600";
            } else {
                saldoBet.className = "text-2xl font-bold mt-1 text-blue-600";
            }
        }

    } catch (e) { console.error("Error cargando resumen:", e); }
}

// --- 2. MONITOR GLOBAL ---
async function cargarMovimientosGlobales(reset = true) {
    const btnCargar = document.getElementById('btn-cargar-mas');
    const msgFin = document.getElementById('msg-fin-datos');
    const tbody = document.getElementById('tabla-movimientos-globales');

    // 1. Si es reset (filtro nuevo o recarga inicial), reiniciamos todo
    if (reset) {
        offsetMovimientos = 0;
        tbody.innerHTML = ''; // Limpiamos la tabla
        btnCargar.innerText = "Cargar más transacciones";
        btnCargar.disabled = false;
        btnCargar.classList.add('hidden');
        msgFin.classList.add('hidden');
        transaccionesCache = []; // Limpiamos caché local
    } else {
        // Si estamos cargando más, cambiamos texto del botón
        btnCargar.innerText = "Cargando...";
        btnCargar.disabled = true;
    }

    const inicio = document.getElementById('global-filtro-inicio').value;
    const fin = document.getElementById('global-filtro-fin').value;
    const texto = document.getElementById('global-filtro-texto').value;

    // 2. Construimos URL con limit y offset
    let url = `${API_URL}/transacciones?limit=${LIMITE_CARGA}&offset=${offsetMovimientos}&_t=${Date.now()}`;
    if(inicio && fin) url += `&fechaInicio=${inicio}&fechaFin=${fin}`;
    if(texto) url += `&busqueda=${encodeURIComponent(texto)}`;

    try {
        const res = await fetch(url);
        const nuevosDatos = await res.json();
        
        // Agregamos al caché global (para que funcionen los modales)
        transaccionesCache = transaccionesCache.concat(nuevosDatos);

        if(nuevosDatos.length === 0 && reset) { 
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-10 text-gray-400">Sin movimientos.</td></tr>'; 
            return; 
        }

        // 3. Renderizamos las filas (append)
        nuevosDatos.forEach(tx => {
            const monto = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(tx.monto);
            const fecha = moment(tx.fecha_transaccion).format('YYYY-MM-DD HH:mm');
            const esReversada = tx.estado === 'REVERSADO';
            
            const claseFila = esReversada ? 'bg-gray-100 text-gray-400' : 'hover:bg-gray-50';
            const claseMonto = esReversada ? 'line-through text-gray-400' : (['RETIRO', 'ABONO_CAJA', 'ABONO_TRASLADO'].includes(tx.tipo_operacion) ? 'text-green-600' : 'text-red-600');
            const estadoLabel = esReversada ? '<span class="ml-2 text-[10px] bg-gray-200 text-gray-500 px-1 rounded uppercase">REVERSADO</span>' : '';

            let detalle = `<span class="font-bold">${tx.tipo_operacion.replace(/_/g, ' ')}</span> ${estadoLabel}`;
            if(tx.referencia_externa) detalle += `<br><span class="text-xs opacity-75">ID: ${tx.referencia_externa}</span>`;

            const btnReversar = esReversada 
            ? `<button disabled class="text-gray-300 cursor-not-allowed"><i class="fas fa-ban"></i></button>`
            : `<button onclick="editarMonto(${tx.id}, ${tx.monto})" class="text-yellow-500 hover:text-yellow-700 transition mx-2" title="Editar Valor"><i class="fas fa-pen"></i></button>
               <button onclick="eliminarTransaccion(${tx.id}, ${tx.monto})" class="text-red-400 hover:text-red-600 transition" title="Reversar"><i class="fas fa-undo"></i></button>`;
            
            const indicadorEdicion = tx.editado 
            ? `<span class="ml-1 text-orange-500" title="Monto ajustado manualmente"><i class="fas fa-pen-nib text-xs"></i></span>` 
            : '';

            const tr = `
            <tr class="border-b transition ${claseFila}">
                <td class="px-5 py-3 text-xs opacity-75 whitespace-nowrap">${fecha}</td>
                <td class="px-5 py-3">
                    <div class="text-sm font-bold ${esReversada ? 'text-gray-500' : 'text-gray-700'} whitespace-nowrap">${tx.nombre_completo}</div>
                    <div class="text-xs opacity-60">${tx.cedula}</div>
                </td>
                <td class="px-5 py-3 text-sm whitespace-nowrap">${detalle}</td>
                <td class="px-5 py-3 text-right font-mono font-bold ${claseMonto} whitespace-nowrap">
                    ${['RETIRO', 'ABONO_CAJA', 'ABONO_TRASLADO'].includes(tx.tipo_operacion) ? '+' : '-'} ${monto} ${indicadorEdicion}
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

        // 4. Lógica del botón "Cargar Más"
        offsetMovimientos += LIMITE_CARGA; // Aumentamos el contador para la próxima vez

        if (nuevosDatos.length < LIMITE_CARGA) {
            // Si trajimos menos de 50, significa que se acabaron los datos
            btnCargar.classList.add('hidden');
            if (!reset && transaccionesCache.length > 0) msgFin.classList.remove('hidden');
        } else {
            // Si trajimos 50 exactos, probablemente hay más
            btnCargar.classList.remove('hidden');
            btnCargar.innerText = "Cargar más transacciones";
            btnCargar.disabled = false;
            btnCargar.innerHTML = '<i class="fas fa-arrow-down mr-2"></i> Cargar más transacciones';
        }

    } catch (e) {
        console.error(e);
        btnCargar.innerText = "Error al cargar";
    }
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
                            <label class="block text-xs font-bold text-gray-500 mb-1">Cupo Sobregiro</label>
                            <div class="relative">
                                <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400 text-xs">$</span>
                                <input id="swal-sobregiro" type="number" class="w-full pl-6 pr-3 py-2 rounded border border-gray-300 focus:border-red-500 outline-none transition font-mono text-red-600" placeholder="0">
                            </div>
                            <p class="text-[9px] text-gray-400">Monto negativo permitido (Crédito)</p>
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
                permisos: document.getElementById('swal-permisos').value,
                sobregiro: document.getElementById('swal-sobregiro').value
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
    
    // --- ESTAS 2 LÍNEAS SON LA SOLUCIÓN ---
    localStorage.setItem('admin_detalle_id', id);
    localStorage.setItem('admin_detalle_nombre', nombre);
    // --------------------------------------

    document.getElementById('detalle-nombre-usuario').innerText = nombre;
    document.getElementById('hist-filtro-inicio').value = '';
    document.getElementById('hist-filtro-fin').value = '';
    
    cargarVista('detalle-usuario');
    filtrarHistorialDetalle(true);
}

async function filtrarHistorialDetalle(reset = true) {
    if(!usuarioActualId) return;

    const btnCargar = document.getElementById('btn-cargar-mas-hist');
    const msgFin = document.getElementById('msg-fin-hist');
    const tbody = document.getElementById('tabla-detalle-historial');

    // Configuración inicial según si es reset o carga incremental
    if (reset) {
        offsetHistorialUsuario = 0;
        tbody.innerHTML = '';
        btnCargar.classList.add('hidden');
        msgFin.classList.add('hidden');
        btnCargar.innerText = "Ver movimientos anteriores";
        btnCargar.disabled = false;
        // Limpiamos caché local si es necesario, o lo reiniciamos
        transaccionesCache = []; 
    } else {
        btnCargar.innerText = "Cargando...";
        btnCargar.disabled = true;
    }
    
    const inicio = document.getElementById('hist-filtro-inicio').value;
    const fin = document.getElementById('hist-filtro-fin').value;
    const LIMITE = 50;
    
    // URL con Limit y Offset
    let url = `${API_URL}/usuario/${usuarioActualId}/historial?limit=${LIMITE}&offset=${offsetHistorialUsuario}&_t=${Date.now()}`;
    if(inicio && fin) url += `&fechaInicio=${inicio}&fechaFin=${fin}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        
        // Concatenamos al caché para que los modales funcionen
        if (reset) {
            transaccionesCache = data.datos;
        } else {
            transaccionesCache = transaccionesCache.concat(data.datos);
        }
        
        const fmt = (v) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
        
        // --- PINTAR RESUMEN (Siempre se actualiza porque el server lo calcula global) ---
        // Esto es bueno porque si el cliente tenía filtro de fecha, el resumen debe cuadrar
        document.getElementById('hist-saldo-actual').innerText = fmt(data.saldoActual);
        document.getElementById('hist-entradas').innerText = fmt(data.resumen.entradas);
        document.getElementById('hist-salidas').innerText = fmt(data.resumen.salidas);
        
        const elNeto = document.getElementById('hist-neto');
        elNeto.innerText = (data.resumen.neto > 0 ? '+' : '') + fmt(data.resumen.neto);
        if(data.resumen.neto > 0) elNeto.className = "text-lg font-bold text-green-600 mt-1";
        else if(data.resumen.neto < 0) elNeto.className = "text-lg font-bold text-red-600 mt-1";
        else elNeto.className = "text-lg font-bold text-gray-400 mt-1";

        // --- PINTAR TABLA ---
        if(data.datos.length === 0 && reset) { 
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-10 text-gray-400 italic">No hay movimientos en este periodo.</td></tr>'; 
            return; 
        }

        data.datos.forEach(tx => {
            const monto = fmt(tx.monto);
            const fecha = moment(tx.fecha_transaccion).format('YYYY-MM-DD HH:mm');
            const esReversada = tx.estado === 'REVERSADO';
            
            const esIngreso = ['RETIRO', 'ABONO_CAJA', 'ABONO_TRASLADO'].includes(tx.tipo_operacion);
            const signo = esIngreso ? '+' : '-';
            const color = esReversada ? 'text-gray-400 line-through' : (esIngreso ? 'text-green-600' : 'text-red-600');

            let htmlComision = '';
            if (tx.comision > 0) htmlComision = `<div class="text-[10px] text-red-400 font-normal">(- ${fmt(tx.comision)} com)</div>`;

            const tr = `
                <tr class="border-b hover:bg-gray-50 transition">
                    <td class="px-4 py-3 text-xs text-gray-500">${fecha}</td>
                    <td class="px-4 py-3 text-sm font-bold text-gray-700">
                        ${tx.tipo_operacion.replace(/_/g, ' ')} ${esReversada ? '(REV)' : ''}
                    </td>
                    <td class="px-4 py-3 text-right font-mono font-bold ${color}">
                        ${signo} ${monto} ${tx.editado ? '<i class="fas fa-pen text-[10px] text-orange-400"></i>' : ''}
                        ${!esReversada ? htmlComision : ''}
                    </td>
                    <td class="px-4 py-3 text-xs text-gray-400">Ref: ${tx.referencia_externa || 'N/A'}</td>
                    <td class="px-4 py-3 text-center">
                        <button onclick="abrirModalDetalle(${tx.id})" class="text-blue-500 hover:text-blue-700"><i class="fas fa-eye"></i></button>
                        ${!esReversada ? `<button onclick="editarMonto(${tx.id}, ${tx.monto})" class="text-yellow-500 mx-2"><i class="fas fa-pen"></i></button><button onclick="eliminarTransaccion(${tx.id})" class="text-red-400"><i class="fas fa-undo"></i></button>` : ''}
                    </td>
                </tr>`;
            tbody.innerHTML += tr;
        });

        // --- LÓGICA DE PAGINACIÓN ---
        offsetHistorialUsuario += LIMITE; // Preparamos el salto para la siguiente
        
        if (data.datos.length < LIMITE) {
            // Ya no hay más datos (trajimos menos de 50)
            btnCargar.classList.add('hidden');
            if (!reset) msgFin.classList.remove('hidden'); // Solo mostramos "Fin" si ya habíamos cargado algo antes
        } else {
            // Posiblemente hay más
            btnCargar.classList.remove('hidden');
            btnCargar.disabled = false;
            btnCargar.innerHTML = '<i class="fas fa-arrow-down mr-2"></i> Ver movimientos anteriores';
        }

    } catch (e) { console.error(e); }
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
                    <div class="mt-3 bg-red-50 p-3 rounded-lg border border-red-100">
                        <p class="text-xs font-bold text-red-800 uppercase mb-2 border-b border-red-200 pb-1">
                            <i class="fas fa-hand-holding-usd mr-1"></i> Línea de Crédito
                        </p>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 mb-1">Límite de Sobregiro</label>
                            <div class="relative">
                                <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400 text-xs">$</span>
                                <input id="edit-sobregiro" type="number" class="w-full pl-6 pr-3 py-2 rounded border border-red-200 focus:border-red-500 outline-none transition font-mono text-red-700 font-bold" value="${u.limite_sobregiro || 0}">
                            </div>
                            <p class="text-[9px] text-gray-500 mt-1">El usuario podrá operar hasta tener saldo negativo de este valor.</p>
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
                activo: document.getElementById('edit-activo').value === 'true',
                sobregiro: document.getElementById('edit-sobregiro').value
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
// En admin.js

function abrirModalDetalle(id) {
    const tx = transaccionesCache.find(t => t.id === id);
    if (!tx) return;

    // Formateadores
    const fmtMoneda = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
    const fechaFmt = moment(tx.fecha_transaccion).format('YYYY-MM-DD HH:mm:ss');

    document.getElementById('modal-titulo').innerText = tx.tipo_operacion.replace(/_/g, ' ');
    document.getElementById('modal-id').innerText = `ID Interno: ${tx.id} | Ref: ${tx.referencia_externa || 'N/A'}`;
    document.getElementById('modal-monto').innerText = fmtMoneda.format(tx.monto);
    document.getElementById('modal-estado').innerText = tx.estado;
    document.getElementById('modal-fecha').innerText = fechaFmt;
    
    // Obtener datos del cliente (si no vienen en la TX, intentamos buscarlos en el DOM)
    const nombreCliente = tx.nombre_completo || document.getElementById('detalle-nombre-usuario')?.innerText || 'Desconocido';
    const cedulaCliente = tx.cedula || '---';
    document.getElementById('modal-cliente').innerText = nombreCliente;
    document.getElementById('modal-cedula').innerText = cedulaCliente;

    // Estilo del Estado
    const estadoEl = document.getElementById('modal-estado');
    estadoEl.className = `px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
        tx.estado === 'APROBADO' ? 'bg-green-100 text-green-700' : 
        tx.estado === 'REVERSADO' ? 'bg-gray-200 text-gray-500' : 'bg-yellow-100 text-yellow-700'
    }`;

    const divDinamico = document.getElementById('modal-contenido-dinamico');
    let html = '';
    
    // 1. RESUMEN FINANCIERO (Si hubo comisión)
    if(tx.comision > 0) {
        const comFmt = fmtMoneda.format(tx.comision);
        const neto = fmtMoneda.format(tx.monto - tx.comision);
        html += `<div class="bg-red-50 p-3 rounded mb-3 border border-red-100">
                    <p class="text-xs text-red-500 font-bold uppercase border-b border-red-200 pb-1 mb-1">Resumen Financiero</p>
                    <div class="flex justify-between text-xs mt-1"><span>Monto Bruto:</span> <span>${fmtMoneda.format(tx.monto)}</span></div>
                    <div class="flex justify-between text-xs text-red-600 font-bold"><span>Comisión (3%):</span> <span>- ${comFmt}</span></div>
                    <div class="flex justify-between text-xs font-bold border-t border-red-200 mt-1 pt-1 text-gray-800"><span>Neto al Cliente:</span> <span>${neto}</span></div>
                 </div>`;
    }

    // 2. DETALLE DE PLATAFORMA (Betplay vs Kairoplay)
    if (tx.tipo_operacion === 'RETIRO') {
        if (tx.cc_casino === 'KAIROPLAY') {
             html += `<div class="mt-2 mb-2">
                        <span class="bg-purple-100 text-purple-800 text-xs font-bold px-2 py-1 rounded border border-purple-200">KAIROPLAY</span>
                      </div>
                      <p class="text-sm"><strong>ID Transferencia:</strong> ${tx.pin_retiro || '---'}</p>`;
        } else {
             // Es Betplay (o antiguo sin etiqueta)
             html += `<div class="mt-2 mb-2">
                        <span class="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded border border-blue-200">BETPLAY</span>
                      </div>
                      <div class="text-sm space-y-1">
                        <p><strong>C.C en Casino:</strong> ${tx.cc_casino || 'N/A'}</p>
                        <p><strong>Titular:</strong> ${tx.nombre_cedula || 'N/A'}</p>
                        <p><strong>PIN:</strong> ${tx.pin_retiro || 'N/A'}</p>
                      </div>`;
        }
    }
    else if (tx.tipo_operacion === 'RECARGA') {
        if (tx.cc_casino === 'KAIROPLAY') {
             html += `<div class="mt-2 mb-2">
                        <span class="bg-purple-100 text-purple-800 text-xs font-bold px-2 py-1 rounded border border-purple-200">KAIROPLAY</span>
                      </div>
                      <p class="text-sm"><strong>ID Usuario Kairo:</strong> ${tx.pin_retiro || '---'}</p>`;
        } else {
             html += `<div class="mt-2 mb-2">
                        <span class="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded border border-blue-200">BETPLAY</span>
                      </div>
                      <p class="text-sm"><strong>Cédula a Recargar:</strong> ${tx.cedula_destino || tx.pin_retiro || 'N/A'}</p>`;
        }
    }
    else if (tx.tipo_operacion === 'DESCUENTO') {
        html += `<div class="bg-pink-50 p-4 rounded-lg border border-pink-100 text-center mt-2">
                    <div class="inline-block p-2 bg-pink-100 rounded-full text-pink-500 mb-2">
                        <i class="fas fa-file-invoice-dollar text-xl"></i>
                    </div>
                    <p class="text-xs text-pink-600 font-bold uppercase mb-1">Motivo del Cobro</p>
                    <p class="text-gray-800 font-bold text-lg leading-tight">"${tx.referencia_externa || 'Sin detalle'}"</p>
                    <p class="text-[10px] text-gray-400 mt-2">Este valor fue descontado del saldo del cliente.</p>
                 </div>`;
    }
    else if (tx.tipo_operacion === 'CONSIGNACION') {
        html += `<div class="text-sm bg-orange-50 p-2 rounded border border-orange-100">
                    <p><strong>Banco/Llave:</strong> ${tx.llave_bre_b || 'N/A'}</p>
                    <p><strong>Titular:</strong> ${tx.titular_cuenta || 'N/A'}</p>
                 </div>`;
    }
    else if (tx.tipo_operacion === 'ABONO_CAJA') {
        html += `<p class="text-gray-500 italic text-sm"><i class="fas fa-university mr-1"></i> Depósito Bancario / Caja</p>`;
    }
    
    // TRASLADOS ENTRE USUARIOS
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

    // 3. COMPROBANTE (Imagen)
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

// --- GESTIÓN DE DESCUENTOS ---

function cargarUsuariosEnSelect() {
    const select = document.getElementById('desc-usuario');
    select.innerHTML = '<option value="">Seleccione un usuario...</option>';
    
    // Usamos usuariosCache que ya cargaste al iniciar la app
    usuariosCache.forEach(u => {
        const saldo = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(u.saldo_actual);
        const option = document.createElement('option');
        option.value = u.id;
        option.innerHTML = `${u.nombre_completo} (Saldo: ${saldo})`;
        select.appendChild(option);
    });
}

async function procesarDescuento(e) {
    e.preventDefault();
    
    const usuarioId = document.getElementById('desc-usuario').value;
    const monto = document.getElementById('desc-monto').value;
    const motivo = document.getElementById('desc-motivo').value;

    if(!usuarioId || !monto || !motivo) return Swal.fire('Atención', 'Todos los campos son obligatorios', 'warning');

    const confirm = await Swal.fire({
        title: '¿Confirmar Descuento?',
        text: `Se descontarán $${monto} al cliente seleccionado.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#db2777', // Color rosa
        confirmButtonText: 'Sí, cobrar'
    });

    if (confirm.isConfirmed) {
        try {
            const res = await fetch(`${API_URL}/descuento`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ usuario_id: usuarioId, monto, motivo })
            });
            const data = await res.json();

            if (data.success) {
                Swal.fire('Éxito', 'Descuento aplicado correctamente', 'success');
                document.getElementById('form-descuento').reset();
                cargarHistorialDescuentos(); // Refrescar tabla pequeña
                cargarUsuarios(); // Refrescar cache de saldos
            } else {
                Swal.fire('Error', data.error || 'No se pudo aplicar', 'error');
            }
        } catch (error) {
            Swal.fire('Error', 'Fallo de conexión', 'error');
        }
    }
}

async function cargarHistorialDescuentos() {
    // 1. Obtener filtros
    const inicio = document.getElementById('desc-filtro-inicio').value;
    const fin = document.getElementById('desc-filtro-fin').value;
    const busqueda = document.getElementById('busqueda-descuentos').value;

    // 2. Construir URL con el nuevo parámetro 'tipo=DESCUENTO'
    let url = `${API_URL}/transacciones?tipo=DESCUENTO&_t=${Date.now()}`;
    if(inicio && fin) url += `&fechaInicio=${inicio}&fechaFin=${fin}`;
    if(busqueda) url += `&busqueda=${encodeURIComponent(busqueda)}`;

    try {
        const res = await fetch(url); 
        const descuentos = await res.json();
        
        const tbody = document.getElementById('tabla-descuentos-recent');
        tbody.innerHTML = '';

        if (descuentos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-gray-400 text-xs italic">No se encontraron cobros.</td></tr>';
            return;
        }

        descuentos.forEach(d => {
            const monto = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(d.monto);
            const fecha = moment(d.fecha_transaccion).format('DD/MM HH:mm');
            const esReversada = d.estado === 'REVERSADO';
            
            const tr = `
                <tr class="border-b hover:bg-pink-50 transition ${esReversada ? 'opacity-50 bg-gray-50' : ''}">
                    <td class="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">${fecha}</td>
                    <td class="px-3 py-2">
                        <div class="text-xs font-bold text-gray-700">${d.nombre_completo}</div>
                        <div class="text-[10px] text-gray-400 italic truncate max-w-[120px]" title="${d.referencia_externa}">${d.referencia_externa || 'Sin motivo'}</div>
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-xs font-bold text-pink-600 ${esReversada ? 'line-through' : ''}">${monto}</td>
                    <td class="px-3 py-2 text-center">
                        ${esReversada ? 
                            '<span class="text-[9px] bg-gray-200 px-1 rounded text-gray-500">REV</span>' : 
                            `<button onclick="eliminarTransaccion(${d.id})" class="text-red-300 hover:text-red-600 transition" title="Reversar"><i class="fas fa-undo"></i></button>`
                        }
                    </td>
                </tr>
            `;
            tbody.innerHTML += tr;
        });

    } catch (e) { console.error("Error cargando historial descuentos", e); }
}

function toggleAcordeon(panelId, iconId) {
    const panel = document.getElementById(panelId);
    const icon = document.getElementById(iconId);
    
    // Si está oculto, lo mostramos
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        icon.classList.add('rotate-180'); // Girar flecha
    } else {
        // Si está visible, lo ocultamos
        panel.classList.add('hidden');
        icon.classList.remove('rotate-180'); // Restaurar flecha
    }
}

// --- AJUSTE KAIRO ---
async function cargarAjusteKairo() {
    try {
        const res = await fetch(`${API_URL}/../admin/config-kairo`);
        const data = await res.json();
        if (document.getElementById('conf-kairo-valor')) {
            document.getElementById('conf-kairo-valor').value = data.valor;
        }
    } catch (e) { console.error(e); }
}

async function guardarAjusteKairo() {
    const valor = document.getElementById('conf-kairo-valor').value;
    if(valor === '') return;

    try {
        const res = await fetch(`${API_URL}/../admin/config-kairo`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ ajuste: valor })
        });

        if(res.ok) {
            Swal.fire({
                icon: 'success',
                title: 'Ajuste Guardado',
                text: 'El saldo neto de Kairoplay se ha recalibrado.',
                timer: 2000,
                showConfirmButton: false
            });
        }
    } catch (e) {
        Swal.fire('Error', 'No se pudo guardar', 'error');
    }
}

async function editarMonto(id, montoActual) {
    const { value: nuevoMonto } = await Swal.fire({
        title: 'Corregir Valor',
        text: `Monto actual: $${new Intl.NumberFormat('es-CO').format(montoActual)}`,
        input: 'number',
        inputValue: montoActual,
        inputLabel: 'Ingresa el valor real de la transacción:',
        showCancelButton: true,
        confirmButtonText: 'Actualizar',
        confirmButtonColor: '#eab308', // Amarillo
        inputValidator: (value) => {
            if (!value || value <= 0) return 'Debes escribir un monto válido';
        }
    });

    if (nuevoMonto && parseFloat(nuevoMonto) !== parseFloat(montoActual)) {
        try {
            const res = await fetch(`${API_URL}/transacciones/${id}/monto`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ nuevoMonto: nuevoMonto })
            });
            
            const data = await res.json();
            
            if (data.success) {
                Swal.fire('Actualizado', 'El saldo del cliente ha sido ajustado.', 'success');
                
                // Recargar la vista activa
                if(!document.getElementById('vista-movimientos').classList.contains('hidden')) {
                    cargarMovimientosGlobales();
                } else if(!document.getElementById('vista-detalle-usuario').classList.contains('hidden')) {
                    filtrarHistorialDetalle();
                } else if(!document.getElementById('vista-descuentos').classList.contains('hidden')) {
                    // Si tienes el historial de descuentos visible
                    cargarHistorialDescuentos();
                }
                
                // Actualizar cache de usuarios si es necesario
                cargarCacheUsuarios(); 
                
            } else {
                Swal.fire('Error', data.error || 'No se pudo actualizar', 'error');
            }
        } catch (e) {
            Swal.fire('Error', 'Fallo de conexión', 'error');
        }
    }
}

async function borrarBaseDatos() {
    // 1. Primera Advertencia
    const confirmacion1 = await Swal.fire({
        title: '¿ESTÁS SEGURO?',
        text: "Se borrarán todos los datos. No hay vuelta atrás.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, continuar',
        cancelButtonText: 'Cancelar'
    });

    if (!confirmacion1.isConfirmed) return;

    // 2. Solicitud de Clave Maestra
    const { value: password } = await Swal.fire({
        title: 'AUTORIZACIÓN REQUERIDA',
        text: "Escribe la Clave Maestra para confirmar el borrado:",
        input: 'password',
        icon: 'error', // Icono rojo
        inputPlaceholder: 'Clave Maestra',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'CONFIRMAR BORRADO',
        allowOutsideClick: false,
        inputValidator: (value) => {
            if (!value) return '¡Debes escribir la clave!';
        }
    });

    if (password) {
        // Mostrar cargando...
        Swal.fire({ title: 'Reseteando sistema...', allowOutsideClick: false, didOpen: () => { Swal.showLoading() } });

        try {
            const res = await fetch(`${API_URL}/../admin/reset-db`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ masterKey: password })
            });

            const data = await res.json();

            if (data.success) {
                await Swal.fire({
                    icon: 'success',
                    title: 'Sistema Reiniciado',
                    text: 'La base de datos ha quedado limpia.',
                    confirmButtonText: 'Recargar Sitio'
                });
                window.location.reload(); // Recargar para limpiar caché visual
            } else {
                Swal.fire('Error', data.error, 'error');
            }
        } catch (e) {
            Swal.fire('Error', 'No se pudo conectar con el servidor', 'error');
        }
    }
}

// --- GESTIÓN PAGOS EXTERNOS KAIRO ---

async function procesarPagoKairo(e) {
    e.preventDefault();
    
    const beneficiario = document.getElementById('kairo-beneficiario').value;
    const motivo = document.getElementById('kairo-motivo').value;
    const monto = document.getElementById('kairo-monto').value;

    if(!monto || !motivo) return Swal.fire('Error', 'Completa los campos', 'warning');

    const confirm = await Swal.fire({
        title: '¿Registrar Pago Kairo?',
        text: `Saldrán $${monto} del flujo neto para "${beneficiario}".`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#9333ea', // Morado
        confirmButtonText: 'Sí, registrar'
    });

    if (confirm.isConfirmed) {
        try {
            const res = await fetch(`${API_URL}/kairo-pagos`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ beneficiario, descripcion: motivo, monto })
            });
            const data = await res.json();

            if (data.success) {
                Swal.fire('Éxito', 'Pago registrado. El saldo Kairo ha disminuido.', 'success');
                // Limpiar form
                document.getElementById('kairo-beneficiario').value = '';
                document.getElementById('kairo-motivo').value = '';
                document.getElementById('kairo-monto').value = '';
                
                cargarHistorialPagosKairo(); // Refrescar tabla
            } else {
                Swal.fire('Error', data.error, 'error');
            }
        } catch (error) { console.error(error); }
    }
}

async function cargarHistorialPagosKairo() {
    // 1. Obtener valores de los filtros
    const inicio = document.getElementById('kairo-filtro-inicio').value;
    const fin = document.getElementById('kairo-filtro-fin').value;
    const texto = document.getElementById('kairo-filtro-texto').value;

    // 2. Construir URL con parámetros
    let url = `${API_URL}/kairo-pagos?_t=${Date.now()}`; // _t evita caché del navegador
    if(inicio && fin) url += `&inicio=${inicio}&fin=${fin}`;
    if(texto) url += `&busqueda=${encodeURIComponent(texto)}`;

    try {
        const res = await fetch(url);
        const pagos = await res.json();
        
        const tbody = document.getElementById('tabla-pagos-kairo');
        tbody.innerHTML = '';

        if (pagos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-gray-400 text-xs italic">No se encontraron pagos con estos filtros.</td></tr>';
            return;
        }

        pagos.forEach(p => {
            const monto = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(p.monto);
            const fecha = moment(p.fecha).format('DD/MM HH:mm');
            
            const tr = `
                <tr class="hover:bg-purple-50 transition group">
                    <td class="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">${fecha}</td>
                    <td class="px-3 py-2">
                        <div class="text-xs font-bold text-gray-700">${p.beneficiario || 'Externo'}</div>
                        <div class="text-[10px] text-gray-400 italic">${p.descripcion}</div>
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-xs font-bold text-red-500 whitespace-nowrap">- ${monto}</td>
                    <td class="px-3 py-2 text-center">
                        <button onclick="eliminarPagoKairo(${p.id})" class="text-gray-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100" title="Eliminar / Reversar">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </td>
                </tr>
            `;
            tbody.innerHTML += tr;
        });
    } catch (e) { console.error(e); }
}

async function eliminarPagoKairo(id) {
    const confirm = await Swal.fire({
        title: '¿Eliminar registro?',
        text: "El monto volverá a sumar al saldo de Kairo.",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Sí, eliminar'
    });

    if(confirm.isConfirmed) {
        try {
            const res = await fetch(`${API_URL}/kairo-pagos/${id}`, { method: 'DELETE' });
            if(res.ok) {
                Swal.fire('Eliminado', 'El pago fue anulado.', 'success');
                cargarHistorialPagosKairo();
            }
        } catch(e) { Swal.fire('Error', 'No se pudo eliminar', 'error'); }
    }
}
