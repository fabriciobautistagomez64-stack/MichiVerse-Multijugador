const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const WORLD_SEED = crypto.randomInt(1, 1000000000);

const players = {};
const chat = [];

function now() {
    return Date.now();
}

function isOnline(player) {
    return (now() - player.lastPing) < 10000;
}

function pushChatMessage(username, message) {
    chat.push({
        username: String(username || "Guest"),
        message: String(message || "").slice(0, 200),
        time: now()
    });

    if (chat.length > 50) {
        chat.shift();
    }
}

app.get("/", (req, res) => {
    res.send("Michiverse Multiplayer Online");
});

app.get("/world", (req, res) => {
    res.json({
        ok: true,
        seed: WORLD_SEED
    });
});

app.post("/join", (req, res) => {
    const id = String(req.body.id || "");
    const username = String(req.body.username || "Guest").slice(0, 24);

    if (id === "") {
        return res.status(400).json({
            error: "Missing id"
        });
    }

    players[id] = {
        id,
        username,
        x: 0,
        y: 80,
        z: 0,
        rotY: 0,
        lastPing: now()
    };

    console.log(username + " joined");

    res.json({
        ok: true,
        seed: WORLD_SEED
    });
});

app.post("/update", (req, res) => {
    const id = String(req.body.id || "");

    if (!players[id]) {
        return res.status(404).json({
            error: "Player not found"
        });
    }

    players[id].x = Number(req.body.x || 0);
    players[id].y = Number(req.body.y || 0);
    players[id].z = Number(req.body.z || 0);
    players[id].rotY = Number(req.body.rotY || 0);
    players[id].lastPing = now();

    res.json({
        ok: true
    });
});

app.post("/leave", (req, res) => {
    const id = String(req.body.id || "");

    if (players[id]) {
        console.log(players[id].username + " left");
        delete players[id];
    }

    res.json({
        ok: true
    });
});

app.get("/players", (req, res) => {
    const result = [];

    for (const id in players) {
        const player = players[id];

        if (!isOnline(player)) {
            continue;
        }

        result.push({
            id: player.id,
            username: player.username,
            x: player.x,
            y: player.y,
            z: player.z,
            rotY: player.rotY
        });
    }

    res.json({
        ok: true,
        players: result
    });
});

app.post("/chat/send", (req, res) => {
    const id = String(req.body.id || "");
    const username = String(req.body.username || "Guest").slice(0, 24);
    const message = String(req.body.message || "").trim().slice(0, 200);

    if (id === "" || message === "") {
        return res.status(400).json({
            error: "Invalid message"
        });
    }

    if (players[id]) {
        players[id].lastPing = now();
    }

    pushChatMessage(username, message);

    res.json({
        ok: true
    });
});

app.get("/chat", (req, res) => {
    res.json({
        ok: true,
        chat
    });
});

setInterval(() => {
    for (const id in players) {
        if (!isOnline(players[id])) {
            console.log(players[id].username + " timed out");
            delete players[id];
        }
    }
}, 5000);

app.listen(PORT, () => {
    console.log("Michiverse Multiplayer running on port " + PORT);
});
