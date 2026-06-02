const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');


const app = express();
const server = http.createServer(app);


//esto configura el socket.io para admitir las conexiones a través de nginx
const io = new Server(server, {
    path: '/socket.io',
});

//configura el pool de conexiones a la base de datos PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST || 'db-pacientes',
    user: process.env.DB_USER || 'user_salud',
    password: process.env.DB_PASSWORD || 'password_seguro123',
    database: process.env.DB_NAME || 'centro_medico',
    port: 5432,
});


//crea la tabla automáticamente al arrancar el contenedor si no existe
const inicializarBaseDeDatos = async () => {
    let conectado = false;
    while (!conectado) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS historial_tickets (
                    id SERIAL PRIMARY KEY,
                    ticket_codigo VARCHAR(50) NOT NULL,
                    fecha_llamado TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Base de datos PostgreSQL inicializada correctamente');
            conectado = true;
        } catch (err) {
            console.error('Error al conectar con PostgreSQL, reintentando en 5 segundos...', err);
            await new Promise(res => setTimeout(res, 5000));
        }
    }
};
        

inicializarBaseDeDatos();


//interfaz gráfica interactiva
app.get('/', async (req, res) => {
    let historialHTML = '';
    
    // Leer el historial real desde PostgreSQL para renderizarlo al cargar la página
    try {
        const result = await pool.query('SELECT ticket_codigo, fecha_llamado FROM historial_tickets ORDER BY id DESC LIMIT 5');
        if (result.rows.length === 0) {
            historialHTML = '<li>No hay registros en la base de datos todavía.</li>';
        } else {
            historialHTML = result.rows.map(row => 
                `<li><strong>${row.ticket_codigo}</strong> - Llamado a las: ${new Date(row.fecha_llamado).toLocaleTimeString()}</li>`
            ).join('');
        }
    } catch (err) {
        console.error('Error al leer historial:', err);
        historialHTML = '<li>Error al conectar con PostgreSQL</li>';
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Sala de Espera - Tickets</title>
            <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
            <style>
                body { font-family: sans-serif; text-align: center; background: #f4f6f9; padding: 50px; }
                .card { background: white; padding: 30px; border-radius: 8px; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 450px; }
                h1 { color: #2c3e50; }
                #pantalla { font-size: 48px; color: #e74c3c; font-weight: bold; margin: 20px 0; }
                .history-box { margin-top: 30px; text-align: left; background: #ebf5fb; padding: 15px; border-radius: 6px; border-left: 5px solid #3498db; }
                button { padding: 12px 24px; font-size: 16px; background: #3498db; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
                button:hover { background: #2980b9; }
                ul { padding-left: 20px; color: #34495e; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>SISTEMA DE TICKETS (Área 1)</h1>
                <p>Último paciente llamado a consulta:</p>
                <div id="pantalla">Esperando llamado...</div>
                <button onclick="simularLlamado()">Médico: Llamar Siguiente Paciente</button>
                
                <div class="history-box">
                    <h3>Persistencia Relacional (PostgreSQL):</h3>
                    <p><small>Últimos 5 registros guardados en la BD:</small></p>
                    <ul id="lista-historial">
                        ${historialHTML}
                    </ul>
                </div>
            </div>

            <script>
                const socket = io({ path: '/tickets/socket.io' });

                socket.on('connect', () => {
                    console.log('Conectado al API Gateway');
                });

                // Escuchar transmisiones globales del WebSocket
                socket.on('nuevo-paciente', (data) => {
                    document.getElementById('pantalla').innerText = data.ticket;
                    
                    // Inyectar el nuevo registro al principio de la lista visual inmediatamente
                    const lista = document.getElementById('lista-historial');
                    
                    // Si estaba el mensaje vacío, lo borramos
                    if (lista.innerText.includes("No hay registros")) {
                        lista.innerHTML = "";
                    }

                    const nuevoItem = document.createElement('li');
                    nuevoItem.innerHTML = "<strong>" + data.ticket + "</strong> - Llamado a las: " + new Date().toLocaleTimeString();
                    lista.insertBefore(nuevoItem, lista.firstChild);
                    
                    // Mantener la lista visual topada en 5 elementos
                    if(lista.children.length > 5) lista.removeChild(lista.lastChild);
                });

                function simularLlamado() {
                    const numeroRandom = Math.floor(Math.random() * 900) + 100;
                    socket.emit('medico-llama', { ticket: "Ticket B-" + numeroRandom });
                }
            </script>
        </body>
        </html>
    `);
});

//lógica para la comunicación bidireccional del websocket
io.on('connection', (socket) => {
    socket.on('medico-llama', async (data) => {
        console.log('Petición recibida por websocket para persistir: :', data);

        // Insertar el nuevo ticket en la base de datos PostgreSQL
        try {
            await pool.query('INSERT INTO historial_tickets (ticket_codigo) VALUES ($1)', [data.ticket]);
            console.log('Nuevo ticket guardado en PostgreSQL:', data.ticket);

            //si se guardó correctamente, se transmite a todos los clientes conectados
            io.emit('nuevo-paciente', data);
        } catch (err) {
            console.error('Error al guardar en PostgreSQL:', err);
        }
    });
});

server.listen(3000, () => {
    console.log('Microservicio de tickets escuchando en el puerto 3000');
});


    