const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const PigIA = require("./PigIA")

const app = express()

app.use(
    express.json({
        limit: "2mb"
    })
)

const PORT =
    process.env.PORT || 3000

const WORLD_SEED = 192727828

const WORLD_TIME_MAX = 500
const WORLD_TIME_SPEED = 1.0

const PLAYER_TIMEOUT = 120000

const WEATHER_TYPES = [
    "soleado",
    "nublado",
    "lluvia"
]

const PIG_UPDATE_INTERVAL = 250
const PIG_SPAWN_INTERVAL = 8000
const MAX_PIGS = 32

const DAY_START = 0
const NIGHT_START = WORLD_TIME_MAX / 2

const ACCOUNT_SERVER_URL =
    "https://michiverse-server.onrender.com"

const ACCOUNT_USER_PATH =
    "/users/%s"

const ACCOUNT_REQUEST_TIMEOUT =
    8000

const players = {}
const chat = []
const sockets = new Map()
const modifiedBlocks = new Map()
const playerNames = new Map()
const pendingNameRequests = new Map()

const pigIA = new PigIA({
    maxPigs: MAX_PIGS
})

let worldTime = 0
let weather = "soleado"

let weatherTimer = 0

let nextWeatherChange =
    60000 +
    Math.random() * 120000

let pigSpawnTimer = 0

let wasNight = false

function now() {
    return Date.now()
}

function isNightTime() {
    return (
        worldTime >=
        NIGHT_START
    )
}

function isOnline(player) {
    return (
        now() -
        player.lastPing
    ) < PLAYER_TIMEOUT
}

function pushChat(message) {
    chat.push(message)

    if (chat.length > 50) {
        chat.shift()
    }
}

function getCachedPlayerName(id) {
    const cached =
        playerNames.get(
            String(id)
        )

    if (
        typeof cached === "string" &&
        cached.trim()
    ) {
        return cached.trim()
    }

    return null
}

function getFallbackPlayerName(id) {
    return `ID ${id}`
}

function getAccountUserUrl(id) {
    const encodedId =
        encodeURIComponent(
            String(id)
        )

    const path =
        ACCOUNT_USER_PATH.replace(
            "%s",
            encodedId
        )

    return (
        ACCOUNT_SERVER_URL +
        (
            path.startsWith("/")
                ? path
                : "/" + path
        )
    )
}

async function fetchPlayerName(id) {
    const url =
        getAccountUserUrl(id)

    const controller =
        new AbortController()

    const timeout =
        setTimeout(
            () => {
                controller.abort()
            },
            ACCOUNT_REQUEST_TIMEOUT
        )

    try {
        const response =
            await fetch(
                url,
                {
                    method: "GET",
                    headers: {
                        Accept:
                            "application/json"
                    },
                    signal:
                        controller.signal
                }
            )

        if (!response.ok) {
            return null
        }

        const data =
            await response.json()

        const username =
            data &&
            data.user &&
            typeof data.user.username ===
                "string"
                ? data.user.username
                : data &&
                    typeof data.username ===
                        "string"
                    ? data.username
                    : null

        if (
            typeof username !== "string" ||
            !username.trim()
        ) {
            return null
        }

        const cleanName =
            username.trim()

        playerNames.set(
            String(id),
            cleanName
        )

        return cleanName
    } catch {
        return null
    } finally {
        clearTimeout(timeout)
    }
}

async function getPlayerName(id) {
    const stringId =
        String(id)

    const cached =
        getCachedPlayerName(
            stringId
        )

    if (cached) {
        return cached
    }

    if (
        pendingNameRequests.has(
            stringId
        )
    ) {
        return await pendingNameRequests.get(
            stringId
        )
    }

    const request =
        fetchPlayerName(
            stringId
        ).finally(
            () => {
                pendingNameRequests.delete(
                    stringId
                )
            }
        )

    pendingNameRequests.set(
        stringId,
        request
    )

    const result =
        await request

    return (
        result ||
        getFallbackPlayerName(
            stringId
        )
    )
}

