// ========== 可靠实时连接与离线重试 ==========
let socket = null;
let isConnected = false;
var wallWishTotal = 0;
var maxVisibleWallWishes = 24;
var liveApiUrl = String(window.LIVE_API_URL || 'https://wedding-invitation-live.onrender.com').replace(/\/$/, '');
var pendingMutationKey = 'wedding-pending-mutations-v1';
var renderedWishKeys = Object.create(null);
var renderedTreeWishKeys = Object.create(null);
var flushingPendingMutations = false;

function apiEndpoint(pathname) {
    return liveApiUrl + pathname;
}

function randomId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return prefix + '-' + window.crypto.randomUUID();
    }
    return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
}

function getVisitorId() {
    try {
        var stored = sessionStorage.getItem('wedding-visitor-id-v1');
        if (stored) return stored;
        var created = randomId('visit');
        sessionStorage.setItem('wedding-visitor-id-v1', created);
        return created;
    } catch (error) {
        return randomId('visit');
    }
}

function readPendingMutations() {
    try {
        var parsed = JSON.parse(localStorage.getItem(pendingMutationKey) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function writePendingMutations(records) {
    try {
        localStorage.setItem(pendingMutationKey, JSON.stringify(records.slice(-50)));
    } catch (error) {
        console.warn('无法写入本机待提交队列:', error.message);
    }
}

function rememberPendingMutation(eventName, endpoint, payload) {
    var records = readPendingMutations();
    var existing = records.find(function(record) {
        return record.payload && record.payload.clientMutationId === payload.clientMutationId;
    });
    if (existing) return existing;
    var record = {
        eventName: eventName,
        endpoint: endpoint,
        payload: payload,
        createdAt: new Date().toISOString()
    };
    records.push(record);
    writePendingMutations(records);
    return record;
}

function forgetPendingMutation(clientMutationId) {
    writePendingMutations(readPendingMutations().filter(function(record) {
        return !record.payload || record.payload.clientMutationId !== clientMutationId;
    }));
}

async function fetchJson(pathname, options, timeoutMilliseconds) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = controller ? window.setTimeout(function() { controller.abort(); }, timeoutMilliseconds || 25000) : null;
    try {
        var requestOptions = Object.assign({}, options || {});
        if (controller) requestOptions.signal = controller.signal;
        var response = await fetch(apiEndpoint(pathname), requestOptions);
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || result.ok === false) {
            var requestError = new Error(result.error || ('服务器返回 ' + response.status));
            requestError.retryable = result.retryable !== false && response.status >= 500;
            throw requestError;
        }
        return result;
    } finally {
        if (timeout) window.clearTimeout(timeout);
    }
}

function wishKey(wish) {
    return wish && (wish.id || [wish.name, wish.message, wish.timestamp].join('|'));
}

function treeWishKey(wish) {
    return wish && (wish.id || [wish.name, wish.message, wish.timestamp].join('|'));
}

function showCommittedWish(wish, isNew) {
    var key = wishKey(wish);
    if (!key || renderedWishKeys[key]) return false;
    renderedWishKeys[key] = true;
    if (isNew) wallWishTotal += 1;
    addWishToWall(wish, isNew);
    updateWishCount();
    return true;
}

function showTreeWish(wish, isNew) {
    var key = treeWishKey(wish);
    if (!key || renderedTreeWishKeys[key]) return false;
    renderedTreeWishKeys[key] = true;
    addWishToTree(wish, isNew);
    return true;
}

function applyInitialData(data) {
    var serverTotal = Number(data && data.totalWishes) || (data && data.wishes ? data.wishes.length : 0);
    wallWishTotal = Math.max(wallWishTotal, serverTotal);
    if (data && data.wishes) data.wishes.forEach(function(wish) { showCommittedWish(wish, false); });
    if (data && data.treeWishes) data.treeWishes.forEach(function(wish) { showTreeWish(wish, false); });
    updateWishCount();
}

function socketRequest(eventName, payload) {
    return new Promise(function(resolve, reject) {
        if (!socket || !isConnected) {
            reject(new Error('实时连接不可用'));
            return;
        }
        socket.timeout(9000).emit(eventName, payload, function(error, response) {
            if (error) {
                reject(error);
            } else if (!response || response.ok !== true) {
                var responseError = new Error(response && response.error ? response.error : '服务器未确认保存');
                responseError.retryable = !response || response.retryable !== false;
                reject(responseError);
            } else {
                resolve(response);
            }
        });
    });
}

async function deliverMutation(record) {
    var socketError = null;
    if (socket && isConnected) {
        try {
            return await socketRequest(record.eventName, record.payload);
        } catch (error) {
            socketError = error;
        }
    }
    try {
        return await fetchJson(record.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record.payload)
        }, 30000);
    } catch (httpError) {
        if (socketError) httpError.socketError = socketError;
        throw httpError;
    }
}

async function submitReliable(eventName, endpoint, payload) {
    var mutationPayload = Object.assign({}, payload, {
        clientMutationId: payload.clientMutationId || randomId(eventName)
    });
    var record = rememberPendingMutation(eventName, endpoint, mutationPayload);
    try {
        var response = await deliverMutation(record);
        forgetPendingMutation(mutationPayload.clientMutationId);
        return response;
    } catch (error) {
        if (error.retryable === false) forgetPendingMutation(mutationPayload.clientMutationId);
        throw error;
    }
}

