require('dotenv').config();
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const moment = require('moment'); // Asegúrate de tenerlo instalado, si no: npm install moment

// 1. Configuración
const FECHA = moment().format('YYYY-MM-DD_HH-mm');
const NOMBRE_ARCHIVO = `backup_bancobet_${FECHA}.sql`;
// Ruta donde se guardará temporalmente (carpeta backups)
const RUTA_CARPETA = path.join(__dirname, 'backups');
const RUTA_ARCHIVO = path.join(RUTA_CARPETA, NOMBRE_ARCHIVO);

// Crear carpeta si no existe
if (!fs.existsSync(RUTA_CARPETA)) {
    fs.mkdirSync(RUTA_CARPETA);
}

console.log(`⏳ Iniciando respaldo: ${NOMBRE_ARCHIVO}...`);

// 2. Comando para ejecutar pg_dump
// Nota: Usamos las variables de entorno para que sea seguro
const comando = `pg_dump -U ${process.env.DB_USER} -h ${process.env.DB_HOST} -p ${process.env.DB_PORT} -F c -b -v -f "${RUTA_ARCHIVO}" ${process.env.DB_NAME}`;

// Configuración para inyectar la contraseña de forma segura
const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD };

// 3. Ejecutar el respaldo
exec(comando, { env }, async (error, stdout, stderr) => {
    if (error) {
        console.error(`❌ Error al crear respaldo: ${error.message}`);
        return;
    }

    console.log('✅ Copia de seguridad creada exitosamente en local.');

    // 4. Enviar por correo (Opcional pero recomendado)
    await enviarPorCorreo(RUTA_ARCHIVO, NOMBRE_ARCHIVO);
});

async function enviarPorCorreo(ruta, nombre) {
    try {
        console.log('📧 Enviando respaldo por correo...');

        // CONFIGURA AQUÍ TU CORREO (Ejemplo con Gmail)
        // Nota: Para Gmail necesitas una "Contraseña de Aplicación", no tu clave normal.
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER, 
                pass: process.env.EMAIL_PASS
            }
        });

        const mailOptions = {
            from: `Sistema BancoBet <${process.env.EMAIL_USER}>`, // El remitente eres tú mismo
            to: process.env.EMAIL_USER, // Te lo envías a ti mismo (o cambia esto si quieres otro destino)
            subject: `📦 Respaldo BancoBet - ${FECHA}`,
            text: 'Adjunto encontrarás la copia de seguridad de la base de datos de hoy.',
            attachments: [
                {
                    filename: nombre,
                    path: ruta
                }
            ]
        };

        await transporter.sendMail(mailOptions);
        console.log('🚀 Correo enviado correctamente.');
        
        // Opcional: Borrar el archivo local después de enviar para no llenar el disco
        // fs.unlinkSync(ruta); 

    } catch (e) {
        console.error('⚠️ Error enviando correo:', e);
    }
}