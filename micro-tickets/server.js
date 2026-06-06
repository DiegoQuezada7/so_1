const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: '/socket.io' });

// 1. Configuración del Pool PostgreSQL Maestro
const pool = new Pool({
    host: process.env.DB_HOST || 'db-pacientes',
    user: process.env.DB_USER || 'user_salud',
    password: process.env.DB_PASSWORD || 'password_seguro123',
    database: process.env.DB_NAME || 'centro_medico',
    port: 5432,
    connectionTimeoutMillis: 2000
});

// Evita que Node muera si Postgres se apaga abruptamente
pool.on('error', (err) => {
    console.log('⚠️ [PostgreSQL Pool] Conexión de fondo interrumpida (Maestro inactivo).');
});

// 2. Configuración MongoDB (Auditoría, Seguridad y Contingencia)
const mongoUrl = process.env.MONGO_URL || 'mongodb://db-logs:27017';
let mongoDb;

const inicializarBasesDatos = async () => {
    let mongoConectado = false;
    while (!mongoConectado) {
        try {
            const client = await MongoClient.connect(mongoUrl);
            mongoDb = client.db('laboratorio_db');
            console.log('✅ [MongoDB] Conectado para auditoría y contingencia.');
            mongoConectado = true;
        } catch (err) {
            console.log('⏳ [MongoDB] Reintentando conexión en 3s...');
            await new Promise(res => setTimeout(res, 3000));
        }
    }

    let pgConectado = false;
    while (!pgConectado) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS historial_tickets (
                    id SERIAL PRIMARY KEY,
                    ticket_codigo VARCHAR(20) NOT NULL,
                    fecha_llamado TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            console.log('✅ [PostgreSQL] Tabla de historial verificada.');
            pgConectado = true;
        } catch (err) {
            console.log('⏳ [PostgreSQL] Buscando Maestro... reintentando en 3s.');
            await new Promise(res => setTimeout(res, 3000));
        }
    }
};
inicializarBasesDatos();

// WORKER AUTOMÁTICO: Sincronizador de Contingencia (Cada 5 segundos)
setInterval(async () => {
    if (!mongoDb) return;
    try {
        const colaContingencia = mongoDb.collection('cola_contingencia');
        const ticketsPendientes = await colaContingencia.find({}).toArray();
        
        if (ticketsPendientes.length > 0) {
            await pool.query('SELECT 1'); // Verificar si Postgres Maestro despertó
            
            for (const ticketDoc of ticketsPendientes) {
                await pool.query('INSERT INTO historial_tickets (ticket_codigo, fecha_llamado) VALUES ($1, $2)', 
                    [ticketDoc.ticket_codigo, ticketDoc.fecha_llamado]);
                await colaContingencia.deleteOne({ _id: ticketDoc._id });
            }
            console.log('✅ [Worker] Datos de contingencia sincronizados en el Maestro.');
            io.emit('contingencia-resuelta');
        }
    } catch (err) {
        // El maestro sigue abajo
    }
}, 5000);