async function flushPendingMutations() {
    if (flushingPendingMutations) return;
    flushingPendingMutations = true;
    try {
        var records = readPendingMutations();
        for (var index = 0; index < records.length; index += 1) {
            var record = records[index];
            try {
                var response = await deliverMutation(record);
                forgetPendingMutation(record.payload.clientMutationId);
                if (record.eventName === 'wish' && response.item) showCommittedWish(response.item, true);
            } catch (error) {
                console.log('待提交记录仍在本机队列中:', record.eventName);
            }
        }
    } finally {
        flushingPendingMutations = false;
    }
}

async function initializeWishes() {
    var visitorId = getVisitorId();
    fetchJson('/api/init', { method: 'GET' }, 30000)
        .then(applyInitialData)
        .catch(function() { console.log('HTTP 初始数据暂不可用，等待实时连接'); });
    fetchJson('/api/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientMutationId: visitorId })
    }, 30000).catch(function() { console.log('浏览记录将在实时连接建立后补记'); });

    if (typeof window.io !== 'function') {
        console.log('实时组件未加载，使用 HTTP 模式');
        flushPendingMutations();
        return;
    }

    socket = window.io(liveApiUrl, {
        auth: { visitorId: visitorId },
        timeout: 10000,
        reconnection: true,
        reconnectionDelay: 1500,
        reconnectionDelayMax: 8000,
        transports: ['polling', 'websocket']
    });
    socket.on('connect', function() {
        isConnected = true;
        flushPendingMutations();
    });
    socket.on('disconnect', function() { isConnected = false; });
    socket.on('connect_error', function() { isConnected = false; });
    socket.on('initData', applyInitialData);
    socket.on('newWish', function(wish) { showCommittedWish(wish, true); });
    socket.on('newTreeWish', function(wish) { showTreeWish(wish, true); });
    socket.on('seatTaken', function(data) {
        alert('座位 ' + data.seat + ' 已被其他人选择，请选择其他座位');
        var seatEl = document.querySelector('[data-seat="' + data.seat + '"]');
        if (seatEl) { seatEl.classList.add('taken'); seatEl.classList.remove('selected'); }
    });
}

initializeWishes();
window.addEventListener('online', flushPendingMutations);
window.setInterval(function() {
    if (readPendingMutations().length) flushPendingMutations();
}, 30000);

var interactionEndpoints = {
    treeWish: '/api/tree-wishes',
    seatSelect: '/api/seat-selections',
    foodPref: '/api/food-prefs',
    gameScore: '/api/game-scores'
};

function socketEmit(eventName, payload) {
    var endpoint = interactionEndpoints[eventName];
    if (endpoint) return submitReliable(eventName, endpoint, payload);
    return socketRequest(eventName, payload);
}

// ========== 花瓣飘落 ==========
function createPetals() {
    const container = document.getElementById('petals');
    if (!container) return;
    const colors = ['#f6d7ad', '#e8b28b', '#9bc8c3', '#f5eee0', '#e99a79'];
    const types = ['petal', 'shell-speck', 'sea-glint', 'tide-streak'];
    for (let i = 0; i < 68; i++) {
        const petal = document.createElement('div');
        petal.className = types[i % types.length];
        const size = 7 + Math.random() * 18;
        const duration = 10 + Math.random() * 18;
        const sway = -120 + Math.random() * 240;
        petal.style.cssText = `left:${Math.random()*100}%;top:${-10-Math.random()*28}%;animation-duration:${duration}s;animation-delay:${-Math.random()*duration}s;background:linear-gradient(135deg,${colors[Math.floor(Math.random()*colors.length)]},${colors[Math.floor(Math.random()*colors.length)]});width:${size}px;height:${size * (0.72 + Math.random() * 0.5)}px;opacity:${0.25+Math.random()*0.55};--drift:${sway}px;--sway:${sway * 0.45}px;--spin:${-240+Math.random()*480}deg;--tilt:${-25+Math.random()*50}deg`;
        container.appendChild(petal);
    }
}

// ========== 信封闪光 ==========
function createSparkles() {
    const container = document.getElementById('sparkles');
    if (!container) return;
    for (let i = 0; i < 12; i++) {
        const sparkle = document.createElement('div');
        sparkle.className = 'sparkle';
        sparkle.style.cssText = `left:${20+Math.random()*60}%;top:${20+Math.random()*60}%;animation-delay:${Math.random()*2}s;animation-duration:${1.5+Math.random()*1.5}s`;
        container.appendChild(sparkle);
    }
}

// ========== 信封点击 ==========
function initEnvelope() {
    const envelope = document.getElementById('envelope');
    const mainContent = document.getElementById('mainContent');
    if (!envelope || !mainContent) return;

    resetPageScroll();

    envelope.addEventListener('click', function() {
        if (envelope.classList.contains('opened')) return;
        playBackgroundMusic();
        resetPageScroll();
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        envelope.classList.add('opened');
        envelope.classList.add('story-running');
        setTimeout(function() {
            envelope.style.display = 'none';
            resetPageScroll();
            mainContent.classList.add('visible');
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
            initScrollAnimations();
        }, 4800);
    });
}

