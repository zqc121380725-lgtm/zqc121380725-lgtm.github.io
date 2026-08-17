const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const INITIAL_WISH_LIMIT = 24;
const STORED_WISH_LIMIT = 500;
const STORED_VISITOR_LIMIT = 200;

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

function loadData() {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const loaded = { ...emptyData(), ...data };
        loaded.totalWishes = Math.max(Number(loaded.totalWishes) || 0, loaded.wishes.length);
        loaded.totalVisitors = Math.max(Number(loaded.totalVisitors) || 0, loaded.visitors.length);
        loaded.wishes = loaded.wishes.slice(-STORED_WISH_LIMIT);
        loaded.visitors = loaded.visitors.slice(-STORED_VISITOR_LIMIT);
        return loaded;
    } catch (error) {
        return emptyData();
    }
}

let data = loadData();

function saveData() {
    const temporaryFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temporaryFile, DATA_FILE);
}

function id() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    saveData();
    return item;
}

function stats() {
    const acceptedEntries = data.rsvp.filter(item => item.status === 'accept');
    return {
        totalVisitors: data.totalVisitors,
        totalRsvp: data.rsvp.length,
        acceptedRsvp: acceptedEntries.length,
        acceptedGuests: acceptedEntries.reduce((total, item) => total + Math.max(Number(item.count) || 1, 1), 0),
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
app.get('/health', (req, res) => res.json({ ok: true, service: 'wedding-invitation-live' }));

io.on('connection', socket => {
    data.totalVisitors += 1;
    const visitor = {
        id: id(),
        timestamp: new Date().toISOString(),
        ip: socket.handshake.address
    };
    data.visitors.push(visitor);
    data.visitors = data.visitors.slice(-STORED_VISITOR_LIMIT);
    saveData();
    io.emit('newVisitor', visitor);
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
            io.emit(broadcastEvent, item);
            io.emit('stats', stats());
        });
    };

    addRecord('rsvp', 'rsvp', 'newRsvp');
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
        io.emit('newWish', item);
        io.emit('stats', stats());
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
        io.emit('newSeatSelect', item);
        io.emit('stats', stats());
    });

    socket.on('markRead', (type, itemId) => {
        if (!Array.isArray(data[type])) return;
        const item = data[type].find(entry => entry.id === itemId);
        if (!item) return;
        item.read = true;
        saveData();
        io.emit('allData', data);
        io.emit('stats', stats());
    });

    socket.on('deleteItem', (type, itemId) => {
        const deletableTypes = new Set(['rsvp', 'wishes', 'treeWishes', 'foodPrefs', 'seatSelections', 'gameScores']);
        if (!deletableTypes.has(type) || !Array.isArray(data[type])) return;
        const index = data[type].findIndex(entry => entry.id === itemId);
        if (index === -1) return;
        data[type].splice(index, 1);
        saveData();
        io.emit('allData', data);
        io.emit('stats', stats());
    });

    socket.on('disconnect', () => {});
});

server.listen(PORT, () => {
    console.log(`Wedding invitation server listening on http://localhost:${PORT}`);
    console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
});