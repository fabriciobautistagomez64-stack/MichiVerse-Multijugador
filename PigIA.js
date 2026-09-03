"use strict"

class PigIA {
    constructor(options = {}) {
        this.chunkSize = Number(options.chunkSize ?? 16)
        this.moveSpeed = Number(options.moveSpeed ?? 1.4)
        this.wanderMin = Number(options.wanderMin ?? 1000)
        this.wanderMax = Number(options.wanderMax ?? 3000)
        this.targetRadius = Number(options.targetRadius ?? 8)
        this.maxPigs = Number(options.maxPigs ?? 32)

        this.terrain = new Map()
        this.pigs = new Map()

        this.nextPigId = 1
    }

    getPigCount() {
        return this.pigs.size
    }

    getPigs() {
        return Array.from(this.pigs.values()).map(
            pig => this.serializePig(pig)
        )
    }

    setTerrainChunk(chunkX, chunkZ, values, heights) {
        chunkX = Number(chunkX)
        chunkZ = Number(chunkZ)

        if (!Number.isInteger(chunkX)) {
            return false
        }

        if (!Number.isInteger(chunkZ)) {
            return false
        }

        if (!Array.isArray(values)) {
            return false
        }

        if (values.length < 256) {
            return false
        }

        const cleanValues = new Array(256)

        for (let i = 0; i < 256; i++) {
            const value = Number(values[i])

            cleanValues[i] = Number.isFinite(value)
                ? Math.max(0, Math.min(255, Math.floor(value)))
                : 0
        }

        let cleanHeights = null

        if (Array.isArray(heights) && heights.length >= 256) {
            cleanHeights = new Array(256)

            for (let i = 0; i < 256; i++) {
                const height = Number(heights[i])

                cleanHeights[i] = Number.isFinite(height)
                    ? Math.floor(height)
                    : 0
            }
        }

        const key = this.chunkKey(
            chunkX,
            chunkZ
        )

        this.terrain.set(key, {
            chunkX,
            chunkZ,
            values: cleanValues,
            heights: cleanHeights
        })

        return true
    }

    removeTerrainChunk(chunkX, chunkZ) {
        chunkX = Number(chunkX)
        chunkZ = Number(chunkZ)

        if (!Number.isInteger(chunkX)) {
            return false
        }

        if (!Number.isInteger(chunkZ)) {
            return false
        }

        return this.terrain.delete(
            this.chunkKey(
                chunkX,
                chunkZ
            )
        )
    }

    getCellAtWorld(x, z) {
        x = Math.floor(Number(x))
        z = Math.floor(Number(z))

        if (!Number.isFinite(x)) {
            return null
        }

        if (!Number.isFinite(z)) {
            return null
        }

        const chunkX = Math.floor(
            x / this.chunkSize
        )

        const chunkZ = Math.floor(
            z / this.chunkSize
        )

        const localX = this.mod(
            x,
            this.chunkSize
        )

        const localZ = this.mod(
            z,
            this.chunkSize
        )

        const chunk = this.terrain.get(
            this.chunkKey(
                chunkX,
                chunkZ
            )
        )

        if (!chunk) {
            return null
        }

        const index =
            localZ * this.chunkSize +
            localX

        const value = Number(
            chunk.values[index] ?? 0
        )

        let height = null

        if (chunk.heights !== null) {
            height = Number(
                chunk.heights[index]
            )

            if (!Number.isFinite(height)) {
                height = null
            }
        }

        return {
            value,
            height
        }
    }

    spawnPig(x, y, z) {
        if (
            this.pigs.size >=
            this.maxPigs
        ) {
            return null
        }

        x = Number(x)
        y = Number(y)
        z = Number(z)

        if (!Number.isFinite(x)) {
            return null
        }

        if (!Number.isFinite(y)) {
            return null
        }

        if (!Number.isFinite(z)) {
            return null
        }

        const id = String(
            this.nextPigId++
        )

        const pig = {
            id,
            x,
            y,
            z,
            targetX: x,
            targetY: y,
            targetZ: z,
            rotationY: 0,
            state: "idle",
            nextDecision:
                Date.now() +
                this.random(
                    this.wanderMin,
                    this.wanderMax
                )
        }

        this.pigs.set(
            id,
            pig
        )

        return this.serializePig(
            pig
        )
    }

    addPig(x, y, z) {
        return this.spawnPig(
            x,
            y,
            z
        )
    }

    removePig(id) {
        return this.pigs.delete(
            String(id)
        )
    }

    getPig(id) {
        const pig = this.pigs.get(
            String(id)
        )

        if (!pig) {
            return null
        }

        return this.serializePig(
            pig
        )
    }

    update(delta) {
        delta = Number(delta)

        if (!Number.isFinite(delta)) {
            return
        }

        if (delta <= 0) {
            return
        }

        const now = Date.now()

        for (
            const pig of this.pigs.values()
        ) {
            if (
                pig.state === "moving"
            ) {
                this.movePig(
                    pig,
                    delta
                )

                continue
            }

            if (
                now <
                pig.nextDecision
            ) {
                continue
            }

            const target =
                this.findTarget(
                    pig
                )

            if (!target) {
                pig.nextDecision =
                    now +
                    this.random(
                        500,
                        1500
                    )

                continue
            }

            pig.targetX =
                target.x

            pig.targetY =
                target.height + 1

            pig.targetZ =
                target.z

            pig.state = "moving"

            this.updateRotation(
                pig
            )
        }
    }