function resetPageScroll() {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

// ========== 倒计时 ==========
function updateCountdown() {
    var weddingDate = new Date('2026-10-03T12:00:00');
    var now = new Date();
    var diff = weddingDate - now;

    if (diff <= 0) {
        var el1 = document.getElementById('countDays');
        var el2 = document.getElementById('countHours');
        var el3 = document.getElementById('countMinutes');
        var el4 = document.getElementById('countSeconds');
        if (el1) el1.textContent = '00';
        if (el2) el2.textContent = '00';
        if (el3) el3.textContent = '00';
        if (el4) el4.textContent = '00';
        return;
    }

    var days = Math.floor(diff / (1000 * 60 * 60 * 24));
    var hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    var minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    var seconds = Math.floor((diff % (1000 * 60)) / 1000);

    var el1 = document.getElementById('countDays');
    var el2 = document.getElementById('countHours');
    var el3 = document.getElementById('countMinutes');
    var el4 = document.getElementById('countSeconds');

    if (el1) el1.textContent = String(days).padStart(2, '0');
    if (el2) el2.textContent = String(hours).padStart(2, '0');
    if (el3) el3.textContent = String(minutes).padStart(2, '0');
    if (el4) el4.textContent = String(seconds).padStart(2, '0');
}

// ========== 滚动动画 ==========
function initScrollAnimations() {
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.15, rootMargin: '0px 0px -30px 0px' });

    document.querySelectorAll('.animate-scroll').forEach(function(item, index) {
        item.style.transitionDelay = (index % 5) * 0.1 + 's';
        observer.observe(item);
    });
}

// ========== 弹窗控制 ==========
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        if (modal._closeTimer) {
            window.clearTimeout(modal._closeTimer);
            modal._closeTimer = null;
        }
        const modalContent = modal.querySelector('.modal');
        if (modalContent) modalContent.style.transform = '';
        if (modalId === 'galleryModal') renderGalleryHighlights();
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function renderGalleryHighlights() {
    var grid = document.getElementById('galleryHighlights');
    if (!grid || !galleryImages || !galleryImages.length) return;

    var indexes = galleryImages.map(function(_, index) { return index; });
    for (var index = indexes.length - 1; index > 0; index -= 1) {
        var swapIndex = Math.floor(Math.random() * (index + 1));
        var current = indexes[index];
        indexes[index] = indexes[swapIndex];
        indexes[swapIndex] = current;
    }

    grid.innerHTML = indexes.slice(0, 6).map(function(imageIndex) {
        var image = galleryImages[imageIndex];
        return '<button class="modal-gallery-item" type="button" data-gallery-index="' + imageIndex + '" aria-label="查看' + image.caption + '">' +
            '<div class="placeholder-img" data-photo="' + image.src + '" style="background-image:url(\'' + image.src + '\')"><span>' + image.caption + '</span></div>' +
            '</button>';
    }).join('');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        const mc = modal.querySelector('.modal');
        if (modal._closeTimer) window.clearTimeout(modal._closeTimer);
        modal._closeTimer = null;
        modal.classList.remove('active');
        if (mc) mc.style.transform = '';
        document.body.style.overflow = '';
    }
}

// ========== 信息卡片点击 ==========
function initInfoCards() {
    var cards = { 'ceremonyCard': 'ceremonyModal', 'venueCard': 'venueModal', 'dressCard': 'dressModal' };
    Object.keys(cards).forEach(function(cardId) {
        var card = document.getElementById(cardId);
        if (card) {
            card.addEventListener('click', function() {
                openModal(cards[cardId]);
            });
        }
    });

    document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    var highlights = document.getElementById('galleryHighlights');
    if (highlights) highlights.addEventListener('click', function(e) {
        var item = e.target.closest('.modal-gallery-item[data-gallery-index]');
        if (!item) return;
        currentImageIndex = parseInt(item.dataset.galleryIndex, 10) || 0;
            closeModal('galleryModal');
            window.setTimeout(function() {
                updateLightbox();
                document.getElementById('lightbox').classList.add('active');
                document.body.style.overflow = 'hidden';
            }, 320);
    });
}

// ========== RSVP处理 ==========
var pendingRsvpStatus = 'accept';

function openRsvpForm(status) {
    pendingRsvpStatus = status === 'decline' ? 'decline' : 'accept';
    var isAttending = pendingRsvpStatus === 'accept';
    document.getElementById('rsvpFormTitle').textContent = isAttending ? '欣然出席' : '遗憾缺席';
    document.getElementById('rsvpFormHint').textContent = isAttending ? '请留下您的姓名、联系方式和出席人数' : '请留下您的姓名和联系方式';
    document.getElementById('guestCountField').hidden = !isAttending;
    document.getElementById('rsvpSubmitButton').textContent = isAttending ? '确认出席' : '确认缺席';
    document.getElementById('rsvpFormError').textContent = '';
    openModal('rsvpFormModal');
    window.setTimeout(function() { document.getElementById('guestName').focus(); }, 320);
}

