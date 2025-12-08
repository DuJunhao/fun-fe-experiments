import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// ================= 配置 =================
const CONFIG = {
    particleCount: 1500,
    bucketXmlUrl: "https://storage.googleapis.com/beautiful-days/?prefix=christa/",
    publicBaseUrl: "https://static.refinefuture.com/",
    treeHeight: 85,
    explodeRadius: 150,
    camZ: 130,
    // 增加一点照片的自转速度，让效果更明显
    photoRotSpeed: 0.015,
    colors: {
        gold: 0xFFD700,
        red: 0xC41E3A,
        green: 0x053505,
        leafGreen: 0x2E8B57,
        white: 0xFFFFFF,
        emissiveGold: 0xAA8800
    }
};

// ================= 全局变量 =================
let scene, camera, renderer, composer;
let particles = [];
let photos = [];
let targetState = 'EXPLODE';
let activePhotoIdx = -1;
let imageList = [];
let isCameraMode = false;
let globalRot = 0; // 新增：用于记录全局旋转角度

const raycaster = new THREE.Raycaster();
const mouseVector = new THREE.Vector2();

// ================= 全局变量 =================

// 【修改点】在这里增加了 smoothX, smoothY, smoothPinch 用于防抖
const inputState = {
    x: 0.5, y: 0.5,
    isFist: false,
    mouseLockedPhoto: false,
    isPinch: false,
    zoomLevel: 3.5,
    lastPinchTime: 0,

    // 新增：平滑缓冲变量 (默认值)
    smoothX: 0.5,
    smoothY: 0.5,
    smoothPinch: 0.0
};

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

// 占位图
function createTextTexture(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 680;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 512, 680);
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 10; ctx.strokeRect(20, 20, 472, 640);
    ctx.font = 'bold 40px Arial'; ctx.fillStyle = '#d4af37'; ctx.textAlign = 'center';
    ctx.fillText(text, 256, 340);
    return new THREE.CanvasTexture(canvas);
}
const loadingTex = createTextTexture("LOADING...");

// ================= 1. 启动入口 =================
async function fetchBucketPhotos() {
    const loaderText = document.getElementById('loader-text');
    setTimeout(() => {
        const loader = document.getElementById('loader');
        if (loader) { loader.style.opacity = 0; setTimeout(() => loader.remove(), 500); }
    }, 2500);

    try {
        if (loaderText) loaderText.innerText = "SCANNING MEMORIES...";
        const response = await fetch(CONFIG.bucketXmlUrl);
        if (!response.ok) throw new Error("Network error");
        const str = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(str, "text/xml");
        const contents = xmlDoc.getElementsByTagName("Contents");
        imageList = [];
        for (let i = 0; i < contents.length; i++) {
            const key = contents[i].getElementsByTagName("Key")[0].textContent;
            if (key.match(/\.(jpg|jpeg|png)$/i) && !key.endsWith('/')) {
                imageList.push(key);
            }
        }
        if (imageList.length === 0) throw new Error("No images found");
        if (loaderText) loaderText.innerText = `LOADED ${imageList.length} PHOTOS`;
    } catch (e) {
        console.warn("Using offline mode", e);
        if (loaderText) loaderText.innerText = "OFFLINE MODE";
        for (let i = 1; i <= 6; i++) imageList.push(`christa/${i}.jpg`);
    }

    initThree();
    setTimeout(initMediaPipeSafe, 100);
}

// ================= 2. 交互逻辑 =================
function getIntersectedPhoto(clientX, clientY) {
    const mv = new THREE.Vector2();
    mv.x = (clientX / window.innerWidth) * 2 - 1;
    mv.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mv, camera);
    const intersects = raycaster.intersectObjects(photos, true);

    if (intersects.length > 0) {
        let hitObj = intersects[0].object;
        while (hitObj && hitObj !== scene) {
            if (hitObj.userData && hitObj.userData.type === 'PHOTO') return hitObj;
            hitObj = hitObj.parent;
        }
    }
    return null;
}