    movePig(pig, delta) {
        const dx =
            pig.targetX -
            pig.x

        const dz =
            pig.targetZ -
            pig.z

        const distance =
            Math.sqrt(
                dx * dx +
                dz * dz
            )

        if (
            distance <=
            0.001
        ) {
            this.finishMovement(
                pig
            )

            return
        }

        const step =
            this.moveSpeed *
            delta

        if (
            step >= distance
        ) {
            this.finishMovement(
                pig
            )

            return
        }

        const nx =
            dx / distance

        const nz =
            dz / distance

        const nextX =
            pig.x +
            nx * step

        const nextZ =
            pig.z +
            nz * step

        const currentCell =
            this.getCellAtWorld(
                pig.x,
                pig.z
            )

        const nextCell =
            this.getCellAtWorld(
                nextX,
                nextZ
            )

        if (!nextCell) {
            this.stopPig(
                pig
            )

            return
        }

        if (
            !this.isWalkable(
                nextCell.value
            )
        ) {
            this.stopPig(
                pig
            )

            return
        }

        if (
            currentCell &&
            currentCell.height !== null &&
            nextCell.height !== null
        ) {
            const difference =
                Math.abs(
                    nextCell.height -
                    currentCell.height
                )

            if (
                difference > 1
            ) {
                this.stopPig(
                    pig
                )

                return
            }
        }

        pig.x = nextX
        pig.z = nextZ

        if (
            nextCell.height !== null
        ) {
            pig.y =
                nextCell.height + 1
        }

        this.updateRotation(
            pig
        )
    }

    finishMovement(pig) {
        pig.x =
            pig.targetX

        pig.y =
            pig.targetY

        pig.z =
            pig.targetZ

        pig.state = "idle"

        pig.nextDecision =
            Date.now() +
            this.random(
                this.wanderMin,
                this.wanderMax
            )

        this.updateRotation(
            pig
        )
    }

    stopPig(pig) {
        pig.state = "idle"

        pig.nextDecision =
            Date.now() +
            this.random(
                300,
                800
            )
    }

    findTarget(pig) {
        const baseX =
            Math.round(
                pig.x
            )

        const baseZ =
            Math.round(
                pig.z
            )

        const currentCell =
            this.getCellAtWorld(
                baseX,
                baseZ
            )

        const currentHeight =
            currentCell &&
            currentCell.height !== null
                ? currentCell.height
                : Math.round(
                    pig.y - 1
                )

        const candidates = []

        for (
            let dz =
                -this.targetRadius;

            dz <=
                this.targetRadius;

            dz++
        ) {
            for (
                let dx =
                    -this.targetRadius;

                dx <=
                    this.targetRadius;

                dx++
            ) {
                if (
                    dx === 0 &&
                    dz === 0
                ) {
                    continue
                }

                const distance =
                    Math.sqrt(
                        dx * dx +
                        dz * dz
                    )

                if (
                    distance >
                    this.targetRadius
                ) {
                    continue
                }

                const x =
                    baseX + dx

                const z =
                    baseZ + dz

                const cell =
                    this.getCellAtWorld(
                        x,
                        z
                    )

                if (!cell) {
                    continue
                }

                if (
                    !this.isWalkable(
                        cell.value
                    )
                ) {
                    continue
                }

                if (
                    cell.height === null
                ) {
                    continue
                }

                if (
                    Math.abs(
                        cell.height -
                        currentHeight
                    ) > 1
                ) {
                    continue
                }

                let weight = 1

                if (
                    cell.value === 99
                ) {
                    weight += 12
                }

                if (
                    cell.value === 60
                ) {
                    weight += 4
                }

                weight += Math.max(
                    0,
                    this.targetRadius -
                    distance
                )

                candidates.push({
                    x,
                    z,
                    height:
                        cell.height,
                    weight
                })
            }
        }

        if (
            candidates.length === 0
        ) {
            return null
        }

        return this.weightedRandom(
            candidates
        )
    }

    isWalkable(value) {
        return (
            value === 60 ||
            value === 99
        )
    }

    updateRotation(pig) {
        const dx =
            pig.targetX -
            pig.x

        const dz =
            pig.targetZ -
            pig.z

        if (
            Math.abs(dx) < 0.0001 &&
            Math.abs(dz) < 0.0001
        ) {
            return
        }

        pig.rotationY =
            Math.atan2(
                dx,
                dz
            )
    }

    weightedRandom(items) {
        if (
            items.length === 0
        ) {
            return null
        }

        let total = 0

        for (
            const item of items
        ) {
            total += Math.max(
                0,
                Number(
                    item.weight
                ) || 0
            )
        }

        if (
            total <= 0
        ) {
            return items[
                Math.floor(
                    Math.random() *
                    items.length
                )
            ]
        }

        let random =
            Math.random() *
            total

        for (
            const item of items
        ) {
            random -= Math.max(
                0,
                Number(
                    item.weight
                ) || 0
            )

            if (
                random <= 0
            ) {
                return item
            }
        }

        return items[
            items.length - 1
        ]
    }

    serializePig(pig) {
        return {
            id: pig.id,
            x: Number(
                pig.x.toFixed(3)
            ),
            y: Number(
                pig.y.toFixed(3)
            ),
            z: Number(
                pig.z.toFixed(3)
            ),
            targetX: Number(
                pig.targetX.toFixed(3)
            ),
            targetY: Number(
                pig.targetY.toFixed(3)
            ),
            targetZ: Number(
                pig.targetZ.toFixed(3)
            ),
            rotationY: Number(
                pig.rotationY.toFixed(4)
            ),
            state: pig.state
        }
    }

    chunkKey(x, z) {
        return `${x}:${z}`
    }

    mod(value, size) {
        return (
            (
                value % size
            ) +
            size
        ) % size
    }

    random(min, max) {
        return Math.floor(
            Math.random() *
            (
                max -
                min +
                1
            )
        ) + min
    }
}

module.exports = PigIA
