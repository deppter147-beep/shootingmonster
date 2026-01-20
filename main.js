'use strict';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const SPEED_CONFIG = {
    normalBase: 0.3,
    normalRandom: 0.7,
    levelScale: 0.03,
    bossBase: 0.25,
    bossRandom: 0.15
};

const SPAWN_CONFIG = {
    baseRate: 110,
    minRate: 50,
    levelScale: 1.5
};

let gameActive = true;
let souls = 50;
let currentMode = 'normal';

let canShoot = true;
let reloadTimer = 0;
let reloadTimeFrames = 30; // 30 frames = 0.5s @60fps, có thể nâng cấp

const GameSystem = {
    level: 1,
    wave: 1,
    totalWavesInLevel: 1,
    enemiesToSpawn: 0,
    enemiesSpawned: 0,
    spawnTimer: 0,
    spawnRate: SPAWN_CONFIG.baseRate,

    startLevel: function() {
        this.level++;
        this.wave = 0;
        this.totalWavesInLevel = Math.ceil(this.level / 3);
        this.startNextWave();
        showBigTitle(`LEVEL ${this.level}`, 2000);
    },

    startNextWave: function() {
        this.wave++;
        if (this.wave > this.totalWavesInLevel) {
            showUpgradePanel();
            return;
        }
        this.enemiesSpawned = 0;
        const baseMobs = 5 + Math.floor(this.level * 1.5);
        this.enemiesToSpawn = baseMobs;

        if (this.level % 5 === 0 && this.wave === this.totalWavesInLevel) {
            this.enemiesToSpawn = 1;
            showBigTitle('⚠️ BOSS FIGHT ⚠️', 3000, true);
        } else {
            showBigTitle(`Wave ${this.wave}/${this.totalWavesInLevel}`, 1500);
        }

        this.spawnRate = Math.max(SPAWN_CONFIG.minRate, SPAWN_CONFIG.baseRate - this.level * SPAWN_CONFIG.levelScale);
        updateLevelInfo();
    }
};

const SKILLS = {
    normal: { cost: 0, color: '#fff' },
    burn: { cost: 50, color: '#ff4400', duration: 5, dmgPerSec: 5 },
    lightning: { cost: 30, color: '#ffff00', bonusDmg: 10, slowDuration: 3 },
    knockback: { cost: 100, color: '#00ffff', bonusDmg: 15, pushDist: 100 }
};

const UPGRADES = [
    {
        id: 'multishot',
        title: '+1 tia bắn',
        desc: 'Tăng số lượng tên bắn ra mỗi phát.',
        apply: () => { playerStats.arrowCount = Math.min(playerStats.arrowCount + 1, 6); }
    },
    {
        id: 'reload',
        title: 'Giảm hồi chiêu',
        desc: '-15% thời gian nạp, tối thiểu 12 frame.',
        apply: () => { reloadTimeFrames = Math.max(12, Math.floor(reloadTimeFrames * 0.85)); }
    },
    {
        id: 'damage',
        title: 'Tăng sát thương',
        desc: '+15 sát thương cơ bản (tỉ lệ theo màn).',
        apply: () => { playerStats.damage += Math.max(15, Math.floor(GameSystem.level * 2)); }
    }
];

