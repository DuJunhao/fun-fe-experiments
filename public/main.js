import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// ================= 配置 =================
const CONFIG = {
    particleCount: 600, // 增加粒子数量
    // 你的 GCS 路径
    bucketXmlUrl: "https://storage.googleapis.com/beautiful-days/?prefix=christa/", 
    publicBaseUrl: "https://static.refinefuture.com/", 
    treeHeight: 90,
    explodeRadius: 140,
    camZ: 120,
    colors: { 
        gold: 0xFFD700,
        red: 0xDC143C,
        green: 0x0B3d0B,
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

const raycaster = new THREE.Raycaster();
const mouseVector = new THREE.Vector2();
let hoveredPhoto = null;

const inputState = {
    x: 0.5, y: 0.5,
    isFist: false,
    mouseLockedPhoto: false,
    isPinch: false
};

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

// 创建带文字的占位图
function createTextTexture(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 680;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0,0,512,680);
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 10; ctx.strokeRect(20,20,472,640);
    ctx.font = 'bold 40px Arial'; ctx.fillStyle = '#d4af37'; ctx.textAlign = 'center';
    ctx.fillText(text, 256, 340);
    return new THREE.CanvasTexture(canvas);
}
const loadingTex = createTextTexture("LOADING MEMORY...");

// ================= 1. 启动入口 =================
async function fetchBucketPhotos() {
    const loaderText = document.getElementById('loader-text');
    try {
        if(loaderText) loaderText.innerText = "SCANNING CHRISTMAS MEMORIES...";
        
        const response = await fetch(CONFIG.bucketXmlUrl);
        if (!response.ok) throw new Error("Network error");
        const str = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(str, "text/xml");
        const contents = xmlDoc.getElementsByTagName("Contents");
        
        imageList = [];
        for (let i = 0; i < contents.length; i++) {
            const key = contents[i].getElementsByTagName("Key")[0].textContent;
            // 过滤 jpg/png 且排除文件夹自身
            if (key.match(/\.(jpg|jpeg|png)$/i) && !key.endsWith('/')) {
                imageList.push(key);
            }
        }
        if (imageList.length === 0) throw new Error("No images found");
        
        if(loaderText) loaderText.innerText = `FOUND ${imageList.length} MOMENTS`;
        
    } catch (e) {
        console.warn("Using offline mode", e);
        if(loaderText) loaderText.innerText = "USING OFFLINE MODE";
        for(let i=1; i<=6; i++) imageList.push(`christa/${i}.jpg`);
    }

    initThree();
    initMediaPipe(); 
}

// ================= 2. 交互逻辑 =================

function getIntersectedPhoto(clientX, clientY) {
    const mv = new THREE.Vector2();
    mv.x = (clientX / window.innerWidth) * 2 - 1;
    mv.y = -(clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mv, camera);
    const intersects = raycaster.intersectObjects(photos, true); // true = 递归检测子物体

    if (intersects.length > 0) {
        let hitObj = intersects[0].object;
        // 向上冒泡查找，直到找到类型为 PHOTO 的父级
        while(hitObj) {
            if (hitObj.userData && hitObj.userData.type === 'PHOTO') return hitObj;
            hitObj = hitObj.parent;
        }
    }
    return null;
}

function onGlobalMouseMove(event) {
    mouseVector.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouseVector.y = -(event.clientY / window.innerHeight) * 2 + 1;

    if (!isCameraMode) {
        inputState.x = event.clientX / window.innerWidth;
        inputState.y = event.clientY / window.innerHeight;
    }
    
    if (!inputState.mouseLockedPhoto) {
        const hit = getIntersectedPhoto(event.clientX, event.clientY);
        if (hit) {
            document.body.style.cursor = 'pointer';
            // 高亮边框 (边框是子物体[0])
            if(hit.children[0]) hit.children[0].material.emissiveIntensity = 3.0;
        } else {
            document.body.style.cursor = 'default';
            // 恢复所有亮度
            photos.forEach(p => {
                if(p.children[0]) p.children[0].material.emissiveIntensity = 0.8;
            });
        }
    }
}

function onGlobalMouseDown(event) {
    if (event.button !== 0) return; // 左键

    const targetPhoto = getIntersectedPhoto(event.clientX, event.clientY);

    if (targetPhoto) {
        // [点击照片] -> 锁定
        inputState.mouseLockedPhoto = true;
        activePhotoIdx = targetPhoto.userData.idx;
        inputState.isFist = false;
        updateStatusText("MEMORY LOCKED", "#00ffff");
    } else {
        // [点击空白]
        if (inputState.mouseLockedPhoto) {
            inputState.mouseLockedPhoto = false; // 解锁
            activePhotoIdx = -1;
            updateStatusText("GALAXY MODE");
        } else {
            inputState.isFist = true; // 聚合
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

function updateStatusText(text, color = "#fff") {
    const el = document.getElementById('status-text');
    if(el && el.innerText !== text) {
        el.innerText = text;
        el.style.color = color;
        el.style.textShadow = color === "#fff" ? "none" : `0 0 15px ${color}`;
    }
}

// ================= 3. Three.js 场景构建 =================
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

    // 灯光
    const ambient = new THREE.AmbientLight(0x111111, 1);
    scene.add(ambient);
    const mainLight = new THREE.DirectionalLight(0xFFF5E1, 3);
    mainLight.position.set(50, 50, 50);
    scene.add(mainLight);
    const centerLight = new THREE.PointLight(0xFFD700, 5, 150);
    scene.add(centerLight);
    
    // 辉光
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.05; bloomPass.strength = 1.6; bloomPass.radius = 0.5;
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    createChristmasObjects();
    createMerryChristmas();

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mousedown', onGlobalMouseDown);
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('resize', onWindowResize);
    
    animate();
}

function createChristmasObjects() {
    // === 材质 ===
    const matGold = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.gold, metalness: 1.0, roughness: 0.15, emissive: CONFIG.colors.emissiveGold, emissiveIntensity: 0.3 });
    const matRed = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.6, roughness: 0.3, emissive: CONFIG.colors.red, emissiveIntensity: 0.2 });
    const matGreen = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.green, metalness: 0.1, roughness: 0.8, emissive: 0x002200, emissiveIntensity: 0.1 });
    const matCandy = new THREE.MeshPhysicalMaterial({ color: 0xFFFFFF, metalness: 0.2, roughness: 0.4, emissive: 0xAA0000, emissiveIntensity: 0.1 }); // 糖果白

    // === 几何体 ===
    const sphereGeo = new THREE.SphereGeometry(1.2, 24, 24); // 装饰球
    const boxGeo = new THREE.BoxGeometry(1.8, 1.8, 1.8); // 礼物盒
    const cylinderGeo = new THREE.CylinderGeometry(0.3, 0.3, 3, 8); // 糖果棒

    // 装饰粒子生成 (球、礼物、糖果)
    for(let i=0; i<CONFIG.particleCount; i++) {
        let mesh;
        const type = Math.random();

        if (type < 0.6) {
            // 60% 金/红球
            const mat = Math.random() > 0.5 ? matGold : matRed;
            mesh = new THREE.Mesh(sphereGeo, mat);
        } else if (type < 0.9) {
            // 30% 礼物盒 (红/绿)
            const mat = Math.random() > 0.5 ? matRed : matGreen;
            mesh = new THREE.Mesh(boxGeo, mat);
        } else {
            // 10% 糖果棒
            mesh = new THREE.Mesh(cylinderGeo, matCandy);
            mesh.rotation.z = Math.random() * Math.PI; // 随机角度
        }
        
        initParticle(mesh, 'DECOR', i);
        scene.add(mesh);
        particles.push(mesh);
    }

    // === 照片卡片 (核心修复：Z轴防遮挡) ===
    const photoGeo = new THREE.PlaneGeometry(9, 12);
    // 边框有厚度 0.5，中心在 0
    const borderGeo = new THREE.BoxGeometry(9.4, 12.4, 0.5); 
    const borderMat = matGold.clone(); borderMat.emissiveIntensity = 0.8;
    
    imageList.forEach((filename, i) => {
        // 使用占位图防止黑屏
        const mat = new THREE.MeshBasicMaterial({ map: loadingTex, side: THREE.DoubleSide });
        
        const url = CONFIG.publicBaseUrl + filename;
        textureLoader.load(url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            mat.map = tex; mat.needsUpdate = true;
        }, undefined, () => {
            mat.map = createTextTexture("LOAD FAILED");
        });

        const mesh = new THREE.Mesh(photoGeo, mat);
        mesh.userData.type = 'PHOTO'; // 标记主体
        mesh.userData.idx = i;

        const border = new THREE.Mesh(borderGeo, borderMat);
        // 【关键修复】: 
        // 边框厚度 0.5，前表面在 +0.25。照片在 0。
        // 将边框移动到 -0.3，这样前表面在 -0.05，完全在照片后面。
        border.position.z = -0.3; 
        mesh.add(border);
        
        initParticle(mesh, 'PHOTO', i);
        scene.add(mesh);
        particles.push(mesh);
        photos.push(mesh); 
    });
}