function onGlobalMouseMove(event) {
    inputState.x = event.clientX / window.innerWidth;
    inputState.y = event.clientY / window.innerHeight;

    if (!inputState.mouseLockedPhoto) {
        const hit = getIntersectedPhoto(event.clientX, event.clientY);
        document.body.style.cursor = hit ? 'pointer' : 'default';
        if (hit) {
            photos.forEach(p => {
                p.userData.hoverScale = (p === hit) ? 1.15 : 1.0;
            });
        } else {
            photos.forEach(p => p.userData.hoverScale = 1.0);
        }
    }
}

function onGlobalMouseDown(event) {
    if (event.button !== 0) return;

    const bgm = document.getElementById('bgm');
    if (bgm && bgm.paused) {
        bgm.volume = 1.0;
        bgm.play()
            .then(() => console.log("✅ 选中照片，BGM 开始播放"))
            .catch(e => console.error("❌ 播放报错:", e));
    }

    const targetPhoto = getIntersectedPhoto(event.clientX, event.clientY);

    // 只有当检测到点击了照片 (targetPhoto 存在) 时进入
    if (targetPhoto) {

        inputState.mouseLockedPhoto = true;
        activePhotoIdx = targetPhoto.userData.idx;
        inputState.isFist = false;

        // 【修改这里】之前是 4.0 太大了，改回 2.2 左右比较合适
        inputState.zoomLevel = 2.2;

        updateStatusText("MEMORY LOCKED", "#00ffff");
    } else {
        // 如果点击的是空白处
        if (inputState.mouseLockedPhoto) {
            inputState.mouseLockedPhoto = false;
            activePhotoIdx = -1;
            updateStatusText("GALAXY MODE");
        } else {
            inputState.isFist = true;
            updateStatusText("FORMING TREE", "#FFD700");
        }
    }
}

function onGlobalMouseUp(event) {
    if (!inputState.mouseLockedPhoto) {
        inputState.isFist = false;
        updateStatusText("GALAXY MODE");
    }
}

function onGlobalWheel(event) {
    if (targetState === 'PHOTO') {
        inputState.zoomLevel += event.deltaY * -0.005;
        inputState.zoomLevel = Math.max(1.5, Math.min(8.0, inputState.zoomLevel));
    }
}

function updateStatusText(text, color = "#fff") {
    const el = document.getElementById('status-text');
    if (el && el.innerText !== text) {
        el.innerText = text;
        el.style.color = color;
        el.style.textShadow = color === "#fff" ? "none" : `0 0 15px ${color}`;
    }
}