const SKILL_SHOP = [
    {
        id: 'burnUpgrade',
        name: 'Nâng cấp Thiêu Đốt',
        desc: 'Giảm 10 soul, tăng 2s thời gian',
        cost: 150,
        level: 0,
        maxLevel: 5,
        apply: () => {
            SKILL_SHOP[0].level++;
            SKILLS.burn.cost = Math.max(10, SKILLS.burn.cost - 10);
            SKILLS.burn.duration += 2;
        }
    },
    {
        id: 'lightningUpgrade',
        name: 'Nâng cấp Sét Giật',
        desc: 'Giảm 5 soul, +5 dmg, +1s slow',
        cost: 120,
        level: 0,
        maxLevel: 5,
        apply: () => {
            SKILL_SHOP[1].level++;
            SKILLS.lightning.cost = Math.max(10, SKILLS.lightning.cost - 5);
            SKILLS.lightning.bonusDmg += 5;
            SKILLS.lightning.slowDuration += 1;
        }
    },
    {
        id: 'knockbackUpgrade',
        name: 'Nâng cấp Đẩy Lùi',
        desc: 'Giảm 20 soul, +10 dmg, +20 khoảng cách',
        cost: 200,
        level: 0,
        maxLevel: 5,
        apply: () => {
            SKILL_SHOP[2].level++;
            SKILLS.knockback.cost = Math.max(20, SKILLS.knockback.cost - 20);
            SKILLS.knockback.bonusDmg += 10;
            SKILLS.knockback.pushDist += 20;
        }
    }
];

const AudioSystem = {
    ctx: new (window.AudioContext || window.webkitAudioContext)(),
    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    },
    shoot() {
        if (!this.ctx) return;
        this.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = 620;
        gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.15);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.2);
    },
    hit() {
        if (!this.ctx) return;
        this.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = 260;
        gain.gain.setValueAtTime(0.07, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.12);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.15);
    }
};

const playerStats = {
    damage: 25,
    critRate: 0.1,
    critDmg: 1.5,
    baseMaxHp: 1000,
    baseCurrentHp: 1000,
    arrowCount: 1,
    canRicochet: false,
    ricochetRange: 250
};

let arrows = [];
class Arrow {
    constructor(x, y, velocity, angle, type, isBouncing = false) {
        this.x = x;
        this.y = y;
        this.velocity = velocity;
        this.angle = angle;
        this.type = type;
        this.active = true;
        this.radius = 4;
        this.isBouncing = isBouncing;
    }
    update() {
        this.x += Math.cos(this.angle) * this.velocity;
        this.y += Math.sin(this.angle) * this.velocity;
        if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) this.active = false;
    }
    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.fillStyle = SKILLS[this.type].color;
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(-10, 5);
        ctx.lineTo(-10, -5);
        ctx.fill();
        if (this.type !== 'normal') {
            ctx.shadowBlur = 10;
            ctx.shadowColor = ctx.fillStyle;
        }
        ctx.restore();
    }
}

let enemies = [];
class Enemy {
    constructor(isBoss = false, specialType = 'normal') {
        this.isBoss = isBoss;
        this.specialType = specialType;
        this.radius = isBoss ? 50 : Math.random() * 10 + 15;
        this.x = Math.random() * (canvas.width - 60) + 30;
        this.y = -80;
        const hpMultiplier = Math.pow(1.1, GameSystem.level - 1);
        this.animFrame = 0;
        this.dashCooldown = 0;
        this.shieldActive = false;
        this.shieldRotation = 0;

        if (isBoss) {
            this.maxHp = 800 * hpMultiplier;
            this.baseSpeed = SPEED_CONFIG.bossBase + Math.random() * SPEED_CONFIG.bossRandom;
        } else {
            if (specialType === 'shield') {
                this.maxHp = 60 * hpMultiplier;
                this.baseSpeed = SPEED_CONFIG.normalBase + Math.random() * 0.4;
                this.shieldActive = true;
            } else if (specialType === 'dash') {
                this.maxHp = 30 * hpMultiplier;
                this.baseSpeed = SPEED_CONFIG.normalBase + Math.random() * 0.3;
            } else if (specialType === 'tank') {
                this.maxHp = 120 * hpMultiplier;
                this.baseSpeed = SPEED_CONFIG.normalBase * 0.6;
                this.radius *= 1.3;
            } else {
                this.maxHp = 40 * hpMultiplier;
                this.baseSpeed = SPEED_CONFIG.normalBase + Math.random() * SPEED_CONFIG.normalRandom + GameSystem.level * SPEED_CONFIG.levelScale;
            }
        }
        this.currentSpeed = this.baseSpeed;
        this.hp = this.maxHp;
        this.active = true;
        this.status = { burnTime: 0, burnTick: 0, slowTime: 0, isFrozen: false };
    }

