const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { createStorage } = require('./storage');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const PUBLIC_DIR = path.join(__dirname, 'public');
const INITIAL_WISH_LIMIT = 24;
const STORED_WISH_LIMIT = 500;
const STORED_VISITOR_LIMIT = 200;
const ARRAY_FIELDS = [
    'rsvp',
    'wishes',
    'treeWishes',
    'visitors',
    'foodPrefs',
    'seatSelections',
    'gameScores'
];

const emptyData = () => ({
    rsvp: [],
    wishes: [],
    totalWishes: 0,
    treeWishes: [],
    visitors: [],
    totalVisitors: 0,
    foodPrefs: [],
    seatSelections: [],
    gameScores: []
});

function normalizeData(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('持久化数据格式无效，服务器已停止启动以避免覆盖原数据');
    }

    const loaded = { ...emptyData(), ...input };
    for (const field of ARRAY_FIELDS) {
        if (!Array.isArray(loaded[field])) loaded[field] = [];
    }

    loaded.wishes = loaded.wishes.slice(-STORED_WISH_LIMIT);
    loaded.visitors = loaded.visitors.slice(-STORED_VISITOR_LIMIT);
    loaded.totalWishes = Math.max(Number(loaded.totalWishes) || 0, loaded.wishes.length);
    loaded.totalVisitors = Math.max(Number(loaded.totalVisitors) || 0, loaded.visitors.length);
    return loaded;
}

function loadSeedData() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return emptyData();
        throw new Error(`无法读取初始数据 ${DATA_FILE}: ${error.message}`);
    }
}

function id() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

let data;
let storage;
let saveQueue = Promise.resolve();
let lastSaveError = null;
let lastSavedAt = null;
let shuttingDown = false;

async function saveWithRetry(snapshot) {
    let latestError;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
            await storage.save(snapshot);
            lastSaveError = null;
            lastSavedAt = new Date().toISOString();
            return;
        } catch (error) {
            latestError = error;
            if (attempt < 5) await wait(500 * (2 ** (attempt - 1)));
        }
    }
    throw latestError;
}

function saveData() {
    const snapshot = JSON.parse(JSON.stringify(data));
    const currentSave = saveQueue.then(() => saveWithRetry(snapshot));
    saveQueue = currentSave.catch(error => {
        lastSaveError = error;
        console.error('数据持久化失败（已重试 5 次）:', error.message);
    });
    return currentSave;
}

function record(type, payload, socket) {
    const item = {
        ...payload,
        id: id(),
        timestamp: new Date().toISOString(),
        ip: socket.handshake.address
    };
    data[type].push(item);
    if (type === 'wishes') {
        data.totalWishes += 1;
        data.wishes = data.wishes.slice(-STORED_WISH_LIMIT);
    }
    return item;
}

function stats() {
    const acceptedEntries = data.rsvp.filter(item => item.status === 'accept');
    return {
        totalVisitors: data.totalVisitors,
        totalRsvp: data.rsvp.length,
        acceptedRsvp: acceptedEntries.length,
        acceptedGuests: acceptedEntries.reduce(
            (total, item) => total + Math.max(Number(item.count) || 1, 1),
            0
        ),
        declinedRsvp: data.rsvp.filter(item => item.status === 'decline').length,
        totalWishes: data.totalWishes,
        unreadRsvp: data.rsvp.filter(item => !item.read).length,
        unreadWishes: data.wishes.filter(item => !item.read).length,
        totalTreeWishes: data.treeWishes.length,
        totalFoodPrefs: data.foodPrefs.length,
        totalSeatSelections: data.seatSelections.length,
        totalGameScores: data.gameScores.length
    };
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: true, credentials: true }
});

app.use(express.static(PUBLIC_DIR));
app.get('/theme/old-money.css', (req, res) => res.sendFile(path.join(__dirname, 'old-money.css')));
app.use('/music', express.static(path.join(__dirname, 'music')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/health', (req, res) => res.json({
    ok: true,
    service: 'wedding-invitation-live',
    storage: storage?.kind || 'starting',
    persistence: lastSaveError ? 'degraded' : 'ok',
    lastSavedAt,
    error: lastSaveError ? lastSaveError.message : undefined
}));
app.get('/api/init', (req, res) => res.json({
    wishes: data.wishes.slice(-INITIAL_WISH_LIMIT),
    totalWishes: data.totalWishes,
    treeWishes: data.treeWishes.slice(-INITIAL_WISH_LIMIT)
}));

function notifySaveFailure(socket) {
    socket.emit('storageError', {
        message: '服务器暂时无法保存，请稍后重试。'
    });
}

function persistAndBroadcast(socket, broadcastEvent, item) {
    saveData()
        .then(() => {
            io.emit(broadcastEvent, item);
            io.emit('stats', stats());
        })
        .catch(() => notifySaveFailure(socket));
}

