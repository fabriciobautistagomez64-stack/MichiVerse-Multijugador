const express = require("express");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const WORLD_SEED = Math.floor(Math.random() * 9999999);

const players = {};
const chat = [];

function now() {
    return Date.now();
}

function isOnline(player) {
    return (now() - player.lastPing) < 10000;
}

function pushChat(message) {
    chat.push(message);
    if (chat.length > 50) {
        chat.shift();
    }
}

app.get("/", (req, res) => {
    res.send("Michiverse Multiplayer Online");
});

app.get("/world", (req, res) => {
    res.json({ ok: true, seed: WORLD_SEED });
});

app.post("/join", (req, res) => {
    const id = String(req.body.id || "");
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