    update() {
        this.animFrame++;
        if (this.status.burnTime > 0) {
            this.status.burnTick++;
            if (this.status.burnTick >= 60) {
                this.takeDamage(SKILLS.burn.dmgPerSec * (1 + GameSystem.level * 0.1), false, 'burn');
                this.status.burnTime--;
                this.status.burnTick = 0;
            }
        }
        if (this.status.slowTime > 0) {
            this.status.slowTime -= 1 / 60;
            this.currentSpeed = this.baseSpeed * 0.5;
            this.status.isFrozen = true;
        } else {
            this.currentSpeed = this.baseSpeed;
            this.status.isFrozen = false;
        }

        // Special abilities
        if (this.specialType === 'dash' && this.dashCooldown <= 0 && Math.random() < 0.01) {
            this.y += 80;
            this.dashCooldown = 180;
            createFloatingText('DASH!', this.x, this.y - 30, '#ff00ff');
        }
        if (this.dashCooldown > 0) this.dashCooldown--;
        if (this.specialType === 'shield') this.shieldRotation += 0.05;

        this.y += this.currentSpeed;
        if (this.y > canvas.height - 80) {
            this.active = false;
            let dmgToBase = this.isBoss ? 500 : 100;
            if (this.specialType === 'tank') dmgToBase = 200;
            playerStats.baseCurrentHp -= dmgToBase;
            createFloatingText('-' + dmgToBase, this.x, this.y - 20, '#ff0000', true);
            updateUI();
            if (playerStats.baseCurrentHp <= 0) gameOver();
        }
    }

    draw() {
        // Pulsing animation
        const pulse = Math.sin(this.animFrame * 0.1) * 2;
        const drawRadius = this.radius + pulse;

        // Draw shadow
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(this.x, this.y + 5, drawRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Main body
        ctx.beginPath();
        ctx.arc(this.x, this.y, drawRadius, 0, Math.PI * 2);
        if (this.isBoss) ctx.fillStyle = '#9400D3';
        else if (this.specialType === 'shield') ctx.fillStyle = '#4169E1';
        else if (this.specialType === 'dash') ctx.fillStyle = '#FF1493';
        else if (this.specialType === 'tank') ctx.fillStyle = '#8B4513';
        else if (this.status.isFrozen) ctx.fillStyle = '#ADD8E6';
        else if (this.status.burnTime > 0) ctx.fillStyle = '#ff6600';
        else ctx.fillStyle = '#66cc66';
        ctx.fill();

        // Special visuals
        if (this.specialType === 'shield' && this.shieldActive) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.shieldRotation);
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, drawRadius + 5, 0, Math.PI);
            ctx.stroke();
            ctx.restore();
        }
        if (this.specialType === 'tank') {
            ctx.strokeStyle = '#654321';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(this.x, this.y, drawRadius, 0, Math.PI * 2);
            ctx.stroke();
        }
        if (this.isBoss) {
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        }

        // HP bar
        const hpW = this.radius * 2;
        ctx.fillStyle = '#333';
        ctx.fillRect(this.x - hpW / 2, this.y - this.radius - 10, hpW, 5);
        ctx.fillStyle = 'red';
        ctx.fillRect(this.x - hpW / 2, this.y - this.radius - 10, hpW, 5);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(this.x - hpW / 2, this.y - this.radius - 10, hpW * (this.hp / this.maxHp), 5);
    }

    takeDamage(amount, isCrit, type) {
        // Shield blocks 50% damage
        if (this.specialType === 'shield' && this.shieldActive && Math.random() < 0.5) {
            amount *= 0.3;
            createFloatingText('CHẶN!', this.x, this.y - 40, '#FFD700');
        }
        
        this.hp -= amount;
        let color = '#fff';
        if (type === 'burn') color = '#ff4400';
        if (type === 'lightning') color = '#ffff00';
        if (isCrit) {
            color = '#ffd700';
            amount = Math.floor(amount);
        }
        createFloatingText(Math.floor(amount), this.x, this.y - 20, color, isCrit);
        if (this.hp <= 0) {
            this.active = false;
            let soulGain = this.isBoss ? 200 : Math.floor(5 + GameSystem.level);
            if (this.specialType === 'tank') soulGain = Math.floor(soulGain * 1.5);
            if (this.specialType === 'shield') soulGain = Math.floor(soulGain * 1.3);
            if (this.specialType === 'dash') soulGain = Math.floor(soulGain * 1.2);
            souls += soulGain;
            createFloatingText('+' + soulGain + ' Soul', this.x, this.y, '#00ffff');
            dropItemSystem(this.x, this.y, this.isBoss);
            updateUI();
        }
    }

    applyStatus(type) {
        if (type === 'burn') {
            this.status.burnTime = SKILLS.burn.duration;
            createFloatingText('CHÁY!', this.x, this.y - 30, '#ff4400');
        }
        if (type === 'lightning') {
            this.status.slowTime = SKILLS.lightning.slowDuration;
            createFloatingText('CHẬM!', this.x, this.y - 30, '#ffff00');
        }
        if (type === 'knockback') {
            let push = SKILLS.knockback.pushDist;
            if (this.isBoss) push *= 0.1;
            this.y -= push;
            createFloatingText('ĐẨY!', this.x, this.y - 30, '#00ffff');
        }
    }
}

