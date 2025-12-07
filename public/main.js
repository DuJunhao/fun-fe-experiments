import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ================= 配置 =================
const CONFIG = {
    particleCount: 500,
    bucketXmlUrl: "https://storage.googleapis.com/beautiful-days/?prefix=christa/", 
    publicBaseUrl: "https://static.refinefuture.com/", 
    treeHeight: 90,
    explodeRadius: 140,
    camZ: 120,
    colors: { 
        gold: 0xFFD700,
        red: 0xDC143C,
        green: 0x0B3d0B,
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

const raycaster = new THREE.Raycaster();
const mouseVector = new THREE.Vector2();
let hoveredPhoto = null;

const inputState = {
    x: 0.5, y: 0.5,
    isFist: false,
    isPinch: false,
    // 是否通过鼠标强制选中了照片 (鼠标模式专用)
    mouseLockedPhoto: false, 
    isActive: false     
};

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

// ================= 1. GCS XML 解析 =================
async function fetchBucketPhotos() {
    const loaderText = document.getElementById('loader-text');
    try {
        loaderText.innerText = "SCANNING MEMORIES...";
        const response = await fetch(CONFIG.bucketXmlUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const str = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(str, "text/xml");
        const contents = xmlDoc.getElementsByTagName("Contents");
        const images = [];
        for (let i = 0; i < contents.length; i++) {
            const key = contents[i].getElementsByTagName("Key")[0].textContent;
            if (key.match(/\.(jpg|jpeg|png)$/i) && !key.endsWith('/')) {
                images.push(key);
            }
        }
        if (images.length === 0) throw new Error("No images found");
        imageList = images;
        loaderText.innerText = `LOADED ${images.length} PHOTOS`;
    } catch (e) {
        console.warn("XML Scan failed, using fallback.", e);
        loaderText.innerText = "USING FALLBACK DATA...";
        for(let i=1; i<=6; i++) imageList.push(`christa/${i}.jpg`);
    }
    setTimeout(() => {
        initThree();
        initMediaPipe();
    }, 800);
}

// ================= 2. 交互逻辑 (鼠标) =================
function onGlobalMouseMove(event) {
    mouseVector.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouseVector.y = -(event.clientY / window.innerHeight) * 2 + 1;

    if (document.body.dataset.mode === 'mouse') {
        inputState.x = event.clientX / window.innerWidth;
        inputState.y = event.clientY / window.innerHeight;
    }
    
    // 只有在没锁定照片时才做射线检测
    if (!inputState.mouseLockedPhoto) {
        checkIntersection();
    }
}

function checkIntersection() {
    raycaster.setFromCamera(mouseVector, camera);
    const intersects = raycaster.intersectObjects(photos);

    if (intersects.length > 0) {
        if (hoveredPhoto !== intersects[0].object) {
            if(hoveredPhoto) hoveredPhoto.children[0].material.emissiveIntensity = 1;
            hoveredPhoto = intersects[0].object;
            document.body.style.cursor = 'pointer';
            hoveredPhoto.children[0].material.emissiveIntensity = 4; 
        }
    } else {
        if (hoveredPhoto) {
            hoveredPhoto.children[0].material.emissiveIntensity = 1;
            document.body.style.cursor = 'default';
            hoveredPhoto = null;
        }
    }
}

function onGlobalMouseDown(event) {
    // 仅在鼠标模式下或混合模式下处理点击
    if (event.button === 0) {
        if (hoveredPhoto) {
            // 点击照片 -> 鼠标锁定模式
            inputState.mouseLockedPhoto = true;
            activePhotoIdx = hoveredPhoto.userData.idx;
            inputState.isFist = false;
            updateStatusText(`MEMORY SELECTED`);
        } else if (document.body.dataset.mode === 'mouse') {
            inputState.isFist = true; // 鼠标长按空白聚合
        }
    }
    if (event.button === 2) {
        // 右键 -> 取消锁定
        inputState.mouseLockedPhoto = false;
        inputState.isFist = false;
        activePhotoIdx = -1;
        updateStatusText("GALAXY MODE");
    }
}

function onGlobalMouseUp(event) {
    if (event.button === 0) inputState.isFist = false;
}

function updateStatusText(text, color = "#fff") {
    const el = document.getElementById('status-text');
    el.innerText = text;
    el.style.color = color;
    el.style.textShadow = color === "#fff" ? "none" : `0 0 15px ${color}`;
}

// ================= 3. Three.js 核心 =================
function initThree() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.0015);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = CONFIG.camZ;

    renderer = new THREE.WebGLRenderer({ antialias: true, stencil: false, depth: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0x111111, 1);
    scene.add(ambient);
    const mainLight = new THREE.DirectionalLight(0xFFF5E1, 3);
    mainLight.position.set(50, 50, 50);
    scene.add(mainLight);
    const centerLight = new THREE.PointLight(0xFFD700, 5, 150);
    centerLight.position.set(0, 0, 0);
    scene.add(centerLight);
    
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.1; bloomPass.strength = 1.5; bloomPass.radius = 0.5;
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    createObjects();
    
    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mousedown', onGlobalMouseDown);
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('resize', onWindowResize);
}

function createObjects() {
    const matGold = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.gold, metalness: 1.0, roughness: 0.15, emissive: CONFIG.colors.emissiveGold, emissiveIntensity: 0.4 });
    const matRed = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.6, roughness: 0.2, emissive: CONFIG.colors.red, emissiveIntensity: 0.2 });
    const matGreen = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.green, metalness: 0.1, roughness: 0.8, emissive: 0x002200, emissiveIntensity: 0.1 });
    
    const geoms = [
        new THREE.SphereGeometry(1.2, 24, 24),
        new THREE.BoxGeometry(1.8, 1.8, 1.8),
        new THREE.IcosahedronGeometry(1.5),
        new THREE.TorusGeometry(1.0, 0.3, 16, 32)
    ];

    for(let i=0; i<CONFIG.particleCount; i++) {
        const rnd = Math.random();
        const mat = rnd > 0.5 ? matGold : (rnd > 0.25 ? matRed : matGreen);
        const geom = geoms[Math.floor(Math.random()*geoms.length)];
        const mesh = new THREE.Mesh(geom, mat);
        initParticle(mesh, 'DECOR', i);
        scene.add(mesh);
        particles.push(mesh);
    }

    const photoGeo = new THREE.PlaneGeometry(9, 12);
    const borderGeo = new THREE.BoxGeometry(9.6, 12.6, 0.5);
    const borderMat = matGold.clone(); borderMat.emissiveIntensity = 1.0;
    const loadingTex = createPlaceholderTexture(-1, "LOADING...");

    imageList.forEach((filename, i) => {
        const mat = new THREE.MeshBasicMaterial({ map: loadingTex, side: THREE.DoubleSide });
        const url = `${CONFIG.publicBaseUrl}${filename}`;
        textureLoader.load(url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.minFilter = THREE.LinearFilter;
            mat.map = tex; mat.needsUpdate = true;
        }, undefined, () => {
            mat.map = createPlaceholderTexture(i, "FAILED");
        });

        const mesh = new THREE.Mesh(photoGeo, mat);
        const border = new THREE.Mesh(borderGeo, borderMat);
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
    const grd = ctx.createLinearGradient(0, 0, 512, 680);
    grd.addColorStop(0, "#332a1a"); grd.addColorStop(1, "#1a1a1a");
    ctx.fillStyle = grd; ctx.fillRect(0,0,512,680);
    ctx.strokeStyle = "#FFD700"; ctx.lineWidth = 10; ctx.strokeRect(20, 20, 472, 640);
    ctx.font = 'bold 40px Arial'; ctx.fillStyle = '#FFD700'; ctx.textAlign = 'center';
    ctx.fillText(text || `MEMORY ${idx+1}`, 256, 340);
    return new THREE.CanvasTexture(canvas);
}