function getPlayersArray() {
    const result = []

    for (
        const id in players
    ) {
        const p = players[id]

        if (!isOnline(p)) {
            continue
        }

        result.push({
            id: p.id,
            x: p.x,
            y: p.y,
            z: p.z,
            rotY: p.rotY
        })
    }

    return result
}

function getBlocksArray() {
    return Array.from(
        modifiedBlocks.values()
    )
}

function getStatePayload() {
    return JSON.stringify({
        type: "state",
        ok: true,
        seed: WORLD_SEED,
        time: Math.floor(worldTime),
        worldTime: Math.floor(worldTime),
        weather,
        players: getPlayersArray(),
        chat,
        blocks: getBlocksArray(),
        pigs: pigIA.getPigs()
    })
}

function getJoinPayload() {
    return JSON.stringify({
        type: "join_ok",
        ok: true,
        seed: WORLD_SEED,
        time: Math.floor(worldTime),
        worldTime: Math.floor(worldTime),
        weather,
        chat,
        blocks: getBlocksArray(),
        pigs: pigIA.getPigs()
    })
}

function getBlockKey(
    x,
    y,
    z
) {
    return `${x}:${y}:${z}`
}

function broadcast(data) {
    const payload =
        typeof data === "string"
            ? data
            : JSON.stringify(data)

    for (
        const ws of wss.clients
    ) {
        if (
            ws.readyState ===
            WebSocket.OPEN
        ) {
            try {
                ws.send(payload)
            } catch {
            }
        }
    }
}

function broadcastState() {
    broadcast(
        getStatePayload()
    )
}

function broadcastPigs() {
    broadcast({
        type: "pigs",
        pigs: pigIA.getPigs()
    })
}

function broadcastBlock(data) {
    broadcast(data)
}

function cleanupPlayer(
    id,
    reasonText,
    notifyClient = true
) {
    if (!players[id]) {
        return
    }

    const name =
        getCachedPlayerName(id) ||
        getFallbackPlayerName(id)

    const ws =
        sockets.get(id)

    pushChat({
        type: "leave",
        user: name,
        text:
            reasonText ||
            `${name} salió del servidor`,
        color: "gray",
        time: now()
    })

    delete players[id]

    if (ws) {
        if (
            notifyClient &&
            ws.readyState ===
                WebSocket.OPEN
        ) {
            try {
                ws.send(
                    JSON.stringify({
                        type: "kicked",
                        reason:
                            reasonText ||
                            "Desconectado del servidor"
                    })
                )
            } catch {
            }
        }

        if (
            ws.readyState ===
            WebSocket.OPEN
        ) {
            try {
                ws.close(
                    1000,
                    "Disconnected"
                )
            } catch {
            }
        }

        ws.id = null
        sockets.delete(id)
    }

    broadcastState()
}

function createPlayer(
    id,
    oldPlayer = null
) {
    return {
        id,
        x:
            oldPlayer
                ? oldPlayer.x
                : 0,
        y:
            oldPlayer
                ? oldPlayer.y
                : 80,
        z:
            oldPlayer
                ? oldPlayer.z
                : 0,
        rotY:
            oldPlayer
                ? oldPlayer.rotY
                : 0,
        lastPing: now()
    }
}

function randomWeather() {
    const index =
        Math.floor(
            Math.random() *
            WEATHER_TYPES.length
        )

    return WEATHER_TYPES[index]
}

function getRandomPlayer() {
    const online =
        Object.values(
            players
        ).filter(
            isOnline
        )

    if (
        online.length === 0
    ) {
        return null
    }

    return online[
        Math.floor(
            Math.random() *
            online.length
        )
    ]
}

