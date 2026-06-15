const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/*
    Seed mundial.
    0 = Superflat
*/
const WORLD_SEED = 12345;

/*
    Jugadores conectados
*/
const players = {};

function now() {
    return Date.now();
}

function isOnline(player) {
    return (now() - player.lastPing) < 10000;
}

/*
    Test
*/
app.get("/", (req, res) => {
    res.send("Michiverse Multiplayer Online");
});

/*
    Información del mundo
*/
app.get("/world", (req, res) => {
    res.json({
        ok: true,
        seed: WORLD_SEED
    });
});

/*
    Entrar al servidor
*/
app.post("/join", (req, res) => {

    const id = String(req.body.id || "");
    const username = String(req.body.username || "Guest");

    if (id === "") {
        return res.status(400).json({
            error: "Missing id"
        });
    }

    players[id] = {
        id: id,
        username: username,

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

/*
    Actualizar posición
*/
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

/*
    Salir
*/
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

/*
    Lista de jugadores
*/
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

/*
    Limpiar desconectados
*/
setInterval(() => {

    for (const id in players) {

        if (!isOnline(players[id])) {

            console.log(
                players[id].username +
                " timed out"
            );

            delete players[id];
        }
    }

}, 5000);

app.listen(PORT, () => {
    console.log(
        "Michiverse Multiplayer running on port " +
        PORT
    );
});
