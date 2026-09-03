"use strict";

class PigIA {
    constructor(options = {}) {
        this.chunkSize = Number(options.chunkSize ?? 16);
        this.tickInterval = Number(options.tickInterval ?? 100);

        this.moveSpeed = Number(options.moveSpeed ?? 1.4);

        this.wanderMin = Number(
            options.wanderMin ?? 1000
        );

        this.wanderMax = Number(
            options.wanderMax ?? 3000
        );

        this.targetRadius = Number(
            options.targetRadius ?? 8
        );

        this.maxPigs = Number(
            options.maxPigs ?? 256
        );

        this.chunks = new Map();
        this.pigs = new Map();

        this._timer = null;
        this._nextPigId = 1;
    }

    start() {
        if (this._timer !== null) {
            return;
        }

        this._timer = setInterval(() => {
            try {
                this.update(
                    this.tickInterval / 1000
                );
            } catch (error) {
                console.error(
                    "PigIA update error:",
                    error
                );
            }
        }, this.tickInterval);
    }

    stop() {
        if (this._timer === null) {
            return;
        }

        clearInterval(this._timer);
        this._timer = null;
    }

    update(delta) {
        const now = Date.now();

        for (const pig of this.pigs.values()) {
            if (!this.isFinitePig(pig)) {
                continue;
            }

            if (pig.state === "moving") {
                this.movePig(
                    pig,
                    delta
                );

                continue;
            }

            if (now < pig.nextDecision) {
                continue;
            }

            const target = this.findTarget(
                pig
            );

            if (target !== null) {
                pig.targetX = target.x;
                pig.targetY = target.y + 1.0;
                pig.targetZ = target.z;

                pig.state = "moving";

                this.updatePigRotation(
                    pig
                );
            } else {
                pig.nextDecision =
                    now +
                    this.random(
                        500,
                        1500
                    );
            }
        }
    }

    setChunk(
        chunkX,
        chunkZ,
        values,
        heights
    ) {
        chunkX = Number(chunkX);
        chunkZ = Number(chunkZ);

        if (
            !Number.isFinite(chunkX) ||
            !Number.isFinite(chunkZ)
        ) {
            return false;
        }

        if (
            !Array.isArray(values) ||
            values.length !== 256
        ) {
            return false;
        }

        if (
            !Array.isArray(heights) ||
            heights.length !== 256
        ) {
            return false;
        }

        const cleanValues =
            new Uint8Array(256);

        const cleanHeights =
            new Int32Array(256);

        for (let i = 0; i < 256; i++) {
            const value =
                Number(values[i]);

            const height =
                Number(heights[i]);

            cleanValues[i] = Number.isFinite(value)
                ? Math.max(
                    0,
                    Math.min(
                        255,
                        Math.floor(value)
                    )
                )
                : 0;

            cleanHeights[i] =
                Number.isFinite(height)
                    ? Math.floor(height)
                    : 0;
        }

        const key = this.chunkKey(
            chunkX,
            chunkZ
        );

        this.chunks.set(
            key,
            {
                chunkX,
                chunkZ,
                values: cleanValues,
                heights: cleanHeights,
                updatedAt: Date.now()
            }
        );

        return true;
    }

    removeChunk(
        chunkX,
        chunkZ
    ) {
        return this.chunks.delete(
            this.chunkKey(
                Number(chunkX),
                Number(chunkZ)
            )
        );
    }

    hasChunk(
        chunkX,
        chunkZ
    ) {
        return this.chunks.has(
            this.chunkKey(
                Number(chunkX),
                Number(chunkZ)
            )
        );
    }

    getChunkCount() {
        return this.chunks.size;
    }

    addPig(
        x,
        y,
        z
    ) {
        if (
            this.pigs.size >=
            this.maxPigs
        ) {
            return null;
        }

        const id =
            String(
                this._nextPigId++
            );

        const now =
            Date.now();

        const pig = {
            id,

            x: Number(x),
            y: Number(y),
            z: Number(z),

            targetX: Number(x),
            targetY: Number(y),
            targetZ: Number(z),

            rotationY: 0,

            state: "idle",

            nextDecision:
                now +
                this.random(
                    this.wanderMin,
                    this.wanderMax
                )
        };

        if (
            !this.isFinitePig(
                pig
            )
        ) {
            return null;
        }

        const surface =
            this.getSurfaceAt(
                Math.round(x),
                Math.round(z)
            );

        if (surface !== null) {
            if (
                this.isWalkable(
                    surface.value
                )
            ) {
                pig.y =
                    surface.y + 1.0;

                pig.targetY =
                    pig.y;
            }
        }

        this.pigs.set(
            id,
            pig
        );

        return this.serializePig(
            pig
        );
    }

