
const express = require("express")

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000

const WORLD_SEED = Math.floor(Math.random() * 999999999)

const players = {}
const chat = []

function now() {
    return Date.now()
}

function isOnline(player) {
    return (now() - player.lastPing) < 10000
}

function pushChat(msg) {
    chat.push(msg)

    if (chat.length > 50) {
        chat.splice(0, chat.length - 50)
    }
}

const joinTexts = [
    "entro al servidor",
    "apareció en el Michiverse",
    "spawned en el mundo",
    "se conectó",
    "entró al caos digital"
]

const leaveTexts = [
    "abandonó el servidor",
    "se desconectó",
    "salió del Michiverse",
    "desapareció",
    "se fue a dormir 😴"
]

app.get("/", (req, res) => {
    res.send("Michiverse Multiplayer Online")
})

app.get("/world", (req, res) => {
    res.json({
        ok: true,
        seed: WORLD_SEED
    })
})

app.post("/join", (req, res) => {

    const id = String(req.body.id || "")
    const username = String(req.body.username || "Guest")

    if (id === "") {
        return res.status(400).json({ error: "Missing id" })
    }

    players[id] = {
        id,
        username,
        x: 0,
        y: 80,
        z: 0,
        rotY: 0,
        lastPing: now()
    }

    pushChat({
        type: "join",
        username,
        text: joinTexts[Math.floor(Math.random() * joinTexts.length)]
    })

    console.log(username + " joined")

    res.json({
        ok: true,
        seed: WORLD_SEED
    })
})

app.post("/leave", (req, res) => {

    const id = String(req.body.id || "")

    if (players[id]) {

        pushChat({
            type: "leave",
            username: players[id].username,
            text: leaveTexts[Math.floor(Math.random() * leaveTexts.length)]
        })

        console.log(players[id].username + " left")

        delete players[id]
    }

    res.json({ ok: true })
})

app.post("/update", (req, res) => {

    const id = String(req.body.id || "")

    if (!players[id]) {
        return res.status(404).json({ error: "Player not found" })
    }

    players[id].x = Number(req.body.x || 0)
    players[id].y = Number(req.body.y || 0)
    players[id].z = Number(req.body.z || 0)
    players[id].rotY = Number(req.body.rotY || 0)
    players[id].lastPing = now()

    res.json({ ok: true })
})

app.get("/players", (req, res) => {

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

    res.json({
        ok: true,
        players: result
    })
})

app.post("/chat", (req, res) => {

    const id = String(req.body.id || "")
    const text = String(req.body.text || "")

    if (!players[id]) {
        return res.status(404).json({ error: "Player not found" })
    }

    if (text.trim() === "") {
        return res.json({ ok: false })
    }

    pushChat({
        type: "chat",
        username: players[id].username,
        text: text.slice(0, 200),
        time: now()
    })

    res.json({ ok: true })
})

app.get("/chat", (req, res) => {
    res.json({
        ok: true,
        messages: chat
    })
})

setInterval(() => {

    for (const id in players) {

        if (!isOnline(players[id])) {

            pushChat({
                type: "leave",
                username: players[id].username,
                text: "abandonó el servidor (timeout)"
            })

            delete players[id]
        }
    }

}, 5000)

app.listen(PORT, () => {
    console.log("Michiverse Multiplayer running on port " + PORT)
    console.log("World seed:", WORLD_SEED)
})
