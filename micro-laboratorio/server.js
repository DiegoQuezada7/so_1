const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    path: '/socket.io'
});

const mongoUrl = process.env.MONGO_URL || 'mongodb://db-logs:27017';
const dbName = 'laboratorio_db';
let db;

// Bucle de reintento para MongoDB (Evita fallos si la BD tarda en arrancar)
const conectarMongo = async () => {
    let conectado = false;
    while (!conectado) {
        try {
            const client = await MongoClient.connect(mongoUrl);
            db = client.db(dbName);
            console.log('✅ Conexión con MongoDB NoSQL (Logs de Auditoría) exitosa.');
            conectado = true;
        } catch (err) {
            console.log('⏳ MongoDB aún se está inicializando... Reintentando conexión en 3 segundos.');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
};
conectarMongo();

// Interfaz gráfica embebida para simular la Maquinaria IoT
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Maquinaria IoT - Laboratorio</title>
            <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
            <style>
                body { font-family: sans-serif; text-align: center; background: #f4f6f9; padding: 50px; }
                .card { background: white; padding: 30px; border-radius: 8px; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 500px; }
                h1 { color: #2c3e50; }
                .status { font-size: 18px; font-weight: bold; margin: 15px 0; padding: 12px; border-radius: 5px; background: #fff3cd; color: #856404; transition: 0.3s; }
                .online { background: #d4edda; color: #155724; }
                .telemetry { background: #2c3e50; color: #2ecc71; font-family: monospace; padding: 15px; text-align: left; border-radius: 5px; height: 180px; overflow-y: auto; font-size: 13px; }
                button { padding: 12px 24px; font-size: 15px; background: #e67e22; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; margin-bottom: 20px; }
                button:hover { background: #d35400; }
                div.log-item { margin-bottom: 4px; border-bottom: 1px solid #34495e; padding-bottom: 2px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>MAQUINARIA DE LABORATORIO IoT (Área 2)</h1>
                <div id="status-box" class="status">Estado del Dispositivo: DETENIDO</div>
                <button onclick="alternarTransmision()">Iniciar / Detener Analizador PCR</button>
                
                <h3>Flujo Telemétrico en Tiempo Real (WebSocket -> MongoDB):</h3>
                <div id="telemetria-log" class="telemetry">Esperando encendido de maquinaria...</div>
            </div>

            <script>
                // Conexión dirigida a través del API Gateway Nginx
                const socket = io({ path: '/tickets/socket.io' }); // Reutiliza el mapeo para simplificar o ajusta según tu Nginx
                const socketLab = io({ path: '/laboratorio/socket.io' });
                let temporizador = null;

                socketLab.on('connect', () => {
                    console.log('Conectado exitosamente al bus de laboratorio.');
                });

                function alternarTransmision() {
                    const statusBox = document.getElementById('status-box');
                    const logBox = document.getElementById('telemetria-log');

                    if (temporizador) {
                        clearInterval(temporizador);
                        temporizador = null;
                        statusBox.innerText = "Estado del Dispositivo: DETENIDO";
                        statusBox.style.background = "#fff3cd";
                        statusBox.style.color = "#856404";
                    } else {
                        statusBox.innerText = "Estado del Dispositivo: TRANSMITIENDO DATOS";
                        statusBox.style.background = "#d4edda";
                        statusBox.style.color = "#155724";
                        if(logBox.innerText.includes("Esperando")) logBox.innerHTML = "";

                        // Simular envío continuo de datos médicos cada 2 segundos
                        temporizador = setInterval(() => {
                            const telemetria = {
                                equipo_modelo: "Analizador-PCR-BioTech",
                                id_muestra: "MUESTRA-" + Math.floor(Math.random() * 90000 + 10000),
                                temperatura_bloque: (Math.random() * (37.5 - 36.2) + 36.2).toFixed(2),
                                ciclos_completados: Math.floor(Math.random() * 40) + 1,
                                carga_viral_estimada: (Math.random() * 5.5).toFixed(2) + " log copies/mL"
                            };

                            // Emitir los datos por WebSocket hacia el backend
                            socketLab.emit('envio-telemetria', telemetria);

                            // Pintar el registro en la pantalla del cliente
                            const item = document.createElement('div');
                            item.className = "log-item";
                            item.innerHTML = "• [" + new Date().toLocaleTimeString() + "] Enviado: " + telemetria.id_muestra + " | Temp: " + telemetria.temperatura_bloque + "°C";
                            logBox.insertBefore(item, logBox.firstChild);
                        }, 2000);
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// Capturar eventos de WebSocket del dispositivo IoT
io.on('connection', (socket) => {
    console.log('Nuevo dispositivo o pantalla de laboratorio acoplada: ' + socket.id);

    socket.on('envio-telemetria', async (data) => {
        console.log('📥 Datos de telemetría IoT recibidos en el servidor:', data);

        // PERSISTENCIA EN BASE DE DATOS NOSQL (MongoDB)
        if (db) {
            try {
                const colecciónLogs = db.collection('logs_muestras_lab');
                await colecciónLogs.insertOne({
                    ...data,
                    fecha_auditoria_sistema: new Date()
                });
                console.log('💾 Log telemétrico guardado exitosamente en MongoDB (Colección NoSQL).');
            } catch (err) {
                console.error('❌ Error al escribir log en MongoDB:', err);
            }
        }
    });
});

server.listen(4000, () => {
    console.log('Microservicio de Laboratorio escuchando en el puerto 4000');
});