function getRandom(min, max) {
    return Math.random() * (max - min) + min;
}

function dropItemSystem(x, y, isBoss) {
    if (isBoss) {
        const rand = Math.random();
        if (rand < 0.5) {
            playerStats.arrowCount++;
            createFloatingText('⬆ ĐA TIỄN (+1 TIA)', x, y, '#ff00ff', true);
        } else {
            if (!playerStats.canRicochet) {
                playerStats.canRicochet = true;
                createFloatingText('🔄 KÍCH HOẠT BẬT NẢY', x, y, '#ff00ff', true);
            } else {
                playerStats.damage += 20;
                createFloatingText('⬆ +20 DMG', x, y, '#ff00ff', true);
            }
        }
        return;
    }

    if (Math.random() < 0.25) {
        const type = Math.floor(Math.random() * 3);
        let minD, maxD, minC, maxC, minH, maxH;

        if (GameSystem.level <= 50) {
            minD = 1; maxD = 5;
            minC = 0.5; maxC = 2;
            minH = 10; maxH = 100;
        } else {
            minD = 5; maxD = 10;
            minC = 2; maxC = 5;
            minH = 100; maxH = 300;
        }

        if (type === 0) {
            const gain = Math.floor(getRandom(minD, maxD + 1));
            playerStats.damage += gain;
            createFloatingText(`⚔️ +${gain} DMG`, x, y, '#ff4444', true);
        } else if (type === 1) {
            const gainPercent = getRandom(minC, maxC);
            playerStats.critRate += gainPercent / 100;
            if (playerStats.critRate > 0.9) playerStats.critRate = 0.9;
            createFloatingText(`🎯 +${gainPercent.toFixed(1)}% CRIT`, x, y, '#ffd700', true);
        } else {
            const hpGain = Math.floor(getRandom(minH, maxH + 1));
            playerStats.baseMaxHp += hpGain;
            playerStats.baseCurrentHp += hpGain;
            createFloatingText(`❤️ +${hpGain} HP`, x, y, '#00ff00', true);
        }
    }
}

const bow = { x: canvas.width / 2, y: canvas.height - 80, angle: -Math.PI / 2, power: 0, charging: false };
const mouse = { x: 0, y: 0 };
canvas.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    bow.angle = Math.atan2(mouse.y - bow.y, mouse.x - bow.x);
});