function trySpawnPig() {
    if (
        pigIA.getPigCount() >=
        MAX_PIGS
    ) {
        return
    }

    const player =
        getRandomPlayer()

    if (!player) {
        return
    }

    const angle =
        Math.random() *
        Math.PI *
        2

    const distance =
        8 +
        Math.random() *
        16

    const x =
        player.x +
        Math.cos(angle) *
        distance

    const z =
        player.z +
        Math.sin(angle) *
        distance

    const cell =
        pigIA.getCellAtWorld(
            x,
            z
        )

    if (!cell) {
        return
    }

    if (
        cell.value <= 0
    ) {
        return
    }

    const y =
        cell.height !== null
            ? cell.height
            : player.y

    const pig =
        pigIA.spawnPig(
            x,
            y + 1,
            z
        )

    if (pig) {
        broadcastPigs()
    }
}

function updateDayNightMessage() {
    const currentNight =
        isNightTime()

    if (
        currentNight ===
        wasNight
    ) {
        return
    }

    wasNight =
        currentNight

    pushChat({
        type: "time",
        user: "Mundo",
        text:
            currentNight
                ? "_______La hora ahora es de noche_______"
                : "_______La hora ahora es de día_______",
        color: "gray",
        time: now()
    })

    broadcastState()
}

const server =
    http.createServer(app)

const wss =
    new WebSocket.Server({
        server,
        path: "/ws"
    })

app.get(
    "/",
    (req, res) => {
        res.send(
            "Michiverse Multiplayer Online"
        )
    }
)

app.get(
    "/world",
    (req, res) => {
        res.json({
            ok: true,
            seed: WORLD_SEED,
            time: Math.floor(
                worldTime
            ),
            worldTime:
                Math.floor(
                    worldTime
                ),
            weather
        })
    }
)

app.get(
    "/players",
    (req, res) => {
        res.json({
            ok: true,
            players:
                getPlayersArray()
        })
    }
)

app.get(
    "/chat",
    (req, res) => {
        res.json({
            ok: true,
            chat
        })
    }
)

app.get(
    "/mobs",
    (req, res) => {
        res.json({
            ok: true,
            mobs:
                pigIA.getPigs()
        })
    }
)

app.post(
    "/join",
    async (req, res) => {
        const id =
            String(
                req.body.id || ""
            )

        if (!id) {
            return res
                .status(400)
                .json({
                    error:
                        "Missing id"
                })
        }

        const username =
            await getPlayerName(id)

        const oldPlayer =
            players[id]

        players[id] =
            createPlayer(
                id,
                oldPlayer
            )

        if (!oldPlayer) {
            pushChat({
                type: "join",
                user: username,
                text:
                    `${username} entró al servidor`,
                color: "green",
                time: now()
            })
        }

        broadcastState()

        res.json({
            ok: true,
            seed: WORLD_SEED,
            time:
                Math.floor(
                    worldTime
                ),
            worldTime:
                Math.floor(
                    worldTime
                ),
            weather,
            chat,
            blocks:
                getBlocksArray(),
            pigs:
                pigIA.getPigs()
        })
    }
)

app.post(
    "/leave",
    (req, res) => {
        const id =
            String(
                req.body.id || ""
            )

        if (players[id]) {
            const username =
                getCachedPlayerName(id) ||
                getFallbackPlayerName(id)

            cleanupPlayer(
                id,
                `${username} salió del servidor`,
                true
            )
        }

        res.json({
            ok: true
        })
    }
)

app.post(
    "/update",
    (req, res) => {
        const id =
            String(
                req.body.id || ""
            )

        if (!players[id]) {
            return res
                .status(404)
                .json({
                    error:
                        "Player not found"
                })
        }

        players[id].x =
            Number(
                req.body.x || 0
            )

        players[id].y =
            Number(
                req.body.y || 0
            )

        players[id].z =
            Number(
                req.body.z || 0
            )

        players[id].rotY =
            Number(
                req.body.rotY || 0
            )

        players[id].lastPing =
            now()

        broadcastState()

        res.json({
            ok: true
        })
    }
)

