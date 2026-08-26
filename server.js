const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { createStorage } = require('./storage');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim();
const FRONTEND_URL = String(process.env.FRONTEND_URL || 'https://zt20261003.love').replace(/\/$/, '');
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
const DELETABLE_TYPES = new Set([
    'rsvp',
    'wishes',
    'treeWishes',
    'foodPrefs',
    'seatSelections',
    'gameScores'
]);

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

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeData(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('持久化数据格式无效；服务器已停止启动，以避免覆盖原数据');
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

function mergeById(primary, secondary) {
    const merged = [];
    const seen = new Set();
    for (const item of [...primary, ...secondary]) {
        const key = String(item?.id || JSON.stringify(item));
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(clone(item));
    }
    return merged;
}

function mergeSeedData(stored, seed) {
    const merged = clone(stored);
    for (const field of ARRAY_FIELDS) {
        merged[field] = mergeById(stored[field], seed[field]);
    }
    merged.totalWishes = Math.max(
        Number(stored.totalWishes) || 0,
        Number(seed.totalWishes) || 0,
        merged.wishes.length
    );
    merged.totalVisitors = Math.max(
        Number(stored.totalVisitors) || 0,
        Number(seed.totalVisitors) || 0,
        merged.visitors.length
    );
    return normalizeData(merged);
}

function loadSeedData() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
        if (error.code === 'ENOENT') return emptyData();
        throw new Error(`无法读取初始数据 ${DATA_FILE}: ${error.message}`);
    }
}