canvas.addEventListener('mousedown', () => {
    AudioSystem.resume();
    if (gameActive && canShoot) bow.charging = true;
});

canvas.addEventListener('mouseup', () => {
    if (gameActive && bow.charging) {
        fireArrow();
        bow.charging = false;
        bow.power = 0;
    }
});

document.addEventListener('keydown', e => {
    if (e.key === '1') selectMode('normal');
    if (e.key === '2') selectMode('burn');
    if (e.key === '3') selectMode('lightning');
    if (e.key === '4') selectMode('knockback');
});

function selectMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.skill-slot').forEach(el => el.classList.remove('active'));
    let id = 'skill1';
    if (mode === 'burn') id = 'skill2';
    if (mode === 'lightning') id = 'skill3';
    if (mode === 'knockback') id = 'skill4';
    document.getElementById(id).classList.add('active');
}

function fireArrow() {
    if (!canShoot) return;

    const skill = SKILLS[currentMode];
    if (souls < skill.cost) {
        createFloatingText('Thiếu Soul!', bow.x, bow.y - 60, '#aaa');
        selectMode('normal');
        return;
    }
    if (skill.cost > 0) {
        souls -= skill.cost;
        updateUI();
    }

    AudioSystem.shoot();

    const baseVelocity = (bow.power + 10) * 1.5;
    const count = playerStats.arrowCount;
    const spread = 0.1;
    const startAngle = bow.angle - ((count - 1) * spread) / 2;

    for (let i = 0; i < count; i++) {
        const angle = startAngle + i * spread;
        arrows.push(new Arrow(bow.x, bow.y, baseVelocity, angle, currentMode));
    }

    canShoot = false;
    reloadTimer = 0;
    document.getElementById('reloadContainer').style.display = 'block';
}

function checkCollisions() {
    arrows.forEach(arrow => {
        if (!arrow.active) return;
        for (const enemy of enemies) {
            if (!enemy.active) continue;
            const dist = Math.hypot(arrow.x - enemy.x, arrow.y - enemy.y);
            if (dist < enemy.radius + arrow.radius) {
                arrow.active = false;
                AudioSystem.hit();
                let totalDmg = playerStats.damage;
                const isCrit = Math.random() < playerStats.critRate;
                if (isCrit) totalDmg *= playerStats.critDmg;
                if (arrow.isBouncing) totalDmg *= 0.6;

                const skillInfo = SKILLS[arrow.type];
                if (arrow.type === 'burn') enemy.applyStatus('burn');
                else if (arrow.type === 'lightning') {
                    totalDmg += skillInfo.bonusDmg;
                    enemy.applyStatus('lightning');
                } else if (arrow.type === 'knockback') {
                    totalDmg += skillInfo.bonusDmg;
                    enemy.applyStatus('knockback');
                }

                enemy.takeDamage(totalDmg, isCrit, arrow.type);
                if (playerStats.canRicochet && !arrow.isBouncing) triggerRicochet(arrow, enemy);
                break;
            }
        }
    });
}

function triggerRicochet(arrow, hitEnemy) {
    let closest = null;
    let minD = playerStats.ricochetRange;
    enemies.forEach(e => {
        if (e !== hitEnemy && e.active) {
            const d = Math.hypot(e.x - arrow.x, e.y - arrow.y);
            if (d < minD) {
                minD = d;
                closest = e;
            }
        }
    });
    if (closest) {
        const angle = Math.atan2(closest.y - arrow.y, closest.x - arrow.x);
        arrows.push(new Arrow(arrow.x, arrow.y, 18, angle, arrow.type, true));
    }
}

function showBigTitle(text, duration, isBoss = false) {
    const t1 = document.getElementById('levelTitle');
    const t2 = document.getElementById('waveTitle');
    t1.innerText = text;
    t1.style.display = 'block';
    t1.style.color = isBoss ? 'red' : '#ffd700';
    t2.innerText = isBoss ? 'DIỆT BOSS ĐỂ QUA MÀN!' : 'Chuẩn bị...';
    t2.style.display = 'block';
    setTimeout(() => {
        t1.style.display = 'none';
        t2.style.display = 'none';
    }, duration);
}

