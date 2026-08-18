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
                signal: AbortSignal.timeout(500)
            });
            if (response.ok) return;
        } catch {}
        await delay(100);
    }
    throw new Error(`等待服务器启动超时：\n${output()}`);
}

async function startServer(port, dataFile) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: PROJECT_DIR,
        env: {
            ...process.env,
            PORT: String(port),
            DATA_FILE: dataFile,
            DATABASE_URL: ''
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
            timeout = setTimeout(() => resolve('timeout'), 5_000);
        })
    ]);
    clearTimeout(timeout);
    if (result === 'timeout') {
        running.child.kill();
        await exited;
    }
}

function connect(port) {
    return new Promise((resolve, reject) => {
        const socket = io(`http://127.0.0.1:${port}`, {
            reconnection: false,
            timeout: 5_000
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

test('祝福、回执和浏览量在服务器重启后仍然存在', async t => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wedding-persistence-'));
    const dataFile = path.join(tempDir, 'data.json');
    const port = await availablePort();
    let running;
    let socket;

    t.after(async () => {
        if (socket) socket.disconnect();
        await stopServer(running);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    running = await startServer(port, dataFile);
    socket = await connect(port);

    const newWish = nextEvent(socket, 'newWish');
    socket.emit('wish', { name: '测试宾客', message: '百年好合' });
    await newWish;

    const newRsvp = nextEvent(socket, 'newRsvp');
    socket.emit('rsvp', {
        name: '测试宾客',
        contact: 'test-contact',
        status: 'accept',
        count: 2
    });
    await newRsvp;

    socket.disconnect();
    socket = null;
    await stopServer(running);

    running = await startServer(port, dataFile);
    socket = await connect(port);
    const allData = nextEvent(socket, 'allData');
    socket.emit('getAllData');
    const restored = await allData;

    assert.equal(restored.wishes.length, 1);
    assert.equal(restored.wishes[0].message, '百年好合');
    assert.equal(restored.rsvp.length, 1);
    assert.equal(restored.rsvp[0].count, 2);
    assert.ok(restored.totalVisitors >= 2);
});