function id(prefix = '') {
    const random = crypto.randomBytes(6).toString('base64url');
    return `${prefix}${Date.now()}-${random}`;
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function cleanText(value, limit, fallback = '') {
    const text = String(value ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim()
        .slice(0, limit);
    return text || fallback;
}

function normalizeClientMutationId(value) {
    const mutationId = String(value || '').trim().slice(0, 120);
    return /^[a-zA-Z0-9:_-]+$/.test(mutationId) ? mutationId : '';
}

function requestIp(request) {
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || request.socket.remoteAddress || '';
}

function tokenMatches(candidate) {
    if (!ADMIN_TOKEN || !candidate) return false;
    const expected = Buffer.from(ADMIN_TOKEN);
    const actual = Buffer.from(String(candidate));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function requestIsAdmin(request) {
    const authorization = String(request.headers.authorization || '');
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    return tokenMatches(bearer || request.headers['x-admin-token']);
}

function socketIsAdmin(socket) {
    return tokenMatches(socket.handshake.auth?.adminToken);
}

function socketIsViewer(socket) {
    return socket.handshake.auth?.adminToken === '__public_view__';
}

function maskContact(value) {
    const contact = String(value || '').trim();
    if (!contact) return '';
    if (contact.includes('@')) {
        const [name, domain] = contact.split('@');
        return `${name.slice(0, 1) || '*'}***@${domain || '***'}`;
    }
    const digits = contact.replace(/\D/g, '');
    if (digits.length >= 7) return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
    return contact.length > 2 ? `${contact.slice(0, 1)}***${contact.slice(-1)}` : '**';
}

function maskIp(value) {
    const ip = String(value || '').replace(/^::ffff:/, '');
    const ipv4 = ip.split('.');
    if (ipv4.length === 4) return `${ipv4[0]}.${ipv4[1]}.*.*`;
    const ipv6 = ip.split(':').filter(Boolean);
    return ipv6.length ? `${ipv6.slice(0, 2).join(':')}:****` : '未知IP';
}

function viewerRsvp(item) {
    return { ...item, contact: maskContact(item.contact) };
}

function viewerVisitor(item) {
    return { ...item, ip: maskIp(item.ip) };
}

function stats(state = data) {
    const acceptedEntries = state.rsvp.filter(item => item.status === 'accept');
    return {
        totalVisitors: state.totalVisitors,
        totalRsvp: state.rsvp.length,
        acceptedRsvp: acceptedEntries.length,
        acceptedGuests: acceptedEntries.reduce(
            (total, item) => total + Math.max(Number(item.count) || 1, 1),
            0
        ),
        declinedRsvp: state.rsvp.filter(item => item.status === 'decline').length,
        // The public wall and admin count represent currently retained records.
        // The append-only event log remains the historical audit trail.
        totalWishes: state.wishes.length,
        unreadRsvp: state.rsvp.filter(item => !item.read).length,
        unreadWishes: state.wishes.filter(item => !item.read).length,
        totalTreeWishes: state.treeWishes.length,
        totalFoodPrefs: state.foodPrefs.length,
        totalSeatSelections: state.seatSelections.length,
        totalGameScores: state.gameScores.length
    };
}

function publicData() {
    return {
        wishes: data.wishes.slice(-INITIAL_WISH_LIMIT),
        totalWishes: data.wishes.length,
        treeWishes: data.treeWishes.slice(-INITIAL_WISH_LIMIT),
        stats: stats()
    };
}

let data;
let storage;
let mutationQueue = Promise.resolve();
let lastSaveError = null;
let lastSavedAt = null;
let lastStorageStatus = null;
let shuttingDown = false;

async function persistWithRetry(operation) {
    let latestError;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
            const result = await operation();
            lastSaveError = null;
            lastSavedAt = result?.committedAt || new Date().toISOString();
            return result;
        } catch (error) {
            latestError = error;
            if (attempt < 5) await wait(350 * (2 ** (attempt - 1)));
        }
    }
    lastSaveError = latestError;
    throw latestError;
}

function findExistingMutation(state, entityType, clientMutationId) {
    if (!clientMutationId || !Array.isArray(state[entityType])) return null;
    return state[entityType].find(item => item.clientMutationId === clientMutationId) || null;
}

function enqueueMutation({
    eventType,
    entityType,
    clientMutationId,
    ip,
    apply,
    beforeSnapshotReason,
    forceSnapshot = true
}) {
    const scheduled = mutationQueue.then(async () => {
        const existing = findExistingMutation(data, entityType, clientMutationId);
        if (existing) return { item: clone(existing), duplicate: true, state: data };

        const beforeState = clone(data);
        const nextState = clone(data);
        const item = apply(nextState);
        const eventId = clientMutationId
            ? `client:${eventType}:${clientMutationId}`
            : id('event-');
        const event = {
            eventId,
            eventType,
            entityType,
            entityId: item?.id || null,
            occurredAt: new Date().toISOString(),
            payload: {
                item: clone(item),
                clientMutationId: clientMutationId || null,
                ip
            }
        };
        const commitResult = await persistWithRetry(() => storage.commit({
            state: nextState,
            event,
            beforeSnapshot: beforeSnapshotReason
                ? { state: beforeState, reason: beforeSnapshotReason }
                : null,
            forceSnapshot
        }));

        if (commitResult?.duplicate) {
            data = normalizeData(await storage.load());
            const committed = findExistingMutation(data, entityType, clientMutationId);
            return { item: clone(committed || item), duplicate: true, state: data };
        }
        data = nextState;
        return { item: clone(item), duplicate: false, state: data };
    });
    mutationQueue = scheduled.catch(error => {
        console.error(`事件 ${eventType} 持久化失败（已重试 5 次）:`, error.message);
    });
    return scheduled;
}

function addRecordMutation(type, payload, { eventType, clientMutationId, ip, forceSnapshot = true }) {
    const safePayload = clone(payload || {});
    return enqueueMutation({
        eventType,
        entityType: type,
        clientMutationId,
        ip,
        forceSnapshot,
        apply(nextState) {
            const item = {
                ...safePayload,
                id: id(),
                timestamp: new Date().toISOString(),
                ip
            };
            if (clientMutationId) item.clientMutationId = clientMutationId;
            nextState[type].push(item);
            if (type === 'wishes') {
                nextState.totalWishes += 1;
                nextState.wishes = nextState.wishes.slice(-STORED_WISH_LIMIT);
            }
            if (type === 'visitors') {
                nextState.totalVisitors += 1;
                nextState.visitors = nextState.visitors.slice(-STORED_VISITOR_LIMIT);
            }
            return item;
        }
    });
}

function wishPayload(payload) {
    const message = cleanText(payload?.message, 200);
    if (!message) throw Object.assign(new Error('祝福内容不能为空'), { statusCode: 400 });
    return {
        name: cleanText(payload?.name, 30, '匿名'),
        message
    };
}

function rsvpPayload(payload) {
    const name = cleanText(payload?.name, 30);
    const contact = cleanText(payload?.contact, 50);
    if (!name || !contact) {
        throw Object.assign(new Error('姓名和联系方式不能为空'), { statusCode: 400 });
    }
    const status = payload?.status === 'decline' ? 'decline' : 'accept';
    const count = status === 'accept'
        ? Math.min(Math.max(Number(payload?.count) || 1, 1), 99)
        : 1;
    return { name, contact, status, count };
}

function treeWishPayload(payload) {
    const message = cleanText(payload?.message, 200);
    if (!message) throw Object.assign(new Error('祝福内容不能为空'), { statusCode: 400 });
    return {
        name: cleanText(payload?.name, 30, '匿名'),
        message,
        color: /^#[0-9a-f]{6}$/i.test(String(payload?.color || ''))
            ? String(payload.color)
            : '#fce4ec'
    };
}

function foodPrefPayload(payload) {
    const preferences = Array.isArray(payload?.preferences)
        ? payload.preferences.slice(0, 20).map(value => cleanText(value, 40)).filter(Boolean)
        : [];
    const note = cleanText(payload?.note, 200);
    if (!preferences.length && !note) {
        throw Object.assign(new Error('请选择菜品偏好或填写备注'), { statusCode: 400 });
    }
    return {
        name: cleanText(payload?.name, 30, '匿名'),
        preferences,
        note
    };
}

function gameScorePayload(payload) {
    return { score: Math.min(Math.max(Number(payload?.score) || 0, 0), 100000) };
}

function acknowledgement(callback, payload) {
    if (typeof callback === 'function') callback(payload);
}

function notifySaveFailure(socket, callback, error) {
    const payload = {
        ok: false,
        retryable: true,
        error: '服务器暂时无法确认保存，请稍后重试；不要关闭当前页面。'
    };
    socket.emit('storageError', payload);
    acknowledgement(callback, payload);
    if (error) console.error('客户端写入未确认:', error.message);
}

function broadcastCommitted(eventName, result) {
    const adminOnlyEvents = new Set(['newRsvp', 'newVisitor', 'newFoodPref', 'newGameScore']);
    if (adminOnlyEvents.has(eventName)) {
        io.to('admins').emit(eventName, result.item);
        if (eventName === 'newRsvp') io.to('viewers').emit(eventName, viewerRsvp(result.item));
        if (eventName === 'newVisitor') io.to('viewers').emit(eventName, viewerVisitor(result.item));
    } else if (eventName === 'newSeatSelect') {
        io.to('admins').emit(eventName, result.item);
        io.except('admins').emit(eventName, { seat: result.item.seat });
    } else {
        io.emit(eventName, result.item);
    }
    io.emit('stats', stats(result.state));
}

async function handleSocketRecord(socket, callback, options) {
    try {
        const result = await addRecordMutation(options.type, options.payload, {
            eventType: options.eventType,
            clientMutationId: normalizeClientMutationId(options.clientMutationId),
            ip: socket.handshake.address,
            forceSnapshot: options.forceSnapshot
        });
        if (!result.duplicate) broadcastCommitted(options.broadcastEvent, result);
        acknowledgement(callback, { ok: true, duplicate: result.duplicate, item: result.item });
    } catch (error) {
        if (error.statusCode) {
            acknowledgement(callback, { ok: false, retryable: false, error: error.message });
            return;
        }
        notifySaveFailure(socket, callback, error);
    }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: true, credentials: false },
    serveClient: true,
    maxHttpBufferSize: 64 * 1024
});

