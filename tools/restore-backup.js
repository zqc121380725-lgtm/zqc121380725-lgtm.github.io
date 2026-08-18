const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createStorage } = require('../storage');

const ARRAY_FIELDS = [
    'rsvp',
    'wishes',
    'treeWishes',
    'visitors',
    'foodPrefs',
    'seatSelections',
    'gameScores'
];

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : '';
}

function validateState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('备份不包含有效状态对象');
    }
    const state = JSON.parse(JSON.stringify(value));
    for (const field of ARRAY_FIELDS) {
        if (!Array.isArray(state[field])) state[field] = [];
    }
    state.totalWishes = Math.max(Number(state.totalWishes) || 0, state.wishes.length);
    state.totalVisitors = Math.max(Number(state.totalVisitors) || 0, state.visitors.length);
    return state;
}

async function main() {
    const inputName = argument('--input');
    if (!inputName) throw new Error('必须提供 --input <备份文件>');
    if (argument('--confirm') !== 'RESTORE') {
        throw new Error('恢复会改变当前状态；确认后请添加 --confirm RESTORE');
    }

    const input = path.resolve(inputName);
    const parsed = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
    const restoredState = validateState(parsed.state || parsed);
    const storage = await createStorage({
        databaseUrl: String(process.env.DATABASE_URL || '').trim(),
        dataFile: path.resolve(process.env.DATA_FILE || 'data.json')
    });
    try {
        const currentState = await storage.load();
        const result = await storage.commit({
            state: restoredState,
            event: {
                eventId: `restore-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
                eventType: 'state.restored',
                entityType: 'state',
                entityId: '1',
                occurredAt: new Date().toISOString(),
                payload: {
                    sourceFile: path.basename(input),
                    wishes: restoredState.wishes.length,
                    rsvp: restoredState.rsvp.length,
                    visitors: restoredState.visitors.length
                }
            },
            beforeSnapshot: currentState
                ? { state: currentState, reason: 'before-restore' }
                : null,
            forceSnapshot: true
        });
        console.log(`恢复成功，状态版本: ${result.version}`);
        console.log(`祝福: ${restoredState.wishes.length}; 回执: ${restoredState.rsvp.length}; 访客: ${restoredState.visitors.length}`);
    } finally {
        await storage.close();
    }
}

main().catch(error => {
    console.error(`恢复失败: ${error.message}`);
    process.exitCode = 1;
});