async function submitRsvpForm(event) {
    event.preventDefault();
    var name = document.getElementById('guestName');
    var contact = document.getElementById('guestContact');
    var count = document.getElementById('guestCount');
    var error = document.getElementById('rsvpFormError');
    var guestName = name ? name.value.trim() : '';
    var guestContact = contact ? contact.value.trim() : '';
    var guestCount = pendingRsvpStatus === 'accept' && count ? parseInt(count.value, 10) : 1;

    if (!guestName) { error.textContent = '请填写您的姓名'; name.focus(); return; }
    if (!guestContact) { error.textContent = '请填写手机号码或微信号'; contact.focus(); return; }

    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 99) {
        error.textContent = '请输入 1 至 99 之间的出席人数';
        if (count) count.focus();
        return;
    }

    var button = document.getElementById('rsvpSubmitButton');
    var originalButtonText = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = '正在安全保存…'; }
    error.textContent = '正在等待服务器确认，请不要关闭页面';
    try {
        await submitReliable('rsvp', '/api/rsvp', {
            name: guestName,
            contact: guestContact,
            status: pendingRsvpStatus,
            count: guestCount
        });
        error.textContent = '';
        closeModal('rsvpFormModal');
        name.value = '';
        contact.value = '';
        if (count) count.value = '1';

        var title = document.getElementById('rsvpTitle');
        var msg = document.getElementById('rsvpMessage');
        if (title) title.textContent = pendingRsvpStatus === 'accept' ? '感谢您的出席' : '收到您的回复';
        if (msg) msg.textContent = pendingRsvpStatus === 'accept' ? guestName + '，期待与您相见' : guestName + '，虽然遗憾但我们理解';
        openModal('rsvpModal');
    } catch (submitError) {
        error.textContent = submitError.retryable === false
            ? submitError.message
            : '网络暂时不稳定。回执已暂存在本设备，联网后会自动重试；请勿清除微信缓存。';
    } finally {
        if (button) { button.disabled = false; button.textContent = originalButtonText; }
    }
}

// ========== 许愿树祝福 ==========
function openWishModal() {
    openModal('treeWishModal');
}

async function submitTreeWish() {
    var nameEl = document.getElementById('wishName');
    var textEl = document.getElementById('wishTreeText');
    var name = nameEl ? nameEl.value || '匿名' : '匿名';
    var message = textEl ? textEl.value : '';

    if (!message) { alert('请写下您的祝福'); return; }

    var activeColor = document.querySelector('.color-dot.active');
    var color = activeColor ? activeColor.dataset.color : '#fce4ec';

    try {
        var response = await socketEmit('treeWish', { name: name, message: message, color: color });
        if (response.item) showTreeWish(response.item, true);
        if (textEl) textEl.value = '';
        showSuccessModal('🌳', '祝福已保存', '感谢您的美好祝福');
        closeModal('treeWishModal');
    } catch (error) {
        alert(error.retryable === false ? error.message : '网络暂不可用，祝福已保存在本设备，联网后会自动重试。');
    }
}

function addWishToTree(wish, isNew) {
    var crown = document.getElementById('treeCrown');
    if (!crown) return;
    var tag = document.createElement('div');
    tag.className = 'wish-tag';
    tag.textContent = wish.message ? wish.message.substring(0, 4) : '祝福';
    tag.style.background = wish.color || '#fce4ec';
    if (isNew) tag.style.animation = 'tagAppear 0.5s ease';
    crown.appendChild(tag);
}

// 颜色选择
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.color-dot').forEach(function(dot) {
        dot.addEventListener('click', function() {
            document.querySelectorAll('.color-dot').forEach(function(d) { d.classList.remove('active'); });
            this.classList.add('active');
        });
    });
});

// ========== 祝福墙 ==========
async function sendWallWish() {
    var nameEl = document.getElementById('wallName');
    var msgEl = document.getElementById('wallMessage');
    var name = nameEl ? nameEl.value || '匿名' : '匿名';
    var message = msgEl ? msgEl.value : '';

    if (!message) { alert('请写下您的祝福'); return; }

    var status = document.getElementById('wallWishStatus');
    var button = document.getElementById('wallWishSubmitButton');
    if (button) { button.disabled = true; button.textContent = '正在安全保存…'; }
    if (status) status.textContent = '正在等待服务器确认，请不要关闭页面';
    try {
        var response = await submitReliable('wish', '/api/wishes', { name: name, message: message });
        if (response.item) showCommittedWish(response.item, true);
        if (msgEl) msgEl.value = '';
        if (status) status.textContent = '已由服务器确认保存';
        playLetterSendAnimation();
        window.setTimeout(function() {
            showSuccessModal('💝', '祝福已保存', '感谢您的美好祝福');
        }, 900);
    } catch (submitError) {
        if (status) {
            status.textContent = submitError.retryable === false
                ? submitError.message
                : '网络暂时不稳定。祝福已保存在本设备，联网后会自动重试；请勿清除微信缓存。';
        }
    } finally {
        if (button) { button.disabled = false; button.textContent = '封缄并送出'; }
    }
}

function playLetterSendAnimation() {
    var paper = document.querySelector('.letter-paper');
    if (!paper) return;

    var rect = paper.getBoundingClientRect();
    var letter = document.createElement('div');
    letter.className = 'outgoing-letter';
    letter.style.left = (rect.left + rect.width / 2) + 'px';
    letter.style.top = (rect.top + rect.height / 2) + 'px';
    letter.innerHTML = '<span class="outgoing-letter-flap"></span><strong>Z & T</strong>';
    document.body.appendChild(letter);
    paper.classList.add('is-sending');

    window.requestAnimationFrame(function() {
        letter.classList.add('is-flying');
    });
    window.setTimeout(function() {
        letter.remove();
        paper.classList.remove('is-sending');
    }, 1100);
}