app.post(
    "/chat",
    async (req, res) => {
        const id =
            String(
                req.body.id || ""
            )

        const text =
            String(
                req.body.text || ""
            )

        if (!players[id]) {
            return res
                .status(404)
                .json({
                    error:
                        "Player not found"
                })
        }

        if (!text.trim()) {
            return res.json({
                ok: false
            })
        }

        players[id].lastPing =
            now()

        const username =
            await getPlayerName(id)

        const msg = {
            type: "chat",
            user: username,
            text,
            color: "white",
            time: now()
        }

        pushChat(msg)

        broadcastState()

        res.json({
            ok: true
        })
    }
)

wss.on(
    "connection",
    ws => {
        ws.id = null

        try {
            ws.send(
                getStatePayload()
            )
        } catch {
        }

        ws.on(
            "message",
            async raw => {
                let data

                try {
                    data =
                        JSON.parse(
                            raw.toString()
                        )
                } catch {
                    return
                }

                if (
                    !data ||
                    typeof data !==
                        "object"
                ) {
                    return
                }

                if (
                    data.type ===
                    "ping"
                ) {
                    if (
                        ws.id &&
                        players[ws.id]
                    ) {
                        players[
                            ws.id
                        ].lastPing =
                            now()
                    }

                    try {
                        ws.send(
                            JSON.stringify({
                                type: "pong",
                                time: now(),
                                worldTime:
                                    Math.floor(
                                        worldTime
                                    ),
                                weather
                            })
                        )
                    } catch {
                    }

                    return
                }

                if (
                    data.type ===
                    "join"
                ) {
                    const id =
                        String(
                            data.id ||
                                ""
                        )

                    if (!id) {
                        return
                    }

                    const oldSocket =
                        sockets.get(
                            id
                        )

                    if (
                        oldSocket &&
                        oldSocket !== ws
                    ) {
                        if (
                            oldSocket.readyState ===
                            WebSocket.OPEN
                        ) {
                            try {
                                oldSocket.send(
                                    JSON.stringify({
                                        type: "kicked",
                                        reason:
                                            "Conectado desde otra sesión"
                                    })
                                )
                            } catch {
                            }

                            try {
                                oldSocket.close(
                                    1000,
                                    "Another session connected"
                                )
                            } catch {
                            }
                        }

                        oldSocket.id =
                            null

                        sockets.delete(
                            id
                        )
                    }

                    const username =
                        await getPlayerName(id)

                    ws.id = id

                    sockets.set(
                        id,
                        ws
                    )

                    const existed =
                        !!players[id]

                    players[id] =
                        createPlayer(
                            id,
                            existed
                                ? players[id]
                                : null
                        )

                    if (
                        !existed
                    ) {
                        pushChat({
                            type: "join",
                            user: username,
                            text:
                                `${username} entró al servidor`,
                            color: "green",
                            time: now()
                        })
                    }

                    try {
                        ws.send(
                            getJoinPayload()
                        )
                    } catch {
                    }

                    broadcastState()

                    return
                }

                if (
                    data.type ===
                    "move"
                ) {
                    const id =
                        ws.id

                    if (
                        !id ||
                        !players[id]
                    ) {
                        return
                    }

                    players[id].x =
                        Number(
                            data.x || 0
                        )

                    players[id].y =
                        Number(
                            data.y || 0
                        )

                    players[id].z =
                        Number(
                            data.z || 0
                        )

                    players[id].rotY =
                        Number(
                            data.rotY ||
                                0
                        )

                    players[id].lastPing =
                        now()

                    broadcastState()

                    return
                }

                if (
                    data.type ===
                    "chat"
                ) {
                    const id =
                        ws.id

                    const text =
                        String(
                            data.text ||
                                ""
                        )

                    if (
                        !id ||
                        !players[id]
                    ) {
                        return
                    }

                    if (
                        !text.trim()
                    ) {
                        return
                    }

                    players[id].lastPing =
                        now()

                    const username =
                        await getPlayerName(
                            id
                        )

                    const msg = {
                        type: "chat",
                        user:
                            username,
                        text,
                        color: "white",
                        time: now()
                    }

                    pushChat(msg)

                    broadcastState()

                    return
                }

                if (
                    data.type ===
                    "terrain"
                ) {
                    const id =
                        ws.id

                    if (
                        !id ||
                        !players[id]
                    ) {
                        return
                    }

                    const chunkX =
                        Number(
                            data.chunkX
                        )

                    const chunkZ =
                        Number(
                            data.chunkZ
                        )

                    const values =
                        data.values

                    const heights =
                        data.heights

                    if (
                        !Number.isInteger(
                            chunkX
                        ) ||
                        !Number.isInteger(
                            chunkZ
                        )
                    ) {
                        return
                    }

                    if (
                        !Array.isArray(
                            values
                        )
                    ) {
                        return
                    }

                    if (
                        values.length <
                        256
                    ) {
                        return
                    }

                    players[id].lastPing =
                        now()

                    pigIA.setTerrainChunk(
                        chunkX,
                        chunkZ,
                        values,
                        Array.isArray(
                            heights
                        )
                            ? heights
                            : null
                    )

                    return
                }

                if (
                    data.type ===
                    "terrain_remove"
                ) {
                    const id =
                        ws.id

                    if (
                        !id ||
                        !players[id]
                    ) {
                        return
                    }

                    const chunkX =
                        Number(
                            data.chunkX
                        )

                    const chunkZ =
                        Number(
                            data.chunkZ
                        )

                    if (
                        !Number.isInteger(
                            chunkX
                        ) ||
                        !Number.isInteger(
                            chunkZ
                        )
                    ) {
                        return
                    }

                    players[id].lastPing =
                        now()

                    pigIA.removeTerrainChunk(
                        chunkX,
                        chunkZ
                    )

                    return
                }

                if (
                    data.type ===
                    "block"
                ) {
                    const id =
                        ws.id

                    if (
                        !id ||
                        !players[id]
                    ) {
                        return
                    }

                    const x =
                        Number(
                            data.x
                        )

                    const y =
                        Number(
                            data.y
                        )

                    const z =
                        Number(
                            data.z
                        )

                    const blockId =
                        Number(
                            data.id
                        )

                    if (
                        !Number.isFinite(
                            x
                        ) ||
                        !Number.isFinite(
                            y
                        ) ||
                        !Number.isFinite(
                            z
                        ) ||
                        !Number.isFinite(
                            blockId
                        )
                    ) {
                        return
                    }

                    players[id].lastPing =
                        now()

                    const blockData = {
                        type:
                            "block_modified",
                        x,
                        y,
                        z,
                        id:
                            blockId,
                        removed:
                            false,
                        player_id:
                            id,
                        time:
                            now()
                    }

                    modifiedBlocks.set(
                        getBlockKey(
                            x,
                            y,
                            z
                        ),
                        blockData
                    )

                    broadcastBlock(
                        blockData
                    )

                    return
                }

                if (
                    data.type ===
                    "block_remove"
                ) {
                    const id =
                        ws.id

                    if (
                        !id ||
                        !players[id]
                    ) {
                        return
                    }

                    const x =
                        Number(
                            data.x
                        )

                    const y =
                        Number(
                            data.y
                        )

                    const z =
                        Number(
                            data.z
                        )

                    if (
                        !Number.isFinite(
                            x
                        ) ||
                        !Number.isFinite(
                            y
                        ) ||
                        !Number.isFinite(
                            z
                        )
                    ) {
                        return
                    }

                    players[id].lastPing =
                        now()

                    const blockData = {
                        type:
                            "block_removed",
                        x,
                        y,
                        z,
                        id: 0,
                        removed:
                            true,
                        player_id:
                            id,
                        time:
                            now()
                    }

                    modifiedBlocks.set(
                        getBlockKey(
                            x,
                            y,
                            z
                        ),
                        blockData
                    )

                    broadcastBlock(
                        blockData
                    )

                    return
                }

                if (
                    data.type ===
                    "leave"
                ) {
                    const id =
                        ws.id

                    if (
                        !id ||
                        !players[id]
                    ) {
                        return
                    }

                    const username =
                        getCachedPlayerName(id) ||
                        getFallbackPlayerName(id)

                    cleanupPlayer(
                        id,
                        `${username} salió del servidor`,
                        false
                    )

                    return
                }
            }
        )

        ws.on(
            "close",
            () => {
                if (!ws.id) {
                    return
                }

                const id =
                    ws.id

                if (
                    !players[id]
                ) {
                    sockets.delete(
                        id
                    )

                    return
                }

                const currentSocket =
                    sockets.get(
                        id
                    )

                if (
                    currentSocket !==
                    ws
                ) {
                    return
                }

                const username =
                    getCachedPlayerName(id) ||
                    getFallbackPlayerName(id)

                cleanupPlayer(
                    id,
                    `${username} salió del servidor`,
                    false
                )
            }
        )

        ws.on(
            "error",
            () => {
                if (!ws.id) {
                    return
                }

                const id =
                    ws.id

                if (
                    !players[id]
                ) {
                    sockets.delete(
                        id
                    )

                    return
                }

                const currentSocket =
                    sockets.get(
                        id
                    )

                if (
                    currentSocket !==
                    ws
                ) {
                    return
                }

                const username =
                    getCachedPlayerName(id) ||
                    getFallbackPlayerName(id)

                cleanupPlayer(
                    id,
                    `${username} perdió la conexión`,
                    false
                )
            }
        )
    }
)

