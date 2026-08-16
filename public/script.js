// Socket.IO 连接（可选，不影响基本功能）
let socket = null;
let isConnected = false;

try {
    socket = io(window.LIVE_API_URL || undefined);
    socket.on('connect', () => {
        console.log('已连接到服务器');
        isConnected = true;
    });
    socket.on('initData', (data) => {
        if (data.wishes) data.wishes.forEach(wish => addWishToWall(wish, false));
        if (data.treeWishes) data.treeWishes.forEach(wish => addWishToTree(wish, false));
        updateWishCount();
    });
    socket.on('newWish', (wish) => { addWishToWall(wish, true); updateWishCount(); });
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
    if (socket && isConnected) {
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
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        const mc = modal.querySelector('.modal');
        if (mc) mc.style.transform = 'scale(0.9) translateY(30px)';
        setTimeout(function() {
            modal.classList.remove('active');
            if (mc) mc.style.transform = '';
            document.body.style.overflow = '';
        }, 300);
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
    if (!isConnected) {
        addWishToWall({ name: name, message: message }, true);
        updateWishCount();
    }
    if (msgEl) msgEl.value = '';

    showSuccessModal('💝', '祝福已送出', '感谢您的美好祝福');
}

function addWishToWall(wish, isNew) {
    var wall = document.getElementById('blessingWall');
    if (!wall) return;

    var styles = ['style-1', 'style-2', 'style-3'];
    var item = document.createElement('div');
    item.className = 'blessing-item ' + styles[Math.floor(Math.random() * styles.length)];
    item.style.top = (10 + Math.random() * 70) + '%';
    item.style.left = (5 + Math.random() * 60) + '%';

    var authorSpan = document.createElement('span');
    authorSpan.className = 'wish-author-small';
    authorSpan.textContent = wish.name || '匿名';
    item.appendChild(authorSpan);
    item.appendChild(document.createTextNode(wish.message || ''));

    if (isNew) item.style.animation = 'wishAppear 0.6s ease';
    wall.appendChild(item);
}

function updateWishCount() {
    var count = document.querySelectorAll('.blessing-item').length;
    var el = document.getElementById('wishCount');
    if (el) el.textContent = count;
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
    { src: 'photos/1786895775746.jpg', caption: '潮声为我们作序' },
    { src: 'photos/1786901043598.jpg', caption: '风把心事吹向你' },
    { src: 'photos/1786901043653.jpg', caption: '把寻常日子拍成诗' },
    { src: 'photos/1786901043709.jpg', caption: '靠近你，也靠近晴朗' },
    { src: 'photos/1786901043714.jpg', caption: '一束柔光落在肩头' },
    { src: 'photos/1786901043721.jpg', caption: '从此望向同一片海' },
    { src: 'photos/1786901043757.jpg', caption: '赵锦江 · 滕玥' },
    { src: 'photos/1786901043794.jpg', caption: '此刻的风，恰好温柔' },
    { src: 'photos/1786901043816.jpg', caption: '这一页，写满心动' },
    { src: 'photos/1786901043859.jpg', caption: '爱在眉眼，也在余生' },
    { src: 'photos/1786901043907.jpg', caption: '故事还会驶向远方' },
    { src: 'photos/1786901043949.jpg', caption: '让海风替我们作证' },
    { src: 'photos/1786901043990.jpg', caption: '沿着星光，牵手去远方' },
    { src: 'photos/1786901044033.jpg', caption: '肩并肩，看潮汐起落' },
    { src: 'photos/1786901044052.jpg', caption: '把远方写进我们的誓言' },
    { src: 'photos/1786901044093.jpg', caption: '下一幕，仍与你同场' },
    { src: 'photos/1786901044128.jpg', caption: '海岸线收好我们的秘密' },
    { src: 'photos/1786901044142.jpg', caption: '回眸时，晚风正好' },
    { src: 'photos/last-wedding-photo.jpg', caption: '余生的镜头，只拍你' }
];
var totalImages = galleryImages.length;
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
    var used = {};
    var queues = items.map(function(item) {
        var index = parseInt(item.dataset.index, 10) - 1;
        used[index] = true;
        return [index];
    });
    galleryImages.forEach(function(image, index) {
        if (!used[index]) queues[index % items.length].push(index);
    });

    items.forEach(function(item, itemIndex) {
        var imageBox = item.querySelector('.placeholder-img');
        var nextBox = document.createElement('div');
        nextBox.className = 'placeholder-img gallery-next-page';
        nextBox.setAttribute('aria-hidden', 'true');
        var photoShell = document.createElement('div');
        photoShell.className = 'gallery-photo-shell';
        imageBox.parentNode.insertBefore(photoShell, imageBox);
        photoShell.appendChild(imageBox);
        photoShell.appendChild(nextBox);
        var captionBox = document.createElement('span');
        captionBox.className = 'gallery-caption';
        captionBox.setAttribute('aria-live', 'polite');
        var captionSpace = document.createElement('div');
        captionSpace.className = 'gallery-caption-space';
        captionSpace.appendChild(captionBox);
        item.appendChild(captionSpace);
        var state = { index: 0, startX: 0, startY: 0, deltaX: 0, deltaY: 0, dragging: false, moved: false, animating: false };
        item.setAttribute('role', 'listitem');
        item.setAttribute('tabindex', '0');
        item.dataset.index = queues[itemIndex][0] + 1;
        item._galleryQueue = queues[itemIndex];
        item._galleryState = state;

        function setImage(box, imageIndex) {
            var image = galleryImages[imageIndex];
            box.style.backgroundImage = "url('" + image.src + "')";
        }

        function render() {
            var imageIndex = item._galleryQueue[state.index];
            item.dataset.index = imageIndex + 1;
            setImage(imageBox, imageIndex);
            captionBox.textContent = galleryImages[imageIndex].caption;
        }

        function turnPage(direction) {
            if (state.animating || item._galleryQueue.length < 2) return;
            state.animating = true;
            var nextIndex = (state.index + direction + item._galleryQueue.length) % item._galleryQueue.length;
            var turnDirection = direction > 0 ? 'next' : 'prev';
            setImage(nextBox, nextIndex);
            nextBox.className = 'placeholder-img gallery-next-page page-under ' + turnDirection;
            imageBox.classList.add('page-front', 'page-turn', turnDirection);
            window.setTimeout(function() {
                state.index = nextIndex;
                render();
                imageBox.className = 'placeholder-img page-front';
                nextBox.className = 'placeholder-img gallery-next-page';
                window.setTimeout(function() {
                    state.animating = false;
                }, 360);
            }, 230);
        }

        function finish(e) {
            if (!state.dragging) return;
            state.dragging = false;
            item.classList.remove('is-dragging');
            if (e && item.hasPointerCapture(e.pointerId)) item.releasePointerCapture(e.pointerId);
            var distance = Math.hypot(state.deltaX, state.deltaY);
            if (distance > 28) {
                var direction = Math.abs(state.deltaX) >= Math.abs(state.deltaY) ? state.deltaX : state.deltaY;
                turnPage(direction < 0 ? 1 : -1);
            }
            if (!state.animating) imageBox.style.transform = 'translate3d(0,0,0)';
            window.setTimeout(function() { state.moved = false; }, 0);
        }

        item.addEventListener('pointerdown', function(e) {
            if (e.button > 0) return;
            state.dragging = true;
            state.moved = false;
            state.startX = e.clientX;
            state.startY = e.clientY;
            state.deltaX = 0;
            state.deltaY = 0;
            item.setPointerCapture(e.pointerId);
            item.classList.add('is-dragging');
        });
        item.addEventListener('pointermove', function(e) {
            if (!state.dragging) return;
            state.deltaX = e.clientX - state.startX;
            state.deltaY = e.clientY - state.startY;
            if (Math.hypot(state.deltaX, state.deltaY) > 6) state.moved = true;
            if (state.moved) {
                e.preventDefault();
                imageBox.style.transform = 'translate3d(' + state.deltaX * .16 + 'px,' + state.deltaY * .16 + 'px,0)';
            }
        }, { passive: false });
        item.addEventListener('pointerup', finish);
        item.addEventListener('pointercancel', finish);
        item.addEventListener('click', function(e) {
            if (state.moved) { e.preventDefault(); return; }
            currentImageIndex = parseInt(item.dataset.index, 10) - 1;
            updateLightbox();
            document.getElementById('lightbox').classList.add('active');
            document.body.style.overflow = 'hidden';
        });
        item.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            item.click();
        });
        imageBox.classList.add('page-front');
        render();
        setImage(nextBox, item._galleryQueue.length > 1 ? item._galleryQueue[1] : item._galleryQueue[0]);
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
    e.preventDefault();
    galleryDrag.deltaX = e.clientX - galleryDrag.startX;
    galleryDrag.deltaY = e.clientY - galleryDrag.startY;
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
var isPlaying = false;
function toggleMusic() {
    isPlaying = !isPlaying;
    var btn = document.getElementById('musicToggle');
    if (btn) btn.classList.toggle('playing', isPlaying);
}

// ========== 地图导航 ==========
function openMap() {
    window.open('https://uri.amap.com/search?keyword=' + encodeURIComponent('幸福大酒店'));
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
