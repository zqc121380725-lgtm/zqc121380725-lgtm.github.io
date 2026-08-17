const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const emptyData = () => ({
    rsvp: [],
    wishes: [],
    treeWishes: [],
    visitors: [],
    foodPrefs: [],
    seatSelections: [],
    gameScores: []
});

function loadData() {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return { ...emptyData(), ...data };
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
    saveData();
    return item;
}

function stats() {
    return {
        totalVisitors: data.visitors.length,
        totalRsvp: data.rsvp.length,
        acceptedRsvp: data.rsvp.filter(item => item.status === 'accept').length,
        declinedRsvp: data.rsvp.filter(item => item.status === 'decline').length,
        totalWishes: data.wishes.length,
        unreadRsvp: data.rsvp.filter(item => !item.read).length,
        unreadWishes: data.wishes.filter(item => !item.read).length,
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
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/health', (req, res) => res.json({ ok: true, service: 'wedding-invitation-live' }));

io.on('connection', socket => {
    const visitor = record('visitors', {}, socket);
    io.emit('newVisitor', visitor);
    socket.emit('initData', {
        wishes: data.wishes,
        treeWishes: data.treeWishes
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
    addRecord('wish', 'wishes', 'newWish');
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

    socket.on('disconnect', () => {});
});

server.listen(PORT, () => {
    console.log(`Wedding invitation server listening on http://localhost:${PORT}`);
    console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
});