function updateLevelInfo() {
    document.getElementById('lvlNum').innerText = GameSystem.level;
    document.getElementById('waveNum').innerText = GameSystem.wave + '/' + GameSystem.totalWavesInLevel;
}

function updateUI() {
    document.getElementById('dispDmg').innerText = Math.floor(playerStats.damage);
    document.getElementById('dispCritRate').innerText = (playerStats.critRate * 100).toFixed(1) + '%';
    document.getElementById('dispMaxHp').innerText = Math.floor(playerStats.baseMaxHp);
    document.getElementById('dispArrowCount').innerText = playerStats.arrowCount;
    document.getElementById('dispRicochet').innerText = playerStats.canRicochet ? 'Có' : 'Không';
    document.getElementById('soulDisplay').innerText = souls;
    const hpPct = (playerStats.baseCurrentHp / playerStats.baseMaxHp) * 100;
    document.getElementById('baseHealthBar').style.width = Math.max(0, hpPct) + '%';
    document.getElementById('baseHealthText').innerText = `HP: ${Math.max(0, Math.floor(playerStats.baseCurrentHp))}/${Math.floor(playerStats.baseMaxHp)}`;
}

function renderUpgradeOptions() {
    const card = document.getElementById('upgradeCard');
    
    // Reset card structure
    card.innerHTML = `
        <h3>Nâng cấp sau màn</h3>
        <div class="upgrade-list">
            <button class="upgrade-btn" id="upg1"></button>
            <button class="upgrade-btn" id="upg2"></button>
            <button class="upgrade-btn" id="upg3"></button>
        </div>
    `;
    
    const buttons = [document.getElementById('upg1'), document.getElementById('upg2'), document.getElementById('upg3')];
    buttons.forEach((btn, idx) => {
        const opt = UPGRADES[idx % UPGRADES.length];
        btn.innerHTML = `<div class="upgrade-title">${opt.title}</div><div class="upgrade-desc">${opt.desc}</div>`;
        btn.onclick = () => applyUpgrade(opt);
    });
}

function showUpgradePanel() {
    renderUpgradeOptions();
    document.getElementById('upgradePanel').style.display = 'flex';
    gameActive = false;
}

function applyUpgrade(opt) {
    opt.apply();
    document.getElementById('upgradePanel').style.display = 'none';
    showSkillShop();
}

function showSkillShop() {
    const panel = document.getElementById('upgradePanel');
    const card = document.getElementById('upgradeCard');
    
    // Safely update title
    let titleElem = card.querySelector('h3');
    if (titleElem) {
        titleElem.innerText = 'Cửa hàng kỹ năng - Soul: ' + souls;
    }
    
    // Safely get or create upgrade list
    let listDiv = card.querySelector('.upgrade-list');
    if (!listDiv) {
        listDiv = document.createElement('div');
        listDiv.className = 'upgrade-list';
        card.appendChild(listDiv);
    }
    listDiv.innerHTML = '';
    
    SKILL_SHOP.forEach((skill, idx) => {
        if (skill.level >= skill.maxLevel) return;
        const btn = document.createElement('button');
        btn.className = 'upgrade-btn';
        btn.innerHTML = `<div class="upgrade-title">${skill.name} [Lv${skill.level}/${skill.maxLevel}]</div>
                        <div class="upgrade-desc">${skill.desc} - Giá: ${skill.cost} Soul</div>`;
        btn.onclick = () => buySkill(idx);
        if (souls < skill.cost) btn.style.opacity = '0.5';
        listDiv.appendChild(btn);
    });
    
    const skipBtn = document.createElement('button');
    skipBtn.className = 'upgrade-btn';
    skipBtn.innerHTML = '<div class="upgrade-title" style="color:#888">Bỏ qua</div>';
    skipBtn.onclick = closeSkillShop;
    listDiv.appendChild(skipBtn);
    
    panel.style.display = 'flex';
}

