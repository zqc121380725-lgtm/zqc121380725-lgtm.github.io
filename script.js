// Socket.IO 连接（可选，不影响基本功能）
let socket = null;
let isConnected = false;
var wallWishTotal = 0;
var maxVisibleWallWishes = 24;

try {
    socket = io(window.LIVE_API_URL || undefined);
    socket.on('connect', () => {
        console.log('已连接到服务器');
        isConnected = true;
    });
    socket.on('disconnect', () => {
        isConnected = false;
    });
    socket.on('initData', (data) => {
        wallWishTotal = Number(data.totalWishes) || (data.wishes ? data.wishes.length : 0);
        if (data.wishes) data.wishes.forEach(wish => addWishToWall(wish, false));
        if (data.treeWishes) data.treeWishes.forEach(wish => addWishToTree(wish, false));
        updateWishCount();
    });
    socket.on('newWish', (wish) => {
        wallWishTotal += 1;
        addWishToWall(wish, true);
        updateWishCount();
    });
    socket.on('newTreeWish', (wish) => { addWishToTree(wish, true); });
    socket.on('seatTaken', (data) => {
        alert(`座位 ${data.seat} 已被其他人选择，请选择其他座位`);
        const seatEl = document.querySelector(`[data-seat="${data.seat}"]`);
        if (seatEl) { seatEl.classList.add('taken'); seatEl.classList.remove('selected'); }
    });
} catch (e) {
    console.log('Socket.IO 未连接，离线模式运行');
}

// 安全发送Socket消息
function socketEmit(event, data) {
    if (socket) {
        socket.emit(event, data);
    } else {
        console.log('离线模式:', event, data);
    }
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
            loadGalleryImages();
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
function handleRSVP(status) {
    var name = document.getElementById('guestName');
    var count = document.getElementById('guestCount');
    var guestName = name ? name.value || '宾客' : '宾客';
    var guestCount = count ? count.value || '1' : '1';

    socketEmit('rsvp', { name: guestName, status: status, count: guestCount });

    var title = document.getElementById('rsvpTitle');
    var msg = document.getElementById('rsvpMessage');
    if (title) title.textContent = status === 'accept' ? '感谢您的出席' : '收到您的回复';
    if (msg) msg.textContent = status === 'accept' ? guestName + '，期待与您相见' : guestName + '，虽然遗憾但我们理解';
    openModal('rsvpModal');
}

// ========== 许愿树祝福 ==========
function openWishModal() {
    openModal('treeWishModal');
}

function submitTreeWish() {
    var nameEl = document.getElementById('wishName');
    var textEl = document.getElementById('wishTreeText');
    var name = nameEl ? nameEl.value || '匿名' : '匿名';
    var message = textEl ? textEl.value : '';

    if (!message) { alert('请写下您的祝福'); return; }

    var activeColor = document.querySelector('.color-dot.active');
    var color = activeColor ? activeColor.dataset.color : '#fce4ec';

    socketEmit('treeWish', { name: name, message: message, color: color });
    if (textEl) textEl.value = '';

    showSuccessModal('🌳', '祝福已挂上', '感谢您的美好祝福');
    closeModal('treeWishModal');
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
function sendWallWish() {
    var nameEl = document.getElementById('wallName');
    var msgEl = document.getElementById('wallMessage');
    var name = nameEl ? nameEl.value || '匿名' : '匿名';
    var message = msgEl ? msgEl.value : '';

    if (!message) { alert('请写下您的祝福'); return; }

    socketEmit('wish', { name: name, message: message });
    if (!socket) {
        wallWishTotal += 1;
        addWishToWall({ name: name, message: message }, true);
        updateWishCount();
    }
    if (msgEl) msgEl.value = '';

    playLetterSendAnimation();
    window.setTimeout(function() {
        showSuccessModal('💝', '祝福已送出', '感谢您的美好祝福');
    }, 900);
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

function confirmSeat() {
    if (!selectedSeat) { alert('请先选择座位'); return; }
    var nameEl = document.getElementById('seatName');
    var name = nameEl ? nameEl.value || '匿名' : '匿名';
    socketEmit('seatSelect', { name: name, seat: selectedSeat });
    showSuccessModal('💺', '座位已确认', '您已选择座位 ' + selectedSeat);
    closeModal('seatModal');
}

// ========== 菜品偏好 ==========
function submitFoodPref() {
    var nameEl = document.getElementById('foodName');
    var noteEl = document.getElementById('foodNote');
    var name = nameEl ? nameEl.value || '匿名' : '匿名';
    var note = noteEl ? noteEl.value : '';
    var prefs = [];
    document.querySelectorAll('input[name="food"]:checked').forEach(function(c) { prefs.push(c.value); });

    if (prefs.length === 0 && !note) { alert('请至少选择一项或填写备注'); return; }

    socketEmit('foodPref', { name: name, preferences: prefs, note: note });
    showSuccessModal('🍽️', '已提交', '感谢您的反馈');
    closeModal('foodModal');
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

    socketEmit('gameScore', { score: gameScore });
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
    { src: 'photos-optimized/1786901043816.webp', caption: '这一页，写满心动' },
    { src: 'photos-optimized/1786901043859.webp', caption: '爱在眉眼，也在余生' },
    { src: 'photos-optimized/last-wedding-photo.webp', caption: '余生的镜头，只拍你' },
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
    if (gallery) initInlineGallery(gallery);

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
        if (inlineImage) {
            inlineImage.addEventListener('error', function retryImage() {
                inlineImage.removeEventListener('error', retryImage);
                inlineImage.src = image.src + '?retry=' + Date.now();
            });
        }
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

function loadGalleryImages() {
    document.querySelectorAll('.gallery-grid img[data-src]').forEach(loadInlineGalleryImage);
}

function loadInlineGalleryImage(inlineImage) {
    if (!inlineImage || inlineImage.src || !inlineImage.dataset.src) return;
    inlineImage.src = inlineImage.dataset.src;
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
    if (!audio) return;
    audio.volume = 0.55;
    audio.addEventListener('play', syncMusicButton);
    audio.addEventListener('pause', syncMusicButton);
    audio.addEventListener('ended', syncMusicButton);
    syncMusicButton();
    playBackgroundMusic();

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
    var destination = '甘肃省兰州市兰州新区丝路华廷禧宴';
    var links = {
        didi: 'https://a.app.qq.com/o/simple.jsp?pkgname=com.sdu.didi.psnger&g_f=992316',
        amap: 'https://uri.amap.com/search?keyword=' + encodeURIComponent(destination) + '&view=map&callnative=1',
        baidu: 'https://api.map.baidu.com/geocoder?address=' + encodeURIComponent(destination) + '&output=html&src=zt20261003.love'
    };
    if (links[provider]) window.open(links[provider], '_blank', 'noopener');
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

// ========== 页面初始化 ==========
document.addEventListener('DOMContentLoaded', function() {
    createPetals();
    createSparkles();
    initEnvelope();
    updateCountdown();
    initInfoCards();
    initGallery();
    initMusic();
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
