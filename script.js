// Socket.IO 连接（可选，不影响基本功能）
let socket = null;
let isConnected = false;

try {
    socket = io();
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
    for (let i = 0; i < 34; i++) {
        const petal = document.createElement('div');
        petal.className = types[i % types.length];
        const size = 10 + Math.random() * 15;
        petal.style.cssText = `left:${Math.random()*100}%;top:${-10-Math.random()*20}%;animation-duration:${9+Math.random()*16}s;animation-delay:${Math.random()*15}s;background:linear-gradient(135deg,${colors[Math.floor(Math.random()*colors.length)]},${colors[Math.floor(Math.random()*colors.length)]});width:${size}px;height:${size}px;opacity:${0.3+Math.random()*0.4};--drift:${-80+Math.random()*160}px;--spin:${-180+Math.random()*360}deg`;
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
var totalImages = 5;

function initGallery() {
    document.querySelectorAll('.gallery-item').forEach(function(item) {
        item.addEventListener('click', function() {
            currentImageIndex = parseInt(this.dataset.index) - 1;
            updateLightbox();
            var lightbox = document.getElementById('lightbox');
            if (lightbox) {
                lightbox.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        });
    });

    var lightbox = document.getElementById('lightbox');
    if (lightbox) {
        lightbox.addEventListener('click', function(e) {
            if (e.target === lightbox) closeLightbox();
        });
    }
}

function updateLightbox() {
    var img = document.getElementById('lightboxImg');
    var caption = document.getElementById('lightboxCaption');
    var counter = document.getElementById('lightboxCounter');
    if (img) img.innerHTML = '<span>照片 ' + (currentImageIndex + 1) + '</span>';
    if (caption) caption.textContent = '幸福瞬间 ' + (currentImageIndex + 1);
    if (counter) counter.textContent = (currentImageIndex + 1) + ' / ' + totalImages;
}

function prevImage() {
    currentImageIndex = (currentImageIndex - 1 + totalImages) % totalImages;
    updateLightbox();
}

function nextImage() {
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