setInterval(
    () => {
        worldTime +=
            WORLD_TIME_SPEED

        if (
            worldTime >=
            WORLD_TIME_MAX
        ) {
            worldTime = 0
        }

        updateDayNightMessage()

        broadcastState()
    },
    1000
)

setInterval(
    () => {
        weatherTimer +=
            5000

        if (
            weatherTimer <
            nextWeatherChange
        ) {
            return
        }

        weatherTimer = 0

        weather =
            randomWeather()

        nextWeatherChange =
            60000 +
            Math.random() *
                120000

        pushChat({
            type: "weather",
            user: "Mundo",
            text:
                `El clima cambió a ${weather}`,
            color: "gray",
            time: now()
        })

        broadcastState()
    },
    5000
)

setInterval(
    () => {
        for (
            const id in players
        ) {
            if (
                !isOnline(
                    players[id]
                )
            ) {
                const username =
                    getCachedPlayerName(id) ||
                    getFallbackPlayerName(id)

                cleanupPlayer(
                    id,
                    `${username} se desconectó por inactividad`,
                    true
                )
            }
        }
    },
    5000
)

setInterval(
    () => {
        try {
            pigIA.update(
                PIG_UPDATE_INTERVAL /
                1000
            )

            broadcastPigs()
        } catch (error) {
            console.error(
                "PigIA update error:",
                error
            )
        }
    },
    PIG_UPDATE_INTERVAL
)

setInterval(
    () => {
        pigSpawnTimer +=
            PIG_SPAWN_INTERVAL

        if (
            pigSpawnTimer <
            PIG_SPAWN_INTERVAL
        ) {
            return
        }

        pigSpawnTimer = 0

        try {
            trySpawnPig()
        } catch (error) {
            console.error(
                "Pig spawn error:",
                error
            )
        }
    },
    PIG_SPAWN_INTERVAL
)

updateDayNightMessage()

server.listen(
    PORT,
    () => {
        console.log(
            "Michiverse running on " +
            PORT
        )

        console.log(
            "World seed: " +
            WORLD_SEED
        )

        console.log(
            "Max pigs: " +
            MAX_PIGS
        )

        console.log(
            "Account server: " +
            ACCOUNT_SERVER_URL
        )
    }
)
