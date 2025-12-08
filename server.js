const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3000;

// *** CONFIGURA AQUÍ TU CONTRASEÑA MAESTRA ***
const MASTER_KEY = 'Bancobet25'; 

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: function (req, file, cb) { cb(null, Date.now() + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });

app.use(cors({
    origin: '*' 
}));
app.use(express.json());
app.use(express.static('.')); 
app.use('/uploads', express.static('uploads'));

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'bancobet',
  password: '0534', // <--- ¡TU CONTRASEÑA!
  port: 5432,
});

// --- API LOGIN ---
app.post('/api/login', async (req, res) => {
    const { cedula, password } = req.body;
    try {
      const result = await pool.query('SELECT * FROM usuarios WHERE cedula = $1 AND password = $2', [cedula, password]);
      
      if (result.rows.length > 0) {
          const user = result.rows[0];
          
          // [NUEVO] Validar si está activo
          if (user.activo === false) {
              return res.status(403).json({ success: false, message: 'Tu cuenta ha sido desactivada. Contacta al soporte.' });
          }
  
          res.json({ success: true, usuario: user });
      } 
      else res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

app.get('/api/usuario/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nombre_completo, cedula, saldo_actual, rol FROM usuarios WHERE id = $1', [req.params.id]);
        if (result.rows.length > 0) res.json({ success: true, usuario: result.rows[0] });
        else res.status(404).json({ success: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// [NUEVO] OBTENER LISTA DE USUARIOS (PARA EL LISTBOX DE TRASLADO)
app.get('/api/lista-usuarios', async (req, res) => {
    try {
        // Solo enviamos ID y Nombre, nada de saldos ni contraseñas por seguridad
        const result = await pool.query("SELECT id, nombre_completo, cedula FROM usuarios WHERE rol = 'cliente' ORDER BY nombre_completo ASC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/historial/:usuarioId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM transacciones WHERE usuario_id = $1 ORDER BY fecha_transaccion DESC LIMIT 50', [req.params.usuarioId]);
        res.json({ success: true, datos: result.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/transaccion', upload.single('comprobante_archivo'), async (req, res) => {
    try {
        // --- VALIDACIÓN DE HORARIO (Igual que antes) ---
        const configRes = await pool.query("SELECT * FROM configuracion_global WHERE clave IN ('hora_apertura', 'hora_cierre')");
        const config = {};
        configRes.rows.forEach(row => { config[row.clave] = row.valor; });

        if (config.hora_apertura && config.hora_cierre) {
            const ahora = new Date().toLocaleString("en-US", {timeZone: "America/Bogota", hour12: false});
            const horaActual = new Date(ahora);
            const horaActualStr = horaActual.getHours().toString().padStart(2, '0') + ':' + horaActual.getMinutes().toString().padStart(2, '0');

            if (horaActualStr < config.hora_apertura || horaActualStr > config.hora_cierre) {
                return res.status(400).json({ 
                    success: false, 
                    error: `El sistema está cerrado. Horario de atención: ${config.hora_apertura} a ${config.hora_cierre}` 
                });
            }
        }
    } catch (e) { console.error("Error validando horario", e); }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const data = req.body;
        const file = req.file;

        // [CORRECCIÓN DEL ERROR] 
        // Aquí definimos la variable que la base de datos está pidiendo a gritos.
        // Forzamos las barras normales '/' para que Windows no moleste.
        const comprobantePath = file ? `/uploads/${file.filename}` : null;
        
        const montoBruto = parseFloat(data.monto);
        
        // --- LÓGICA DE TRANSACCIONES ---
        if (data.tipo_operacion === 'TRASLADO') {
            const idRemitente = data.usuario_id;
            const idDestinatario = data.usuario_destino_id;

            if (!idDestinatario) throw new Error("Debes seleccionar un destinatario");
            if (idRemitente == idDestinatario) throw new Error("No puedes enviarte dinero a ti mismo");

            const saldoRes = await client.query('SELECT saldo_actual, nombre_completo FROM usuarios WHERE id = $1', [idRemitente]);
            if (saldoRes.rows[0].saldo_actual < montoBruto) throw new Error("Saldo insuficiente");

            await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual - $1 WHERE id = $2`, [montoBruto, idRemitente]);
            await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [montoBruto, idDestinatario]);

            await client.query(
                `INSERT INTO transacciones (usuario_id, tipo_operacion, monto, estado, usuario_destino_id, referencia_externa) 
                 VALUES ($1, 'TRASLADO', $2, 'APROBADO', $3, $4)`,
                [idRemitente, montoBruto, idDestinatario, data.id_transaccion]
            );

            await client.query(
                `INSERT INTO transacciones (usuario_id, tipo_operacion, monto, estado, usuario_destino_id, referencia_externa) 
                 VALUES ($1, 'ABONO_TRASLADO', $2, 'APROBADO', $3, $4)`,
                [idDestinatario, montoBruto, idRemitente, data.id_transaccion + '-RX']
            );

        } else {
            // OPERACIONES NORMALES (RETIROS, RECARGAS, ABONOS)
            let operacion = "";
            let comision = 0; // Por defecto 0
            
            // 1. Calcular Comisión (Solo para Betplay)
            if (data.tipo_operacion === 'RETIRO') {
                if (data.cc_casino === 'KAIROPLAY') { 
                    comision = 0; // Kairo no cobra comisión
                } else { 
                    comision = montoBruto * 0.03; // Betplay sí
                }
            }

            // El monto neto es lo que realmente afecta el saldo del cliente
            const montoNeto = montoBruto - comision;

            // 2. Determinar signo de la operación
            if (data.tipo_operacion === 'RETIRO' || data.tipo_operacion === 'ABONO_CAJA') {
                operacion = "+"; // Ingresa dinero al cliente
            } else {
                // Es una salida (RECARGA, CONSIGNACIÓN, ETC)
                operacion = "-"; // Sale dinero del cliente
                
                // Validamos saldo SIEMPRE (Sea Kairo o Betplay, el cliente debe tener plata)
                const saldoRes = await client.query('SELECT saldo_actual FROM usuarios WHERE id = $1', [data.usuario_id]);
                if (saldoRes.rows[0].saldo_actual < montoBruto) throw new Error("Saldo insuficiente");
            }

            // 3. EJECUTAR EL CAMBIO DE SALDO (Afecta al cliente en su panel)
            await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual ${operacion} $1 WHERE id = $2`, [montoNeto, data.usuario_id]);

            // 4. Insertar transacción
            await client.query(
                `INSERT INTO transacciones (usuario_id, tipo_operacion, monto, comision, estado, cc_casino, nombre_cedula, pin_retiro, cedula_destino, llave_bre_b, titular_cuenta, comprobante_ruta, referencia_externa) 
                 VALUES ($1, $2, $3, $4, 'APROBADO', $5, $6, $7, $8, $9, $10, $11, $12)`,
                [data.usuario_id, data.tipo_operacion, montoBruto, comision, data.cc_casino||null, data.nombre_cedula||null, data.pin_retiro||null, data.cedula_recarga||null, data.llave_bre_b||null, data.titular_cuenta||null, comprobantePath, data.id_transaccion]
            );
        }

        await client.query('COMMIT');
        
        // --- PREPARAR RESPUESTA PARA WHATSAPP ---
        const configRes = await pool.query('SELECT numero_telefono FROM configuracion_whatsapp WHERE tipo_operacion = $1', [data.tipo_operacion]);
        const numeroWhatsapp = configRes.rows.length > 0 ? configRes.rows[0].numero_telefono : null;

        // URL para el cliente (Aquí manejamos el localhost vs producción)
        let urlWeb = null;
        if (file) {
            // Usamos req.protocol y host para armar http://localhost:3000/uploads/foto.jpg
            // Esto arregla el problema de "C:\Users..."
            urlWeb = `${req.protocol}://${req.get('host')}/uploads/${file.filename}`;
        }

        res.json({ 
            success: true, 
            message: "Operación exitosa", 
            whatsapp_destino: numeroWhatsapp,
            comprobante_url: urlWeb // Esta variable va al frontend (app.js)
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err); // Ver el error en la consola del servidor
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

app.get('/api/admin/resumen', async (req, res) => {
    try {
        const { fechaInicio, fechaFin } = req.query;
        let filtroFecha = "";
        const params = [];
        if (fechaInicio && fechaFin) {
            filtroFecha = " AND fecha_transaccion::date BETWEEN $1 AND $2";
            params.push(fechaInicio, fechaFin);
        }
        const ajusteRes = await pool.query("SELECT valor FROM configuracion_global WHERE clave = 'kairo_ajuste_saldo'");
        const ajusteKairo = parseFloat(ajusteRes.rows.length > 0 ? ajusteRes.rows[0].valor : 0);
        const saldoRealRes = await pool.query("SELECT SUM(saldo_actual) as total FROM usuarios WHERE rol = 'cliente'");
        let totalBancoReal = parseFloat(saldoRealRes.rows[0].total || 0);

        const comisiones = await pool.query(
            `SELECT SUM(comision) as total FROM transacciones WHERE estado = 'APROBADO' ${filtroFecha}`, 
            params
        );

        const operaciones = await pool.query(`
            SELECT tipo_operacion, SUM(monto) as total 
            FROM transacciones 
            WHERE estado = 'APROBADO'
            ${filtroFecha}
            AND (cc_casino IS NULL OR cc_casino != 'KAIROPLAY')
            GROUP BY tipo_operacion
        `, params);

        const desglose = {};
        operaciones.rows.forEach(op => { desglose[op.tipo_operacion] = op.total || 0; });

        const kairoStats = await pool.query(`
            SELECT tipo_operacion, SUM(monto) as total
            FROM transacciones
            WHERE estado = 'APROBADO' AND cc_casino = 'KAIROPLAY'${filtroFecha}
            GROUP BY tipo_operacion
        `, params);

        let kRetiros = 0; let kRecargas = 0;
        kairoStats.rows.forEach(row => {
            if (row.tipo_operacion === 'RETIRO') kRetiros = parseFloat(row.total);
            if (row.tipo_operacion === 'RECARGA') kRecargas = parseFloat(row.total);
        });

        // --- CÁLCULO 5: RESUMEN BETPLAY ---
        const betplayStats = await pool.query(`
            SELECT 
                tipo_operacion, 
                SUM(monto) as total_bruto,
                SUM(comision) as total_comision
            FROM transacciones
            WHERE estado = 'APROBADO' 
            AND (cc_casino != 'KAIROPLAY' OR cc_casino IS NULL)
            ${filtroFecha}
            GROUP BY tipo_operacion
        `, params);

        let bRetiros = 0; let bRecargas = 0;
        betplayStats.rows.forEach(row => {
            if (row.tipo_operacion === 'RETIRO') bRetiros = parseFloat(row.total_bruto) - parseFloat(row.total_comision);
            if (row.tipo_operacion === 'RECARGA') bRecargas = parseFloat(row.total_bruto);
        });
        
        const numUsuarios = await pool.query("SELECT COUNT(*) as total FROM usuarios WHERE rol = 'cliente'");

        res.json({
            success: true,
            totalBanco: totalBancoReal, 
            totalUsuarios: numUsuarios.rows[0].total || 0,
            totalGanancias: comisiones.rows[0].total || 0,
            desgloseOperaciones: desglose,
            
            // KAIROPLAY MODIFICADO
            kairo: {
                // [CAMBIO] Quitamos el '* -1'. Ahora se muestra positivo.
                // Ejemplo: Si retiraste 200.000, se ve "200.000".
                retiros: kRetiros, 
                
                recargas: kRecargas, 
                
                // La lógica matemática se MANTIENE (Recargas - Retiros)
                // Ejemplo: 500.000 (Recarga) - 200.000 (Retiro) = 300.000 (Neto)
                saldo: (kRecargas - kRetiros) + ajusteKairo
            },
            
            betplay: {
                retiros: bRetiros,
                recargas: bRecargas,
                saldo: bRetiros - bRecargas
            }
        });

    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/usuarios', async (req, res) => {
    const result = await pool.query('SELECT * FROM usuarios ORDER BY id ASC');
    res.json(result.rows);
});

// [NUEVO] OBTENER HORARIO (Para el Admin)
app.get('/api/admin/config-horario', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM configuracion_global WHERE clave IN ('hora_apertura', 'hora_cierre')");
        const config = {};
        result.rows.forEach(row => { config[row.clave] = row.valor; });
        res.json(config);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// [NUEVO] GUARDAR HORARIO (Para el Admin)
app.post('/api/admin/config-horario', async (req, res) => {
    const { apertura, cierre } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Actualizamos o insertamos (Upsert manual simple)
        await client.query("INSERT INTO configuracion_global (clave, valor) VALUES ('hora_apertura', $1) ON CONFLICT (clave) DO UPDATE SET valor = $1", [apertura]);
        await client.query("INSERT INTO configuracion_global (clave, valor) VALUES ('hora_cierre', $1) ON CONFLICT (clave) DO UPDATE SET valor = $1", [cierre]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ error: err.message }); 
    } finally { client.release(); }
});

app.post('/api/admin/usuarios', async (req, res) => {
    // Recibimos el campo 'permisos'
    const { nombre, cedula, password, saldoInicial, rol, permisos } = req.body;
    
    try {
        // [MODIFICADO] Agregamos permisos_casino al INSERT
        // Si no envían permiso, por defecto ponemos 'AMBOS'
        const permisoFinal = permisos || 'AMBOS';
        
        await pool.query(
            'INSERT INTO usuarios (nombre_completo, cedula, password, saldo_actual, rol, permisos_casino) VALUES ($1, $2, $3, $4, $5, $6)', 
            [nombre, cedula, password, saldoInicial || 0, rol || 'cliente', permisoFinal]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/usuarios/:id', async (req, res) => {
    const { masterKey } = req.body;
    if (masterKey !== 'Bancobet25') return res.status(403).json({ success: false, message: 'Clave Maestra Incorrecta' });

    try {
        const id = req.params.id;
        
        // 1. Verificar si tiene transacciones
        const check = await pool.query('SELECT COUNT(*) as total FROM transacciones WHERE usuario_id = $1 OR usuario_destino_id = $1', [id]);
        
        if (parseInt(check.rows[0].total) > 0) {
            // TIENE HISTORIAL: No dejamos borrar, sugerimos desactivar.
            return res.status(400).json({ 
                success: false, 
                message: 'No se puede eliminar: El usuario tiene historial financiero. Por favor, DESACTÍVALO en editar.' 
            });
        }

        // 2. Si está limpio (0 transacciones), procedemos a borrar.
        await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
        res.json({ success: true });

    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/usuario/:id/historial', async (req, res) => {
    const { id } = req.params; const { fechaInicio, fechaFin } = req.query;
    let query = `SELECT * FROM transacciones WHERE usuario_id = $1`; const params = [id];
    if (fechaInicio && fechaFin) { query += ` AND fecha_transaccion BETWEEN $2 AND $3`; params.push(fechaInicio, fechaFin); }
    query += ` ORDER BY fecha_transaccion DESC`;
    try { const result = await pool.query(query, params); res.json(result.rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/transacciones', async (req, res) => {
    const { fechaInicio, fechaFin, busqueda } = req.query;
    let query = `SELECT t.*, u.nombre_completo, u.cedula FROM transacciones t JOIN usuarios u ON t.usuario_id = u.id WHERE 1=1`;
    const params = []; let paramCount = 1;
    if (fechaInicio && fechaFin) { query += ` AND t.fecha_transaccion BETWEEN $${paramCount} AND $${paramCount + 1}`; params.push(fechaInicio, fechaFin); paramCount += 2; }
    if (busqueda) { query += ` AND (u.nombre_completo ILIKE $${paramCount} OR u.cedula ILIKE $${paramCount} OR t.referencia_externa ILIKE $${paramCount} OR CAST(t.id AS TEXT) = $${paramCount})`; params.push(`%${busqueda}%`); paramCount++; }
    query += ` ORDER BY t.fecha_transaccion DESC LIMIT 100`;
    try { const result = await pool.query(query, params); res.json(result.rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/transacciones/:id', async (req, res) => {
    const { id } = req.params; 
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. Obtener la transacción original
        const txRes = await client.query('SELECT * FROM transacciones WHERE id = $1', [id]);
        if (txRes.rows.length === 0) throw new Error("Transacción no encontrada");
        
        const tx = txRes.rows[0]; 
        if (tx.estado === 'REVERSADO') throw new Error("Esta transacción ya fue reversada anteriormente");
        
        // [CORRECCIÓN CRÍTICA] 
        // Calculamos el Neto: (Monto Original - Comisión). 
        // Ejemplo: 100.000 - 3.000 = 97.000. Esto es lo que vamos a devolver/quitar.
        const montoImpacto = parseFloat(tx.monto) - parseFloat(tx.comision || 0);
        
        let referenciaPareja = null; 

        // --- LÓGICA DE REVERSO ---
        
        if (tx.tipo_operacion === 'TRASLADO') {
            // Remitente: Se le devuelve el dinero
            await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [montoImpacto, tx.usuario_id]);
            // Destinatario: Se le quita el dinero
            if (tx.usuario_destino_id) {
                await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual - $1 WHERE id = $2`, [montoImpacto, tx.usuario_destino_id]);
            }
            referenciaPareja = tx.referencia_externa + '-RX';
        } 
        else if (tx.tipo_operacion === 'ABONO_TRASLADO') {
             // Receptor: Se le quita el dinero
             await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual - $1 WHERE id = $2`, [montoImpacto, tx.usuario_id]);
             // Remitente (guardado en usuario_destino_id): Se le devuelve
             if (tx.usuario_destino_id) {
                await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [montoImpacto, tx.usuario_destino_id]);
             }
             referenciaPareja = tx.referencia_externa.replace('-RX', '');
        }
        else if (tx.tipo_operacion === 'DESCUENTO') {
            // Si fue un descuento, le quitamos dinero. Para reversar, SE LO DEVOLVEMOS.
            await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [montoImpacto, tx.usuario_id]);
        }
        else {
            // Operaciones normales (Retiro, Recarga, etc.)
            let operacionReversa = "";
            // Si fue un ingreso (+), ahora restamos (-)
            if (['RETIRO', 'ABONO_CAJA'].includes(tx.tipo_operacion)) {
                operacionReversa = "-"; 
            } else {
                // Si fue salida (-), ahora sumamos (+)
                operacionReversa = "+"; 
            }
            
            // Aquí usamos montoImpacto (el neto). 
            // Si era un Retiro de 100k con 3k comision, entraron 97k. Ahora restamos 97k.
            // El saldo vuelve a quedar exactamente como estaba antes de la operación.
            await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual ${operacionReversa} $1 WHERE id = $2`, [montoImpacto, tx.usuario_id]);
        }

        // --- LIMPIEZA ---
        if (tx.comprobante_ruta) {
            try {
                const rutaRelativa = tx.comprobante_ruta.startsWith('/') ? tx.comprobante_ruta.substring(1) : tx.comprobante_ruta;
                const rutaAbsoluta = path.join(__dirname, rutaRelativa);
                if (fs.existsSync(rutaAbsoluta)) fs.unlinkSync(rutaAbsoluta);
            } catch (errArchivo) {}
        }

        // --- ACTUALIZACIÓN DE ESTADO ---
        await client.query("UPDATE transacciones SET estado = 'REVERSADO', comprobante_ruta = NULL WHERE id = $1", [id]);

        if (referenciaPareja) {
            await client.query(
                "UPDATE transacciones SET estado = 'REVERSADO' WHERE referencia_externa = $1 AND (tipo_operacion = 'TRASLADO' OR tipo_operacion = 'ABONO_TRASLADO')", 
                [referenciaPareja]
            );
        }

        await client.query('COMMIT'); 
        res.json({ success: true });

    } catch (e) { 
        await client.query('ROLLBACK'); 
        console.error(e); // Importante para ver errores en consola
        res.status(500).json({ success: false, error: e.message }); 
    } finally { 
        client.release(); 
    }
});

// [NUEVO] EDITAR USUARIO (Sirve para activar/desactivar y cambiar datos)
app.put('/api/admin/usuarios/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, cedula, password, rol, permisos, activo } = req.body;
    
    try {
        // Construimos la query dinámicamente para no obligar a cambiar el password siempre
        let query = `UPDATE usuarios SET nombre_completo = $1, cedula = $2, rol = $3, permisos_casino = $4, activo = $5`;
        const params = [nombre, cedula, rol, permisos || 'AMBOS', activo];
        
        if (password && password.trim() !== '') {
            query += `, password = $6`;
            params.push(password);
        }
        
        query += ` WHERE id = $${params.length + 1}`;
        params.push(id); // El ID va al final de los parámetros

        await pool.query(query, params);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// [NUEVO] OBTENER CONFIGURACIÓN WHATSAPP (Para el Admin)
app.get('/api/admin/config-whatsapp', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM configuracion_whatsapp');
        // Convertimos el array a un objeto simple { RETIRO: '...', RECARGA: '...' }
        const config = {};
        result.rows.forEach(row => { config[row.tipo_operacion] = row.numero_telefono; });
        res.json(config);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// [NUEVO] ACTUALIZAR CONFIGURACIÓN WHATSAPP (Para el Admin)
app.post('/api/admin/config-whatsapp', async (req, res) => {
    const { numeros } = req.body; // Esperamos objeto { RETIRO: '57...', ... }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const [tipo, numero] of Object.entries(numeros)) {
            await client.query(
                'INSERT INTO configuracion_whatsapp (tipo_operacion, numero_telefono) VALUES ($1, $2) ON CONFLICT (tipo_operacion) DO UPDATE SET numero_telefono = $2',
                [tipo, numero]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ error: err.message }); 
    } finally { client.release(); }
});

app.post('/api/admin/descuento', async (req, res) => {
    const { usuario_id, monto, motivo } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const montoFloat = parseFloat(monto);

        // 1. Validar saldo
        const userRes = await client.query('SELECT saldo_actual FROM usuarios WHERE id = $1', [usuario_id]);
        if (userRes.rows.length === 0) throw new Error('Usuario no encontrado');
        
        // Opcional: Si permites saldo negativo, quita este if
        if (userRes.rows[0].saldo_actual < montoFloat) {
            throw new Error('El usuario no tiene saldo suficiente para este descuento.');
        }

        // 2. Restar saldo al usuario
        await client.query('UPDATE usuarios SET saldo_actual = saldo_actual - $1 WHERE id = $2', [montoFloat, usuario_id]);

        // 3. Registrar transacción
        // Usamos 'referencia_externa' para guardar el motivo del descuento
        const idTx = `DESC-${Date.now()}`;
        await client.query(
            `INSERT INTO transacciones (usuario_id, tipo_operacion, monto, estado, referencia_externa) 
             VALUES ($1, 'DESCUENTO', $2, 'APROBADO', $3)`,
            [usuario_id, montoFloat, motivo || 'Cobro Administrativo']
        );

        await client.query('COMMIT');
        res.json({ success: true, message: 'Descuento aplicado con éxito' });

    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Obtener el ajuste actual
app.get('/api/admin/config-kairo', async (req, res) => {
    try {
        const result = await pool.query("SELECT valor FROM configuracion_global WHERE clave = 'kairo_ajuste_saldo'");
        res.json({ valor: result.rows.length > 0 ? result.rows[0].valor : 0 });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Guardar el ajuste
app.post('/api/admin/config-kairo', async (req, res) => {
    const { ajuste } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Guardamos el valor (puede ser positivo o negativo)
        await client.query(
            "INSERT INTO configuracion_global (clave, valor) VALUES ('kairo_ajuste_saldo', $1) ON CONFLICT (clave) DO UPDATE SET valor = $1", 
            [ajuste]
        );
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ error: err.message }); 
    } finally { client.release(); }
});

// --- NUEVO ENDPOINT: EDITAR MONTO TRANSACCIÓN ---
app.put('/api/admin/transacciones/:id/monto', async (req, res) => {
    const { id } = req.params;
    const { nuevoMonto } = req.body;
    
    if(!nuevoMonto || nuevoMonto <= 0) return res.status(400).json({ error: "Monto inválido" });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Obtener la transacción original
        const txRes = await client.query('SELECT * FROM transacciones WHERE id = $1', [id]);
        if (txRes.rows.length === 0) throw new Error("Transacción no encontrada");
        
        const tx = txRes.rows[0];
        if (tx.estado === 'REVERSADO') throw new Error("No se puede editar una transacción reversada");

        const montoViejo = parseFloat(tx.monto);
        const montoNuevo = parseFloat(nuevoMonto);
        
        // 2. Calcular Nueva Comisión (Solo si la original tenía comisión)
        // Esto mantiene la regla del 3% para Betplay si cambias el valor
        let nuevaComision = 0;
        if (parseFloat(tx.comision) > 0) {
            nuevaComision = montoNuevo * 0.03;
        }

        const impactoViejo = montoViejo - parseFloat(tx.comision);
        const impactoNuevo = montoNuevo - nuevaComision;

        // 3. Ajustar el Saldo del Usuario
        // Primero REVERTIMOS el efecto viejo, luego APLICAMOS el nuevo.
        
        let operacion = ""; 
        // Identificar si la operación original SUMABA (+) o RESTABA (-) saldo
        if (['RETIRO', 'ABONO_CAJA', 'ABONO_TRASLADO'].includes(tx.tipo_operacion)) {
            // Originalmente SUMÓ. Para corregir: Restamos lo viejo, Sumamos lo nuevo.
            // Matemáticamente: Saldo = Saldo - Viejo + Nuevo
            await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual - $1 + $2 WHERE id = $3`, [impactoViejo, impactoNuevo, tx.usuario_id]);
        } else {
            // Originalmente RESTÓ (Recargas, Traslados, Consignaciones, Descuentos). 
            // Para corregir: Sumamos lo viejo, Restamos lo nuevo.
            // Matemáticamente: Saldo = Saldo + Viejo - Nuevo
            await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual + $1 - $2 WHERE id = $3`, [impactoViejo, impactoNuevo, tx.usuario_id]);
        }

        // 4. Actualizar la Transacción
        await client.query(
            `UPDATE transacciones SET monto = $1, comision = $2, editado = true WHERE id = $3`,
            [montoNuevo, nuevaComision, id]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: "Monto actualizado correctamente" });

    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// --- ZONA DE PELIGRO: FACTORY RESET ---
app.post('/api/admin/reset-db', async (req, res) => {
    const { masterKey } = req.body;
    
    // 1. Verificación de Seguridad
    if (masterKey !== 'Bancobet25') { // O usa la variable MASTER_KEY si la tienes definida arriba
        return res.status(403).json({ error: "Clave Maestra Incorrecta. Acceso denegado." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 2. Borrar TODO el historial de transacciones (Reinicia contadores de ID)
        await client.query('TRUNCATE TABLE transacciones RESTART IDENTITY CASCADE');

        // 3. Borrar configuraciones (Vuelve a estado virgen)
        await client.query('TRUNCATE TABLE configuracion_whatsapp RESTART IDENTITY CASCADE');
        // Opcional: Si quieres borrar horarios también:
        // await client.query('TRUNCATE TABLE configuracion_global RESTART IDENTITY CASCADE');

        // 4. Borrar Usuarios (SOLO CLIENTES)
        // Mantenemos a los ADMINS para que no pierdas acceso al sistema.
        await client.query("DELETE FROM usuarios WHERE rol != 'admin'");

        // 5. Reiniciar saldo de los Admins a 0 (Opcional, para limpieza total)
        await client.query("UPDATE usuarios SET saldo_actual = 0 WHERE rol = 'admin'");

        await client.query('COMMIT');
        res.json({ success: true, message: "El sistema ha sido formateado correctamente." });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: "Error crítico al resetear: " + err.message });
    } finally {
        client.release();
    }
});

app.listen(port, () => { console.log(`Banco Server (Traslados Full) corriendo en http://localhost:${port}`); });