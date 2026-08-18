const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const { io } = require('socket.io-client');

const PROJECT_DIR = path.resolve(__dirname, '..');
const ADMIN_TOKEN = 'integration-test-admin-token';

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function availablePort() {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const { port } = probe.address();
    await new Promise(resolve => probe.close(resolve));
    return port;
}

async function waitForHealth(port, child, output) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`服务器提前退出：\n${output()}`);
        }
        try {
            const response = await fetch(`http://127.0.0.1:${port}/health`, {
                signal: AbortSignal.timeout(700)
            });
            if (response.ok) return;
        } catch {}
        await delay(100);
    }
    throw new Error(`等待服务器启动超时：\n${output()}`);
}

async function startServer(port, dataFile, backupDirectory) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: PROJECT_DIR,
        env: {
            ...process.env,
            PORT: String(port),
            DATA_FILE: dataFile,
            BACKUP_DIR: backupDirectory,
            DATABASE_URL: '',
            ADMIN_TOKEN,
            SNAPSHOT_EVERY: '3'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let logs = '';
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    await waitForHealth(port, child, () => logs);
    return { child, logs: () => logs };
}

async function stopServer(running) {
    if (!running || running.child.exitCode !== null) return;
    const exited = once(running.child, 'exit');
    running.child.kill('SIGTERM');
    let timeout;
    const result = await Promise.race([
        exited.then(() => 'exited'),
        new Promise(resolve => {
            timeout = setTimeout(() => resolve('timeout'), 7_000);
        })
    ]);
    clearTimeout(timeout);
    if (result === 'timeout') {
        running.child.kill();
        await exited;
    }
}

function connect(port, suffix = 'default') {
    return new Promise((resolve, reject) => {
        const socket = io(`http://127.0.0.1:${port}`, {
            reconnection: false,
            timeout: 5_000,
            auth: {
                adminToken: ADMIN_TOKEN,
                visitorId: `test-visitor-${suffix}`
            }
        });
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

function connectGuest(port, suffix = 'guest') {
    return new Promise((resolve, reject) => {
        const socket = io(`http://127.0.0.1:${port}`, {
            reconnection: false,
            timeout: 5_000,
            auth: { visitorId: `guest-visitor-${suffix}` }
        });
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

function nextEvent(socket, eventName) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error(`等待 ${eventName} 事件超时`)),
            5_000
        );
        socket.once(eventName, payload => {
            clearTimeout(timeout);
            resolve(payload);
        });
    });
}

async function emitWithAck(socket, eventName, ...payload) {
    return socket.timeout(5_000).emitWithAck(eventName, ...payload);
}

function readEventLog(backupDirectory) {
    return fs.readFileSync(
        path.join(backupDirectory, 'wedding-events.jsonl'),
        'utf8'
    ).trim().split(/\r?\n/).map(line => JSON.parse(line));
}

test('祝福、回执、浏览量与 HTTP 去重在重启后仍然存在', async t => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wedding-persistence-'));
    const dataFile = path.join(tempDir, 'data.json');
    const backupDirectory = path.join(tempDir, 'backup');
    const port = await availablePort();
    let running;
    let socket;

    t.after(async () => {
        if (socket) socket.disconnect();
        await stopServer(running);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    running = await startServer(port, dataFile, backupDirectory);
    socket = await connect(port, 'first');
    await fetch(`http://127.0.0.1:${port}/api/visit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientMutationId: 'visit-test-first' })
    });

    const wishAck = await emitWithAck(socket, 'wish', {
        name: '测试宾客',
        message: '百年好合',
        clientMutationId: 'wish-socket-001'
    });
    assert.equal(wishAck.ok, true);

    const rsvpAck = await emitWithAck(socket, 'rsvp', {
        name: '测试宾客',
        contact: 'test-contact',
        status: 'accept',
        count: 2,
        clientMutationId: 'rsvp-socket-001'
    });
    assert.equal(rsvpAck.ok, true);

    const httpWish = {
        name: '微信回退测试',
        message: '永结同心',
        clientMutationId: 'wish-http-001'
    };
    const firstResponse = await fetch(`http://127.0.0.1:${port}/api/wishes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(httpWish)
    });
    assert.equal(firstResponse.status, 201);
    const duplicateResponse = await fetch(`http://127.0.0.1:${port}/api/wishes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(httpWish)
    });
    assert.equal(duplicateResponse.status, 200);
    assert.equal((await duplicateResponse.json()).duplicate, true);

    socket.disconnect();
    socket = null;
    await stopServer(running);

    running = await startServer(port, dataFile, backupDirectory);
    socket = await connect(port, 'second');
    await fetch(`http://127.0.0.1:${port}/api/visit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientMutationId: 'visit-test-second' })
    });
    const allData = nextEvent(socket, 'allData');
    socket.emit('getAllData');
    const restored = await allData;

    assert.equal(restored.wishes.length, 2);
    assert.deepEqual(restored.wishes.map(item => item.message).sort(), ['永结同心', '百年好合']);
    assert.equal(restored.rsvp.length, 1);
    assert.equal(restored.rsvp[0].count, 2);
    assert.ok(restored.totalVisitors >= 2);

    const events = readEventLog(backupDirectory);
    assert.equal(events.filter(entry => entry.event.eventType === 'wish.created').length, 2);
    assert.ok(events.every(entry => entry.stateAfter));
    assert.ok(fs.readdirSync(path.join(backupDirectory, 'snapshots')).length >= 3);
});