function initThree() {
    console.log("正在初始化 initThree..."); // 【调试】确认函数进来了吗？

    // ===========================================
    // 【修改】把监听器移到最前面！防止后面报错阻断
    // ===========================================
    window.removeEventListener('mousedown', onGlobalMouseDown); // 先移除旧的，防止重复
    window.addEventListener('mousedown', onGlobalMouseDown);
    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('wheel', onGlobalWheel);
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('contextmenu', e => e.preventDefault());
    console.log("鼠标监听器已挂载");
    // ===========================================

    // 【1. 清空旧画布】
    const container = document.getElementById('canvas-container');
    container.innerHTML = '';

    particles = [];
    photos = [];

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.001);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = CONFIG.camZ;

    renderer = new THREE.WebGLRenderer({ antialias: true, stencil: false, depth: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 2.0;
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    const mainLight = new THREE.DirectionalLight(0xFFF5E1, 2);
    mainLight.position.set(20, 50, 50);
    scene.add(mainLight);
    const centerLight = new THREE.PointLight(0xFFD700, 5, 150);
    scene.add(centerLight);

    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.8;
    bloomPass.strength = 1.5;
    bloomPass.radius = 0.5;
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    // 【注意检查】如果这里面的代码报错，后面就会停止运行
    try {
        createChristmasObjects();
        createMerryChristmas();
    } catch (e) {
        console.error("创建3D对象时出错:", e);
    }

    animate();
}

function createChristmasObjects() {
    // ==========================================================================
    // 辅助函数：柔光纹理 (保持不变)
    // ==========================================================================
    function createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 255, 240, 1)');
        gradient.addColorStop(0.4, 'rgba(255, 220, 180, 0.6)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    // 1. 纹理配置 (保持之前的深绿色设置)
    const leafTex = createCrossTexture('#0B300B', '#000500');
    const giftTex = createCrossTexture('#DC143C', '#FFD700');
    const glowTex = createGlowTexture();

    // 2. 材质配置
    const matGlowSprite = new THREE.SpriteMaterial({
        map: glowTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });

    const matLeaf = new THREE.MeshLambertMaterial({ map: leafTex });
    const matGift = new THREE.MeshPhysicalMaterial({ map: giftTex, roughness: 0.4, metalness: 0.3, emissive: 0x220000, emissiveIntensity: 0.2 });
    const matGold = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.gold, metalness: 0.9, roughness: 0.1, emissive: CONFIG.colors.emissiveGold, emissiveIntensity: 2.0 });
    const matRedShiny = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.7, roughness: 0.15, emissive: 0x550000, emissiveIntensity: 1.5 });
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const matCandy = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.white, metalness: 0.3, roughness: 0.4, emissive: 0xFFFFFF, emissiveIntensity: 1.2 });
    const matTopStar = new THREE.MeshPhysicalMaterial({ color: 0xFFD700, metalness: 1.0, roughness: 0.0, emissive: 0xFFEE88, emissiveIntensity: 5.0, clearcoat: 1.0 });

    // 3. 几何体配置
    const leafGeo = new THREE.BoxGeometry(1.8, 1.8, 1.8);
    const sphereGeo = new THREE.SphereGeometry(1.2, 16, 16);
    const giftGeo = new THREE.BoxGeometry(2.0, 2.0, 2.0);
    const hatConeGeo = new THREE.ConeGeometry(1.2, 3, 16);
    const hatBrimGeo = new THREE.TorusGeometry(1.2, 0.3, 12, 24);
    const stockLegGeo = new THREE.CylinderGeometry(0.8, 0.8, 2.5, 12);
    const stockFootGeo = new THREE.CylinderGeometry(0.8, 0.9, 1.5, 12);
    const candyGeo = new THREE.CylinderGeometry(0.3, 0.3, 3.5, 12);
    const starGeo = new THREE.OctahedronGeometry(1.8);

    const starShape = createStarShape(5, 2.5);
    const extrudeSettings = { steps: 1, depth: 1.5, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.4, bevelSegments: 3 };
    const topStarGeo = new THREE.ExtrudeGeometry(starShape, extrudeSettings);
    topStarGeo.center();

    const baseCount = CONFIG.particleCount - 150;

    // 4. 创建普通装饰物 (循环保持不变)
    for (let i = 0; i < baseCount; i++) {
        let mesh;
        const containerGroup = new THREE.Group();
        const type = Math.random();
        let isSuitableForGlow = true;

        if (type < 0.60) {
            mesh = new THREE.Mesh(leafGeo, matLeaf);
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            mesh.scale.setScalar(0.8 + Math.random() * 0.5);
            initParticle(containerGroup, 'LEAF', i);
            isSuitableForGlow = false;
        } else {
            if (type < 0.70) mesh = new THREE.Mesh(sphereGeo, Math.random() > 0.5 ? matGold : matRedShiny);
            else if (type < 0.80) { mesh = new THREE.Mesh(giftGeo, matGift); mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI); }
            else if (type < 0.88) { mesh = new THREE.Mesh(candyGeo, matCandy); mesh.rotation.set((Math.random() - 0.5), (Math.random() - 0.5), Math.random() * Math.PI); }
            else if (type < 0.93) { mesh = new THREE.Mesh(starGeo, matGold); mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0); }
            else if (type < 0.97) {
                const group = new THREE.Group();
                const cone = new THREE.Mesh(hatConeGeo, matRedShiny);
                const brim = new THREE.Mesh(hatBrimGeo, matWhite);
                brim.position.y = -1.5; brim.rotation.x = Math.PI / 2;
                group.add(cone); group.add(brim);
                mesh = group;
            } else {
                const group = new THREE.Group();
                const leg = new THREE.Mesh(stockLegGeo, matRedShiny);
                const foot = new THREE.Mesh(stockFootGeo, matRedShiny);
                foot.rotation.x = Math.PI / 2; foot.position.set(0, -1.25, 0.5);
                const cuff = new THREE.Mesh(hatBrimGeo, matWhite);
                cuff.position.y = 1.25; cuff.rotation.x = Math.PI / 2; cuff.scale.set(0.8, 0.8, 0.8);
                group.add(leg); group.add(foot); group.add(cuff);
                mesh = group;
            }

            const scaleVar = 0.8 + Math.random() * 0.4;
            if (!mesh.isGroup) mesh.scale.setScalar(scaleVar);
            initParticle(containerGroup, 'DECOR', i);
        }

        containerGroup.add(mesh);

        if (isSuitableForGlow) {
            const glowSprite = new THREE.Sprite(matGlowSprite);
            const glowSize = 3.5 + Math.random() * 1.0;
            glowSprite.scale.set(glowSize, glowSize, 1.0);
            glowSprite.position.set(0, 0, 0.1);
            containerGroup.add(glowSprite);
        }

        scene.add(containerGroup);
        particles.push(containerGroup);
    }

    // ==========================================
    // 5. 灯带 (Light Ribbon) - 【核心修改区域】
    // ==========================================
    const ribbonPoints = [];
    const ribbonSegments = 400; // 增加分段让细线更圆滑
    const ribbonTurns = 7;
    const bottomRadius = 55;
    const topRadius = 1;

    for (let i = 0; i <= ribbonSegments; i++) {
        const progress = i / ribbonSegments;
        const angle = progress * Math.PI * 2 * ribbonTurns;
        const y = (progress - 0.5) * CONFIG.treeHeight;
        const radius = THREE.MathUtils.lerp(bottomRadius, topRadius, progress);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        ribbonPoints.push(new THREE.Vector3(x, y, z));
    }
    const spiralPath = new THREE.CatmullRomCurve3(ribbonPoints);

    // 【修改 1】：半径改细！从 1.2 改为 0.3
    const tubeGeo = new THREE.TubeGeometry(spiralPath, 800, 0.3, 8, false);

    // 【修改 2】：使用 Standard 材质 + 自发光(Emissive)
    // 这样可以通过 emissiveIntensity 强制让暗色也发光
    const matGlowingRibbon = new THREE.MeshStandardMaterial({
        color: 0x000000,        // 基础色设为黑，全靠发光
        emissive: 0xFF8800,     // 发光色：深金橙色 (不会像浅黄那么刺眼)
        emissiveIntensity: 4.0, // 【关键】强度设高，强制触发 Bloom 光晕
        roughness: 0.4,
        metalness: 1.0
    });

    const ribbonMesh = new THREE.Mesh(tubeGeo, matGlowingRibbon);

    ribbonMesh.userData = {
        type: 'RIBBON',
        treePos: new THREE.Vector3(0, 0, 0),
        explodePos: new THREE.Vector3(0, 0, 0),
        baseScale: new THREE.Vector3(1, 1, 1),
        rotSpeed: { x: 0, y: 0, z: 0 }
    };

    scene.add(ribbonMesh);
    particles.push(ribbonMesh);

    // ==========================================
    // 6. 树顶星星
    // ==========================================
    const topStarGroup = new THREE.Group();
    const topStarMesh = new THREE.Mesh(topStarGeo, matTopStar);
    topStarGroup.add(topStarMesh);

    const topGlowSprite = new THREE.Sprite(matGlowSprite);
    topGlowSprite.scale.set(12, 12, 1.0);
    topStarGroup.add(topGlowSprite);

    initParticle(topStarGroup, 'TOP_STAR', 20000);
    topStarGroup.userData.treePos.set(0, CONFIG.treeHeight / 2 + 2, 0);
    topStarGroup.userData.rotSpeed = { x: 0, y: 0.02, z: 0 };
    scene.add(topStarGroup);
    particles.push(topStarGroup);

    // ==========================================
    // 7. 照片卡片
    // ==========================================
    const photoGeo = new THREE.PlaneGeometry(9, 12);
    const borderGeo = new THREE.BoxGeometry(9.6, 12.6, 0.2);
    const borderMat = new THREE.MeshStandardMaterial({ color: 0xdaa520, metalness: 0.6, roughness: 0.4 });

    imageList.forEach((filename, i) => {
        const mat = new THREE.MeshBasicMaterial({ map: loadingTex, side: THREE.DoubleSide, toneMapped: false });
        const url = CONFIG.publicBaseUrl + filename;
        textureLoader.load(url, (tex) => { tex.colorSpace = THREE.SRGBColorSpace; mat.map = tex; mat.needsUpdate = true; }, undefined, () => { mat.map = createTextTexture("LOAD FAILED"); });

        const photoMesh = new THREE.Mesh(photoGeo, mat);
        photoMesh.position.z = 0.15;
        const border = new THREE.Mesh(borderGeo, borderMat);
        border.position.z = -0.15;

        const group = new THREE.Group();
        group.userData = { type: 'PHOTO', idx: i, hoverScale: 1.0 };
        group.add(border); group.add(photoMesh);

        initParticle(group, 'PHOTO', i);
        scene.add(group);
        particles.push(group);
        photos.push(group);
    });

    // ==========================================
    // 8. 下雪特效
    // ==========================================
    const snowGeo = new THREE.CircleGeometry(0.4, 6);
    const snowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });

    for (let i = 0; i < 300; i++) {
        const snowMesh = new THREE.Mesh(snowGeo, snowMat);
        const x = (Math.random() - 0.5) * 300;
        const y = Math.random() * 200 + 50;
        const z = (Math.random() - 0.5) * 300;
        snowMesh.position.set(x, y, z);

        snowMesh.userData = {
            type: 'SNOW',
            fallSpeed: 0.1 + Math.random() * 0.2,
            driftSpeed: (Math.random() - 0.5) * 0.15,
            randomPhase: Math.random() * Math.PI * 2,
            baseScale: new THREE.Vector3(1, 1, 1)
        };

        scene.add(snowMesh);
        particles.push(snowMesh);
    }
}

