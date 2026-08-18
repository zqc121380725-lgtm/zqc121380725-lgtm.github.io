const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const STATE_ID = 1;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createFileStorage(dataFile) {
    return {
        kind: 'file',

        async load() {
            try {
                return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
            } catch (error) {
                if (error.code === 'ENOENT') return null;
                throw new Error(`无法读取数据文件 ${dataFile}: ${error.message}`);
            }
        },

        async save(payload) {
            fs.mkdirSync(path.dirname(dataFile), { recursive: true });
            const temporaryFile = `${dataFile}.${process.pid}.tmp`;
            fs.writeFileSync(temporaryFile, JSON.stringify(payload, null, 2), 'utf8');
            fs.renameSync(temporaryFile, dataFile);
        },

        async close() {}
    };
}

async function createPostgresStorage(databaseUrl) {
    const pool = new Pool({
        connectionString: databaseUrl,
        max: 3,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000
    });

    pool.on('error', error => {
        console.error('PostgreSQL 连接池错误:', error.message);
    });

    await pool.query(`
        CREATE TABLE IF NOT EXISTS wedding_state (
            id SMALLINT PRIMARY KEY CHECK (id = 1),
            payload JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
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

        async save(payload) {
            await pool.query(
                `INSERT INTO wedding_state (id, payload, updated_at)
                 VALUES ($1, $2::jsonb, NOW())
                 ON CONFLICT (id) DO UPDATE
                 SET payload = EXCLUDED.payload, updated_at = NOW()`,
                [STATE_ID, JSON.stringify(payload)]
            );
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