    spawnPigNear(
        x,
        y,
        z
    ) {
        if (
            this.pigs.size >=
            this.maxPigs
        ) {
            return null;
        }

        const baseX =
            Math.round(
                Number(x)
            );

        const baseZ =
            Math.round(
                Number(z)
            );

        const candidates = [];

        const radius = 8;

        for (
            let dz = -radius;
            dz <= radius;
            dz++
        ) {
            for (
                let dx = -radius;
                dx <= radius;
                dx++
            ) {
                if (
                    dx === 0 &&
                    dz === 0
                ) {
                    continue;
                }

                const px =
                    baseX + dx;

                const pz =
                    baseZ + dz;

                const surface =
                    this.getSurfaceAt(
                        px,
                        pz
                    );

                if (
                    surface === null
                ) {
                    continue;
                }

                if (
                    !this.isWalkable(
                        surface.value
                    )
                ) {
                    continue;
                }

                const distance =
                    this.distanceXZ(
                        baseX,
                        baseZ,
                        px,
                        pz
                    );

                if (
                    distance >
                    radius
                ) {
                    continue;
                }

                let weight =
                    Math.max(
                        1,
                        10 - distance
                    );

                if (
                    surface.value === 99
                ) {
                    weight += 10;
                }

                if (
                    surface.value === 60
                ) {
                    weight += 3;
                }

                candidates.push({
                    x: px,
                    y: surface.y,
                    z: pz,
                    weight
                });
            }
        }

        if (
            candidates.length === 0
        ) {
            return null;
        }

        const target =
            this.weightedRandom(
                candidates
            );

        return this.addPig(
            target.x,
            target.y + 1.0,
            target.z
        );
    }

    removePig(id) {
        return this.pigs.delete(
            String(id)
        );
    }

    getPig(id) {
        const pig =
            this.pigs.get(
                String(id)
            );

        if (!pig) {
            return null;
        }

        return this.serializePig(
            pig
        );
    }

    getPigs() {
        return Array.from(
            this.pigs.values()
        ).map(
            pig =>
                this.serializePig(
                    pig
                )
        );
    }

    getPigsArray() {
        return this.getPigs();
    }

    getPigCount() {
        return this.pigs.size;
    }

    clearPigs() {
        this.pigs.clear();
    }

    setMaxPigs(maxPigs) {
        const value =
            Number(maxPigs);

        if (
            !Number.isFinite(value) ||
            value < 0
        ) {
            return false;
        }

        this.maxPigs =
            Math.floor(value);

        while (
            this.pigs.size >
            this.maxPigs
        ) {
            const first =
                this.pigs.keys().next();

            if (first.done) {
                break;
            }

            this.pigs.delete(
                first.value
            );
        }

        return true;
    }

    movePig(
        pig,
        delta
    ) {
        const dx =
            pig.targetX -
            pig.x;

        const dz =
            pig.targetZ -
            pig.z;

        const distance =
            Math.sqrt(
                dx * dx +
                dz * dz
            );

        if (
            distance <=
            0.0001
        ) {
            pig.x =
                pig.targetX;

            pig.y =
                pig.targetY;

            pig.z =
                pig.targetZ;

            pig.state = "idle";

            pig.nextDecision =
                Date.now() +
                this.random(
                    this.wanderMin,
                    this.wanderMax
                );

            return;
        }

        const step =
            this.moveSpeed *
            delta;

        if (
            step >= distance
        ) {
            pig.x =
                pig.targetX;

            pig.y =
                pig.targetY;

            pig.z =
                pig.targetZ;

            pig.state = "idle";

            pig.nextDecision =
                Date.now() +
                this.random(
                    this.wanderMin,
                    this.wanderMax
                );

            return;
        }

        const nx =
            dx / distance;

        const nz =
            dz / distance;

        const nextX =
            pig.x +
            nx * step;

        const nextZ =
            pig.z +
            nz * step;

        const surface =
            this.getSurfaceAt(
                Math.round(nextX),
                Math.round(nextZ)
            );

        if (
            surface === null
        ) {
            pig.state = "idle";

            pig.nextDecision =
                Date.now() +
                this.random(
                    300,
                    800
                );

            return;
        }

        if (
            !this.isWalkable(
                surface.value
            )
        ) {
            pig.state = "idle";

            pig.nextDecision =
                Date.now() +
                this.random(
                    300,
                    800
                );

            return;
        }

        const currentSurface =
            this.getSurfaceAt(
                Math.round(pig.x),
                Math.round(pig.z)
            );

        if (
            currentSurface !== null
        ) {
            const heightDifference =
                Math.abs(
                    surface.y -
                    currentSurface.y
                );

            if (
                heightDifference >
                1
            ) {
                pig.state = "idle";

                pig.nextDecision =
                    Date.now() +
                    this.random(
                        300,
                        800
                    );

                return;
            }
        }

        pig.x =
            nextX;

        pig.z =
            nextZ;

        pig.y =
            surface.y + 1.0;

        this.updatePigRotation(
            pig
        );
    }

    findTarget(
        pig
    ) {
        const baseX =
            Math.round(
                pig.x
            );

        const baseZ =
            Math.round(
                pig.z
            );

        const currentSurface =
            this.getSurfaceAt(
                baseX,
                baseZ
            );

        const currentY =
            currentSurface !== null
                ? currentSurface.y
                : Math.round(
                    pig.y - 1.0
                );

        const candidates = [];

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
                    continue;
                }