function initParticle(mesh, type, idx) {
    const h = Math.random();
    let radiusMod = 1.0;
    // 讓葉子（綠色禮物盒）稍微靠內一點，形成樹的主體
    if (type === 'LEAF') radiusMod = 0.85;

    const angle = h * Math.PI * 25 + idx * 0.1;

    // 【修改點 3】將 40 改為 36，讓整體分佈更緊湊
    // 原來是: const r = ((1.05 - h) * 40) * radiusMod;
    const r = ((1.05 - h) * 36) * radiusMod;

    const treePos = new THREE.Vector3(Math.cos(angle) * r, (h - 0.5) * CONFIG.treeHeight, Math.sin(angle) * r);

    // ... (後面的代碼保持不變) ...
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const rad = 60 + Math.random() * CONFIG.explodeRadius;
    const explodePos = new THREE.Vector3(
        rad * Math.sin(phi) * Math.cos(theta),
        rad * Math.sin(phi) * Math.sin(theta),
        rad * Math.cos(phi)
    );

    mesh.userData = Object.assign(mesh.userData || {}, {
        type, idx, treePos, explodePos,
        rotSpeed: { x: Math.random() * 0.02, y: Math.random() * 0.02, z: Math.random() * 0.02 },
        baseScale: mesh.scale.clone(),
        randomPhase: Math.random() * 10
    });
    mesh.position.copy(explodePos);
}