function initParticle(mesh, type, idx) {
    const h = Math.random();
    const angle = h * Math.PI * 22 + Math.random();
    const r = (1.05 - h) * 30 + Math.random()*3;
    const treePos = new THREE.Vector3(Math.cos(angle)*r, (h-0.5)*CONFIG.treeHeight, Math.sin(angle)*r);
    const phi = Math.acos(2*Math.random()-1);
    const theta = Math.random()*Math.PI*2;
    const rad = 50 + Math.random()*CONFIG.explodeRadius;
    const explodePos = new THREE.Vector3(rad*Math.sin(phi)*Math.cos(theta), rad*Math.sin(phi)*Math.sin(theta), rad*Math.cos(phi));

    mesh.userData = {
        type, idx, treePos, explodePos,
        rotSpeed: {x: (Math.random()-0.5)*0.05, y: (Math.random()-0.5)*0.05, z: (Math.random()-0.5)*0.05},
        baseScale: mesh.scale.clone(),
        randomPhase: Math.random() * Math.PI * 2
    };
    mesh.position.copy(explodePos);
}

// ================= 4. 状态机 (核心逻辑更新) =================
function updateLogic() {
    // 优先级 1: 鼠标强制锁定
    if (inputState.mouseLockedPhoto) {
        targetState = 'PHOTO';
    } 
    // 优先级 2: 手势捏合 (MediaPipe)
    else if (inputState.isPinch) {
        // 如果之前不是捏合状态，说明是新的一次捏合，切换照片
        if (targetState !== 'PHOTO') {
            activePhotoIdx = (activePhotoIdx + 1) % photos.length; 
        }
        targetState = 'PHOTO';
        updateStatusText("PINCH DETECTED: ZOOM", "#00ffff");
    } 
    // 优先级 3: 握拳 / 长按
    else if (inputState.isFist) {
        targetState = 'TREE';
        updateStatusText("FORMING TREE", "#FFD700");
    } 
    // 优先级 4: 默认散开 (包括松开捏合)
    else {
        targetState = 'EXPLODE';
        updateStatusText("GALAXY MODE", "#ff4466");
    }

    const time = Date.now() * 0.001;
    const targetRotY = (inputState.x - 0.5) * 1.2;
    const targetRotX = (inputState.y - 0.5) * 0.8;
    scene.rotation.y += (targetRotY - scene.rotation.y) * 0.04;
    scene.rotation.x += (targetRotX - scene.rotation.x) * 0.04;

    particles.forEach(mesh => {
        const data = mesh.userData;
        let tPos = new THREE.Vector3();
        let tScale = data.baseScale.clone();
        let tRot = mesh.rotation.clone();
        tRot.x += data.rotSpeed.x; tRot.y += data.rotSpeed.y; tRot.z += data.rotSpeed.z;

        if (targetState === 'TREE') {
            tPos.copy(data.treePos);
            tPos.y += Math.sin(time*1.5 + data.randomPhase)*0.8;
            if(data.type === 'PHOTO') tScale.multiplyScalar(0.4); 
        } 
        else if (targetState === 'EXPLODE') {
            tPos.copy(data.explodePos);
            tPos.x += Math.sin(time*0.5 + data.randomPhase)*3;
            tPos.y += Math.cos(time*0.6 + data.randomPhase)*3;
            tPos.z += Math.sin(time*0.7 + data.randomPhase)*3;
        }
        else if (targetState === 'PHOTO') {
            if (data.type === 'PHOTO' && data.idx === activePhotoIdx) {
                tPos.set(0, 0, CONFIG.camZ - 30);
                tScale.multiplyScalar(4.0);
                mesh.lookAt(camera.position);
                mesh.renderOrder = 999;
                tRot.copy(mesh.rotation);
                mesh.position.lerp(tPos, 0.08);
                mesh.scale.lerp(tScale, 0.08);
                return;
            } else {
                tPos.copy(data.explodePos).multiplyScalar(2.0);
            }
        }
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

// ================= 5. 输入适配 =================
function enableMouseMode() {
    document.body.dataset.mode = 'mouse';
    // 切换 UI 显示
    document.getElementById('hint-cam').classList.remove('active');
    document.getElementById('hint-mouse').classList.add('active');
    updateStatusText("MOUSE MODE ACTIVE");
    
    const loader = document.getElementById('loader');
    loader.style.opacity = 0;
    setTimeout(() => loader.remove(), 800);
}

function initMediaPipe() {
    const video = document.getElementById('input_video');
    const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
    hands.setOptions({maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5});

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
            
            // 手势优先级高于鼠标锁定
            if (inputState.isFist || inputState.isPinch) {
                inputState.mouseLockedPhoto = false;
            }
        }
    });

    const cam = new Camera(video, {
        onFrame: async () => { await hands.send({image: video}); },
        width: 640, height: 480
    });
    
    cam.start().then(() => {
        document.body.dataset.mode = 'camera';
        // 切换 UI 显示
        document.getElementById('hint-cam').classList.add('active');
        document.getElementById('hint-mouse').classList.remove('active');
        const loader = document.getElementById('loader');
        loader.style.opacity = 0;
        setTimeout(() => loader.remove(), 800);
    }).catch((err) => {
        console.warn("Camera failed/denied:", err);
        enableMouseMode();
    });
}

fetchBucketPhotos();
animate();