function addWishToWall(wish, isNew) {
    var wall = document.getElementById('blessingWall');
    if (!wall) return;

    var styles = ['style-1', 'style-2', 'style-3'];
    var item = document.createElement('div');
    item.className = 'blessing-item ' + styles[Math.floor(Math.random() * styles.length)];

    var authorSpan = document.createElement('span');
    authorSpan.className = 'wish-author-small';
    authorSpan.textContent = wish.name || '匿名';
    item.appendChild(authorSpan);
    item.appendChild(document.createTextNode(wish.message || ''));

    if (isNew) item.classList.add('is-new');
    wall.appendChild(item);
    while (wall.children.length > maxVisibleWallWishes) {
        wall.removeChild(wall.firstElementChild);
    }
}

function updateWishCount() {
    var el = document.getElementById('wishCount');
    if (el) el.textContent = wallWishTotal;
}

// ========== 座位选择 ==========
var selectedSeat = null;

function selectSeat(el) {
    if (el.classList.contains('taken')) return;
    document.querySelectorAll('.seat.selected').forEach(function(s) { s.classList.remove('selected'); });
    el.classList.add('selected');
    selectedSeat = el.dataset.seat;
    var seatText = document.getElementById('selectedSeat');
    if (seatText) seatText.textContent = '已选择: ' + selectedSeat;
}

async function confirmSeat() {
    if (!selectedSeat) { alert('请先选择座位'); return; }
    var nameEl = document.getElementById('seatName');
    var name = nameEl ? nameEl.value || '匿名' : '匿名';
    try {
        await socketEmit('seatSelect', { name: name, seat: selectedSeat });
        showSuccessModal('💺', '座位已确认', '您已选择座位 ' + selectedSeat);
        closeModal('seatModal');
    } catch (error) {
        alert(error.retryable === false ? error.message : '网络暂不可用，座位选择已保存在本设备，联网后会自动重试。');
    }
}

// ========== 菜品偏好 ==========
async function submitFoodPref() {
    var nameEl = document.getElementById('foodName');
    var noteEl = document.getElementById('foodNote');
    var name = nameEl ? nameEl.value || '匿名' : '匿名';
    var note = noteEl ? noteEl.value : '';
    var prefs = [];
    document.querySelectorAll('input[name="food"]:checked').forEach(function(c) { prefs.push(c.value); });

    if (prefs.length === 0 && !note) { alert('请至少选择一项或填写备注'); return; }

    try {
        await socketEmit('foodPref', { name: name, preferences: prefs, note: note });
        showSuccessModal('🍽️', '已保存', '感谢您的反馈');
        closeModal('foodModal');
    } catch (error) {
        alert(error.retryable === false ? error.message : '网络暂不可用，菜品偏好已保存在本设备，联网后会自动重试。');
    }
}

// ========== 互动游戏 ==========
var gameScore = 0;
var currentQuestion = 1;
var totalQuestions = 3;

function checkAnswer(button, questionNum, isCorrect) {
    var options = button.parentElement.querySelectorAll('.game-option');
    options.forEach(function(opt) {
        opt.disabled = true;
        opt.style.pointerEvents = 'none';
    });

    if (isCorrect) {
        button.classList.add('correct');
        gameScore += 33;
    } else {
        button.classList.add('wrong');
    }

    var progressBar = document.getElementById('gameProgress');
    if (progressBar) progressBar.style.width = ((questionNum / totalQuestions) * 100) + '%';

    setTimeout(function() {
        if (questionNum < totalQuestions) {
            var current = document.querySelector('.game-question[data-q="' + questionNum + '"]');
            var next = document.querySelector('.game-question[data-q="' + (questionNum + 1) + '"]');
            if (current) current.classList.remove('active');
            if (next) next.classList.add('active');
            currentQuestion = questionNum + 1;
        } else {
            endGame();
        }
    }, 1000);
}

function endGame() {
    var container = document.getElementById('gameContainer');
    var result = document.getElementById('gameResult');
    if (container) container.style.display = 'none';
    if (result) result.style.display = 'block';

    var scoreNum = document.getElementById('scoreNumber');
    if (scoreNum) scoreNum.textContent = gameScore;

    var text = '';
    if (gameScore >= 99) text = '满分！您太了解新人了！';
    else if (gameScore >= 66) text = '很不错！您很关心新人！';
    else text = '继续加油！多了解新人哦！';
    var resultText = document.getElementById('resultText');
    if (resultText) resultText.textContent = text;

    socketEmit('gameScore', { score: gameScore }).catch(function() {
        console.log('游戏成绩已进入本机待提交队列');
    });
}

function resetGame() {
    gameScore = 0;
    currentQuestion = 1;
    var container = document.getElementById('gameContainer');
    var result = document.getElementById('gameResult');
    var progress = document.getElementById('gameProgress');
    if (container) container.style.display = 'block';
    if (result) result.style.display = 'none';
    if (progress) progress.style.width = '0%';

    document.querySelectorAll('.game-question').forEach(function(q) { q.classList.remove('active'); });
    var first = document.querySelector('.game-question[data-q="1"]');
    if (first) first.classList.add('active');

    document.querySelectorAll('.game-option').forEach(function(opt) {
        opt.disabled = false;
        opt.style.pointerEvents = 'auto';
        opt.classList.remove('correct', 'wrong');
    });
}

// ========== 成功弹窗 ==========
function showSuccessModal(emoji, title, message) {
    var emojiEl = document.getElementById('successEmoji');
    var titleEl = document.getElementById('successTitle');
    var msgEl = document.getElementById('successMessage');
    if (emojiEl) emojiEl.textContent = emoji;
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    openModal('successModal');
}