// ==========================================
// 新增辅助函数：创建一个 2D 五角星形状
// ==========================================
function createStarShape(outerRadius, innerRadius, points = 5) {
    const shape = new THREE.Shape();
    const step = Math.PI / points; // 每个点之间的角度间隔（半角）

    for (let i = 0; i < 2 * points; i++) {
        const radius = (i % 2 === 0) ? outerRadius : innerRadius;
        // 减去 Math.PI / 2 是为了让星星的一个角初始朝上
        const angle = i * step - Math.PI / 2;

        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;

        if (i === 0) {
            shape.moveTo(x, y);
        } else {
            shape.lineTo(x, y);
        }
    }
    shape.closePath(); // 闭合路径
    return shape;
}

function createMerryChristmas() {
    const loader = new FontLoader();
    loader.load('https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json', function (font) {
        const textMat = new THREE.MeshPhysicalMaterial({
            color: CONFIG.colors.gold, metalness: 1.0, roughness: 0.15,
            emissive: CONFIG.colors.emissiveGold, emissiveIntensity: 2.0,
            clearcoat: 1.0
        });
        const settings = { font: font, size: 5, height: 1.0, curveSegments: 12, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.1 };

        const merryGeo = new TextGeometry('MERRY', settings);
        const chrisGeo = new TextGeometry('CHRISTMAS', settings);
        merryGeo.center(); chrisGeo.center();

        const mMesh = new THREE.Mesh(merryGeo, textMat); mMesh.position.y = 6;
        const cMesh = new THREE.Mesh(chrisGeo, textMat); cMesh.position.y = -4;

        const group = new THREE.Group();
        group.add(mMesh); group.add(cMesh);

        const explodePos = new THREE.Vector3(0, CONFIG.treeHeight + 50, 0);
        group.userData = {
            type: 'TEXT', treePos: new THREE.Vector3(0, CONFIG.treeHeight / 2 + 18, 0),
            explodePos: explodePos, rotSpeed: { x: 0, y: 0.01, z: 0 },
            baseScale: new THREE.Vector3(1, 1, 1), randomPhase: 0
        };
        group.position.copy(explodePos);
        scene.add(group);
        particles.push(group);
    });
}

