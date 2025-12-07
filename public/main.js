import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ================= 配置 (关键修改) =================
const CONFIG = {
    particleCount: 500, // 粒子数量
    // XML API 地址，带上 prefix 来扫描子文件夹
    bucketXmlUrl: "https://storage.googleapis.com/beautiful-days/?prefix=christa/", 
    // 图片访问的 CDN 基地址
    publicBaseUrl: "https://static.refinefuture.com/", 
    treeHeight: 90,
    explodeRadius: 140,
    camZ: 120,
    // 高级感配色
    colors: { 
        gold: 0xFFD700,   // 香槟金
        red: 0xDC143C,    // 猩红
        green: 0x006400,  // 深墨绿
        emissiveGold: 0xAA8800 // 自发光金色
    }
};

// ================= 全局变量 =================
let scene, camera, renderer, composer;
let particles = []; 
let photos = [];
let targetState = 'EXPLODE'; 
let activePhotoIdx = -1;
let imageList = []; // 存储完整路径 (例如 "christa/1.jpg")

const raycaster = new THREE.Raycaster();
const mouseVector = new THREE.Vector2();
let hoveredPhoto = null;

const inputState = {
    x: 0.5, y: 0.5,
    isFist: false,
    isPinch: false,
    forcePhotoSelection: false,
    isActive: false     
};

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

// ================= 1. GCS XML 解析 (修复版) =================

