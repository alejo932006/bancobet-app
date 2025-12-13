require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';

const webpush = require('web-push');

// Configura web-push
webpush.setVapidDetails(
    'mailto:bancobet39@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

const app = express();
const port = process.env.PORT || 3000;

// *** CONFIGURA AQUÍ TU CONTRASEÑA MAESTRA ***
const MASTER_KEY = process.env.MASTER_KEY; 

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: function (req, file, cb) { cb(null, Date.now() + path.extname(file.originalname)); }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB
    fileFilter: (req, file, cb) => {
        // Expresión regular para aceptar solo imágenes
        const filetypes = /jpeg|jpg|png|gif|webp/;
        // Verificamos la extensión y el tipo MIME
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Error: Solo se permiten imágenes válidas (jpeg, jpg, png, gif, webp)'));
    }
});

app.use(cors({
    origin: allowedOrigin
}));
app.use(express.json());
// app.use(express.static('.')); 
app.use('/uploads', express.static('uploads'));

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  });

  app.use('/api/admin', (req, res, next) => {
    const claveRecibida = req.headers['x-master-key'];
    const claveReal = process.env.MASTER_KEY;

    // Si no envió clave o es incorrecta -> Bloqueo total (403 Forbidden)
    if (!claveRecibida || claveRecibida !== claveReal) {
        console.log(`⛔ Intento de acceso no autorizado a ${req.path} desde ${req.ip}`);
        return res.status(403).json({ success: false, error: 'Acceso Denegado: Falta autorización.' });
    }
    
    next(); // Si la clave es correcta, deja pasar.
});