function createCrossTexture(bgColorStr, crossColorStr) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bgColorStr; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = crossColorStr;
    const thickness = size / 4; const center = size / 2;
    ctx.fillRect(center - thickness / 2, 0, thickness, size);
    ctx.fillRect(0, center - thickness / 2, size, thickness);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    return tex;
}

function updateLogic() {
    // 状态切换逻辑
    if (activePhotoIdx !== -1) {
        targetState = 'PHOTO';
    } else if (inputState.isFist) {
        targetState = 'TREE';
    } else {
        targetState = 'EXPLODE';
    }

    const time = Date.now() * 0.001;

    // 1. 全局旋转计算
    globalRot -= 0.0005;

    // 2. 鼠标上下控制场景俯仰 (X轴)
    const targetRotX = (inputState.y - 0.5) * 0.5;
    scene.rotation.x += (targetRotX - scene.rotation.x) * 0.05;
    scene.rotation.y = 0;

    particles.forEach(mesh => {
        const data = mesh.userData;
        let tPos = new THREE.Vector3();
        let tScale = data.baseScale.clone();

        // ================= 修改开始：添加雪花运动逻辑 =================
        if (data.type === 'SNOW') {
            // 1. 向下移动
            mesh.position.y -= data.fallSpeed;

            // 2. 水平方向轻微摆动（模拟风吹）
            mesh.position.x += Math.sin(time + data.randomPhase) * data.driftSpeed;
            // 确保雪花始终面向摄像机（对于 2D CircleGeometry 很有必要）
            mesh.lookAt(camera.position);

            // 3. 循环机制：如果掉到屏幕下方，就回到顶部
            // 这里的 -150 是一个大概的底部边界值
            if (mesh.position.y < -150) {
                mesh.position.y = 200; // 回到顶部
                // 重新随机水平位置，避免重复感
                mesh.position.x = (Math.random() - 0.5) * 300;
                mesh.position.z = (Math.random() - 0.5) * 300;
            }

            // 雪花不需要插值，直接应用位置即可
            // 直接 return，不执行后面的通用逻辑
            return;
        }

        // ===========================================
        // 2. 特殊处理：树顶五角星 (TOP_STAR)
        // 【修改点】：让星星在爆炸模式下永远居中自转
        // ===========================================
        if (data.type === 'TOP_STAR') {
            // 始终自转 (绕Y轴)
            mesh.rotation.y += 0.02;
            // 稍微带点X轴倾角，让星星看起来更有立体感，不至于是一条线
            mesh.rotation.x = 0.1;

            if (targetState === 'TREE') {
                // 树模式：飞回树顶
                tPos.copy(data.treePos);
                tScale.set(1, 1, 1);
            } else {
                // 爆炸/照片模式：强制居中
                tPos.set(0, 0, 0);
                // 可以稍微放大一点，让它像个核心
                tScale.set(1.5, 1.5, 1.5);
            }

            // 平滑插值
            mesh.position.lerp(tPos, 0.08);
            mesh.scale.lerp(tScale, 0.08);
            return; // 跳过后续通用逻辑
        }

        // ===========================================
        // 特殊处理：灯带 (RIBBON)
        // 目的：确保灯带在任何模式下都可见，且正确旋转
        // ===========================================
        if (data.type === 'RIBBON') {
            // 位置始终居中
            tPos.set(0, 0, 0);

            // 【修改点】根据状态决定是否显示
            if (targetState === 'TREE') {
                tScale.set(1, 1, 1); // 树模式：显示
            } else {
                tScale.set(0, 0, 0); // 爆炸/照片模式：消失
            }

            // 保持自转
            mesh.rotation.set(0, globalRot, 0);

            // 平滑过渡
            mesh.position.lerp(tPos, 0.08);
            mesh.scale.lerp(tScale, 0.08);
            return; // 跳过后续通用逻辑
        }

        // ===========================================
        // 下面是普通粒子的通用逻辑
        // ===========================================

        // 默认自转
        mesh.rotation.x += data.rotSpeed.x;
        mesh.rotation.y += data.rotSpeed.y;

        if (targetState === 'TREE') {
            tPos.copy(data.treePos);
            // 呼吸效果
            tPos.y += Math.sin(time * 2 + data.randomPhase) * 1.0;
            if (data.type === 'PHOTO') tScale.multiplyScalar(0.6);

        } else if (targetState === 'EXPLODE') {
            tPos.copy(data.explodePos);
            // 漂浮效果
            tPos.x += Math.sin(time * 0.5 + data.randomPhase) * 2;
            tPos.y += Math.cos(time * 0.5 + data.randomPhase) * 2;

        } else if (targetState === 'PHOTO') {
            if (data.type === 'PHOTO' && data.idx === activePhotoIdx) {
                // 选中照片逻辑在后面
            } else {
                tPos.copy(data.explodePos).multiplyScalar(2.0);
            }
        }

        // --- B. 应用位置变换 ---
        const isActivePhoto = (targetState === 'PHOTO' && data.type === 'PHOTO' && data.idx === activePhotoIdx);

        if (isActivePhoto) {
            tPos.set(0, 0, CONFIG.camZ - 50);
            mesh.lookAt(camera.position);
            mesh.rotation.set(0, 0, 0);
            tScale.multiplyScalar(inputState.zoomLevel);
        } else {
            // 普通物体应用公转
            if (data.type !== 'RIBBON') {
                tPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), globalRot);
            }

            if (data.type === 'PHOTO' && targetState !== 'PHOTO') {
                tScale.multiplyScalar(data.hoverScale);
            }
        }

        // --- C. 平滑插值 ---
        mesh.position.lerp(tPos, 0.08);
        mesh.scale.lerp(tScale, 0.08);
    });
}