// ========== 相册灯箱 ==========
var currentImageIndex = 0;
var galleryImages = [
    { src: 'photos-optimized/1786895775746.webp', caption: '赵锦江 · 滕玥' },
    { src: 'photos-optimized/1786901043714.webp', caption: '这一页，写满心动' },
    { src: 'photos-optimized/1786901043721.webp', caption: '爱在眉眼，也在余生' },
    { src: 'photos-optimized/1786901043757.webp', caption: '余生的镜头，只拍你' },
    { src: 'photos-optimized/1786901044033.webp', caption: '肩并肩，看潮汐起落' },
    { src: 'photos-optimized/1786901044052.webp', caption: '把远方写进我们的誓言' },
    { src: 'photos-optimized/1786901044128.webp', caption: '海岸线收好我们的秘密' }
];
var totalImages = galleryImages.length;
var galleryImageCache = {};

function preloadGalleryImage(imageIndex) {
    var image = galleryImages[imageIndex];
    if (!image) return Promise.resolve();
    if (galleryImageCache[image.src]) return galleryImageCache[image.src];

    galleryImageCache[image.src] = new Promise(function(resolve) {
        var preload = new Image();
        preload.decoding = 'async';
        preload.onload = function() {
            var decoded = preload.decode ? preload.decode().catch(function() {}) : Promise.resolve();
            decoded.then(resolve);
        };
        preload.onerror = resolve;
        preload.src = image.src;
    });
    return galleryImageCache[image.src];
}

var galleryDrag = {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    deltaX: 0,
    deltaY: 0,
    startedAt: 0,
    changing: false
};

function initGallery() {
    var gallery = document.querySelector('.gallery-grid');
    if (gallery) {
        initInlineGallery(gallery);
        loadGalleryImages(gallery);
    }

    var lightbox = document.getElementById('lightbox');
    if (lightbox) {
        lightbox.addEventListener('click', function(e) {
            if (e.target === lightbox) closeLightbox();
        });

        var img = document.getElementById('lightboxImg');
        if (img) {
            img.addEventListener('pointerdown', beginGalleryDrag);
            img.addEventListener('pointermove', moveGalleryDrag, { passive: false });
            img.addEventListener('pointerup', endGalleryDrag);
            img.addEventListener('pointercancel', cancelGalleryDrag);
        }
    }
}

function initInlineGallery(gallery) {
    var items = Array.prototype.slice.call(gallery.querySelectorAll('.gallery-item'));
    items.forEach(function(item) {
        var imageIndex = parseInt(item.dataset.index, 10) - 1;
        var image = galleryImages[imageIndex];
        var imageBox = item.querySelector('.placeholder-img');
        var inlineImage = imageBox ? imageBox.querySelector('img') : null;
        if (!image || !imageBox) return;

        item.setAttribute('role', 'listitem');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', '放大查看：' + image.caption);
        item.addEventListener('click', function() {
            currentImageIndex = imageIndex;
            updateLightbox();
            document.getElementById('lightbox').classList.add('active');
            document.body.style.overflow = 'hidden';
        });
        item.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            item.click();
        });
    });
}

function loadGalleryImages(gallery) {
    var galleryElement = gallery || document.querySelector('.gallery-grid');
    if (!galleryElement || galleryElement.dataset.loading === 'true') return;
    galleryElement.dataset.loading = 'true';
    var images = Array.prototype.slice.call(galleryElement.querySelectorAll('img[data-src]'));
    Promise.all(images.map(loadInlineGalleryImage)).then(function() {
        galleryElement.classList.add('gallery-images-ready');
    });
}

function loadInlineGalleryImage(inlineImage) {
    if (!inlineImage || !inlineImage.dataset.src) return Promise.resolve();
    if (inlineImage.complete && inlineImage.naturalWidth > 0) return Promise.resolve();

    return new Promise(function(resolve) {
        var source = inlineImage.dataset.src;
        var retried = false;

        function finish() {
            inlineImage.removeEventListener('load', handleLoad);
            inlineImage.removeEventListener('error', handleError);
            var decoded = inlineImage.decode ? inlineImage.decode().catch(function() {}) : Promise.resolve();
            decoded.then(resolve);
        }

        function handleLoad() {
            finish();
        }

        function handleError() {
            if (!retried) {
                retried = true;
                inlineImage.src = source + '?retry=' + Date.now();
                return;
            }
            finish();
        }

        inlineImage.addEventListener('load', handleLoad);
        inlineImage.addEventListener('error', handleError);
        inlineImage.src = source;
    });
}

function beginGalleryDrag(e) {
    if (galleryDrag.changing || e.button > 0) return;
    galleryDrag.active = true;
    galleryDrag.pointerId = e.pointerId;
    galleryDrag.startX = e.clientX;
    galleryDrag.startY = e.clientY;
    galleryDrag.deltaX = 0;
    galleryDrag.deltaY = 0;
    galleryDrag.startedAt = Date.now();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.classList.add('is-dragging');
}