function initParticle(mesh, type, idx) {
    const h = Math.random();
    // 树形：圆锥螺旋
    const angle = h * Math.PI * 25 + idx * 0.1; 
    const r = (1.05 - h) * 40; 
    const treePos = new THREE.Vector3(Math.cos(angle)*r, (h-0.5)*CONFIG.treeHeight, Math.sin(angle)*r);
    
    // 散开：球形随机
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const rad = 60 + Math.random() * CONFIG.explodeRadius;
    const explodePos = new THREE.Vector3(
        rad * Math.sin(phi) * Math.cos(theta),
        rad * Math.sin(phi) * Math.sin(theta),
        rad * Math.cos(phi)
    );

    mesh.userData.type = type;
    mesh.userData.idx = idx;
    mesh.userData.treePos = treePos;
    mesh.userData.explodePos = explodePos;
    mesh.userData.rotSpeed = {x:Math.random()*0.02, y:Math.random()*0.02, z:Math.random()*0.02};
    mesh.userData.baseScale = mesh.scale.clone();
    mesh.userData.randomPhase = Math.random() * 10;

    mesh.position.copy(explodePos);
}

function createMerryChristmas() {
    const loader = new FontLoader();
    loader.load('https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json', function (font) {
        const textMat = new THREE.MeshPhysicalMaterial({
            color: CONFIG.colors.gold, metalness: 1.0, roughness: 0.15,
            emissive: CONFIG.colors.emissiveGold, emissiveIntensity: 0.6,
            clearcoat: 1.0
        });
        const settings = { font: font, size: 5, height: 1.2, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.15, bevelSegments: 3 };

        const merryGeo = new TextGeometry('MERRY', settings);
        const chrisGeo = new TextGeometry('CHRISTMAS', settings);
        merryGeo.center(); chrisGeo.center();

        const mMesh = new THREE.Mesh(merryGeo, textMat); mMesh.position.y = 6;
        const cMesh = new THREE.Mesh(chrisGeo, textMat); cMesh.position.y = -4;

        const group = new THREE.Group();
        group.add(mMesh); group.add(cMesh);

        const explodePos = new THREE.Vector3(0, CONFIG.treeHeight + 50, 0);
        group.userData = {
            type: 'TEXT', treePos: new THREE.Vector3(0, CONFIG.treeHeight/2 + 18, 0),
            explodePos: explodePos, rotSpeed: {x:0, y:0.01, z:0},
            baseScale: new THREE.Vector3(1,1,1), randomPhase: 0
        };
        group.position.copy(explodePos);
        scene.add(group);
        particles.push(group);
    });
}