function animate() {
    requestAnimationFrame(animate);
    updateLogic();
    composer.render();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}



// ================= 5. MediaPipe (增强版) =================
async function initMediaPipeSafe() {
    const video = document.getElementById('input_video');

    // 1. 核心检查：浏览器是否支持
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        enableMouseMode("MOUSE MODE (NO API)");
        return;
    }

    try {
        // 2. 硬件检查：是否有视频输入设备
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = devices.some(device => device.kind === 'videoinput');

        if (!hasCamera) {
            console.warn("No camera found.");
            enableMouseMode("MOUSE MODE (NO CAM)");
            return; // 直接退出，不再尝试启动
        }

        // 3. 初始化 Hand 模型
        const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
        hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6 });

        hands.onResults(results => {
            if (!isCameraMode) return;
            if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                const lm = results.multiHandLandmarks[0];

                // ================= 1. 计算原始数据 (Raw Data) =================
                // 捏合距离 (大拇指4 - 食指8)
                const rawPinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);

                // 握拳距离 (四个指尖到手腕)
                const fingerTips = [8, 12, 16, 20];
                let totalDist = 0;
                fingerTips.forEach(i => {
                    totalDist += Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y);
                });
                const avgFingerDist = totalDist / 4;

                // ================= 2. 更新平滑数据 (Smoothing) =================
                // 无论是否处于捏合状态，都在后台更新平滑值，保证数值连续
                // 0.15 是阻尼系数：越小越稳，越大越跟手
                inputState.smoothPinch += (rawPinchDist - inputState.smoothPinch) * 0.15;

                // 只有在【没锁定照片】时才更新鼠标位置，防止照片乱跑
                if (activePhotoIdx === -1) {
                    const targetX = 1.0 - lm[9].x;
                    const targetY = lm[9].y;
                    inputState.smoothX += (targetX - inputState.smoothX) * 0.15;
                    inputState.smoothY += (targetY - inputState.smoothY) * 0.15;

                    inputState.x = inputState.smoothX;
                    inputState.y = inputState.smoothY;
                }

                // ================= 3. 判定状态 (State Detection) =================
                // 【关键修改】：判定是否捏合，使用【原始距离 rawPinchDist】
                // 这样反应最快，不需要等平滑数值追上来
                let isPinchDetected = (rawPinchDist < 0.06);

                // 判定是否握拳 (阈值 0.25)
                let isFistDetected = (avgFingerDist < 0.25);

                // 优先级处理：如果正在捏合，就不算握拳 (防止冲突)
                if (isPinchDetected) {
                    isFistDetected = false;
                }

                inputState.isFist = isFistDetected;
                inputState.isPinch = isPinchDetected;

                // ===========================================
                // 【新增】只要检测到任何手势(握拳或捏合)，就尝试播放音乐
                // ===========================================
                if (isPinchDetected || isFistDetected) {
                    const bgm = document.getElementById('bgm');
                    if (bgm && bgm.paused) {
                        bgm.volume = 1.0;
                        // 注意：如果用户从未点击过页面，纯手势可能会被浏览器拦截自动播放
                        // 但只要点过一次允许摄像头，通常就可以了
                        bgm.play().catch(e => {}); 
                    }
                }
            
                // ================= 4. 执行业务逻辑 =================
                if (inputState.isPinch) {
                    const now = Date.now();

                    // 触发解锁 (0.5秒冷却)
                    if (activePhotoIdx === -1 && now - inputState.lastPinchTime > 500) {

                        activePhotoIdx = Math.floor(Math.random() * photos.length);
                        inputState.lastPinchTime = now;
                        inputState.zoomLevel = 2.2; // 初始放大一点
                        updateStatusText("MEMORY UNLOCKED", "#00ffff");
                    }

                    // 【关键修改】：虽然判定用原始值，但计算缩放用【平滑值 smoothPinch】
                    // 这样手抖的时候，isPinch 依然是 true (保持锁定)，但 zoomLevel 不会乱跳
                    // 调整了公式参数，让放大更自然
                    let scale = (inputState.smoothPinch - 0.02) * 80.0;

                    // 限制缩放范围
                    inputState.zoomLevel = Math.max(1.5, Math.min(8.0, scale));

                } else {
                    // 松开手，如果刚才锁定了照片，现在释放
                    if (activePhotoIdx !== -1) {
                        activePhotoIdx = -1;
                        updateStatusText("GALAXY MODE");
                    }
                }
            }
        });
        // 4. 启动摄像头 (增加 Try-Catch 包裹)
        const cam = new Camera(video, {
            onFrame: async () => { await hands.send({ image: video }); },
            width: 640, height: 480
        });

        cam.start()
            .then(() => {
                isCameraMode = true;
                updateStatusText("GALAXY MODE");
                document.getElementById('hint-cam').classList.add('active');
                document.getElementById('hint-mouse').classList.remove('active');
                const loader = document.getElementById('loader');
                if (loader) { loader.style.opacity = 0; setTimeout(() => loader.remove(), 500); }
            })
            .catch(err => {
                // 捕获所有启动错误（包括 Device Not Found）
                console.warn("Camera start failed:", err);
                enableMouseMode("MOUSE MODE (START FAIL)");
            });

    } catch (e) {
        console.error("MediaPipe Init Error:", e);
        enableMouseMode("MOUSE MODE (LIB FAIL)");
    }
}

function enableMouseMode(msg) {
    isCameraMode = false;
    updateStatusText(msg);
    document.getElementById('hint-cam').classList.remove('active');
    document.getElementById('hint-mouse').classList.add('active');
    const loader = document.getElementById('loader');
    if (loader) { loader.style.opacity = 0; setTimeout(() => loader.remove(), 500); }
}

fetchBucketPhotos();