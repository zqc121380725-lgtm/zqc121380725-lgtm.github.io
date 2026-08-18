const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const STATE_ID = 1;
const SNAPSHOT_EVERY = Math.max(Number(process.env.SNAPSHOT_EVERY) || 25, 1);

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function ensureDirectory(directory) {
    fs.mkdirSync(directory, { recursive: true });
}

function writeAtomicJson(filePath, payload) {
    ensureDirectory(path.dirname(filePath));
    const temporaryFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const descriptor = fs.openSync(temporaryFile, 'w');
    try {
        fs.writeFileSync(descriptor, JSON.stringify(payload, null, 2), 'utf8');
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
    fs.renameSync(temporaryFile, filePath);
}

function appendDurableJsonLine(filePath, payload) {
    ensureDirectory(path.dirname(filePath));
    const descriptor = fs.openSync(filePath, 'a');
    try {
        fs.writeSync(descriptor, `${JSON.stringify(payload)}\n`, null, 'utf8');
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}

function readJsonLines(filePath) {
    try {
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
        const values = [];
        const invalidLines = [];
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index].trim();
            if (!line) continue;
            try {
                values.push(JSON.parse(line));
            } catch (error) {
                invalidLines.push({ line: index + 1, error: error.message });
            }
        }
        return { values, invalidLines };
    } catch (error) {
        if (error.code === 'ENOENT') return { values: [], invalidLines: [] };
        throw error;
    }
}

function snapshotName(version, reason) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeReason = String(reason || 'periodic').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40);
    return `${String(version).padStart(10, '0')}-${timestamp}-${safeReason}.json`;
}