function moveGalleryDrag(e) {
    if (!galleryDrag.active || e.pointerId !== galleryDrag.pointerId) return;
    galleryDrag.deltaX = e.clientX - galleryDrag.startX;
    galleryDrag.deltaY = e.clientY - galleryDrag.startY;
    if (Math.abs(galleryDrag.deltaY) > Math.abs(galleryDrag.deltaX)) return;
    e.preventDefault();
    var distance = Math.hypot(galleryDrag.deltaX, galleryDrag.deltaY);
    var resistance = distance > 180 ? 0.58 : 0.82;
    var scale = 1 - Math.min(distance / 2600, 0.055);
    e.currentTarget.style.transform = 'translate3d(' + (galleryDrag.deltaX * resistance) + 'px, ' + (galleryDrag.deltaY * resistance) + 'px, 0) scale(' + scale + ')';
}

function endGalleryDrag(e) {
    if (!galleryDrag.active || e.pointerId !== galleryDrag.pointerId) return;
    var img = e.currentTarget;
    var deltaX = galleryDrag.deltaX;
    var deltaY = galleryDrag.deltaY;
    var distance = Math.hypot(deltaX, deltaY);
    var elapsed = Math.max(Date.now() - galleryDrag.startedAt, 1);
    var velocity = distance / elapsed;
    galleryDrag.active = false;
    galleryDrag.pointerId = null;
    img.classList.remove('is-dragging');
    if (Math.abs(deltaY) > Math.abs(deltaX)) {
        resetGalleryImagePosition(img);
        return;
    }
    if (distance < 55 && velocity < 0.45) {
        resetGalleryImagePosition(img);
        return;
    }
    var direction = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
    var step = direction < 0 ? 1 : -1;
    switchGalleryImage(step, deltaX, deltaY);
}

function cancelGalleryDrag(e) {
    if (!galleryDrag.active || e.pointerId !== galleryDrag.pointerId) return;
    galleryDrag.active = false;
    galleryDrag.pointerId = null;
    e.currentTarget.classList.remove('is-dragging');
    resetGalleryImagePosition(e.currentTarget);
}

function resetGalleryImagePosition(img) {
    img.style.transition = 'transform .42s cubic-bezier(.22,.8,.24,1)';
    img.style.transform = 'translate3d(0, 0, 0) scale(1)';
    window.setTimeout(function() {
        img.style.transition = '';
    }, 440);
}

function switchGalleryImage(step, deltaX, deltaY) {
    if (galleryDrag.changing) return;
    var img = document.getElementById('lightboxImg');
    if (!img) return;
    galleryDrag.changing = true;
    var distance = Math.max(window.innerWidth, window.innerHeight) * 0.9;
    var dominantX = Math.abs(deltaX) >= Math.abs(deltaY);
    var exitX = dominantX ? (deltaX < 0 ? -distance : distance) : 0;
    var exitY = dominantX ? 0 : (deltaY < 0 ? -distance : distance);
    img.style.transition = 'transform .3s cubic-bezier(.55,.05,.68,.19), opacity .3s ease';
    img.style.transform = 'translate3d(' + exitX + 'px, ' + exitY + 'px, 0) scale(.96)';
    img.style.opacity = '.15';
    window.setTimeout(function() {
        currentImageIndex = (currentImageIndex + step + totalImages) % totalImages;
        img.style.transition = 'none';
        img.style.transform = 'translate3d(' + (-exitX * .22) + 'px, ' + (-exitY * .22) + 'px, 0) scale(.97)';
        updateLightbox();
        img.style.opacity = '1';
        window.requestAnimationFrame(function() {
            img.style.transition = 'transform .48s cubic-bezier(.22,.8,.24,1), opacity .48s ease';
            img.style.transform = 'translate3d(0, 0, 0) scale(1)';
        });
        window.setTimeout(function() {
            img.style.transition = '';
            galleryDrag.changing = false;
        }, 500);
    }, 300);
}

function updateLightbox() {
    var img = document.getElementById('lightboxImg');
    var caption = document.getElementById('lightboxCaption');
    var counter = document.getElementById('lightboxCounter');
    if (img) {
        img.classList.remove('is-next', 'is-prev');
        void img.offsetWidth;
        img.style.backgroundImage = "url('" + galleryImages[currentImageIndex].src + "')";
        img.classList.add('is-next');
    }
    if (caption) caption.textContent = galleryImages[currentImageIndex].caption;
    if (counter) counter.textContent = (currentImageIndex + 1) + ' / ' + totalImages;
}

function prevImage() {
    if (galleryDrag.changing) return;
    currentImageIndex = (currentImageIndex - 1 + totalImages) % totalImages;
    updateLightbox();
}

function nextImage() {
    if (galleryDrag.changing) return;
    currentImageIndex = (currentImageIndex + 1) % totalImages;
    updateLightbox();
}