                const distance =
                    Math.sqrt(
                        dx * dx +
                        dz * dz
                    );

                if (
                    distance >
                    this.targetRadius
                ) {
                    continue;
                }

                const x =
                    baseX + dx;

                const z =
                    baseZ + dz;

                const surface =
                    this.getSurfaceAt(
                        x,
                        z
                    );

                if (
                    surface === null
                ) {
                    continue;
                }

                if (
                    !this.isWalkable(
                        surface.value
                    )
                ) {
                    continue;
                }

                if (
                    Math.abs(
                        surface.y -
                        currentY
                    ) > 1
                ) {
                    continue;
                }

                let weight = 1;

                if (
                    surface.value === 99
                ) {
                    weight += 12;
                }

                if (
                    surface.value === 60
                ) {
                    weight += 4;
                }

                weight += Math.max(
                    0,
                    this.targetRadius -
                    distance
                );

                candidates.push({
                    x,
                    y: surface.y,
                    z,
                    weight
                });
            }
        }

        if (
            candidates.length === 0
        ) {
            return null;
        }

        return this.weightedRandom(
            candidates
        );
    }

    getSurfaceAt(
        x,
        z
    ) {
        x = Math.floor(
            Number(x)
        );

        z = Math.floor(
            Number(z)
        );

        const chunkX =
            Math.floor(
                x /
                this.chunkSize
            );

        const chunkZ =
            Math.floor(
                z /
                this.chunkSize
            );

        const localX =
            this.mod(
                x,
                this.chunkSize
            );

        const localZ =
            this.mod(
                z,
                this.chunkSize
            );

        const chunk =
            this.chunks.get(
                this.chunkKey(
                    chunkX,
                    chunkZ
                )
            );

        if (
            !chunk
        ) {
            return null;
        }

        const index =
            localZ *
                this.chunkSize +
            localX;

        return {
            value:
                chunk.values[
                    index
                ],

            y:
                chunk.heights[
                    index
                ]
        };
    }

    isWalkable(
        value
    ) {
        return (
            value === 60 ||
            value === 99
        );
    }

    isFinitePig(
        pig
    ) {
        return (
            pig &&
            Number.isFinite(
                pig.x
            ) &&
            Number.isFinite(
                pig.y
            ) &&
            Number.isFinite(
                pig.z
            ) &&
            Number.isFinite(
                pig.targetX
            ) &&
            Number.isFinite(
                pig.targetY
            ) &&
            Number.isFinite(
                pig.targetZ
            )
        );
    }

    updatePigRotation(
        pig
    ) {
        const dx =
            pig.targetX -
            pig.x;

        const dz =
            pig.targetZ -
            pig.z;

        if (
            Math.abs(dx) < 0.0001 &&
            Math.abs(dz) < 0.0001
        ) {
            return;
        }

        pig.rotationY =
            Math.atan2(
                dx,
                dz
            );
    }

    getPigDistance(
        pigId,
        x,
        z
    ) {
        const pig =
            this.pigs.get(
                String(pigId)
            );

        if (!pig) {
            return null;
        }

        return this.distanceXZ(
            pig.x,
            pig.z,
            Number(x),
            Number(z)
        );
    }

    getPigsNear(
        x,
        z,
        radius
    ) {
        const result = [];

        const px =
            Number(x);

        const pz =
            Number(z);

        const maxDistance =
            Number(radius);

        for (
            const pig
            of this.pigs.values()
        ) {
            const distance =
                this.distanceXZ(
                    pig.x,
                    pig.z,
                    px,
                    pz
                );

            if (
                distance <=
                maxDistance
            ) {
                result.push(
                    this.serializePig(
                        pig
                    )
                );
            }
        }

        return result;
    }

    chunkKey(
        x,
        z
    ) {
        return `${x}:${z}`;
    }

    mod(
        value,
        size
    ) {
        return (
            (
                value %
                size
            ) +
            size
        ) % size;
    }

    distanceXZ(
        x1,
        z1,
        x2,
        z2
    ) {
        const dx =
            x2 - x1;

        const dz =
            z2 - z1;

        return Math.sqrt(
            dx * dx +
            dz * dz
        );
    }

    weightedRandom(
        items
    ) {
        if (
            items.length === 0
        ) {
            return null;
        }

        let total = 0;

        for (
            const item of items
        ) {
            total += Math.max(
                0,
                Number(
                    item.weight
                ) || 0
            );
        }

        if (
            total <= 0
        ) {
            return items[
                Math.floor(
                    Math.random() *
                    items.length
                )
            ];
        }

        let random =
            Math.random() *
            total;

        for (
            const item of items
        ) {
            random -= Math.max(
                0,
                Number(
                    item.weight
                ) || 0
            );

            if (
                random <= 0
            ) {
                return item;
            }
        }

        return items[
            items.length - 1
        ];
    }

    random(
        min,
        max
    ) {
        return Math.floor(
            Math.random() *
            (
                max -
                min +
                1
            )
        ) + min;
    }

    serializePig(
        pig
    ) {
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
        };
    }
}

module.exports = PigIA;