// ================= 4. 动画循环 =================
function updateLogic() {
    if (inputState.mouseLockedPhoto) {
        targetState = 'PHOTO';
    } else if (inputState.isFist) {
        targetState = 'TREE';
    } else {
        targetState = 'EXPLODE';
    }

    const time = Date.now() * 0.001;
    
    // 只有非锁定状态下，背景才跟随鼠标微动
    if (targetState !== 'PHOTO') {
        const targetRotY = (inputState.x - 0.5) * 1.0;
        const targetRotX = (inputState.y - 0.5) * 0.5;
        scene.rotation.y += (targetRotY - scene.rotation.y) * 0.05;
        scene.rotation.x += (targetRotX - scene.rotation.x) * 0.05;
    }

    particles.forEach(mesh => {
        const data = mesh.userData;
        let tPos = new THREE.Vector3();
        let tScale = data.baseScale.clone();
        
        mesh.rotation.x += data.rotSpeed.x;
        mesh.rotation.y += data.rotSpeed.y;

        if (targetState === 'TREE') {
            tPos.copy(data.treePos);
            tPos.y += Math.sin(time*2 + data.randomPhase) * 1.0; 
            if(data.type === 'PHOTO') tScale.multiplyScalar(0.6); 
        } 
        else if (targetState === 'EXPLODE') {
            tPos.copy(data.explodePos);
            tPos.x += Math.sin(time*0.5 + data.randomPhase)*2; 
            tPos.y += Math.cos(time*0.5 + data.randomPhase)*2;
        }
        else if (targetState === 'PHOTO') {
            if (data.type === 'PHOTO' && data.idx === activePhotoIdx) {
                tPos.set(0, 0, CONFIG.camZ - 40); 
                mesh.lookAt(camera.position); 
                mesh.rotation.set(0,0,0);
                tScale.multiplyScalar(3.5); 
            } else {
                tPos.copy(data.explodePos).multiplyScalar(2.0); 
            }
        }

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
function initMediaPipe() {
    const video = document.getElementById('input_video');
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        enableMouseMode("MOUSE MODE ACTIVE");
        return;
    }

    const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
    hands.setOptions({maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6});

    hands.onResults(results => {
        if (!isCameraMode) return; 

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const lm = results.multiHandLandmarks[0];
            if (!inputState.mouseLockedPhoto) {
                inputState.x = 1.0 - lm[9].x; 
                inputState.y = lm[9].y;
            }
            const tips = [8, 12, 16, 20];
            let avgDist = 0;
            tips.forEach(i => avgDist += Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y));
            inputState.isFist = (avgDist / 4) < 0.22;
            
            // 捏合检测
            const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
            inputState.isPinch = pinchDist < 0.05;
            
            // 手势优先级
            if (inputState.isFist || inputState.isPinch) {
                inputState.mouseLockedPhoto = false;
            }
        }
    });

    const cam = new Camera(video, {
        onFrame: async () => { await hands.send({image: video}); },
        width: 640, height: 480
    });
    
    cam.start()
        .then(() => {
            isCameraMode = true;
            document.getElementById('hint-cam').classList.add('active');
            document.getElementById('hint-mouse').classList.remove('active');
            const loader = document.getElementById('loader');
            if(loader) { loader.style.opacity = 0; setTimeout(() => loader.remove(), 500); }
        })
        .catch(err => {
            console.error("Camera denied/failed:", err);
            enableMouseMode("CAMERA FAILED - MOUSE MODE");
        });
}

function enableMouseMode(msg) {
    isCameraMode = false;
    updateStatusText(msg);
    document.getElementById('hint-cam').classList.remove('active');
    document.getElementById('hint-mouse').classList.add('active');
    const loader = document.getElementById('loader');
    if(loader) { loader.style.opacity = 0; setTimeout(() => loader.remove(), 500); }
}

fetchBucketPhotos();