function closeLightbox() {
    var lightbox = document.getElementById('lightbox');
    if (lightbox) {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// ========== 音乐控制 ==========
function syncMusicButton() {
    var audio = document.getElementById('backgroundMusic');
    var btn = document.getElementById('musicToggle');
    if (!audio || !btn) return;
    var isPlaying = !audio.paused && !audio.ended;
    btn.classList.toggle('playing', isPlaying);
    btn.setAttribute('aria-label', isPlaying ? '暂停背景音乐' : '播放背景音乐');
    btn.title = isPlaying ? '暂停背景音乐' : '播放背景音乐';
}

function playBackgroundMusic() {
    var audio = document.getElementById('backgroundMusic');
    if (!audio || !audio.paused) return;
    var playAttempt = audio.play();
    if (playAttempt && playAttempt.catch) playAttempt.catch(syncMusicButton);
}

function toggleMusic() {
    var audio = document.getElementById('backgroundMusic');
    if (!audio) return;
    if (audio.paused) {
        playBackgroundMusic();
    } else {
        audio.pause();
    }
}

function initMusic() {
    var audio = document.getElementById('backgroundMusic');
    if (!audio || audio.dataset.initialized === 'true') return;
    audio.dataset.initialized = 'true';
    audio.volume = 0.55;
    audio.addEventListener('play', syncMusicButton);
    audio.addEventListener('pause', syncMusicButton);
    audio.addEventListener('ended', syncMusicButton);
    syncMusicButton();

    function retryAutoplay() {
        playBackgroundMusic();
        document.removeEventListener('pointerdown', retryAutoplay);
        document.removeEventListener('touchstart', retryAutoplay);
        document.removeEventListener('keydown', retryAutoplay);
    }

    document.addEventListener('pointerdown', retryAutoplay, { once: true, passive: true });
    document.addEventListener('touchstart', retryAutoplay, { once: true, passive: true });
    document.addEventListener('keydown', retryAutoplay, { once: true });
}

// ========== 地图导航 ==========
function openMap() {
    closeModal('venueModal');
    openModal('navigationModal');
}

function openNavigation(provider) {
    var destination = '丝路华廷禧宴（绿地乐和城店）';
    var encodedDestination = encodeURIComponent(destination);
    var gcjLocation = { latitude: 36.470987, longitude: 103.686997 };
    var baiduLocation = { latitude: 36.477276, longitude: 103.693386 };
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var links = {
        amap: {
            app: isIOS
                ? 'iosamap://navi?sourceApplication=zt20261003.love&poiname=' + encodedDestination + '&lat=' + gcjLocation.latitude + '&lon=' + gcjLocation.longitude + '&dev=0&style=2'
                : 'androidamap://navi?sourceApplication=zt20261003.love&poiname=' + encodedDestination + '&lat=' + gcjLocation.latitude + '&lon=' + gcjLocation.longitude + '&dev=0&style=2',
            fallback: 'https://uri.amap.com/navigation?to=' + gcjLocation.longitude + ',' + gcjLocation.latitude + ',' + encodedDestination + '&mode=car&policy=1&src=zt20261003.love&coordinate=gaode&callnative=1'
        },
        baidu: {
            app: (isIOS ? 'baidumap' : 'bdapp') + '://map/navi?location=' + baiduLocation.latitude + ',' + baiduLocation.longitude + '&coord_type=bd09ll&query=' + encodedDestination + '&src=webapp.zt20261003.love',
            fallback: 'https://api.map.baidu.com/direction?destination=latlng:' + baiduLocation.latitude + ',' + baiduLocation.longitude + '|name:' + encodedDestination + '&mode=driving&coord_type=bd09ll&region=%E5%85%B0%E5%B7%9E%E6%96%B0%E5%8C%BA&output=html&src=webapp.zt20261003.love'
        },
        didi: {
            app: 'diditaxi://',
            fallback: 'https://a.app.qq.com/o/simple.jsp?pkgname=com.sdu.didi.psnger&g_f=992316'
        }
    };
    if (!links[provider]) return;
    closeModal('navigationModal');
    openAppWithFallback(links[provider].app, links[provider].fallback);
}

function openAppWithFallback(appUrl, fallbackUrl) {
    var pageHidden = false;
    var fallbackTimer;

    function handleVisibilityChange() {
        if (document.hidden) {
            pageHidden = true;
            window.clearTimeout(fallbackTimer);
        }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    fallbackTimer = window.setTimeout(function() {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (!pageHidden) window.location.href = fallbackUrl;
    }, 1200);
    window.location.href = appUrl;
}

// ========== 回到顶部 ==========
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initBackToTop() {
    var btn = document.getElementById('backToTop');
    if (!btn) return;
    window.addEventListener('scroll', function() {
        btn.classList.toggle('visible', window.scrollY > 500);
    });
}

// ========== 键盘事件 ==========
function initKeyboard() {
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay.active').forEach(function(m) { closeModal(m.id); });
            closeLightbox();
        }
        var lightbox = document.getElementById('lightbox');
        if (lightbox && lightbox.classList.contains('active')) {
            if (e.key === 'ArrowLeft') prevImage();
            if (e.key === 'ArrowRight') nextImage();
        }
    });
}

initMusic();

// ========== 页面初始化 ==========
document.addEventListener('DOMContentLoaded', function() {
    createPetals();
    createSparkles();
    initEnvelope();
    updateCountdown();
    initInfoCards();
    initGallery();
    initKeyboard();
    initBackToTop();
    setInterval(updateCountdown, 1000);

    var hero = document.querySelector('.hero-section');
    if (hero && document.documentElement.dataset.device === 'desktop') {
        hero.addEventListener('pointermove', function(event) {
            var rect = hero.getBoundingClientRect();
            var x = ((event.clientX - rect.left) / rect.width - 0.5) * 16;
            var y = ((event.clientY - rect.top) / rect.height - 0.5) * 10;
            hero.style.setProperty('--mouse-x', x.toFixed(2) + 'px');
            hero.style.setProperty('--mouse-y', y.toFixed(2) + 'px');
        });
        hero.addEventListener('pointerleave', function() {
            hero.style.setProperty('--mouse-x', '0px');
            hero.style.setProperty('--mouse-y', '0px');
        });
    }
});

document.addEventListener('gesturestart', function(e) { e.preventDefault(); });
