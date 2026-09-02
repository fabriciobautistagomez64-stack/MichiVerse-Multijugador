const express = require("express")
const http = require("http")
const WebSocket = require("ws")

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000
const WORLD_SEED = Math.floor(Math.random() * 9999999)

const WORLD_TIME_MAX = 500
const WORLD_TIME_SPEED = 1.0
const PLAYER_TIMEOUT = 30000

const WEATHER_TYPES = [
    "soleado",
    "nublado",
    "lluvia"
]

const players = {}
const chat = []
const sockets = new Map()

let worldTime = 0
let weather = "soleado"
let weatherTimer = 0
let nextWeatherChange = 60000 + Math.random() * 120000

function now() {
    return Date.now()
}

function isOnline(player) {
    return (now() - player.lastPing) < PLAYER_TIMEOUT
}

function pushChat(message) {
    chat.push(message)

    if (chat.length > 50) {
        chat.shift()
    }
}

function getPlayersArray() {
    const result = []

    for (const id in players) {
        const p = players[id]

        if (!isOnline(p)) {
            continue
        }

        result.push({
            id: p.id,
            username: p.username,
            x: p.x,
            y: p.y,
            z: p.z,
            rotY: p.rotY
        })
    }

    return result
}

function getStatePayload() {
    return JSON.stringify({
        type: "state",
        ok: true,
        seed: WORLD_SEED,
        time: Math.floor(worldTime),
        weather,
        players: getPlayersArray(),
        chat
    })
}

function broadcastState() {
    const payload = getStatePayload()

    for (const ws of wss.clients) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload)
        }
    }
}

function cleanupPlayer(id, reasonText, notifyClient = true) {
    if (!players[id]) {
        return
    }

    const player = players[id]
    const name = player.username
    const ws = sockets.get(id)

    pushChat({
        type: "leave",
        user: name,
        text: reasonText || `${name} salió del servidor`,
        color: "gray",
        time: now()
    })

    delete players[id]

    if (ws) {
        if (notifyClient && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "kicked",
                reason: reasonText || "Desconectado del servidor"
            }))
        }

        if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, "Disconnected")
        }

        ws.id = null
        sockets.delete(id)
    }

    broadcastState()
}

function createPlayer(id, username, oldPlayer = null) {
    return {
        id,
        username,
        x: oldPlayer ? oldPlayer.x : 0,
        y: oldPlayer ? oldPlayer.y : 80,
        z: oldPlayer ? oldPlayer.z : 0,
        rotY: oldPlayer ? oldPlayer.rotY : 0,
        lastPing: now()
    }
}

function randomWeather() {
    const index = Math.floor(Math.random() * WEATHER_TYPES.length)
    return WEATHER_TYPES[index]
}

const server = http.createServer(app)

const wss = new WebSocket.Server({
    server,
    path: "/ws"
})

app.get("/", (req, res) => {
    res.send("Michiverse Multiplayer Online")
})

app.get("/world", (req, res) => {
    res.json({
        ok: true,
        seed: WORLD_SEED,
        time: Math.floor(worldTime),
        weather
    })
})

app.post("/join", (req, res) => {
    const id = String(req.body.id || "")
    const username = String(req.body.username || "Guest")

    if (!id) {
        return res.status(400).json({
            error: "Missing id"
        })
    }

    const oldPlayer = players[id]

    players[id] = createPlayer(
        id,
        username,
        oldPlayer
    )

    if (!oldPlayer) {
        pushChat({
            type: "join",
            user: username,
            text: `${username} entró al servidor`,
            color: "green",
            time: now()
        })
    }

    broadcastState()

    res.json({
        ok: true,
        seed: WORLD_SEED,
        time: Math.floor(worldTime),
        weather
    })
})

app.post("/leave", (req, res) => {
    const id = String(req.body.id || "")

    if (players[id]) {
        cleanupPlayer(
            id,
            `${players[id].username} salió del servidor`,
            true
        )
    }

    res.json({
        ok: true
    })
})

app.post("/update", (req, res) => {
    const id = String(req.body.id || "")

    if (!players[id]) {
        return res.status(404).json({
            error: "Player not found"
        })
    }

    players[id].x = Number(req.body.x || 0)
    players[id].y = Number(req.body.y || 0)
    players[id].z = Number(req.body.z || 0)
    players[id].rotY = Number(req.body.rotY || 0)
    players[id].lastPing = now()

    broadcastState()

    res.json({
        ok: true
    })
})

app.get("/players", (req, res) => {
    res.json({
        ok: true,
        players: getPlayersArray()
    })
})

app.get("/chat", (req, res) => {
    res.json({
        ok: true,
        chat
    })
})