function buySkill(idx) {
    const skill = SKILL_SHOP[idx];
    if (souls >= skill.cost && skill.level < skill.maxLevel) {
        souls -= skill.cost;
        skill.apply();
        updateUI();
        createFloatingText(`Nâng cấp ${skill.name}!`, canvas.width / 2, canvas.height / 2, '#00ff00', true);
        showSkillShop();
    }
}

function closeSkillShop() {
    document.getElementById('upgradePanel').style.display = 'none';
    gameActive = true;
    GameSystem.startLevel();
    animate();
}

function createFloatingText(text, x, y, color, isBig = false) {
    const el = document.createElement('div');
    el.className = 'floating-text';
    el.innerText = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.color = color;
    if (isBig) {
        el.style.fontSize = '24px';
        el.style.zIndex = 101;
    }
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

function gameOver() {
    gameActive = false;
    alert(`GAME OVER! Bạn đã trụ đến Màn ${GameSystem.level} - Wave ${GameSystem.wave}`);
    location.reload();
}

GameSystem.enemiesToSpawn = 5;

function animate() {
    if (!gameActive) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!canShoot) {
        reloadTimer++;
        const pct = (reloadTimer / reloadTimeFrames) * 100;
        document.getElementById('reloadBar').style.width = pct + '%';
        if (reloadTimer >= reloadTimeFrames) {
            canShoot = true;
            document.getElementById('reloadContainer').style.display = 'none';
        }
    }

    if (bow.charging && bow.power < 15) bow.power += 0.5;
    ctx.save();
    ctx.translate(bow.x, bow.y);
    ctx.rotate(bow.angle);
    ctx.beginPath();
    ctx.strokeStyle = canShoot ? '#fff' : '#555';
    const pull = bow.charging ? -bow.power * 2 : 0;
    ctx.moveTo(0, -30);
    ctx.quadraticCurveTo(pull, 0, 0, 30);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 4;
    ctx.arc(0, 0, 30, Math.PI / 2, -Math.PI / 2, false);
    ctx.stroke();
    if (bow.charging) {
        ctx.fillStyle = SKILLS[currentMode].color;
        ctx.fillRect(pull, -2, 40, 4);
    }
    ctx.restore();

    arrows.forEach(a => {
        a.update();
        a.draw();
    });
    arrows = arrows.filter(a => a.active);

    if (GameSystem.enemiesSpawned < GameSystem.enemiesToSpawn) {
        GameSystem.spawnTimer++;
        if (GameSystem.spawnTimer > GameSystem.spawnRate) {
            const isBoss = GameSystem.level % 5 === 0 && GameSystem.wave === GameSystem.totalWavesInLevel && GameSystem.enemiesToSpawn === 1;
            
            let specialType = 'normal';
            if (!isBoss && GameSystem.level >= 2) {
                const rand = Math.random();
                if (rand < 0.15) specialType = 'shield';
                else if (rand < 0.25) specialType = 'dash';
                else if (rand < 0.35 && GameSystem.level >= 3) specialType = 'tank';
            }
            
            enemies.push(new Enemy(isBoss, specialType));
            GameSystem.enemiesSpawned++;
            GameSystem.spawnTimer = 0;
        }
    } else if (enemies.length === 0) {
        setTimeout(() => {
            if (enemies.length === 0 && GameSystem.enemiesSpawned >= GameSystem.enemiesToSpawn) {
                GameSystem.startNextWave();
            }
        }, 1000);
    }

    enemies.forEach(e => {
        e.update();
        e.draw();
    });
    enemies = enemies.filter(e => e.active);

    checkCollisions();
    requestAnimationFrame(animate);
}

updateUI();
animate();
showBigTitle('LEVEL 1', 2000);
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    bow.x = canvas.width / 2;
    bow.y = canvas.height - 80;
});