// --- API LOGIN ---
app.post('/api/login', async (req, res) => {
    const { cedula, password } = req.body;
    try {
      // 1. Buscamos SOLO por cédula
      const result = await pool.query('SELECT * FROM usuarios WHERE cedula = $1', [cedula]);
      
      if (result.rows.length > 0) {
          const user = result.rows[0];
          
          // Validar si está activo
          if (user.activo === false) {
              return res.status(403).json({ success: false, message: 'Tu cuenta ha sido desactivada.' });
          }

          // 2. COMPARAMOS la contraseña segura con BCRYPT
          // Si la contraseña en la BD no está encriptada (usuarios viejos), esto fallará. 
          // (Abajo te digo cómo solucionar eso).
          const match = await bcrypt.compare(password, user.password);

          if (match) {
              res.json({ success: true, usuario: user });
          } else {
              res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
          }
      } 
      else res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/usuario/:id', async (req, res) => {
    try {
        // [MODIFICADO] Agregamos 'activo' a la lista de campos
        const result = await pool.query('SELECT id, nombre_completo, cedula, saldo_actual, rol, activo, limite_sobregiro FROM usuarios WHERE id = $1', [req.params.id]);
        
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

// [MODIFICADO] Historial del cliente con paginación
app.get('/api/historial/:usuarioId', async (req, res) => {
    try {
        const { limit, offset, busqueda, fechaInicio, fechaFin } = req.query;
        
        const limite = parseInt(limit) || 20;
        const salto = parseInt(offset) || 0;
        const usuarioId = req.params.usuarioId;

        let query = `
            SELECT * FROM transacciones 
            WHERE usuario_id = $1 
        `;
        
        const params = [usuarioId];
        let paramCount = 2;

        // 1. Filtro de Búsqueda (ID, Referencia, Cédulas, Tipo)
        if (busqueda) {
            query += ` AND (
                referencia_externa ILIKE $${paramCount} OR 
                cc_casino ILIKE $${paramCount} OR 
                pin_retiro ILIKE $${paramCount} OR 
                cedula_destino ILIKE $${paramCount} OR 
                tipo_operacion ILIKE $${paramCount}
            )`;
            params.push(`%${busqueda}%`);
            paramCount++;
        }

        // 2. Filtro de Fechas
        if (fechaInicio && fechaFin) {
            query += ` AND fecha_transaccion::date BETWEEN $${paramCount} AND $${paramCount + 1}`;
            params.push(fechaInicio, fechaFin);
            paramCount += 2;
        }

        // Orden y Paginación
        query += ` ORDER BY fecha_transaccion DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limite, salto);

        const result = await pool.query(query, params);
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
            
                // --- INICIO CAMBIO SOBREGIRO ---
                // 1. Traemos el saldo actual Y el límite de sobregiro del usuario
                const saldoRes = await client.query('SELECT saldo_actual, limite_sobregiro FROM usuarios WHERE id = $1', [data.usuario_id]);
                const usuario = saldoRes.rows[0];
                
                // 2. Convertimos a número (si no tiene límite asignado, asumimos 0)
                const limite = parseFloat(usuario.limite_sobregiro || 0);
                
                // 3. Calculamos la capacidad real de gasto: (Saldo que tiene) + (Lo que le prestas)
                // Ejemplo: Si tiene $0 y límite $500.000, puede gastar $500.000.
                const capacidadTotal = parseFloat(usuario.saldo_actual) + limite;
    
                // 4. Validamos si le alcanza
                if (capacidadTotal < montoBruto) {
                    const disponibleFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(capacidadTotal);
                    throw new Error(`Saldo insuficiente. Tu cupo disponible (saldo + sobregiro) es de ${disponibleFmt}`);
                }
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
            urlWeb = `https://${req.get('host')}/uploads/${file.filename}`;
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
        const pagosExternosRes = await pool.query("SELECT SUM(monto) as total FROM pagos_kairo_externos");
        const totalPagosKairo = parseFloat(pagosExternosRes.rows[0].total || 0);
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
        const comisionRecargasBetplay = bRecargas * 0.055;

        res.json({
            success: true,
            totalBanco: totalBancoReal, 
            totalUsuarios: numUsuarios.rows[0].total || 0,
            totalGanancias: comisiones.rows[0].total || 0,
            desgloseOperaciones: desglose,
            
            // KAIROPLAY MODIFICADO
            kairo: {
                retiros: kRetiros, 
                recargas: kRecargas, 
                pagos_externos: totalPagosKairo, // Opcional: para mostrarlo si quieres
                // FÓRMULA ACTUALIZADA: (Recargas - Retiros) + Ajuste - PAGOS EXTERNOS
                saldo: (kRecargas - kRetiros) + ajusteKairo - totalPagosKairo
            },
            
            betplay: {
                retiros: bRetiros,
                recargas: bRecargas,
                comision_recargas: comisionRecargasBetplay,
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
    // 1. Recibimos 'sobregiro' junto con los otros datos
    const { nombre, cedula, password, saldoInicial, rol, permisos, sobregiro } = req.body;
    
    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const permisoFinal = permisos || 'AMBOS';
        
        // 2. La consulta INSERT debe tener 7 valores (incluyendo limite_sobregiro)
        await pool.query(
            'INSERT INTO usuarios (nombre_completo, cedula, password, saldo_actual, rol, permisos_casino, limite_sobregiro) VALUES ($1, $2, $3, $4, $5, $6, $7)', 
            [
                nombre, 
                cedula, 
                passwordHash, 
                saldoInicial || 0, 
                rol || 'cliente', 
                permisoFinal, 
                sobregiro || 0 // 3. Aquí enviamos el valor (o 0 si no existe)
            ] 
        );
        res.json({ success: true });
    } catch(err) { 
        console.error("Error creando usuario:", err.message); // Ver error en consola negra
        res.status(500).json({ error: err.message }); 
    }
});

app.delete('/api/admin/usuarios/:id', async (req, res) => {
    const { masterKey } = req.body;
    if (masterKey !== process.env.MASTER_KEY) {
        return res.status(403).json({ success: false, message: 'Clave Maestra Incorrecta' });
    }

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
    const { id } = req.params;
    const { fechaInicio, fechaFin, limit, offset } = req.query; // Recibimos limit y offset

    // Valores por defecto
    const limite = parseInt(limit) || 50;
    const salto = parseInt(offset) || 0;

    const client = await pool.connect();
    try {
        // 1. Saldo Actual (Igual que antes)
        const userRes = await client.query('SELECT saldo_actual FROM usuarios WHERE id = $1', [id]);
        const saldoActual = userRes.rows[0]?.saldo_actual || 0;

        // 2. Filtros de fecha (Igual que antes)
        let filtroFecha = "";
        const paramsStats = [id];
        
        if (fechaInicio && fechaFin) {
            filtroFecha = ` AND fecha_transaccion::date BETWEEN $2 AND $3`;
            paramsStats.push(fechaInicio, fechaFin);
        }

        // 3. ESTADÍSTICAS (Calculamos sobre TODO el rango, sin límite, para que los cuadros de resumen sean correctos)
        const statsQuery = `
            SELECT tipo_operacion, SUM(monto) as total,
            SUM(CASE WHEN cc_casino = 'KAIROPLAY' THEN 0 ELSE comision END) as total_comision
            FROM transacciones
            WHERE usuario_id = $1 AND estado = 'APROBADO' ${filtroFecha}
            GROUP BY tipo_operacion
        `;
        const statsRes = await client.query(statsQuery, paramsStats);

        let entradas = 0;
        let salidas = 0;
        statsRes.rows.forEach(r => {
            const montoBruto = parseFloat(r.total || 0);
            const comision = parseFloat(r.total_comision || 0);
            if (['RETIRO', 'ABONO_CAJA', 'ABONO_TRASLADO'].includes(r.tipo_operacion)) {
                entradas += (montoBruto - comision);
            } else {
                salidas += montoBruto;
            }
        });

        // 4. LISTA DE TRANSACCIONES (Aquí APLICAMOS la paginación)
        // Necesitamos un array de parámetros nuevo para esta consulta porque agregamos limit y offset al final
        const paramsLista = [...paramsStats, limite, salto]; 
        
        // El índice del límite será: paramsStats.length + 1
        // El índice del offset será: paramsStats.length + 2
        const idxLimit = paramsStats.length + 1;
        const idxOffset = paramsStats.length + 2;

        const listaQuery = `
            SELECT * FROM transacciones 
            WHERE usuario_id = $1 ${filtroFecha} 
            ORDER BY fecha_transaccion DESC 
            LIMIT $${idxLimit} OFFSET $${idxOffset}
        `;
        
        const listaRes = await client.query(listaQuery, paramsLista);

        res.json({
            saldoActual: saldoActual,
            resumen: { entradas, salidas, neto: entradas - salidas },
            datos: listaRes.rows // Solo devuelve las 50 (o limit) filas solicitadas
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// [MODIFICADO] Endpoint transacciones con paginación
app.get('/api/admin/transacciones', async (req, res) => {
    // Recibimos limit y offset, por defecto 50 y 0
    const { fechaInicio, fechaFin, busqueda, tipo, limit, offset } = req.query; 
    
    // Convertimos a números seguros
    const limite = parseInt(limit) || 50;
    const salto = parseInt(offset) || 0;

    let query = `SELECT t.*, u.nombre_completo, u.cedula 
                 FROM transacciones t 
                 JOIN usuarios u ON t.usuario_id = u.id 
                 WHERE 1=1`;
    
    const params = []; 
    let paramCount = 1;

    // 1. Filtro Fecha
    if (fechaInicio && fechaFin) { 
        query += ` AND t.fecha_transaccion::date BETWEEN $${paramCount} AND $${paramCount + 1}`; 
        params.push(fechaInicio, fechaFin); 
        paramCount += 2; 
    }
    
    // 2. Filtro Búsqueda
    if (busqueda) { 
        query += ` AND (u.nombre_completo ILIKE $${paramCount} OR u.cedula ILIKE $${paramCount} OR t.referencia_externa ILIKE $${paramCount} OR CAST(t.id AS TEXT) = $${paramCount})`; 
        params.push(`%${busqueda}%`); 
        paramCount++; 
    }

    // 3. Filtro por Tipo
    if (tipo) {
        query += ` AND t.tipo_operacion = $${paramCount}`;
        params.push(tipo);
        paramCount++;
    }

    // [MODIFICADO] Aplicamos Paginación dinámica
    query += ` ORDER BY t.fecha_transaccion DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limite, salto);
    
    try { 
        const result = await pool.query(query, params); 
        res.json(result.rows); 
    } 
    catch (err) { res.status(500).json({ error: err.message }); }
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

        const motivo = `Tu transacción ID ${id} (${tx.tipo_operacion}) ha sido REVERSADA/ANULADA por el administrador. El saldo ha sido ajustado.`;
        await notificarUsuario(client, tx.usuario_id, motivo);

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
    const { nombre, cedula, password, rol, permisos, activo, sobregiro } = req.body;
    
    try {
        let query = `UPDATE usuarios SET nombre_completo = $1, cedula = $2, rol = $3, permisos_casino = $4, activo = $5, limite_sobregiro = $6`;
        const params = [nombre, cedula, rol, permisos || 'AMBOS', activo, sobregiro];
        
        // Si viene password, lo encriptamos y lo agregamos a la query
        if (password && password.trim() !== '') {
            const passwordHash = await bcrypt.hash(password, 10);
            query += `, password = $7`;
            params.push(passwordHash);
        }
        
        query += ` WHERE id = $${params.length + 1}`;
        params.push(id);

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

        const motivoEdit = `El monto de tu transacción ID ${id} (${tx.tipo_operacion}) fue corregido de $${montoViejo} a $${montoNuevo}. Tu saldo fue actualizado.`;
        await notificarUsuario(client, tx.usuario_id, motivoEdit);

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
    if (masterKey !== process.env.MASTER_KEY) { 
        return res.status(403).json({ error: "Clave Maestra Incorrecta. Acceso denegado." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query('TRUNCATE TABLE notificaciones RESTART IDENTITY CASCADE');

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

// [MODIFICADO] OBTENER PAGOS EXTERNOS KAIRO (CON FILTROS)
app.get('/api/admin/kairo-pagos', async (req, res) => {
    const { inicio, fin, busqueda } = req.query;
    
    // Consulta base
    let query = 'SELECT * FROM pagos_kairo_externos WHERE 1=1';
    const params = [];
    let paramCount = 1;

    // 1. Filtro por Fechas
    if (inicio && fin) {
        query += ` AND fecha::date BETWEEN $${paramCount} AND $${paramCount + 1}`;
        params.push(inicio, fin);
        paramCount += 2;
    }

    // 2. Filtro por Texto (Beneficiario o Descripción)
    if (busqueda) {
        query += ` AND (beneficiario ILIKE $${paramCount} OR descripcion ILIKE $${paramCount})`;
        params.push(`%${busqueda}%`); // El % es para buscar coincidencias parciales
        paramCount++;
    }

    // Ordenar y limitar (aumentamos el límite a 100 para búsquedas)
    query += ' ORDER BY fecha DESC LIMIT 100';

    try {
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/kairo-pagos', async (req, res) => {
    const { descripcion, beneficiario, monto } = req.body;
    try {
        await pool.query(
            'INSERT INTO pagos_kairo_externos (descripcion, beneficiario, monto) VALUES ($1, $2, $3)',
            [descripcion, beneficiario, parseFloat(monto)]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/kairo-pagos/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pagos_kairo_externos WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ENDPOINT CORREGIDO: RESTAURAR TRANSACCIÓN (DES-REVERSAR) ---
app.post('/api/admin/transacciones/:id/restaurar', async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. Obtener la transacción que queremos restaurar
        const txRes = await client.query('SELECT * FROM transacciones WHERE id = $1', [id]);
        if (txRes.rows.length === 0) throw new Error("Transacción no encontrada");
        const tx = txRes.rows[0];

        if (tx.estado !== 'REVERSADO') throw new Error("Solo se pueden restaurar transacciones reversadas");

        // 2. Calcular monto neto (quitando comisión si la hubiera)
        const impacto = parseFloat(tx.monto) - parseFloat(tx.comision || 0);

        // 3. Variables para manejar la pareja (el otro usuario)
        let refPareja = null;
        let tipoPareja = null;

        // --- LÓGICA DE SALDOS Y PAREJAS ---

        // CASO A: Estamos restaurando el ENVÍO (TRASLADO)
        if (tx.tipo_operacion === 'TRASLADO') {
            // 1. El remitente (tx.usuario_id) vuelve a PERDER el dinero (-)
            await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual - $1 WHERE id = $2`, [impacto, tx.usuario_id]);
            
            // 2. El destinatario (tx.usuario_destino_id) vuelve a RECIBIR el dinero (+)
            if (tx.usuario_destino_id) {
                await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [impacto, tx.usuario_destino_id]);
                
                // NOTA: La pareja del TRASLADO es el ABONO_TRASLADO y tiene sufijo '-RX'
                refPareja = tx.referencia_externa + '-RX';
                tipoPareja = 'ABONO_TRASLADO';
            }
        }
        // CASO B: Estamos restaurando la RECEPCIÓN (ABONO_TRASLADO)
        else if (tx.tipo_operacion === 'ABONO_TRASLADO') {
            // 1. El receptor (tx.usuario_id) vuelve a RECIBIR el dinero (+)
            await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [impacto, tx.usuario_id]);

            // 2. El remitente original (tx.usuario_destino_id) vuelve a PERDER el dinero (-)
            if (tx.usuario_destino_id) {
                await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual - $1 WHERE id = $2`, [impacto, tx.usuario_destino_id]);

                // NOTA: La pareja del ABONO_TRASLADO es el TRASLADO y NO tiene sufijo '-RX'
                refPareja = tx.referencia_externa.replace('-RX', '');
                tipoPareja = 'TRASLADO';
            }
        }
        // CASO C: Otras operaciones (Retiros, Recargas, etc.)
        else if (['RETIRO', 'ABONO_CAJA'].includes(tx.tipo_operacion)) {
            // Eran entradas (+), así que volvemos a SUMAR
            await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [impacto, tx.usuario_id]);
        } 
        else {
            // Eran salidas (-), así que volvemos a RESTAR
            await client.query(`UPDATE usuarios SET saldo_actual = saldo_actual - $1 WHERE id = $2`, [impacto, tx.usuario_id]);
        }

        // 4. CAMBIAR ESTADO DE LA PRINCIPAL
        await client.query("UPDATE transacciones SET estado = 'APROBADO' WHERE id = $1", [id]);

        // 5. CAMBIAR ESTADO DE LA PAREJA (Si existe)
        if (refPareja && tipoPareja) {
            await client.query(
                "UPDATE transacciones SET estado = 'APROBADO' WHERE referencia_externa = $1 AND tipo_operacion = $2", 
                [refPareja, tipoPareja]
            );
            
            // Opcional: Notificar también al otro usuario
            if (tx.usuario_destino_id) {
                 const msjPareja = `La transacción compartida ${refPareja} ha sido RESTAURADA.`;
                 await notificarUsuario(client, tx.usuario_destino_id, msjPareja);            }
        }

        // 6. Notificar al usuario principal
        const motivo = `La reversión de tu transacción ID ${id} fue cancelada. Operación RESTAURADA exitosamente.`;
        await notificarUsuario(client, tx.usuario_id, motivo);

        await client.query('COMMIT');
        res.json({ success: true, message: "Transacción y su pareja restauradas correctamente." });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
});

//Notificaciones con paginación
app.get('/api/notificaciones/:usuarioId', async (req, res) => {
    try {
        const { limit, offset } = req.query;
        
        // Valores por defecto: 10 notificaciones, empezando desde la 0
        const limite = parseInt(limit) || 10;
        const salto = parseInt(offset) || 0;

        // Cambiamos ORDER BY a solo 'fecha DESC' para que la línea de tiempo sea coherente al paginar
        const result = await pool.query(
            'SELECT * FROM notificaciones WHERE usuario_id = $1 ORDER BY fecha DESC LIMIT $2 OFFSET $3',
            [req.params.usuarioId, limite, salto]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Marcar notificación como leída
app.put('/api/notificaciones/leer/:id', async (req, res) => {
    try {
        await pool.query('UPDATE notificaciones SET leido = true WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- RUTA: GUARDAR SUSCRIPCIÓN DEL CELULAR ---
app.post('/api/subscribe', async (req, res) => {
    const { usuario_id, subscription } = req.body;
    
    try {
        // Guardamos los datos técnicos del celular en la BD
        await pool.query(
            `INSERT INTO suscripciones_push (usuario_id, endpoint, keys_auth, keys_p256dh) 
             VALUES ($1, $2, $3, $4)`,
            [usuario_id, subscription.endpoint, subscription.keys.auth, subscription.keys.p256dh]
        );
        res.status(201).json({ success: true });
    } catch (err) {
        console.error("Error guardando suscripción:", err);
        // Si falla (ej: duplicado) no rompemos nada, solo avisamos
        res.status(500).json({ error: err.message });
    }
});

// --- FUNCIÓN AUXILIAR: NOTIFICAR (DB + PUSH) ---
async function notificarUsuario(client, usuarioId, mensaje) {
    try {
        // 1. Guardar en tu Base de Datos (para que salga en la campana de la app)
        await client.query("INSERT INTO notificaciones (usuario_id, mensaje, tipo) VALUES ($1, $2, 'INFO')", [usuarioId, mensaje]);

        // 2. Buscar si el usuario tiene celular registrado para notificaciones
        const subsRes = await client.query("SELECT * FROM suscripciones_push WHERE usuario_id = $1", [usuarioId]);

        // 3. Preparar el mensaje para el celular
        const payload = JSON.stringify({ 
            title: 'Banco Bet', 
            body: mensaje 
        });

        // 4. Enviar a todos los celulares registrados de ese usuario
        for (const subRow of subsRes.rows) {
            const subscription = {
                endpoint: subRow.endpoint,
                keys: {
                    auth: subRow.keys_auth,
                    p256dh: subRow.keys_p256dh
                }
            };

            try {
                await webpush.sendNotification(subscription, payload);
            } catch (error) {
                console.error("Error enviando push:", error);
                // Si el celular ya no existe (error 410), borramos la suscripción vieja
                if (error.statusCode === 410) {
                    await client.query("DELETE FROM suscripciones_push WHERE id = $1", [subRow.id]);
                }
            }
        }
    } catch (e) {
        console.error("Error en notificarUsuario:", e);
    }
}

app.listen(port, () => { console.log(`Banco Server (Traslados Full) corriendo en http://localhost:${port}`); });