// Render principal de la vista
app.get('/', async (req, res) => {
    let historialHTML = '';
    let estadoMaestro = 'ONLINE';
    
    try {
        // SOLUCIÓN CLAVE: to_char extrae la hora exacta formateada desde la BD como texto puro sin sufrir alteraciones de huso horario
        const result = await pool.query("SELECT ticket_codigo, to_char(fecha_llamado, 'HH24:MI:SS') as hora_limpia FROM historial_tickets ORDER BY id DESC LIMIT 5");
        historialHTML = result.rows.length === 0 
            ? '<li>No hay registros en la base de datos todavía.</li>' 
            : result.rows.map(row => `<li><strong>${row.ticket_codigo}</strong> - Llamado a las: ${row.hora_limpia}</li>`).join('');
    } catch (err) {
        if (err.code === '42P01') {
            historialHTML = '<li>Estructurando tablas relacionales... Refresca en unos segundos.</li>';
        } else {
            estadoMaestro = 'CONTINGENCIA (Maestro caído - Guardando en MongoDB)';
            try {
                const buffer = await mongoDb.collection('cola_contingencia').find({}).sort({_id: -1}).limit(5).toArray();
                historialHTML = buffer.length === 0 
                    ? '<li>Sin tickets nuevos en contingencia.</li>'
                    : buffer.map(t => {
                        // SOLUCIÓN CLAVE: Forzar explícitamente la zona horaria de Chile al leer de Mongo
                        const horaMongo = new Date(t.fecha_llamado).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        return `<li><span style="color:orange">⚠️ [Buffer]</span> <strong>${t.ticket_codigo}</strong> - Llamado a las: ${horaMongo}</li>`;
                      }).join('');
            } catch (mErr) {
                historialHTML = '<li>Error total de persistencia.</li>';
            }
        }
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Sala de Espera - Reloj Rectificado</title>
            <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
            <style>
                body { font-family: sans-serif; text-align: center; background: #f4f6f9; padding: 40px; }
                .card { background: white; padding: 30px; border-radius: 8px; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 480px; }
                .status-banner { padding: 10px; font-weight: bold; border-radius: 5px; margin-bottom: 20px; }
                .online { background: #d4edda; color: #155724; }
                .failover { background: #f8d7da; color: #721c24; animation: parpadeo 2s infinite; }
                .auth-box { background: #f8f9fa; border: 1px solid #ced4da; padding: 15px; border-radius: 6px; margin-bottom: 20px; text-align: left; }
                #pantalla { font-size: 48px; color: #e74c3c; font-weight: bold; margin: 20px 0; }
                .history-box { margin-top: 25px; text-align: left; background: #ebf5fb; padding: 15px; border-radius: 6px; border-left: 5px solid #3498db; }
                button { padding: 12px 20px; font-size: 15px; background: #3498db; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; }
                select { padding: 8px; width: 100%; margin-top: 5px; font-size: 14px; }
                .alerta-error { color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; border-radius: 5px; margin-top: 15px; display: none; }
                @keyframes parpadeo { 0% {opacity: 0.6;} 50% {opacity: 1;} 100% {opacity: 0.6;} }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>SISTEMA DE TICKETS</h2>
                <div id="banner" class="status-banner ${estadoMaestro === 'ONLINE' ? 'online' : 'failover'}">ESTADO RED: ${estadoMaestro}</div>
                
                <div class="auth-box">
                    <strong>Capa de Autenticación (Simulación OAuth2):</strong><br>
                    <label>Selecciona tu Rol de Intranet:</label>
                    <select id="rol-select" onchange="actualizarToken()">
                        <option value="Médico">Médico (Autorizado para área Tickets)</option>
                        <option value="Laboratorista">Laboratorista (No Autorizado aquí)</option>
                    </select>
                </div>

                <p>Último paciente llamado:</p>
                <div id="pantalla">Esperando llamado...</div>
                <button onclick="simularLlamado()">Médico: Llamar Siguiente Paciente</button>
                
                <div id="error-box" class="alerta-error"></div>

                <div class="history-box">
                    <h3>Persistencia Activa (Clúster Híbrido Políglota):</h3>
                    <ul id="lista-historial">${historialHTML}</ul>
                </div>
            </div>
            <script>
                const socket = io({ path: '/tickets/socket.io' });
                let miTokenSimulado = { user: "diego@salud.cl", role: "Médico" };

                function actualizarToken() {
                    miTokenSimulado.role = document.getElementById('rol-select').value;
                    document.getElementById('error-box').style.display = 'none';
                }

                socket.on('nuevo-paciente', (data) => {
                    document.getElementById('pantalla').innerText = data.ticket;
                    const lista = document.getElementById('lista-historial');
                    if (lista.innerText.includes("No hay registros") || lista.innerText.includes("Sin tickets") || lista.innerText.includes("Estructurando")) lista.innerHTML = "";
                    const nuevoItem = document.createElement('li');
                    nuevoItem.innerHTML = (data.isContingency ? '<span style="color:orange">⚠️ [Buffer]</span> ' : '') + "<strong>" + data.ticket + "</strong> - Llamado a las: " + data.hora;
                    lista.insertBefore(nuevoItem, lista.firstChild);
                });

                socket.on('rbac-error', (msg) => {
                    const errorBox = document.getElementById('error-box');
                    errorBox.innerText = "❌ " + msg;
                    errorBox.style.display = 'block';
                });

                socket.on('modo-contingencia-activo', () => {
                    const banner = document.getElementById('banner');
                    banner.innerText = "ESTADO RED: CONTINGENCIA (Guardando en MongoDB)";
                    banner.className = "status-banner failover";
                });

                socket.on('contingencia-resuelta', () => {
                    alert("🔄 ¡PostgreSQL Maestro recuperado! El clúster se ha sincronizado.");
                    window.location.reload();
                });

                function simularLlamado() {
                    document.getElementById('error-box').style.display = 'none';
                    const numeroRandom = Math.floor(Math.random() * 900) + 100;
                    socket.emit('medico-llama', { ticket: "Ticket B-" + numeroRandom, token: miTokenSimulado });
                }
            </script>
        </body>
        </html>
    `);
});

// Procesamiento de eventos en tiempo real con zona horaria chilena estricta
io.on('connection', (socket) => {
    socket.on('medico-llama', async (data) => {
        // SOLUCIÓN CLAVE: Forzar zona horaria de Santiago para el evento en tiempo real
        const horaExactaServidor = new Date().toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const usuarioRol = data.token ? data.token.role : 'Anónimo';

        // Filtro de Seguridad RBAC
        if (usuarioRol !== 'Médico') {
            const mensajeError = `Acceso Denegado: El rol '${usuarioRol}' no tiene permisos en este módulo.`;
            socket.emit('rbac-error', mensajeError);

            if (mongoDb) {
                try {
                    await mongoDb.collection('logs_auditoria_seguridad').insertOne({
                        timestamp: new Date(),
                        evento: 'ACCESO_RECHAZADO_RBAC',
                        usuario: data.token ? data.token.user : 'Desconocido',
                        rol_intentado: usuarioRol,
                        modulo_afectado: 'Tickets y Llamados'
                    });
                } catch (mErr) {
                    console.error(mErr);
                }
            }
            return;
        }

        // Persistencia y ruteo
        try {
            await pool.query('INSERT INTO historial_tickets (ticket_codigo) VALUES ($1)', [data.ticket]);
            io.emit('nuevo-paciente', { ticket: data.ticket, isContingency: false, hora: horaExactaServidor });
        } catch (err) {
            console.log('🚨 PostgreSQL Maestro inactivo. Derivando de emergencia a MongoDB...');
            if (mongoDb) {
                try {
                    await mongoDb.collection('cola_contingencia').insertOne({ ticket_codigo: data.ticket, fecha_llamado: new Date() });
                    io.emit('modo-contingencia-activo');
                    io.emit('nuevo-paciente', { ticket: data.ticket, isContingency: true, hora: horaExactaServidor });
                } catch (mongoErr) {
                    console.error(mongoErr);
                }
            }
        }
    });
});

server.listen(3000, () => {
    console.log('Microservicio de Tickets escuchando en el puerto 3000');
});