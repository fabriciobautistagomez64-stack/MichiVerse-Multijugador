const express = require("express")
const http = require("http")
const WebSocket = require("ws")

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000
const WORLD_SEED = Math.floor(Math.random() * 9999999)

const players = {}
const chat = []
const sockets = new Map()

function now() {
    return Date.now()
}

function isOnline(player) {
    return (now() - player.lastPing) < 10000
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
        if (!isOnline(p)) continue

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

function cleanupPlayer(id, reasonText) {
    if (!players[id]) return

    const name = players[id].username

    pushChat({
        type: "leave",
        user: name,
        text: reasonText || `${name} salió del servidor`,
        color: "gray",
        time: now()
    })

    delete players[id]

    const ws = sockets.get(id)
    if (ws) {
        ws.id = null
        sockets.delete(id)
    }

    broadcastState()
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
    res.json({ ok: true, seed: WORLD_SEED })
})

app.post("/join", (req, res) => {
    const id = String(req.body.id || "")
    const username = String(req.body.username || "Guest")

    if (!id) return res.status(400).json({ error: "Missing id" })

    const exists = !!players[id]

    players[id] = {
        id,
        username,
        x: exists ? players[id].x : 0,
        y: exists ? players[id].y : 80,
        z: exists ? players[id].z : 0,
        rotY: exists ? players[id].rotY : 0,
        lastPing: now()
    }

    if (!exists) {
        pushChat({
            type: "join",
            user: username,
            text: `${username} entró al servidor`,
            color: "green",
            time: now()
        })
    }

    broadcastState()
    res.json({ ok: true, seed: WORLD_SEED })
})

app.post("/leave", (req, res) => {
    const id = String(req.body.id || "")

    if (players[id]) {
        cleanupPlayer(id, `${players[id].username} salió del servidor`)
    }

    res.json({ ok: true })
})

app.post("/update", (req, res) => {
    const id = String(req.body.id || "")

    if (!players[id]) return res.status(404).json({ error: "Player not found" })

    players[id].x = Number(req.body.x || 0)
    players[id].y = Number(req.body.y || 0)
    players[id].z = Number(req.body.z || 0)
    players[id].rotY = Number(req.body.rotY || 0)
    players[id].lastPing = now()

    broadcastState()
    res.json({ ok: true })
})

app.get("/players", (req, res) => {
    res.json({ ok: true, players: getPlayersArray() })
})

app.get("/chat", (req, res) => {
    res.json({ ok: true, chat })
})

app.post("/chat", (req, res) => {
    const id = String(req.body.id || "")
    const text = String(req.body.text || "")

    if (!players[id]) return res.status(404).json({ error: "Player not found" })
    if (!text.trim()) return res.json({ ok: false })

    const msg = {
        type: "chat",
        user: players[id].username,
        text,
        color: "white",
        time: now()
    }

    pushChat(msg)
    broadcastState()

    res.json({ ok: true })
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

        if (!data || typeof data !== "object") return

        if (data.type === "ping") {
            if (ws.id && players[ws.id]) {
                players[ws.id].lastPing = now()
            }
            ws.send(JSON.stringify({ type: "pong", time: now() }))
            return
        }

        if (data.type === "join") {
            const id = String(data.id || "")
            const username = String(data.username || "Guest")

            if (!id) return

            ws.id = id
            sockets.set(id, ws)

            const existed = !!players[id]

            players[id] = {
                id,
                username,
                x: existed ? players[id].x : 0,
                y: existed ? players[id].y : 80,
                z: existed ? players[id].z : 0,
                rotY: existed ? players[id].rotY : 0,
                lastPing: now()
            }

            if (!existed) {
                pushChat({
                    type: "join",
                    user: username,
                    text: `${username} entró al servidor`,
                    color: "green",
                    time: now()
                })
            }

            broadcastState()
            return
        }

        if (data.type === "move") {
            const id = ws.id || String(data.id || "")
            if (!id || !players[id]) return

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

            if (!id || !players[id]) return
            if (!text.trim()) return

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
            if (!id || !players[id]) return
            cleanupPlayer(id, `${players[id].username} salió del servidor`)
            return
        }
    })

    ws.on("close", () => {
        if (!ws.id) return
        if (!players[ws.id]) return

        cleanupPlayer(ws.id, `${players[ws.id].username} salió del servidor`)
    })
})

setInterval(() => {
    for (const id in players) {
        if (!isOnline(players[id])) {
            cleanupPlayer(id, `${players[id].username} se desconectó`)
        }
    }
}, 5000)

server.listen(PORT, () => {
    console.log("Michiverse running on " + PORT)
})    const id = String(req.body.id || "");
    const username = String(req.body.username || "Guest");

    if (!id) return res.status(400).json({ error: "Missing id" });

    players[id] = {
        id,
        username,
        x: 0,
        y: 80,
        z: 0,
        rotY: 0,
        lastPing: now()
    };

    pushChat({
        type: "join",
        user: username,
        text: `${username} entró al servidor`,
        color: "green",
        time: now()
    });

    res.json({ ok: true, seed: WORLD_SEED });
});

app.post("/leave", (req, res) => {
    const id = String(req.body.id || "");

    if (players[id]) {
        const name = players[id].username;

        pushChat({
            type: "leave",
            user: name,
            text: `${name} salió del servidor`,
            color: "gray",
            time: now()
        });

        delete players[id];
    }

    res.json({ ok: true });
});

app.post("/update", (req, res) => {
    const id = String(req.body.id || "");
    if (!players[id]) return res.status(404).json({ error: "Player not found" });

    players[id].x = Number(req.body.x || 0);
    players[id].y = Number(req.body.y || 0);
    players[id].z = Number(req.body.z || 0);
    players[id].rotY = Number(req.body.rotY || 0);
    players[id].lastPing = now();

    res.json({ ok: true });
});

app.get("/players", (req, res) => {
    const result = [];

    for (const id in players) {
        const p = players[id];
        if (!isOnline(p)) continue;

        result.push({
            id: p.id,
            username: p.username,
            x: p.x,
            y: p.y,
            z: p.z,
            rotY: p.rotY
        });
    }

    res.json({ ok: true, players: result });
});

app.get("/chat", (req, res) => {
    res.json({ ok: true, chat });
});

app.post("/chat", (req, res) => {
    const id = String(req.body.id || "");
    const text = String(req.body.text || "");

    if (!players[id]) return res.status(404).json({ error: "Player not found" });
    if (!text.trim()) return res.json({ ok: false });

    const msg = {
        type: "chat",
        user: players[id].username,
        text,
        color: "white",
        time: now()
    };

    pushChat(msg);

    res.json({ ok: true });
});

setInterval(() => {
    for (const id in players) {
        if (!isOnline(players[id])) {
            const name = players[id].username;

            pushChat({
                type: "timeout",
                user: name,
                text: `${name} se desconectó`,
                color: "gray",
                time: now()
            });

            delete players[id];
        }
    }
}, 5000);

app.listen(PORT, () => {
    console.log("Michiverse running on " + PORT);
});