test('删除前强制快照保留被删除记录，且删除事件为追加写入', async t => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wedding-delete-backup-'));
    const dataFile = path.join(tempDir, 'data.json');
    const backupDirectory = path.join(tempDir, 'backup');
    const port = await availablePort();
    let running;
    let socket;

    t.after(async () => {
        if (socket) socket.disconnect();
        await stopServer(running);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    running = await startServer(port, dataFile, backupDirectory);
    socket = await connect(port, 'delete');
    const wishAck = await emitWithAck(socket, 'wish', {
        name: '待恢复宾客',
        message: '删除快照验证',
        clientMutationId: 'wish-delete-001'
    });
    assert.equal(wishAck.ok, true);

    const deleteAck = await emitWithAck(
        socket,
        'deleteItem',
        'wishes',
        wishAck.item.id
    );
    assert.equal(deleteAck.ok, true);

    const snapshotDirectory = path.join(backupDirectory, 'snapshots');
    const snapshots = fs.readdirSync(snapshotDirectory)
        .map(fileName => JSON.parse(fs.readFileSync(path.join(snapshotDirectory, fileName), 'utf8')));
    const beforeDelete = snapshots.find(snapshot => snapshot.reason === 'before-delete-wishes');
    assert.ok(beforeDelete);
    assert.equal(beforeDelete.state.wishes[0].message, '删除快照验证');

    const events = readEventLog(backupDirectory);
    const deletion = events.find(entry => entry.event.eventType === 'item.deleted');
    assert.ok(deletion);
    assert.equal(deletion.event.payload.item.message, '删除快照验证');
    assert.equal(deletion.stateAfter.wishes.length, 0);
});

test('管理数据受令牌保护，HTTP 互动回退完整可用', async t => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wedding-admin-security-'));
    const dataFile = path.join(tempDir, 'data.json');
    const backupDirectory = path.join(tempDir, 'backup');
    const port = await availablePort();
    let running;
    let adminSocket;
    let guestSocket;

    t.after(async () => {
        if (adminSocket) adminSocket.disconnect();
        if (guestSocket) guestSocket.disconnect();
        await stopServer(running);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    running = await startServer(port, dataFile, backupDirectory);
    adminSocket = await connect(port, 'security-admin');
    guestSocket = await connectGuest(port, 'security-guest');

    const adminError = nextEvent(guestSocket, 'adminError');
    guestSocket.emit('getAllData');
    assert.equal((await adminError).error, '未授权');

    let leakedRsvp = false;
    guestSocket.on('newRsvp', () => { leakedRsvp = true; });
    const adminRsvp = nextEvent(adminSocket, 'newRsvp');
    const rsvpResponse = await fetch(`http://127.0.0.1:${port}/api/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: '隐私测试',
            contact: 'private-contact',
            status: 'accept',
            count: 1,
            clientMutationId: 'privacy-rsvp-001'
        })
    });
    assert.equal(rsvpResponse.status, 201);
    assert.equal((await adminRsvp).contact, 'private-contact');
    await delay(100);
    assert.equal(leakedRsvp, false);

    const routes = [
        ['/api/tree-wishes', { name: '树', message: '幸福', color: '#fce4ec', clientMutationId: 'tree-http-001' }],
        ['/api/food-prefs', { name: '菜品', preferences: ['veg'], note: '', clientMutationId: 'food-http-001' }],
        ['/api/seat-selections', { name: '座位', seat: 'A1', clientMutationId: 'seat-http-001' }],
        ['/api/game-scores', { score: 88, clientMutationId: 'game-http-001' }]
    ];
    for (const [route, body] of routes) {
        const response = await fetch(`http://127.0.0.1:${port}${route}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        assert.equal(response.status, 201, route);
    }

    const unauthorizedBackup = await fetch(`http://127.0.0.1:${port}/api/admin/backup`);
    assert.equal(unauthorizedBackup.status, 401);
    const backupResponse = await fetch(`http://127.0.0.1:${port}/api/admin/backup`, {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    assert.equal(backupResponse.status, 200);
    const backup = await backupResponse.json();
    assert.equal(backup.state.rsvp.length, 1);
    assert.ok(backup.events.length >= 6);
    assert.ok(backup.snapshots.length >= 1);
});
