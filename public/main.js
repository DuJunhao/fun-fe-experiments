import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// ================= 配置 =================
const CONFIG = {
    particleCount: 800,
    bucketXmlUrl: "https://storage.googleapis.com/beautiful-days/?prefix=christa/",
    publicBaseUrl: "https://static.refinefuture.com/",
    treeHeight: 90,
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
// ... (其他变量保持不变)

const inputState = {
    x: 0.5, y: 0.5,
    isFist: false,
    mouseLockedPhoto: false,
    isPinch: false,
    zoomLevel: 3.5,
    lastPinchTime: 0  // 【必须添加】: 否则捏合时间计算会出错
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

    const targetPhoto = getIntersectedPhoto(event.clientX, event.clientY);

    if (targetPhoto) {
        inputState.mouseLockedPhoto = true;
        activePhotoIdx = targetPhoto.userData.idx;
        inputState.isFist = false;

        // 【修改这里】之前是 4.0 太大了，改回 2.2 左右比较合适
        inputState.zoomLevel = 2.2;

        updateStatusText("MEMORY LOCKED", "#00ffff");
    } else {
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

// ================= 3. Three.js 场景构建 =================
function initThree() {
    // 【1. 清空旧画布】这行非常重要！
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
    renderer.toneMapping = THREE.NoToneMapping;
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
    bloomPass.threshold = 0.9;
    bloomPass.strength = 1.3;
    bloomPass.radius = 0.5;
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    createChristmasObjects();
    createMerryChristmas();

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mousedown', onGlobalMouseDown);
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('wheel', onGlobalWheel);
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('contextmenu', e => e.preventDefault());

    animate();
}

function createChristmasObjects() {
    // 纹理
    const leafTex = createCrossTexture('#228B22', '#003300');
    const giftTex = createCrossTexture('#DC143C', '#FFD700');

    // 材质
    const matLeaf = new THREE.MeshLambertMaterial({ map: leafTex });
    const matGift = new THREE.MeshPhysicalMaterial({ map: giftTex, roughness: 0.3, metalness: 0.1, emissive: 0x330000, emissiveIntensity: 0.5 });
    const matGold = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.gold, metalness: 0.9, roughness: 0.1, emissive: CONFIG.colors.emissiveGold, emissiveIntensity: 2.0 });
    const matRedShiny = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.7, roughness: 0.15, emissive: 0x550000, emissiveIntensity: 1.5 });
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const matCandy = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.white, metalness: 0.3, roughness: 0.4, emissive: 0xFFFFFF, emissiveIntensity: 1.2 });

    const matLightString = new THREE.MeshBasicMaterial({ color: 0xFFD700 });
    // 树顶大星星材质
    const matTopStar = new THREE.MeshPhysicalMaterial({ color: 0xFFD700, metalness: 1.0, roughness: 0.0, emissive: 0xFFEE88, emissiveIntensity: 5.0, clearcoat: 1.0 });

    // 几何体
    const leafGeo = new THREE.BoxGeometry(2.0, 2.0, 2.0);
    const sphereGeo = new THREE.SphereGeometry(1.3, 16, 16);
    const giftGeo = new THREE.BoxGeometry(2.2, 2.2, 2.2);

    const hatConeGeo = new THREE.ConeGeometry(1.2, 3, 16);
    const hatBrimGeo = new THREE.TorusGeometry(1.2, 0.3, 12, 24);
    const stockLegGeo = new THREE.CylinderGeometry(0.8, 0.8, 2.5, 12);
    const stockFootGeo = new THREE.CylinderGeometry(0.8, 0.9, 1.5, 12);

    const baseCount = CONFIG.particleCount - 150;

    const candyGeo = new THREE.CylinderGeometry(0.3, 0.3, 3.5, 12); 
    const starGeo = new THREE.OctahedronGeometry(1.8); 

    // ==========================================
    // 修改开始：使用挤压几何体创建 3D 五角星
    // ==========================================
    // 1. 定义 2D 形状 (外径 5，内径 2.5)
    const starShape = createStarShape(5, 2.5); 

    // 2. 定义挤压设置 (厚度和倒角让它更好看)
    const extrudeSettings = {
        steps: 1,
        depth: 1.5,           // 星星的厚度
        bevelEnabled: true,   // 启用倒角，让边缘圆润反光
        bevelThickness: 0.4,
        bevelSize: 0.4,
        bevelSegments: 3
    };

    // 3. 生成 3D 几何体
    const topStarGeo = new THREE.ExtrudeGeometry(starShape, extrudeSettings);
    
    // 4. 关键：将几何体中心移动到原点
    // 如果不执行这一步，星星旋转时会绕着其中一个角转，而不是绕中心转
    topStarGeo.center();
    // ==========================================
    // 修改结束
    // ==========================================

    const lightBulbGeo = new THREE.SphereGeometry(0.6, 8, 8);

    // 1. 普通装饰
    for (let i = 0; i < baseCount; i++) {
        let mesh;
        const type = Math.random();

        if (type < 0.60) {
            mesh = new THREE.Mesh(leafGeo, matLeaf);
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            mesh.scale.setScalar(0.8 + Math.random() * 0.5);
            initParticle(mesh, 'LEAF', i);
        } else {
            if (type < 0.70) {
                mesh = new THREE.Mesh(sphereGeo, Math.random() > 0.5 ? matGold : matRedShiny);
            } else if (type < 0.80) {
                mesh = new THREE.Mesh(giftGeo, matGift);
                mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            } else if (type < 0.88) {
                mesh = new THREE.Mesh(candyGeo, matCandy);
                mesh.rotation.set((Math.random() - 0.5), (Math.random() - 0.5), Math.random() * Math.PI);
            } else if (type < 0.93) {
                mesh = new THREE.Mesh(starGeo, matGold);
                mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
            } else if (type < 0.97) {
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
            initParticle(mesh, 'DECOR', i);
        }
        scene.add(mesh);
        particles.push(mesh);
    }

   // ==========================================
    // 2. 灯带 (Light Ribbon) - 材质增强版
    // ==========================================
    const ribbonPoints = [];
    const ribbonSegments = 300; 
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
    const tubeGeo = new THREE.TubeGeometry(spiralPath, 600, 1.2, 8, false); // 半径改回1.2让它显眼点

    // 【修改点】：颜色改为超亮淡黄，确保 RGB 通道值足够高以触发 Bloom
    const matGlowingRibbon = new THREE.MeshBasicMaterial({ 
        color: 0xFFFF88, // 越接近白色(FFFFCC)，发光越强；FFFF88 是强烈的亮黄光
        side: THREE.DoubleSide
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

    // 3. 树顶星星
    const topStarMesh = new THREE.Mesh(topStarGeo, matTopStar);
    initParticle(topStarMesh, 'TOP_STAR', 20000);
    // 强制位于最顶端
    topStarMesh.userData.treePos.set(0, CONFIG.treeHeight / 2 + 2, 0);
    topStarMesh.userData.rotSpeed = { x: 0, y: 0.02, z: 0 };
    scene.add(topStarMesh);
    particles.push(topStarMesh);

    // 4. 照片卡片
    const photoGeo = new THREE.PlaneGeometry(9, 12);
    const borderGeo = new THREE.BoxGeometry(9.6, 12.6, 0.2);
    const borderMat = new THREE.MeshStandardMaterial({
        color: 0xdaa520, metalness: 0.6, roughness: 0.4
    });

    imageList.forEach((filename, i) => {
        const mat = new THREE.MeshBasicMaterial({
            map: loadingTex,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        const url = CONFIG.publicBaseUrl + filename;
        textureLoader.load(url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            mat.map = tex; mat.needsUpdate = true;
        }, undefined, () => {
            mat.map = createTextTexture("LOAD FAILED");
        });

        const photoMesh = new THREE.Mesh(photoGeo, mat);
        photoMesh.position.z = 0.15;
        const border = new THREE.Mesh(borderGeo, borderMat);
        border.position.z = -0.15;

        const group = new THREE.Group();
        group.userData = { type: 'PHOTO', idx: i, hoverScale: 1.0 };
        group.add(border);
        group.add(photoMesh);

        initParticle(group, 'PHOTO', i);
        scene.add(group);
        particles.push(group);
        photos.push(group);
    });
}

function initParticle(mesh, type, idx) {
    const h = Math.random();
    let radiusMod = 1.0;
    if (type === 'LEAF') radiusMod = 0.85;

    const angle = h * Math.PI * 25 + idx * 0.1;
    const r = ((1.05 - h) * 40) * radiusMod;
    const treePos = new THREE.Vector3(Math.cos(angle) * r, (h - 0.5) * CONFIG.treeHeight, Math.sin(angle) * r);

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

// ================= 5. MediaPipe =================
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

                // 1. 移动控制 (保持不变)
                if (activePhotoIdx === -1) {
                    inputState.x = 1.0 - lm[9].x;
                    inputState.y = lm[9].y;
                }

                // ================== 修改开始 ==================

                // 2. 计算握拳程度 (Fist)
                // 计算 食指(8)、中指(12)、无名指(16)、小指(20) 到手腕(0) 的平均距离
                const fingerTips = [8, 12, 16, 20];
                let totalDist = 0;
                fingerTips.forEach(i => {
                    totalDist += Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y);
                });
                const avgFingerDist = totalDist / 4;
                
                // 判定是否握拳 (阈值保持 0.22)
                const isFistDetected = avgFingerDist < 0.22;

                // 3. 计算捏合程度 (Pinch)
                // 计算 拇指(4) 到 食指(8) 的距离
                const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
                
                // 判定是否捏合
                // 核心修复逻辑：只有在 【满足捏合距离】 且 【没有检测到握拳】 时才算捏合
                // 此外，为了防止误判，可以加一个辅助条件：中指(12)必须离手腕较远(伸直状态)
                const middleFingerDist = Math.hypot(lm[12].x - lm[0].x, lm[12].y - lm[0].y);
                const isMiddleFingerExtended = middleFingerDist > 0.25; // 中指伸直阈值

                // 最终捏合判定：距离近 + 不是握拳 + (可选:中指伸直)
                const isPinchDetected = (pinchDist < 0.08) && !isFistDetected && isMiddleFingerExtended;

                // 4. 更新状态
                inputState.isFist = isFistDetected;
                inputState.isPinch = isPinchDetected;

                // ================== 修改结束 ==================

                if (inputState.isPinch) {
                    const now = Date.now();
                    if (activePhotoIdx === -1 && now - inputState.lastPinchTime > 500) {
                        activePhotoIdx = Math.floor(Math.random() * photos.length);
                        inputState.lastPinchTime = now;
                        inputState.zoomLevel = 2.2;
                        updateStatusText("MEMORY UNLOCKED", "#00ffff");
                    }
                    let scale = (pinchDist - 0.02) * 60.0;
                    inputState.zoomLevel = Math.max(1.5, Math.min(8.0, scale));
                } else {
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