app.post("/chat", (req, res) => {
    const id = String(req.body.id || "")
    const text = String(req.body.text || "")

    if (!players[id]) {
        return res.status(404).json({
            error: "Player not found"
        })
    }

    if (!text.trim()) {
        return res.json({
            ok: false
        })
    }

    players[id].lastPing = now()

    const msg = {
        type: "chat",
        user: players[id].username,
        text,
        color: "white",
        time: now()
    }

    pushChat(msg)
    broadcastState()

    res.json({
        ok: true
    })
})

wss.on("connection", (ws) => {
    ws.id = null

    ws.send(getStatePayload())

    ws.on("message", (raw) => {
        let data

        try {
            data = JSON.parse(raw.toString())
        } catch {
            return
        }

        if (!data || typeof data !== "object") {
            return
        }

        if (data.type === "ping") {
            if (ws.id && players[ws.id]) {
                players[ws.id].lastPing = now()
            }

            ws.send(JSON.stringify({
                type: "pong",
                time: now()
            }))

            return
        }

        if (data.type === "join") {
            const id = String(data.id || "")
            const username = String(data.username || "Guest")

            if (!id) {
                return
            }

            const oldSocket = sockets.get(id)

            if (oldSocket && oldSocket !== ws) {
                if (oldSocket.readyState === WebSocket.OPEN) {
                    oldSocket.send(JSON.stringify({
                        type: "kicked",
                        reason: "Conectado desde otra sesión"
                    }))

                    oldSocket.close(
                        1000,
                        "Another session connected"
                    )
                }

                oldSocket.id = null
                sockets.delete(id)
            }

            ws.id = id
            sockets.set(id, ws)

            const existed = !!players[id]

            players[id] = createPlayer(
                id,
                username,
                existed ? players[id] : null
            )

            if (!existed) {
                pushChat({
                    type: "join",
                    user: username,
                    text: `${username} entró al servidor`,
                    color: "green",
                    time: now()
                })
            }

            ws.send(getStatePayload())
            broadcastState()

            return
        }

        if (data.type === "move") {
            const id = ws.id || String(data.id || "")

            if (!id || !players[id]) {
                return
            }

            players[id].x = Number(data.x || 0)
            players[id].y = Number(data.y || 0)
            players[id].z = Number(data.z || 0)
            players[id].rotY = Number(data.rotY || 0)
            players[id].lastPing = now()

            broadcastState()

            return
        }

        if (data.type === "chat") {
            const id = ws.id || String(data.id || "")
            const text = String(data.text || "")

            if (!id || !players[id]) {
                return
            }

            if (!text.trim()) {
                return
            }

            players[id].lastPing = now()

            const msg = {
                type: "chat",
                user: players[id].username,
                text,
                color: "white",
                time: now()
            }

            pushChat(msg)
            broadcastState()

            return
        }

        if (data.type === "leave") {
            const id = ws.id || String(data.id || "")

            if (!id || !players[id]) {
                return
            }

            cleanupPlayer(
                id,
                `${players[id].username} salió del servidor`,
                false
            )

            return
        }
    })

    ws.on("close", () => {
        if (!ws.id) {
            return
        }

        const id = ws.id

        if (!players[id]) {
            sockets.delete(id)
            return
        }

        const currentSocket = sockets.get(id)

        if (currentSocket !== ws) {
            return
        }

        cleanupPlayer(
            id,
            `${players[id].username} salió del servidor`,
            false
        )
    })

    ws.on("error", () => {
        if (!ws.id) {
            return
        }

        const id = ws.id

        if (!players[id]) {
            sockets.delete(id)
            return
        }

        const currentSocket = sockets.get(id)

        if (currentSocket !== ws) {
            return
        }

        cleanupPlayer(
            id,
            `${players[id].username} perdió la conexión`,
            false
        )
    })
})

setInterval(() => {
    worldTime += WORLD_TIME_SPEED

    if (worldTime >= WORLD_TIME_MAX) {
        worldTime = 0
    }

    broadcastState()
}, 1000)

setInterval(() => {
    weatherTimer += 5000

    if (weatherTimer < nextWeatherChange) {
        return
    }

    weatherTimer = 0
    weather = randomWeather()
    nextWeatherChange = 60000 + Math.random() * 120000

    pushChat({
        type: "weather",
        user: "Mundo",
        text: `El clima cambió a ${weather}`,
        color: "gray",
        time: now()
    })

    broadcastState()
}, 5000)

setInterval(() => {
    for (const id in players) {
        if (!isOnline(players[id])) {
            cleanupPlayer(
                id,
                `${players[id].username} se desconectó por inactividad`,
                true
            )
        }
    }
}, 5000)

server.listen(PORT, () => {
    console.log("Michiverse running on " + PORT)
})