function createFileStorage(dataFile) {
    const backupRoot = process.env.BACKUP_DIR
        ? path.resolve(process.env.BACKUP_DIR)
        : path.join(path.dirname(dataFile), 'local-backups', 'live');
    const eventFile = path.join(backupRoot, 'wedding-events.jsonl');
    const snapshotDirectory = path.join(backupRoot, 'snapshots');
    const parsedEvents = readJsonLines(eventFile);
    const eventIds = new Set(
        parsedEvents.values.map(entry => entry?.event?.eventId).filter(Boolean)
    );
    let version = parsedEvents.values.reduce(
        (maximum, entry) => Math.max(maximum, Number(entry?.version) || 0),
        0
    );

    function latestLoggedState() {
        for (let index = parsedEvents.values.length - 1; index >= 0; index -= 1) {
            const state = parsedEvents.values[index]?.stateAfter;
            if (state && typeof state === 'object' && !Array.isArray(state)) return clone(state);
        }
        return null;
    }

    function latestSnapshotState() {
        try {
            const files = fs.readdirSync(snapshotDirectory)
                .filter(name => name.endsWith('.json'))
                .sort()
                .reverse();
            for (const fileName of files) {
                try {
                    const snapshot = JSON.parse(
                        fs.readFileSync(path.join(snapshotDirectory, fileName), 'utf8')
                    );
                    if (snapshot?.state && typeof snapshot.state === 'object') {
                        version = Math.max(version, Number(snapshot.version) || 0);
                        return clone(snapshot.state);
                    }
                } catch {}
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        return null;
    }

    function writeSnapshot(state, reason, snapshotVersion = version) {
        ensureDirectory(snapshotDirectory);
        const snapshot = {
            version: snapshotVersion,
            reason,
            createdAt: new Date().toISOString(),
            state: clone(state)
        };
        const filePath = path.join(
            snapshotDirectory,
            snapshotName(snapshotVersion, reason)
        );
        writeAtomicJson(filePath, snapshot);
        return filePath;
    }

    return {
        kind: 'file',

        async load() {
            const loggedState = latestLoggedState();
            if (loggedState) return loggedState;
            try {
                return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    const recovered = latestSnapshotState();
                    if (recovered) return recovered;
                    throw new Error(`无法读取数据文件 ${dataFile}: ${error.message}`);
                }
                return latestSnapshotState();
            }
        },

        async commit({ state, event, beforeSnapshot, forceSnapshot = false }) {
            if (!event?.eventId) throw new Error('持久化事件缺少 eventId');
            if (eventIds.has(event.eventId)) {
                return { version, duplicate: true };
            }

            if (beforeSnapshot) {
                writeSnapshot(beforeSnapshot.state, beforeSnapshot.reason, version);
            }

            const nextVersion = version + 1;
            const committedAt = new Date().toISOString();
            const eventEnvelope = {
                version: nextVersion,
                committedAt,
                event: clone(event),
                // A full state image makes every local JSONL line independently recoverable.
                stateAfter: clone(state)
            };
            appendDurableJsonLine(eventFile, eventEnvelope);
            writeAtomicJson(dataFile, state);

            version = nextVersion;
            eventIds.add(event.eventId);
            parsedEvents.values.push(eventEnvelope);
            if (forceSnapshot || version % SNAPSHOT_EVERY === 0) {
                writeSnapshot(state, forceSnapshot ? 'interaction' : 'periodic', version);
            }
            return { version, duplicate: false, committedAt };
        },

        async snapshot(state, reason = 'manual') {
            return { filePath: writeSnapshot(state, reason, version), version };
        },

        async exportBundle() {
            const snapshots = [];
            try {
                for (const fileName of fs.readdirSync(snapshotDirectory).sort()) {
                    if (!fileName.endsWith('.json')) continue;
                    try {
                        snapshots.push(JSON.parse(
                            fs.readFileSync(path.join(snapshotDirectory, fileName), 'utf8')
                        ));
                    } catch {}
                }
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
            return {
                format: 'wedding-backup-v1',
                exportedAt: new Date().toISOString(),
                storage: 'file',
                version,
                state: await this.load(),
                events: clone(parsedEvents.values),
                invalidEventLines: clone(parsedEvents.invalidLines),
                snapshots
            };
        },

        async getStatus() {
            return {
                version,
                events: eventIds.size,
                invalidEventLines: parsedEvents.invalidLines.length,
                backupRoot
            };
        },

        async close() {}
    };
}

async function createPostgresStorage(databaseUrl) {
    const pool = new Pool({
        connectionString: databaseUrl,
        max: 3,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000,
        allowExitOnIdle: true
    });

    pool.on('error', error => {
        console.error('PostgreSQL 连接池错误:', error.message);
    });

    await pool.query(`
        CREATE TABLE IF NOT EXISTS wedding_state (
            id SMALLINT PRIMARY KEY CHECK (id = 1),
            payload JSONB NOT NULL,
            version BIGINT NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE wedding_state
            ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

        CREATE TABLE IF NOT EXISTS wedding_events (
            event_id TEXT PRIMARY KEY,
            state_version BIGINT NOT NULL,
            event_type TEXT NOT NULL,
            entity_type TEXT,
            entity_id TEXT,
            payload JSONB NOT NULL,
            occurred_at TIMESTAMPTZ NOT NULL,
            committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS wedding_events_version_idx
            ON wedding_events (state_version);
        CREATE INDEX IF NOT EXISTS wedding_events_occurred_at_idx
            ON wedding_events (occurred_at);

        CREATE TABLE IF NOT EXISTS wedding_snapshots (
            snapshot_id BIGSERIAL PRIMARY KEY,
            state_version BIGINT NOT NULL,
            reason TEXT NOT NULL,
            payload JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS wedding_snapshots_version_idx
            ON wedding_snapshots (state_version DESC);

        CREATE OR REPLACE FUNCTION prevent_wedding_event_mutation()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'wedding_events is append-only';
        END;
        $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS wedding_events_append_only ON wedding_events;
        CREATE TRIGGER wedding_events_append_only
            BEFORE UPDATE OR DELETE ON wedding_events
            FOR EACH ROW EXECUTE FUNCTION prevent_wedding_event_mutation();
    `);

    return {
        kind: 'postgres',

        async load() {
            const result = await pool.query(
                'SELECT payload FROM wedding_state WHERE id = $1',
                [STATE_ID]
            );
            return result.rows[0] ? clone(result.rows[0].payload) : null;
        },

        async commit({ state, event, beforeSnapshot, forceSnapshot = false }) {
            if (!event?.eventId) throw new Error('持久化事件缺少 eventId');
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const duplicate = await client.query(
                    'SELECT state_version, committed_at FROM wedding_events WHERE event_id = $1',
                    [event.eventId]
                );
                if (duplicate.rows[0]) {
                    await client.query('COMMIT');
                    return {
                        version: Number(duplicate.rows[0].state_version),
                        duplicate: true,
                        committedAt: duplicate.rows[0].committed_at
                    };
                }

                const current = await client.query(
                    'SELECT payload, version FROM wedding_state WHERE id = $1 FOR UPDATE',
                    [STATE_ID]
                );
                const currentVersion = Number(current.rows[0]?.version) || 0;
                const nextVersion = currentVersion + 1;

                if (beforeSnapshot) {
                    await client.query(
                        `INSERT INTO wedding_snapshots (state_version, reason, payload)
                         VALUES ($1, $2, $3::jsonb)`,
                        [
                            currentVersion,
                            beforeSnapshot.reason,
                            JSON.stringify(beforeSnapshot.state)
                        ]
                    );
                }

                await client.query(
                    `INSERT INTO wedding_state (id, payload, version, updated_at)
                     VALUES ($1, $2::jsonb, $3, NOW())
                     ON CONFLICT (id) DO UPDATE
                     SET payload = EXCLUDED.payload,
                         version = EXCLUDED.version,
                         updated_at = NOW()`,
                    [STATE_ID, JSON.stringify(state), nextVersion]
                );
                await client.query(
                    `INSERT INTO wedding_events (
                        event_id, state_version, event_type, entity_type,
                        entity_id, payload, occurred_at
                     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
                    [
                        event.eventId,
                        nextVersion,
                        event.eventType,
                        event.entityType || null,
                        event.entityId || null,
                        JSON.stringify(event.payload || {}),
                        event.occurredAt
                    ]
                );

                if (forceSnapshot || nextVersion % SNAPSHOT_EVERY === 0) {
                    await client.query(
                        `INSERT INTO wedding_snapshots (state_version, reason, payload)
                         VALUES ($1, $2, $3::jsonb)`,
                        [
                            nextVersion,
                            forceSnapshot ? 'interaction' : 'periodic',
                            JSON.stringify(state)
                        ]
                    );
                }
                await client.query('COMMIT');
                return {
                    version: nextVersion,
                    duplicate: false,
                    committedAt: new Date().toISOString()
                };
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        },

        async snapshot(state, reason = 'manual') {
            const current = await pool.query(
                'SELECT version FROM wedding_state WHERE id = $1',
                [STATE_ID]
            );
            const version = Number(current.rows[0]?.version) || 0;
            const result = await pool.query(
                `INSERT INTO wedding_snapshots (state_version, reason, payload)
                 VALUES ($1, $2, $3::jsonb)
                 RETURNING snapshot_id, created_at`,
                [version, reason, JSON.stringify(state)]
            );
            return { version, ...result.rows[0] };
        },

        async exportBundle() {
            const [stateResult, eventResult, snapshotResult] = await Promise.all([
                pool.query('SELECT payload, version, updated_at FROM wedding_state WHERE id = $1', [STATE_ID]),
                pool.query(`SELECT event_id, state_version, event_type, entity_type,
                                   entity_id, payload, occurred_at, committed_at
                            FROM wedding_events ORDER BY state_version, committed_at`),
                pool.query(`SELECT snapshot_id, state_version, reason, payload, created_at
                            FROM wedding_snapshots ORDER BY state_version, snapshot_id`)
            ]);
            const stateRow = stateResult.rows[0];
            return {
                format: 'wedding-backup-v1',
                exportedAt: new Date().toISOString(),
                storage: 'postgres',
                version: Number(stateRow?.version) || 0,
                stateUpdatedAt: stateRow?.updated_at || null,
                state: stateRow ? clone(stateRow.payload) : null,
                events: clone(eventResult.rows),
                snapshots: clone(snapshotResult.rows)
            };
        },

        async getStatus() {
            const result = await pool.query(`
                SELECT
                    COALESCE((SELECT version FROM wedding_state WHERE id = 1), 0) AS version,
                    (SELECT COUNT(*) FROM wedding_events) AS events,
                    (SELECT COUNT(*) FROM wedding_snapshots) AS snapshots
            `);
            return {
                version: Number(result.rows[0].version),
                events: Number(result.rows[0].events),
                snapshots: Number(result.rows[0].snapshots)
            };
        },

        async close() {
            await pool.end();
        }
    };
}

async function createStorage({ databaseUrl, dataFile }) {
    if (databaseUrl) return createPostgresStorage(databaseUrl);
    return createFileStorage(dataFile);
}

module.exports = {
    createStorage
};
