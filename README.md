# Simulación de Infraestructura Distribuida para Centro de Salud (SO y Distribuidos).

## Integrantes:
* Benjamín Arancibia.
* Thomas Aranguiz.
* Alexander Donoso.
* Diego Quezada.
* Nicolás Salas.

---

## 1. ¿De qué trata el proyecto?
El objetivo de este proyecto es simular el comportamiento técnico y el flujo de datos en tiempo real de dos áreas críticas de un centro de salud. 

El foco principal está en diseñar una infraestructura robusta que soporte el despliegue. Para lograrlo, implementamos servicios desacoplados, persistencia híbrida de bases de datos, una réplica activa para asegurar la disponibilidad de los datos y comunicación bidireccional ágil.

---

## 2. Infraestructura Base y Sistema Operativo
Para simular un entorno real de producción que sea estable y aislado, trabajamos con la siguiente estructura:

* **Sistema Operativo Anfitrión:** Todo se despliega sobre **Ubuntu Server**, encargado de gestionar el hardware y el motor de contenedores.
* **Contenedores (Docker y Docker Compose):** Cada microservicio y base de datos corre en mini-entornos Linux basados en **Alpine**.
* **API Gateway (Nginx):** Actúa como único punto de entrada en el puerto 80. Se encarga de balancear la carga y mantener abiertos los túneles de WebSockets (`ws://`) sin que el sistema corte las conexiones por inactividad.

---

## 3. Alcance del Proyecto y Simulación (WebSockets)
Para cumplir con la comunicación bidireccional en tiempo real, conectamos las dos áreas usando **WebSockets** a través de `Socket.io`.

### Área 1: Sistema de Tickets y Llamados (Gestión de Pacientes)
* **Funcionalidad:** Simula una sala de espera médica. Cuando un médico llama a un paciente desde su módulo, la pantalla principal se actualiza sin necesidad de recargar la página.
* **Bases de datos:** Las llamadas exitosas se guardan en **PostgreSQL**. A su vez, contamos con un nodo **PostgreSQL Réplica** que clona los datos automáticamente.
* **Seguridad (RBAC):** Usamos roles (Médico, Laboratorista, Administrativo). Si un rol no autorizado intenta llamar a un paciente, el sistema bloquea la acción y dispara una alerta de seguridad.

### Área 2: Procesamiento de Laboratorio y Maquinaria IoT
* **Funcionalidad:** Un script emula el comportamiento de un equipo de laboratorio automatizado (como un analizador PCR).
* **Flujo de datos:** Al encender la máquina, esta empieza a transmitir ráfagas de datos de exámenes médicos mediante WebSockets hacia el backend. Al ser datos masivos y semiestructurados, se almacenan directo en **MongoDB** para no saturar la base de datos relacional.

---

## 4. Comandos de Ejecución.

### Levantamiento del entorno.
Desde la carpeta raíz del proyecto ejecuta:

```bash
docker compose up --build
```

Posteriormente, en tu navegador selecciona la área de trabajo:
Para el **Sistema de Tickets (Área 1)**: ```bash http://localhost/tickets/```
Para la **Maquinaria IoT / Laboratorio (Área 2)**: ```bash http://localhost/laboratorio/```