async function fetchBucketPhotos() {
    const loaderText = document.getElementById('loader-text');
    try {
        loaderText.innerText = "SCANNING 'christa/' FOLDER...";
        
        const response = await fetch(CONFIG.bucketXmlUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const str = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(str, "text/xml");
        const contents = xmlDoc.getElementsByTagName("Contents");
        
        const images = [];
        for (let i = 0; i < contents.length; i++) {
            const key = contents[i].getElementsByTagName("Key")[0].textContent;
            // 过滤 jpg/png/jpeg，且排除文件夹本身
            if (key.match(/\.(jpg|jpeg|png)$/i) && !key.endsWith('/')) {
                images.push(key);
            }
        }

        if (images.length === 0) throw new Error("No images found in 'christa/' folder");
        
        console.log(`Found ${images.length} images in bucket:`, images);
        imageList = images;
        loaderText.innerText = `FOUND ${images.length} MEMORIES. STARTING...`;

    } catch (e) {
        console.warn("XML Fetch failed. Check CORS or bucket permissions.", e);
        loaderText.innerText = "GCS SCAN FAILED. USING FALLBACK...";
        loaderText.style.color = "#ff3333";
        // 回退方案：假设有 6 张图 (根据你的截图)
        for(let i=1; i<=6; i++) imageList.push(`christa/${i}.jpg`);
    }

    // 给予一点时间显示状态，然后启动
    setTimeout(() => {
        initThree();
        initMediaPipe();
    }, 1000);
}

// ================= 2. 交互逻辑 (修复右键) =================

function onGlobalMouseMove(event) {
    mouseVector.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouseVector.y = -(event.clientY / window.innerHeight) * 2 + 1;

    if (document.body.dataset.mode === 'mouse') {
        inputState.x = event.clientX / window.innerWidth;
        inputState.y = event.clientY / window.innerHeight;
    }
    
    if (!inputState.forcePhotoSelection) {
        checkIntersection();
    }
}

function checkIntersection() {
    raycaster.setFromCamera(mouseVector, camera);
    const intersects = raycaster.intersectObjects(photos);

    if (intersects.length > 0) {
        if (hoveredPhoto !== intersects[0].object) {
            // 清除上一个高亮
            if(hoveredPhoto) hoveredPhoto.children[0].material.emissiveIntensity = 1; 
            
            hoveredPhoto = intersects[0].object;
            document.body.style.cursor = 'pointer';
            // 高亮边框
            hoveredPhoto.children[0].material.emissiveIntensity = 3;
        }
    } else {
        if (hoveredPhoto) {
             // 恢复上一个高亮
            hoveredPhoto.children[0].material.emissiveIntensity = 1;
            document.body.style.cursor = 'default';
            hoveredPhoto = null;
        }
    }
}

function onGlobalMouseDown(event) {
    // === 左键 (0) : 选中 / 聚合 ===
    if (event.button === 0) {
        if (hoveredPhoto) {
            selectPhoto(hoveredPhoto);
        } else if (document.body.dataset.mode === 'mouse') {
            inputState.isFist = true;
        }
    }
    
    // === 右键 (2) : 取消 / 缩小 (修复点) ===
    if (event.button === 2) {
        // 阻止默认的右键菜单在点击时触发（双重保险）
        event.preventDefault();
        deselectPhoto();
    }
}

function onGlobalMouseUp(event) {
    if (event.button === 0) {
        inputState.isFist = false;
    }
}

function selectPhoto(mesh) {
    inputState.forcePhotoSelection = true;
    activePhotoIdx = mesh.userData.idx;
    inputState.isFist = false;
    
    const statusEl = document.getElementById('status-text');
    // 显示简短的文件名
    const shortName = imageList[activePhotoIdx].split('/').pop();
    statusEl.innerText = `VIEWING: ${shortName}`;
    statusEl.style.color = "#FFD700";
    statusEl.style.textShadow = "0 0 15px #FFD700";
}

function deselectPhoto() {
    if (inputState.forcePhotoSelection) {
        inputState.forcePhotoSelection = false;
        activePhotoIdx = -1;
        
        const statusEl = document.getElementById('status-text');
        statusEl.innerText = "EXPLORING MODE";
        statusEl.style.color = "#fff";
        statusEl.style.textShadow = "0 0 10px rgba(212, 175, 55, 0.6)";
    }
}

// ================= 3. Three.js 核心 (视觉升级) =================

function initThree() {
    const container = document.getElementById('canvas-container');
    
    scene = new THREE.Scene();
    // 使用纯黑背景，增强对比度
    scene.background = new THREE.Color(0x000000);
    // 黑色迷雾，增加深度感
    scene.fog = new THREE.FogExp2(0x000000, 0.0015);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = CONFIG.camZ;

    renderer = new THREE.WebGLRenderer({ antialias: true, stencil: false, depth: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // 使用电影级色调映射
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    // --- 灯光系统 (升级) ---
    const ambient = new THREE.AmbientLight(0x111111, 1); // 微弱环境光
    scene.add(ambient);

    // 主光源：强烈的暖金色侧光
    const mainLight = new THREE.DirectionalLight(0xFFF5E1, 3);
    mainLight.position.set(50, 50, 50);
    scene.add(mainLight);

    // 点光源：位于中心，照亮内部粒子，制造核心发光感
    const centerLight = new THREE.PointLight(0xFFD700, 5, 150);
    centerLight.position.set(0, 0, 0);
    scene.add(centerLight);
    
    // --- 后处理 (升级辉光) ---
    const renderPass = new RenderPass(scene, camera);
    // 参数调校：更低的阈值，更高的强度，更小的半径 -> 锐利闪烁的辉光
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.1;  // 让更多暗部也发光
    bloomPass.strength = 1.8;   // 强烈的光晕
    bloomPass.radius = 0.3;     // 锐利的光芒
    
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    createObjects();
    
    // 事件监听
    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mousedown', onGlobalMouseDown);
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('contextmenu', e => e.preventDefault()); // 禁用右键菜单
    window.addEventListener('resize', onWindowResize);
}

function createObjects() {
    // === 高级材质 (MeshPhysicalMaterial) ===
    // 金色：高金属感，低粗糙度，带自发光
    const matGold = new THREE.MeshPhysicalMaterial({ 
        color: CONFIG.colors.gold, 
        metalness: 1.0, 
        roughness: 0.1,
        emissive: CONFIG.colors.emissiveGold,
        emissiveIntensity: 0.5, // 自身微光
        reflectivity: 1.0,
        clearcoat: 1.0 // 清漆层，增加光泽
    });
    // 红色：类似红宝石质感
    const matRed = new THREE.MeshPhysicalMaterial({ 
        color: CONFIG.colors.red, 
        metalness: 0.6, 
        roughness: 0.2,
        emissive: CONFIG.colors.red,
        emissiveIntensity: 0.3
    });
    // 绿色：深邃的祖母绿
    const matGreen = new THREE.MeshPhysicalMaterial({ 
        color: CONFIG.colors.green, 
        metalness: 0.4, 
        roughness: 0.3,
        emissive: CONFIG.colors.green,
        emissiveIntensity: 0.2
    });
    
    const geoms = [
        new THREE.SphereGeometry(1.2, 24, 24), // 更圆滑的球
        new THREE.BoxGeometry(1.8, 1.8, 1.8), // 更大的方块
        new THREE.IcosahedronGeometry(1.5),   // 钻石形状
        new THREE.TorusGeometry(1.2, 0.4, 16, 32) // 圆环
    ];

    // 装饰粒子
    for(let i=0; i<CONFIG.particleCount; i++) {
        const rnd = Math.random();
        // 金色比例更高
        const mat = rnd > 0.5 ? matGold : (rnd > 0.25 ? matRed : matGreen);
        const geom = geoms[Math.floor(Math.random()*geoms.length)];
        const mesh = new THREE.Mesh(geom, mat);
        initParticle(mesh, 'DECOR', i);
        scene.add(mesh);
        particles.push(mesh);
    }

    // 照片卡片
    const photoGeo = new THREE.PlaneGeometry(9, 12); // 稍微大一点
    // 边框材质：高亮金色
    const borderMat = new THREE.MeshPhysicalMaterial({
        color: CONFIG.colors.gold,
        metalness: 1.0,
        roughness: 0.1,
        emissive: CONFIG.colors.gold,
        emissiveIntensity: 1.0 // 边框常亮
    });
    const borderGeo = new THREE.BoxGeometry(9.6, 12.6, 0.5); // 有厚度的边框

    const loadingTex = createPlaceholderTexture(-1, "LOADING...");

    imageList.forEach((filename, i) => {
        const mat = new THREE.MeshBasicMaterial({ map: loadingTex, side: THREE.DoubleSide });
        
        // 拼接完整 URL: https://static.refinefuture.com/christa/xxx.jpg
        const url = `${CONFIG.publicBaseUrl}${filename}`;
        
        textureLoader.load(url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.minFilter = THREE.LinearMipMapLinearFilter; // 更好的缩放质量
            mat.map = tex;
            mat.needsUpdate = true;
        }, undefined, (err) => {
            console.warn(`Failed to load ${filename}`);
            mat.map = createPlaceholderTexture(i, "LOAD FAILED");
        });

        const mesh = new THREE.Mesh(photoGeo, mat);
        // 边框
        const border = new THREE.Mesh(borderGeo, borderMat.clone());
        border.position.z = -0.3;
        mesh.add(border);
        
        initParticle(mesh, 'PHOTO', i);
        scene.add(mesh);
        particles.push(mesh);
        photos.push(mesh);
    });
}

function createPlaceholderTexture(idx, text) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 680;
    const ctx = canvas.getContext('2d');
    // 金色渐变背景
    const grd = ctx.createLinearGradient(0, 0, 512, 680);
    grd.addColorStop(0, "#332a1a");
    grd.addColorStop(1, "#1a1a1a");
    ctx.fillStyle = grd;
    ctx.fillRect(0,0,512,680);
    
    // 金色边框
    ctx.strokeStyle = "#FFD700";
    ctx.lineWidth = 10;
    ctx.strokeRect(20, 20, 472, 640);

    ctx.font = 'bold 40px Arial'; ctx.fillStyle = '#FFD700'; ctx.textAlign = 'center';
    ctx.fillText(text || `MEMORY ${idx+1}`, 256, 340);
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function initParticle(mesh, type, idx) {
    const h = Math.random();
    // 树形：更紧凑的螺旋
    const angle = h * Math.PI * 22 + Math.random();
    const r = (1.05 - h) * 30 + Math.random()*3;
    const treePos = new THREE.Vector3(Math.cos(angle)*r, (h-0.5)*CONFIG.treeHeight, Math.sin(angle)*r);

    // 爆炸形：更广阔的分布
    const phi = Math.acos(2*Math.random()-1);
    const theta = Math.random()*Math.PI*2;
    const rad = 50 + Math.random()*CONFIG.explodeRadius;
    const explodePos = new THREE.Vector3(
        rad*Math.sin(phi)*Math.cos(theta),
        rad*Math.sin(phi)*Math.sin(theta),
        rad*Math.cos(phi)
    );

    mesh.userData = {
        type, idx, treePos, explodePos,
        // 增加自转速度，看起来更闪烁
        rotSpeed: {x: (Math.random()-0.5)*0.05, y: (Math.random()-0.5)*0.05, z: (Math.random()-0.5)*0.05},
        baseScale: mesh.scale.clone(),
        randomPhase: Math.random() * Math.PI * 2 // 用于呼吸动画的随机相位
    };
    mesh.position.copy(explodePos);
}

// ================= 4. 状态机与动画 (视觉优化) =================

function updateLogic() {
    const statusEl = document.getElementById('status-text');
    if (inputState.forcePhotoSelection) {
        // 状态已经在 selectPhoto 中设置
    } else if (inputState.isPinch) {
        if (targetState !== 'PHOTO') {
            targetState = 'PHOTO';
            activePhotoIdx = (activePhotoIdx + 1) % photos.length;
            statusEl.innerText = "ZOOMING MEMORY";
            statusEl.style.color = "#00ffff";
        }
    } else if (inputState.isFist) {
        targetState = 'TREE';
        statusEl.innerText = "FORMING TREE";
        statusEl.style.color = "#FFD700";
    } else {
        targetState = 'EXPLODE';
        statusEl.innerText = "WANDERING STARS";
        statusEl.style.color = "#ff4466";
    }

    const time = Date.now() * 0.001;
    
    // 视角控制：增加阻尼感
    const targetRotY = (inputState.x - 0.5) * 1.2;
    const targetRotX = (inputState.y - 0.5) * 0.8;
    scene.rotation.y += (targetRotY - scene.rotation.y) * 0.04;
    scene.rotation.x += (targetRotX - scene.rotation.x) * 0.04;

    particles.forEach(mesh => {
        const data = mesh.userData;
        let tPos = new THREE.Vector3();
        let tScale = data.baseScale.clone();
        let tRot = mesh.rotation.clone();

        // 持续自转
        tRot.x += data.rotSpeed.x;
        tRot.y += data.rotSpeed.y;
        tRot.z += data.rotSpeed.z;

        if (targetState === 'TREE') {
            tPos.copy(data.treePos);
            // 树形态下的呼吸浮动
            tPos.y += Math.sin(time*1.5 + data.randomPhase)*0.8;
            if(data.type === 'PHOTO') tScale.multiplyScalar(0.4); // 照片在树里变小
        } 
        else if (targetState === 'EXPLODE') {
            tPos.copy(data.explodePos);
            // 散开形态下的缓慢漂流
            tPos.x += Math.sin(time*0.5 + data.randomPhase)*3;
            tPos.y += Math.cos(time*0.6 + data.randomPhase)*3;
            tPos.z += Math.sin(time*0.7 + data.randomPhase)*3;
        }
        else if (targetState === 'PHOTO') {
            if (data.type === 'PHOTO' && data.idx === activePhotoIdx) {
                // 选中照片：飞到面前
                tPos.set(0, 0, CONFIG.camZ - 30);
                tScale.multiplyScalar(4.0); // 放大更多
                mesh.lookAt(camera.position);
                mesh.renderOrder = 999;
                // 停止自转，保持正对
                tRot.copy(mesh.rotation);
                
                mesh.position.lerp(tPos, 0.08);
                mesh.scale.lerp(tScale, 0.08);
                // 不应用自转
                return;
            } else {
                // 背景退后并散开
                tPos.copy(data.explodePos).multiplyScalar(2.0);
            }
        }

        // 平滑插值
        mesh.position.lerp(tPos, 0.05);
        mesh.scale.lerp(tScale, 0.08);
        mesh.rotation.copy(tRot);
        mesh.renderOrder = 0;
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    updateLogic();
    composer.render();
}

// ================= 5. 初始化流程 =================

function enableMouseMode() {
    document.body.dataset.mode = 'mouse';
    document.getElementById('hint-cam').classList.remove('active');
    document.getElementById('hint-mouse').classList.add('active');
    document.getElementById('status-text').innerText = "MOUSE MODE ACTIVE";
    
    const loader = document.getElementById('loader');
    loader.style.opacity = 0;
    setTimeout(() => loader.remove(), 800);
}

function initMediaPipe() {
    const video = document.getElementById('input_video');
    const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
    
    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    hands.onResults(results => {
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const lm = results.multiHandLandmarks[0];
            inputState.isActive = true;
            inputState.x = 1.0 - lm[9].x; 
            inputState.y = lm[9].y;

            const tips = [8, 12, 16, 20];
            let avgDist = 0;
            tips.forEach(i => avgDist += Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y));
            avgDist /= 4;
            inputState.isFist = avgDist < 0.25;

            const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
            inputState.isPinch = pinchDist < 0.05;
            
            // 手势操作会打断照片锁定
            if (inputState.isFist || inputState.isPinch) {
                deselectPhoto();
            }
        }
    });

    const cam = new Camera(video, {
        onFrame: async () => { await hands.send({image: video}); },
        width: 640, height: 480
    });
    
    cam.start()
        .then(() => {
            document.body.dataset.mode = 'camera';
            document.getElementById('hint-cam').classList.add('active');
            const loader = document.getElementById('loader');
            loader.style.opacity = 0;
            setTimeout(() => loader.remove(), 800);
        })
        .catch((err) => {
            console.warn("Camera failed/denied:", err);
            enableMouseMode();
        });
}

// 启动：先获取 GCS 列表，成功后再初始化 3D 和 AI
fetchBucketPhotos();
animate(); // 提前启动渲染循环防止黑屏