io.on('connection', socket => {
    data.totalVisitors += 1;
    const visitor = {
        id: id(),
        timestamp: new Date().toISOString(),
        ip: socket.handshake.address
    };
    data.visitors.push(visitor);
    data.visitors = data.visitors.slice(-STORED_VISITOR_LIMIT);
    persistAndBroadcast(socket, 'newVisitor', visitor);

    socket.emit('initData', {
        wishes: data.wishes.slice(-INITIAL_WISH_LIMIT),
        totalWishes: data.totalWishes,
        treeWishes: data.treeWishes.slice(-INITIAL_WISH_LIMIT)
    });

    socket.on('getAllData', () => socket.emit('allData', data));
    socket.on('getStats', () => socket.emit('stats', stats()));

    const addRecord = (event, type, broadcastEvent = event) => {
        socket.on(event, payload => {
            const item = record(type, payload || {}, socket);
            persistAndBroadcast(socket, broadcastEvent, item);
        });
    };

    socket.on('rsvp', payload => {
        const name = String(payload?.name || '').trim().slice(0, 30);
        const contact = String(payload?.contact || '').trim().slice(0, 50);
        const status = payload?.status === 'decline' ? 'decline' : 'accept';
        const count = status === 'accept'
            ? Math.min(Math.max(Number(payload?.count) || 1, 1), 99)
            : 1;
        if (!name || !contact) return;
        const item = record('rsvp', { name, contact, status, count }, socket);
        persistAndBroadcast(socket, 'newRsvp', item);
    });

    socket.on('wish', payload => {
        const now = Date.now();
        if (now - (socket.data.lastWishAt || 0) < 2000) return;
        const message = String(payload?.message || '').trim().slice(0, 200);
        if (!message) return;
        socket.data.lastWishAt = now;
        const item = record('wishes', {
            name: String(payload?.name || '匿名').trim().slice(0, 30) || '匿名',
            message
        }, socket);
        persistAndBroadcast(socket, 'newWish', item);
    });

    addRecord('treeWish', 'treeWishes', 'newTreeWish');
    addRecord('foodPref', 'foodPrefs', 'newFoodPref');
    addRecord('gameScore', 'gameScores', 'newGameScore');

    socket.on('seatSelect', payload => {
        const seat = String(payload?.seat || '').trim();
        const alreadyTaken = data.seatSelections.some(item => item.seat === seat);
        if (alreadyTaken) {
            socket.emit('seatTaken', { seat });
            return;
        }
        const item = record('seatSelections', payload || {}, socket);
        persistAndBroadcast(socket, 'newSeatSelect', item);
    });

    socket.on('markRead', (type, itemId) => {
        if (!Array.isArray(data[type])) return;
        const item = data[type].find(entry => entry.id === itemId);
        if (!item) return;
        item.read = true;
        saveData()
            .then(() => {
                io.emit('allData', data);
                io.emit('stats', stats());
            })
            .catch(() => notifySaveFailure(socket));
    });

    socket.on('deleteItem', (type, itemId) => {
        const deletableTypes = new Set([
            'rsvp',
            'wishes',
            'treeWishes',
            'foodPrefs',
            'seatSelections',
            'gameScores'
        ]);
        if (!deletableTypes.has(type) || !Array.isArray(data[type])) return;
        const index = data[type].findIndex(entry => entry.id === itemId);
        if (index === -1) return;
        data[type].splice(index, 1);
        saveData()
            .then(() => {
                io.emit('allData', data);
                io.emit('stats', stats());
            })
            .catch(() => notifySaveFailure(socket));
    });
});

async function start() {
    storage = await createStorage({
        databaseUrl: DATABASE_URL,
        dataFile: DATA_FILE
    });

    const storedData = await storage.load();
    if (storedData) {
        data = normalizeData(storedData);
    } else {
        data = normalizeData(loadSeedData());
        await storage.save(data);
        lastSavedAt = new Date().toISOString();
        console.log('持久化存储为空，已导入 data.json 初始数据');
    }

    server.listen(PORT, () => {
        console.log(`Wedding invitation server listening on http://localhost:${PORT}`);
        console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
        console.log(`Persistent storage: ${storage.kind}`);
        if (storage.kind === 'file') {
            console.warn('未配置 DATABASE_URL；当前为本地文件模式，Render 重启后数据会丢失');
        }
    });
}

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`收到 ${signal}，正在保存数据并关闭服务`);
    io.close();
    server.close();

    try {
        await Promise.race([
            saveData(),
            wait(20_000).then(() => {
                throw new Error('关机保存超时');
            })
        ]);
        await storage.close();
        process.exit(0);
    } catch (error) {
        console.error('关闭服务时保存失败:', error.message);
        process.exit(1);
    }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(error => {
    console.error('服务器启动失败:', error.message);
    process.exit(1);
});
