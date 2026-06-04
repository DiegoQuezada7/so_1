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
    connectionTimeoutMillis: 2000 // Tiempo corto para saltar rápido a contingencia
});

// 🔥 LA LÍNEA MÁGICA: Captura errores asíncronos del Pool y evita que Node.js muera en un 'docker stop'
pool.on('error', (err) => {
    console.log('⚠️ [PostgreSQL Pool] Conexión de fondo interrumpida (ej. Servidor Maestro apagado o reiniciándose). El proceso sigue vivo.');
});

// 2. Configuración MongoDB (Auditoría y Contingencia)
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
            console.log('⏳ [MongoDB] Esperando inicialización... reintentando en 3s.');
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
            console.log('✅ [PostgreSQL] Tabla historial_tickets verificada en Maestro.');
            pgConectado = true;
        } catch (err) {
            console.log('⏳ [PostgreSQL] Buscando conexión con Maestro... reintentando en 3s.');
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
            await pool.query('SELECT 1'); // Probar si Postgres despertó
            
            for (const ticketDoc of ticketsPendientes) {
                await pool.query('INSERT INTO historial_tickets (ticket_codigo, fecha_llamado) VALUES ($1, $2)', 
                    [ticketDoc.ticket_codigo, ticketDoc.fecha_llamado]);
                await colaContingencia.deleteOne({ _id: ticketDoc._id });
            }
            console.log('✅ [Worker] Datos de contingencia vaciados en PostgreSQL Maestro.');
            io.emit('contingencia-resuelta');
        }
    } catch (err) {
        // El maestro sigue abajo, no hace nada y espera el próximo ciclo
    }
}, 5000);

app.get('/', async (req, res) => {
    let historialHTML = '';
    let estadoMaestro = 'ONLINE';
    
    try {
        const result = await pool.query('SELECT ticket_codigo, fecha_llamado FROM historial_tickets ORDER BY id DESC LIMIT 5');
        historialHTML = result.rows.length === 0 
            ? '<li>No hay registros en la base de datos todavía.</li>' 
            : result.rows.map(row => `<li><strong>${row.ticket_codigo}</strong> - Llamado a las: ${new Date(row.fecha_llamado).toLocaleTimeString()}</li>`).join('');
    } catch (err) {
        if (err.code === '42P01') {
            historialHTML = '<li>Estructurando tablas relacionales... Refresca en 2 segundos.</li>';
        } else {
            estadoMaestro = 'CONTINGENCIA (Maestro caído - Guardando en MongoDB)';
            try {
                const buffer = await mongoDb.collection('cola_contingencia').find({}).sort({_id: -1}).limit(5).toArray();
                historialHTML = buffer.length === 0 
                    ? '<li>Sin tickets nuevos en contingencia.</li>'
                    : buffer.map(t => `<li><span style="color:orange">⚠️ [Buffer]</span> <strong>${t.ticket_codigo}</strong> - Llamado a las: ${new Date(t.fecha_llamado).toLocaleTimeString()}</li>`).join('');
            } catch (mErr) {
                historialHTML = '<li>Error total de persistencia.</li>';
            }
        }
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Sala de Espera - Sistema Sincronizado</title>
            <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
            <style>
                body { font-family: sans-serif; text-align: center; background: #f4f6f9; padding: 40px; }
                .card { background: white; padding: 30px; border-radius: 8px; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 480px; }
                .status-banner { padding: 10px; font-weight: bold; border-radius: 5px; margin-bottom: 20px; }
                .online { background: #d4edda; color: #155724; }
                .failover { background: #f8d7da; color: #721c24; animation: parpadeo 2s infinite; }
                #pantalla { font-size: 48px; color: #e74c3c; font-weight: bold; margin: 20px 0; }
                .history-box { margin-top: 25px; text-align: left; background: #ebf5fb; padding: 15px; border-radius: 6px; border-left: 5px solid #3498db; }
                button { padding: 12px 20px; font-size: 15px; background: #3498db; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; }
                @keyframes parpadeo { 0% {opacity: 0.6;} 50% {opacity: 1;} 100% {opacity: 0.6;} }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>SISTEMA DE TICKETS (Estable)</h2>
                <div id="banner" class="status-banner ${estadoMaestro === 'ONLINE' ? 'online' : 'failover'}">ESTADO RED: ${estadoMaestro}</div>
                <p>Último paciente llamado:</p>
                <div id="pantalla">Esperando llamado...</div>
                <button onclick="simularLlamado()">Médico: Llamar Siguiente Paciente</button>
                <div class="history-box">
                    <h3>Persistencia Activa (Clúster Híbrido):</h3>
                    <ul id="lista-historial">${historialHTML}</ul>
                </div>
            </div>
            <script>
                const socket = io({ path: '/tickets/socket.io' });
                let miTokenSimulado = { user: "diego@salud.cl", role: "Médico" };

                socket.on('nuevo-paciente', (data) => {
                    document.getElementById('pantalla').innerText = data.ticket;
                    const lista = document.getElementById('lista-historial');
                    if (lista.innerText.includes("No hay registros") || lista.innerText.includes("Sin tickets") || lista.innerText.includes("Estructurando")) lista.innerHTML = "";
                    const nuevoItem = document.createElement('li');
                    nuevoItem.innerHTML = (data.isContingency ? '<span style="color:orange">⚠️ [Buffer]</span> ' : '') + "<strong>" + data.ticket + "</strong> - Llamado a las: " + data.hora;
                    lista.insertBefore(nuevoItem, lista.firstChild);
                });

                socket.on('modo-contingencia-activo', () => {
                    const banner = document.getElementById('banner');
                    banner.innerText = "ESTADO RED: CONTINGENCIA (Guardando en MongoDB)";
                    banner.className = "status-banner failover";
                });

                socket.on('contingencia-resuelta', () => {
                    alert("🔄 ¡PostgreSQL Maestro recuperado! Clúster sincronizado.");
                    window.location.reload();
                });

                function simularLlamado() {
                    const numeroRandom = Math.floor(Math.random() * 900) + 100;
                    socket.emit('medico-llama', { ticket: "Ticket B-" + numeroRandom, token: miTokenSimulado });
                }
            </script>
        </body>
        </html>
    `);
});

io.on('connection', (socket) => {
    socket.on('medico-llama', async (data) => {
        const horaExactaServidor = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        try {
            // Intentamos escribir en Postgres
            await pool.query('INSERT INTO historial_tickets (ticket_codigo) VALUES ($1)', [data.ticket]);
            io.emit('nuevo-paciente', { ticket: data.ticket, isContingency: false, hora: horaExactaServidor });
        } catch (err) {
            console.log('🚨 Fallo transaccional directo detectado. Derivando de emergencia a MongoDB...');
            if (mongoDb) {
                try {
                    await mongoDb.collection('cola_contingencia').insertOne({ ticket_codigo: data.ticket, fecha_llamado: new Date() });
                    io.emit('modo-contingencia-activo');
                    io.emit('nuevo-paciente', { ticket: data.ticket, isContingency: true, hora: horaExactaServidor });
                } catch (mongoErr) {
                    console.error('Colapso de persistencia total', mongoErr);
                }
            }
        }
    });
});

server.listen(3000, () => {
    console.log('Microservicio de Tickets escuchando en el puerto 3000');
});