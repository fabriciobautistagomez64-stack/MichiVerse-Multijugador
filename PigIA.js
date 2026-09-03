const CHUNK_SIZE = 16
const UPDATE_INTERVAL = 250
const MAX_PIGS = 32

class PigIA {
    constructor() {
        this.pigs = new Map()
        this.terrain = new Map()
        this.nextPigId = 1
        this.lastUpdate = Date.now()
    }

    setTerrainChunk(chunkX, chunkZ, values, heights = null) {
        if (!Array.isArray(values)) {
            return
        }

        const key = this.chunkKey(chunkX, chunkZ)

        const cells = new Array(CHUNK_SIZE * CHUNK_SIZE)

        for (let i = 0; i < cells.length; i++) {
            const value = Number(values[i] ?? 0)
            const height = heights && heights[i] !== undefined
                ? Number(heights[i])
                : null

            cells[i] = {
                value: Number.isFinite(value) ? Math.max(0, Math.min(99, value)) : 0,
                height: Number.isFinite(height) ? height : null
            }
        }

        this.terrain.set(key, {
            chunkX,
            chunkZ,
            cells,
            updatedAt: Date.now()
        })
    }

    removeTerrainChunk(chunkX, chunkZ) {
        this.terrain.delete(this.chunkKey(chunkX, chunkZ))
    }

    spawnPig(x, y, z) {
        if (this.pigs.size >= MAX_PIGS) {
            return null
        }

        const id = this.nextPigId++

        const pig = {
            id,
            kind: "pig",
            x,
            y,
            z,
            rotY: Math.random() * Math.PI * 2,
            speed: 1.4,
            state: "idle",
            targetX: x,
            targetY: y,
            targetZ: z,
            targetValue: 0,
            thinkTimer: 0,
            wanderTimer: 0
        }

        this.pigs.set(id, pig)

        return pig
    }

    removePig(id) {
        this.pigs.delete(id)
    }

    getPigs() {
        return Array.from(this.pigs.values()).map(pig => ({
            id: pig.id,
            kind: pig.kind,
            x: pig.x,
            y: pig.y,
            z: pig.z,
            rotY: pig.rotY,
            state: pig.state
        }))
    }

    getPig(id) {
        return this.pigs.get(Number(id)) || null
    }

    update(delta) {
        if (this.pigs.size === 0) {
            return
        }

        for (const pig of this.pigs.values()) {
            this.updatePig(pig, delta)
        }
    }

    updatePig(pig, delta) {
        pig.thinkTimer -= delta
        pig.wanderTimer -= delta

        if (pig.thinkTimer <= 0) {
            pig.thinkTimer = 0.5 + Math.random() * 0.8
            this.chooseTarget(pig)
        }

        if (pig.wanderTimer <= 0) {
            pig.wanderTimer = 4 + Math.random() * 6
            this.chooseTarget(pig)
        }

        if (pig.state === "idle") {
            return
        }

        const dx = pig.targetX - pig.x
        const dz = pig.targetZ - pig.z
        const distance = Math.sqrt(dx * dx + dz * dz)

        if (distance < 0.2) {
            pig.state = "idle"
            return
        }

        const dirX = dx / distance
        const dirZ = dz / distance

        const nextX = pig.x + dirX * pig.speed * delta
        const nextZ = pig.z + dirZ * pig.speed * delta

        const nextCell = this.getCellAtWorld(nextX, nextZ)

        if (!nextCell) {
            pig.state = "idle"
            this.chooseTarget(pig)
            return
        }

        if (nextCell.value <= 0) {
            pig.state = "idle"
            this.chooseTarget(pig)
            return
        }

        if (
            nextCell.height !== null &&
            Math.abs(nextCell.height - pig.y) > 1.25
        ) {
            pig.state = "idle"
            this.chooseTarget(pig)
            return
        }

        if (nextCell.height !== null) {
            pig.y += (nextCell.height - pig.y) * Math.min(1, delta * 8)
        }

        pig.x = nextX
        pig.z = nextZ
        pig.rotY = Math.atan2(dirX, dirZ)
    }

    chooseTarget(pig) {
        const centerX = Math.floor(pig.x)
        const centerZ = Math.floor(pig.z)

        let best = null
        let bestScore = -Infinity

        const radius = 8

        for (let z = -radius; z <= radius; z++) {
            for (let x = -radius; x <= radius; x++) {
                const worldX = centerX + x
                const worldZ = centerZ + z

                const cell = this.getCellAtWorld(worldX, worldZ)

                if (!cell) {
                    continue
                }

                if (cell.value <= 0) {
                    continue
                }

                if (
                    cell.height !== null &&
                    Math.abs(cell.height - pig.y) > 1.25
                ) {
                    continue
                }

                const distance = Math.sqrt(x * x + z * z)

                if (distance < 0.5) {
                    continue
                }

                const proximityBonus = Math.max(0, radius - distance) * 2
                const preference = cell.value * 1.5
                const randomFactor = Math.random() * 20

                let score = preference + proximityBonus + randomFactor

                if (cell.value >= 90) {
                    score += 100
                }

                if (distance > 7) {
                    score -= 20
                }

                if (score > bestScore) {
                    bestScore = score

                    best = {
                        x: worldX + 0.5,
                        z: worldZ + 0.5,
                        y: cell.height !== null ? cell.height : pig.y,
                        value: cell.value
                    }
                }
            }
        }

        if (!best) {
            pig.state = "idle"
            return
        }

        pig.targetX = best.x
        pig.targetY = best.y
        pig.targetZ = best.z
        pig.targetValue = best.value
        pig.state = "wander"
    }

    getCellAtWorld(worldX, worldZ) {
        const x = Math.floor(worldX)
        const z = Math.floor(worldZ)

        const chunkX = Math.floor(x / CHUNK_SIZE)
        const chunkZ = Math.floor(z / CHUNK_SIZE)

        const localX = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
        const localZ = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE

        const chunk = this.terrain.get(this.chunkKey(chunkX, chunkZ))

        if (!chunk) {
            return null
        }

        const index = localZ * CHUNK_SIZE + localX

        return chunk.cells[index] || null
    }

    chunkKey(chunkX, chunkZ) {
        return `${chunkX}:${chunkZ}`
    }

    getTerrainChunkCount() {
        return this.terrain.size
    }

    getPigCount() {
        return this.pigs.size
    }
}

module.exports = PigIA
