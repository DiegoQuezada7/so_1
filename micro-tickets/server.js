const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const { MongoClient } = require('mongodb'); // NUEVO: Cliente Mongo para auditoría

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: '/socket.io' });

// 1. Configuración del Pool PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST || 'db-pacientes',
    user: process.env.DB_USER || 'user_salud',
    password: process.env.DB_PASSWORD || 'password_seguro123',
    database: process.env.DB_NAME || 'centro_medico',
    port: 5432,
});

// 2. Configuración Cliente MongoDB (Auditoría Centralizada)
const mongoUrl = process.env.MONGO_URL || 'mongodb://db-logs:27017';
let mongoDb;

const inicializarBasesDatos = async () => {
    // Inicializar Postgres
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
            console.log('✅ [PostgreSQL] Conexión y tabla verificadas.');
            pgConectado = true;
        } catch (err) {
            console.log('⏳ [PostgreSQL] Esperando inicialización... reintentando en 3s.');
            await new Promise(res => setTimeout(res, 3000));
        }
    }

    // Inicializar Mongo
    let mongoConectado = false;
    while (!mongoConectado) {
        try {
            const client = await MongoClient.connect(mongoUrl);
            mongoDb = client.db('laboratorio_db');
            console.log('✅ [MongoDB] Conectado para auditoría de seguridad.');
            mongoConectado = true;
        } catch (err) {
            console.log('⏳ [MongoDB] Esperando inicialización... reintentando en 3s.');
            await new Promise(res => setTimeout(res, 3000));
        }
    }
};
inicializarBasesDatos();

// Interfaz gráfica con control de Roles (RBAC Simulado)
app.get('/', async (req, res) => {
    let historialHTML = '';
    try {
        const result = await pool.query('SELECT ticket_codigo, fecha_llamado FROM historial_tickets ORDER BY id DESC LIMIT 5');
        historialHTML = result.rows.length === 0 
            ? '<li>No hay registros.</li>' 
            : result.rows.map(row => `<li><strong>${row.ticket_codigo}</strong> - ${new Date(row.fecha_llamado).toLocaleTimeString()}</li>`).join('');
    } catch (err) {
        historialHTML = '<li>Error al cargar Postgres.</li>';
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Sala de Espera - Seguridad RBAC</title>
            <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
            <style>
                body { font-family: sans-serif; text-align: center; background: #f4f6f9; padding: 40px; }
                .card { background: white; padding: 30px; border-radius: 8px; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 480px; }
                .auth-box { background: #f8f9fa; border: 1px solid #ced4da; padding: 15px; border-radius: 6px; margin-bottom: 20px; text-align: left; }
                #pantalla { font-size: 48px; color: #e74c3c; font-weight: bold; margin: 20px 0; }
                .history-box { margin-top: 25px; text-align: left; background: #ebf5fb; padding: 15px; border-radius: 6px; border-left: 5px solid #3498db; }
                button { padding: 12px 20px; font-size: 15px; background: #2ecc71; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; }
                button:hover { background: #27ae60; }
                select { padding: 8px; width: 100%; margin-top: 5px; font-size: 14px; }
                .alerta-error { color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; border-radius: 5px; margin-top: 15px; display: none; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>SISTEMA DE TICKETS CON SEGURIDAD (RBAC)</h2>
                
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
                    <h3>Persistencia Base de Datos (PostgreSQL):</h3>
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
                    if (lista.innerText.includes("No hay registros")) lista.innerHTML = "";
                    
                    const nuevoItem = document.createElement('li');
                    nuevoItem.innerHTML = "<strong>" + data.ticket + "</strong> - " + new Date().toLocaleTimeString();
                    lista.insertBefore(nuevoItem, lista.firstChild);
                    if(lista.children.length > 5) lista.removeChild(lista.lastChild);
                });

                // Escuchar rechazos de seguridad del RBAC
                socket.on('rbac-error', (msg) => {
                    const errorBox = document.getElementById('error-box');
                    errorBox.innerText = "❌ " + msg;
                    errorBox.style.display = 'block';
                });

                function simularLlamado() {
                    document.getElementById('error-box').style.display = 'none';
                    const numeroRandom = Math.floor(Math.random() * 900) + 100;
                    
                    // Enviamos la petición inyectando las credenciales simuladas de OAuth2
                    socket.emit('medico-llama', { 
                        ticket: "Ticket B-" + numeroRandom,
                        token: miTokenSimulado 
                    });
                }
            </script>
        </body>
        </html>
    `);
});

// Canal de WebSockets con middleware de Validación de Roles (RBAC)
io.on('connection', (socket) => {
    socket.on('medico-llama', async (data) => {
        const usuarioRol = data.token ? data.token.role : 'Anónimo';
        console.log(`🔒 [RBAC] Evaluando permisos para el rol: ${usuarioRol}`);

        // VALIDACIÓN ESTRICTA DE ROL (RBAC)
        if (usuarioRol !== 'Médico') {
            const mensajeError = `Acceso Denegado: El rol '${usuarioRol}' no tiene permisos de escritura en el Módulo de Tickets.`;
            console.error(`🚨 ALERT: ${mensajeError}`);

            // 1. Notificar el bloqueo al infractor por el WebSocket
            socket.emit('rbac-error', mensajeError);

            // 2. AUDITORÍA CRÍTICA: Guardar la brecha de seguridad en MongoDB (db-logs)
            if (mongoDb) {
                try {
                    await mongoDb.collection('logs_auditoria_seguridad').insertOne({
                        timestamp: new Date(),
                        evento: 'ACCESO_RECHAZADO_RBAC',
                        usuario: data.token ? data.token.user : 'Desconocido',
                        rol_intentado: usuarioRol,
                        modulo_afectado: 'Tickets y Llamados',
                        descripcion: 'Intento no autorizado de manipulación de colas de atención'
                    });
                    console.log('💾 Alerta de seguridad registrada con éxito en MongoDB NoSQL.');
                } catch (mongoErr) {
                    console.error('Error al escribir auditoría en Mongo:', mongoErr);
                }
            }
            return; // Detiene la ejecución, bloqueando la escritura en Postgres
        }

        // Si es Médico, el flujo continúa normalmente
        try {
            await pool.query('INSERT INTO historial_tickets (ticket_codigo) VALUES ($1)', [data.ticket]);
            console.log('Explicit entry saved to PostgreSQL (Master).');
            io.emit('nuevo-paciente', data);
        } catch (err) {
            console.error('Error en Postgres:', err);
        }
    });
});

server.listen(3000, () => {
    console.log('Microservicio de Tickets escuchando en el puerto 3000');
});