app.use((request, response, next) => {
    const origin = request.headers.origin;
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS') return response.sendStatus(204);
    return next();
});
app.use(express.json({ limit: '32kb' }));

app.get('/admin', (request, response) => response.redirect(`${FRONTEND_URL}/admin.html`));
app.get('/health', async (request, response) => {
    try {
        lastStorageStatus = await storage?.getStatus();
    } catch (error) {
        lastSaveError = error;
    }
    response.status(lastSaveError ? 503 : 200).json({
        ok: !lastSaveError,
        service: 'wedding-invitation-live',
        storage: storage?.kind || 'starting',
        persistence: lastSaveError ? 'degraded' : 'ok',
        lastSavedAt,
        backup: lastStorageStatus,
        adminProtection: ADMIN_TOKEN ? 'enabled' : 'not-configured',
        error: lastSaveError ? lastSaveError.message : undefined
    });
});
app.get('/api/init', (request, response) => response.json(publicData()));

app.post('/api/visit', async (request, response, next) => {
    try {
        const result = await addRecordMutation('visitors', {}, {
            eventType: 'visitor.recorded',
            clientMutationId: normalizeClientMutationId(request.body?.clientMutationId),
            ip: requestIp(request),
            forceSnapshot: false
        });
        if (!result.duplicate) broadcastCommitted('newVisitor', result);
        response.status(result.duplicate ? 200 : 201).json({
            ok: true,
            duplicate: result.duplicate,
            totalVisitors: result.state.totalVisitors
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/wishes', async (request, response, next) => {
    try {
        const result = await addRecordMutation('wishes', wishPayload(request.body), {
            eventType: 'wish.created',
            clientMutationId: normalizeClientMutationId(request.body?.clientMutationId),
            ip: requestIp(request)
        });
        if (!result.duplicate) broadcastCommitted('newWish', result);
        response.status(result.duplicate ? 200 : 201).json({
            ok: true,
            duplicate: result.duplicate,
            item: result.item
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/rsvp', async (request, response, next) => {
    try {
        const result = await addRecordMutation('rsvp', rsvpPayload(request.body), {
            eventType: 'rsvp.created',
            clientMutationId: normalizeClientMutationId(request.body?.clientMutationId),
            ip: requestIp(request)
        });
        if (!result.duplicate) broadcastCommitted('newRsvp', result);
        response.status(result.duplicate ? 200 : 201).json({
            ok: true,
            duplicate: result.duplicate,
            item: result.item
        });
    } catch (error) {
        next(error);
    }
});

function addInteractionRoute(route, type, eventType, broadcastEvent, payloadFactory) {
    app.post(route, async (request, response, next) => {
        try {
            const result = await addRecordMutation(type, payloadFactory(request.body), {
                eventType,
                clientMutationId: normalizeClientMutationId(request.body?.clientMutationId),
                ip: requestIp(request)
            });
            if (!result.duplicate) broadcastCommitted(broadcastEvent, result);
            response.status(result.duplicate ? 200 : 201).json({
                ok: true,
                duplicate: result.duplicate,
                item: result.item
            });
        } catch (error) {
            next(error);
        }
    });
}

addInteractionRoute('/api/tree-wishes', 'treeWishes', 'treeWishes.created', 'newTreeWish', treeWishPayload);
addInteractionRoute('/api/food-prefs', 'foodPrefs', 'foodPrefs.created', 'newFoodPref', foodPrefPayload);
addInteractionRoute('/api/game-scores', 'gameScores', 'gameScores.created', 'newGameScore', gameScorePayload);

app.post('/api/seat-selections', async (request, response, next) => {
    const seat = cleanText(request.body?.seat, 30);
    if (!seat) return response.status(400).json({ ok: false, retryable: false, error: '座位不能为空' });
    try {
        const clientMutationId = normalizeClientMutationId(request.body?.clientMutationId);
        const ip = requestIp(request);
        const result = await enqueueMutation({
            eventType: 'seat.selected',
            entityType: 'seatSelections',
            clientMutationId,
            ip,
            apply(nextState) {
                if (nextState.seatSelections.some(item => item.seat === seat)) {
                    throw Object.assign(new Error('座位已被选择'), { statusCode: 409 });
                }
                const item = {
                    name: cleanText(request.body?.name, 30, '匿名'),
                    seat,
                    id: id(),
                    timestamp: new Date().toISOString(),
                    ip
                };
                if (clientMutationId) item.clientMutationId = clientMutationId;
                nextState.seatSelections.push(item);
                return item;
            }
        });
        if (!result.duplicate) broadcastCommitted('newSeatSelect', result);
        return response.status(result.duplicate ? 200 : 201).json({
            ok: true,
            duplicate: result.duplicate,
            item: result.item
        });
    } catch (error) {
        return next(error);
    }
});

app.get('/api/admin/backup', async (request, response, next) => {
    if (!requestIsAdmin(request)) return response.status(401).json({ ok: false, error: '未授权' });
    try {
        const bundle = await storage.exportBundle();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        response.setHeader('Content-Disposition', `attachment; filename="wedding-backup-${stamp}.json"`);
        return response.json(bundle);
    } catch (error) {
        return next(error);
    }
});

app.post('/api/admin/snapshot', async (request, response, next) => {
    if (!requestIsAdmin(request)) return response.status(401).json({ ok: false, error: '未授权' });
    try {
        await mutationQueue;
        const snapshot = await storage.snapshot(data, 'admin-manual');
        return response.json({ ok: true, snapshot });
    } catch (error) {
        return next(error);
    }
});

app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = Number(error.statusCode) || 503;
    if (status >= 500) {
        lastSaveError = error;
        console.error('HTTP 请求失败:', error.message);
    }
    return response.status(status).json({
        ok: false,
        retryable: status >= 500,
        error: status >= 500 ? '服务器暂时无法确认保存，请稍后重试。' : error.message
    });
});

io.on('connection', socket => {
    const isAdmin = socketIsAdmin(socket);
    if (isAdmin) {
        socket.join('admins');
    } else if (socketIsViewer(socket)) {
        socket.join('viewers');
    } else {
        const visitorMutationId = normalizeClientMutationId(socket.handshake.auth?.visitorId)
            || `socket-${socket.id}`;
        addRecordMutation('visitors', {}, {
            eventType: 'visitor.recorded',
            clientMutationId: visitorMutationId,
            ip: socket.handshake.address,
            forceSnapshot: false
        }).then(result => {
            if (!result.duplicate) broadcastCommitted('newVisitor', result);
        }).catch(error => notifySaveFailure(socket, null, error));
    }

    socket.emit('initData', publicData());
    socket.on('getStats', () => socket.emit('stats', stats()));
    socket.on('getAllData', () => {
        if (!socketIsAdmin(socket) && !socketIsViewer(socket)) {
            socket.emit('adminError', { error: '未授权' });
            return;
        }
        if (socketIsViewer(socket)) {
            socket.emit('allData', {
                rsvp: data.rsvp.map(viewerRsvp),
                wishes: data.wishes,
                treeWishes: data.treeWishes,
                visitors: data.visitors.map(viewerVisitor),
                foodPrefs: [],
                seatSelections: [],
                gameScores: []
            });
            return;
        }
        socket.emit('allData', data);
    });

    socket.on('wish', (payload, callback) => {
        const now = Date.now();
        if (now - (socket.data.lastWishAt || 0) < 1500) {
            acknowledgement(callback, { ok: false, retryable: true, error: '提交过快，请稍后重试' });
            return;
        }
        try {
            const cleaned = wishPayload(payload);
            socket.data.lastWishAt = now;
            handleSocketRecord(socket, callback, {
                type: 'wishes',
                eventType: 'wish.created',
                broadcastEvent: 'newWish',
                clientMutationId: payload?.clientMutationId,
                payload: cleaned
            });
        } catch (error) {
            acknowledgement(callback, { ok: false, retryable: false, error: error.message });
        }
    });

    socket.on('rsvp', (payload, callback) => {
        try {
            handleSocketRecord(socket, callback, {
                type: 'rsvp',
                eventType: 'rsvp.created',
                broadcastEvent: 'newRsvp',
                clientMutationId: payload?.clientMutationId,
                payload: rsvpPayload(payload)
            });
        } catch (error) {
            acknowledgement(callback, { ok: false, retryable: false, error: error.message });
        }
    });

    socket.on('treeWish', (payload, callback) => {
        try {
            handleSocketRecord(socket, callback, {
                type: 'treeWishes',
                eventType: 'treeWishes.created',
                broadcastEvent: 'newTreeWish',
                clientMutationId: payload?.clientMutationId,
                payload: treeWishPayload(payload)
            });
        } catch (error) {
            acknowledgement(callback, { ok: false, retryable: false, error: error.message });
        }
    });
    socket.on('foodPref', (payload, callback) => {
        try {
            handleSocketRecord(socket, callback, {
                type: 'foodPrefs',
                eventType: 'foodPrefs.created',
                broadcastEvent: 'newFoodPref',
                clientMutationId: payload?.clientMutationId,
                payload: foodPrefPayload(payload)
            });
        } catch (error) {
            acknowledgement(callback, { ok: false, retryable: false, error: error.message });
        }
    });
    socket.on('gameScore', (payload, callback) => {
        handleSocketRecord(socket, callback, {
            type: 'gameScores',
            eventType: 'gameScores.created',
            broadcastEvent: 'newGameScore',
            clientMutationId: payload?.clientMutationId,
            payload: gameScorePayload(payload)
        });
    });

    socket.on('seatSelect', async (payload, callback) => {
        const seat = cleanText(payload?.seat, 30);
        if (!seat) {
            acknowledgement(callback, { ok: false, retryable: false, error: '座位不能为空' });
            return;
        }
        try {
            const clientMutationId = normalizeClientMutationId(payload?.clientMutationId);
            const result = await enqueueMutation({
                eventType: 'seat.selected',
                entityType: 'seatSelections',
                clientMutationId,
                ip: socket.handshake.address,
                apply(nextState) {
                    if (nextState.seatSelections.some(item => item.seat === seat)) {
                        throw Object.assign(new Error('座位已被选择'), { code: 'SEAT_TAKEN' });
                    }
                    const item = {
                        ...clone(payload || {}),
                        seat,
                        id: id(),
                        timestamp: new Date().toISOString(),
                        ip: socket.handshake.address
                    };
                    if (clientMutationId) item.clientMutationId = clientMutationId;
                    nextState.seatSelections.push(item);
                    return item;
                }
            });
            if (!result.duplicate) broadcastCommitted('newSeatSelect', result);
            acknowledgement(callback, { ok: true, duplicate: result.duplicate, item: result.item });
        } catch (error) {
            if (error.code === 'SEAT_TAKEN') {
                socket.emit('seatTaken', { seat });
                acknowledgement(callback, { ok: false, retryable: false, error: error.message });
            } else {
                notifySaveFailure(socket, callback, error);
            }
        }
    });

    socket.on('markRead', async (type, itemId, callback) => {
        if (!socketIsAdmin(socket)) {
            acknowledgement(callback, { ok: false, error: '未授权' });
            return;
        }
        try {
            const result = await enqueueMutation({
                eventType: 'item.marked_read',
                entityType: type,
                ip: socket.handshake.address,
                apply(nextState) {
                    if (!Array.isArray(nextState[type])) {
                        throw Object.assign(new Error('记录类型无效'), { statusCode: 400 });
                    }
                    const item = nextState[type].find(entry => entry.id === itemId);
                    if (!item) throw Object.assign(new Error('记录不存在'), { statusCode: 404 });
                    item.read = true;
                    return item;
                }
            });
            io.to('admins').emit('allData', data);
            io.emit('stats', stats());
            acknowledgement(callback, { ok: true, item: result.item });
        } catch (error) {
            acknowledgement(callback, { ok: false, error: error.message });
        }
    });

    socket.on('deleteItem', async (type, itemId, callback) => {
        if (!socketIsAdmin(socket)) {
            acknowledgement(callback, { ok: false, error: '未授权' });
            return;
        }
        if (!DELETABLE_TYPES.has(type)) {
            acknowledgement(callback, { ok: false, error: '记录类型不可删除' });
            return;
        }
        try {
            const result = await enqueueMutation({
                eventType: 'item.deleted',
                entityType: type,
                ip: socket.handshake.address,
                beforeSnapshotReason: `before-delete-${type}`,
                apply(nextState) {
                    const index = nextState[type].findIndex(entry => entry.id === itemId);
                    if (index === -1) {
                        throw Object.assign(new Error('记录不存在'), { statusCode: 404 });
                    }
                    const [deletedItem] = nextState[type].splice(index, 1);
                    return deletedItem;
                }
            });
            io.to('admins').emit('allData', data);
            io.emit('stats', stats());
            acknowledgement(callback, { ok: true, deleted: result.item });
        } catch (error) {
            acknowledgement(callback, { ok: false, error: error.message });
        }
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
        const initialStatus = await storage.getStatus();
        // The previous release had only wedding_state and no event log. Merge the
        // recovered seed exactly once, while preserving any records already in DB.
        if (Number(initialStatus.events) === 0) {
            const recoveredSeed = normalizeData(loadSeedData());
            const merged = mergeSeedData(data, recoveredSeed);
            if (JSON.stringify(merged) !== JSON.stringify(data)) {
                const previousState = data;
                data = merged;
                await persistWithRetry(() => storage.commit({
                    state: data,
                    event: {
                        eventId: id('recovery-import-'),
                        eventType: 'state.recovery_imported',
                        entityType: 'state',
                        entityId: '1',
                        occurredAt: new Date().toISOString(),
                        payload: {
                            wishes: data.wishes.length,
                            rsvp: data.rsvp.length,
                            visitors: data.visitors.length
                        }
                    },
                    beforeSnapshot: { state: previousState, reason: 'before-recovery-import' },
                    forceSnapshot: true
                }));
                console.log('已把本机恢复候选与旧数据库状态安全合并，并保留导入前快照');
            }
        }
    } else {
        data = normalizeData(loadSeedData());
        await persistWithRetry(() => storage.commit({
            state: data,
            event: {
                eventId: id('seed-'),
                eventType: 'state.seeded',
                entityType: 'state',
                entityId: '1',
                occurredAt: new Date().toISOString(),
                payload: { source: path.basename(DATA_FILE) }
            },
            forceSnapshot: true
        }));
        console.log('持久化存储为空，已导入 data.json 初始数据并创建首个快照');
    }

    lastStorageStatus = await storage.getStatus();
    server.listen(PORT, () => {
        console.log(`Wedding invitation server listening on http://localhost:${PORT}`);
        console.log(`Persistent storage: ${storage.kind}`);
        if (storage.kind === 'file') {
            console.warn('未配置 DATABASE_URL：当前使用本地事件日志和快照；Render 重启仍会清空临时磁盘');
        }
        if (!ADMIN_TOKEN) {
            console.warn('未配置 ADMIN_TOKEN：管理读取、删除和备份接口已锁定');
        }
    });
}

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`收到 ${signal}，正在等待写入并创建关闭快照`);
    io.close();
    server.close();

    try {
        await Promise.race([
            mutationQueue,
            wait(20_000).then(() => {
                throw new Error('等待写入队列超时');
            })
        ]);
        await storage.snapshot(data, `shutdown-${signal.toLowerCase()}`);
        await storage.close();
        process.exit(0);
    } catch (error) {
        console.error('关闭服务器时持久化失败:', error.message);
        process.exit(1);
    }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(error => {
    console.error('服务器启动失败:', error.message);
    process.exit(1);
});
