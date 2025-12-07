import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// ================= 配置 =================
const CONFIG = {
    particleCount: 800, // 增加背景气氛组数量
    bucketXmlUrl: "https://storage.googleapis.com/beautiful-days/?prefix=christa/", 
    publicBaseUrl: "https://static.refinefuture.com/", 
    treeHeight: 90,
    explodeRadius: 160,
    camZ: 140,
    colors: { 
        gold: 0xFFD700,
        red: 0xC41E3A,    
        green: 0x0B3d0B,  
        white: 0xFFFFFF,
        emissiveGold: 0xAA8800
    }
};

// ================= 全局变量 =================
let scene, camera, renderer, composer;
// 【关键分离】：粒子数组只存装饰物，照片数组只存照片
let decorParticles = []; 
let photoCards = []; 

let targetState = 'EXPLODE'; 
let activePhoto = null; // 当前正在查看的 specific photo object
let imageList = []; 
let isCameraMode = false;

const raycaster = new THREE.Raycaster();
const mouseVector = new THREE.Vector2();

const inputState = {
    x: 0.5, y: 0.5,
    isFist: false,
    isPinch: false,
    zoomLevel: 1.0 // 额外缩放系数
};

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

// 占位图
function createTextTexture(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 680;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#222'; ctx.fillRect(0,0,512,680);
    ctx.strokeStyle = '#666'; ctx.lineWidth = 15; ctx.strokeRect(0,0,512,680);
    ctx.font = 'bold 40px Arial'; ctx.fillStyle = '#888'; ctx.textAlign = 'center';
    ctx.fillText(text, 256, 340);
    return new THREE.CanvasTexture(canvas);
}
const loadingTex = createTextTexture("LOADING...");

// ================= 1. 启动入口 =================
async function fetchBucketPhotos() {
    const loaderText = document.getElementById('loader-text');
    try {
        if(loaderText) loaderText.innerText = "READING MEMORIES...";
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
        if (imageList.length === 0) throw new Error("No images");
        if(loaderText) loaderText.innerText = `LOADED ${imageList.length} PHOTOS`;
    } catch (e) {
        console.warn("Offline mode", e);
        if(loaderText) loaderText.innerText = "OFFLINE MODE";
        for(let i=1; i<=6; i++) imageList.push(`christa/${i}.jpg`);
    }
    initThree();
    initMediaPipe(); 
}

// ================= 2. 交互逻辑 (针对 PhotoCards) =================

function getIntersectedPhoto(clientX, clientY) {
    const mv = new THREE.Vector2();
    mv.x = (clientX / window.innerWidth) * 2 - 1;
    mv.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mv, camera);
    
    // 只检测 photoCards，完全忽略背景粒子
    const intersects = raycaster.intersectObjects(photoCards, true);
    
    if (intersects.length > 0) {
        let hitObj = intersects[0].object;
        // 向上查找直到找到照片主体 Group
        while(hitObj && hitObj !== scene) {
            if (hitObj.userData && hitObj.userData.isPhoto) return hitObj;
            hitObj = hitObj.parent;
        }
    }
    return null;
}

function onGlobalMouseMove(event) {
    inputState.x = event.clientX / window.innerWidth;
    inputState.y = event.clientY / window.innerHeight;
    
    // 如果当前没在看大图，允许鼠标变成小手
    if (!activePhoto) {
        const hit = getIntersectedPhoto(event.clientX, event.clientY);
        document.body.style.cursor = hit ? 'pointer' : 'default';
        
        // 简单的悬停微动效果
        photoCards.forEach(p => {
            if (p === hit) p.userData.hoverScale = 1.2;
            else p.userData.hoverScale = 1.0;
        });
    } else {
        document.body.style.cursor = 'default';
    }
}

function onGlobalMouseDown(event) {
    if (event.button !== 0) return; // 只左键

    const hit = getIntersectedPhoto(event.clientX, event.clientY);

    if (hit) {
        // [点击照片] -> 无论之前在干嘛，直接把这张照片置为 active
        activePhoto = hit;
        inputState.isFist = false; // 打断聚合
        updateStatusText("VIEWING MEMORY", "#00ffff");
    } else {
        // [点击空白]
        if (activePhoto) {
            // 如果正在看照片 -> 关闭照片，回到星系
            activePhoto = null;
            updateStatusText("GALAXY MODE");
        } else {
            // 如果没看照片 -> 聚合圣诞树
            inputState.isFist = true;
            updateStatusText("FORMING TREE", "#FFD700");
        }
    }
}

function onGlobalMouseUp(event) {
    // 松开鼠标，只有在【没看照片】时才取消聚合
    if (!activePhoto) {
        inputState.isFist = false;
        updateStatusText("GALAXY MODE");
    }
}

function onGlobalWheel(event) {
    if (activePhoto) {
        inputState.zoomLevel += event.deltaY * -0.001;
        inputState.zoomLevel = Math.max(0.5, Math.min(2.0, inputState.zoomLevel));
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
    // 雾气调淡一点，别遮住照片
    scene.fog = new THREE.FogExp2(0x000000, 0.0005);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = CONFIG.camZ;

    renderer = new THREE.WebGLRenderer({ antialias: true, stencil: false, depth: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // 开启 ToneMapping 让金属好看，但后面我们会针对照片关掉它
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0; 
    container.appendChild(renderer.domElement);

    // 灯光
    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambient);
    const mainLight = new THREE.DirectionalLight(0xFFF5E1, 2);
    mainLight.position.set(50, 50, 50);
    scene.add(mainLight);
    const centerLight = new THREE.PointLight(0xFFD700, 5, 200);
    scene.add(centerLight);
    
    // 辉光
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.85; // 高阈值
    bloomPass.strength = 1.5; 
    bloomPass.radius = 0.5;
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    createDecorations(); // 背景粒子
    createPhotoCards();  // 照片卡片
    createMerryChristmas();

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mousedown', onGlobalMouseDown);
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('wheel', onGlobalWheel);
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('contextmenu', e => e.preventDefault());
    
    animate();
}

// === 第一组：纯粹的装饰粒子（金属/发光/几何体） ===
function createDecorations() {
    const matGold = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.gold, metalness: 0.9, roughness: 0.1, emissive: CONFIG.colors.emissiveGold, emissiveIntensity: 2.0 });
    const matRed = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.7, roughness: 0.15, emissive: 0x550000, emissiveIntensity: 1.0 });
    const matGreen = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.green, metalness: 0.1, roughness: 0.8 });
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }); 
    const matCandy = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.white, metalness: 0.3, roughness: 0.4, emissive: 0xFFFFFF, emissiveIntensity: 1.5 });

    const sphereGeo = new THREE.SphereGeometry(1.3, 16, 16); 
    const giftGeo = new THREE.BoxGeometry(2.2, 2.2, 2.2); 
    const candyGeo = new THREE.CylinderGeometry(0.3, 0.3, 3.5, 12); 
    const starGeo = new THREE.OctahedronGeometry(1.8); 

    for(let i=0; i<CONFIG.particleCount; i++) {
        let mesh;
        const type = Math.random();

        if (type < 0.3) mesh = new THREE.Mesh(sphereGeo, Math.random() > 0.5 ? matGold : matRed);
        else if (type < 0.5) mesh = new THREE.Mesh(giftGeo, Math.random() > 0.5 ? matRed : matGreen);
        else if (type < 0.7) {
            mesh = new THREE.Mesh(candyGeo, matCandy);
            mesh.rotation.set((Math.random()-0.5),(Math.random()-0.5), Math.random()*Math.PI);
        } else {
            mesh = new THREE.Mesh(starGeo, matGold);
            mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, 0);
        }
        
        const scaleVar = 0.8 + Math.random() * 0.4;
        mesh.scale.set(scaleVar, scaleVar, scaleVar);
        
        // 存入装饰列表，只参与背景动画
        initMovementData(mesh, i);
        scene.add(mesh);
        decorParticles.push(mesh);
    }
}

// === 第二组：照片卡片（独立逻辑） ===
function createPhotoCards() {
    const photoGeo = new THREE.PlaneGeometry(9, 12);
    // 边框不发光，普通金属
    const borderMat = new THREE.MeshStandardMaterial({
        color: 0xdaa520, metalness: 0.6, roughness: 0.4
    });
    const borderGeo = new THREE.BoxGeometry(9.6, 12.6, 0.2); 

    imageList.forEach((filename, i) => {
        // Group 用于整体移动
        const group = new THREE.Group();
        group.userData.isPhoto = true; // 标记
        group.userData.idx = i;
        group.userData.hoverScale = 1.0;

        // 1. 照片本体：MeshBasicMaterial (不受光照影响，绝对清晰)
        const mat = new THREE.MeshBasicMaterial({ 
            map: loadingTex, 
            side: THREE.DoubleSide,
            toneMapped: false // 关键：禁止色调映射，保持原色
        });
        
        const url = CONFIG.publicBaseUrl + filename;
        textureLoader.load(url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace; 
            mat.map = tex; mat.needsUpdate = true;
        }, undefined, () => {
            mat.map = createTextTexture("FAILED");
        });

        const photoMesh = new THREE.Mesh(photoGeo, mat);
        photoMesh.position.z = 0.11; // 稍微在边框前面

        // 2. 边框
        const border = new THREE.Mesh(borderGeo, borderMat);
        border.position.z = 0; 

        group.add(border);
        group.add(photoMesh);
        
        initMovementData(group, i);
        scene.add(group);
        photoCards.push(group); 
    });
}

function initMovementData(mesh, idx) {
    const h = Math.random();
    // 树位置
    const angle = h * Math.PI * 25 + idx * 0.1; 
    const r = (1.05 - h) * 40; 
    const treePos = new THREE.Vector3(Math.cos(angle)*r, (h-0.5)*CONFIG.treeHeight, Math.sin(angle)*r);
    
    // 散开位置
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const rad = 60 + Math.random() * CONFIG.explodeRadius;
    const explodePos = new THREE.Vector3(
        rad * Math.sin(phi) * Math.cos(theta),
        rad * Math.sin(phi) * Math.sin(theta),
        rad * Math.cos(phi)
    );

    mesh.userData = Object.assign(mesh.userData, {
        treePos, explodePos,
        rotSpeed: {x:Math.random()*0.02, y:Math.random()*0.02, z:Math.random()*0.02},
        baseScale: mesh.scale.clone(),
        randomPhase: Math.random() * 10
    });
    mesh.position.copy(explodePos);
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
            treePos: new THREE.Vector3(0, CONFIG.treeHeight/2 + 18, 0),
            explodePos: explodePos, rotSpeed: {x:0, y:0.01, z:0},
            baseScale: new THREE.Vector3(1,1,1), randomPhase: 0
        };
        group.position.copy(explodePos);
        scene.add(group);
        decorParticles.push(group); // 文字算装饰
    });
}

// ================= 4. 动画循环 (分离逻辑) =================
function updateLogic() {
    const time = Date.now() * 0.001;
    
    // 确定当前大环境状态 (树还是散)
    // 如果 activePhoto 存在，背景强制散开
    let envState = 'EXPLODE';
    if (inputState.isFist && !activePhoto) envState = 'TREE';

    // UI 反馈
    const statusEl = document.getElementById('status-text');
    if(activePhoto) statusEl.innerText = "MEMORY VIEW";
    else if(envState === 'TREE') statusEl.innerText = "CHRISTMAS TREE";
    else statusEl.innerText = "GALAXY MODE";

    // 视角控制：只有没看照片时，才允许大幅度旋转视角
    const targetRotY = (activePhoto ? 0 : (inputState.x - 0.5) * 1.0);
    const targetRotX = (activePhoto ? 0 : (inputState.y - 0.5) * 0.5);
    scene.rotation.y += (targetRotY - scene.rotation.y) * 0.05;
    scene.rotation.x += (targetRotX - scene.rotation.x) * 0.05;

    // --- A. 更新背景装饰粒子 ---
    decorParticles.forEach(mesh => {
        const data = mesh.userData;
        let tPos = new THREE.Vector3();
        let tScale = data.baseScale.clone();
        
        mesh.rotation.x += data.rotSpeed.x;
        mesh.rotation.y += data.rotSpeed.y;

        if (envState === 'TREE') {
            tPos.copy(data.treePos);
            tPos.y += Math.sin(time*2 + data.randomPhase) * 1.0; 
        } else {
            // EXPLODE
            tPos.copy(data.explodePos);
            tPos.x += Math.sin(time*0.5 + data.randomPhase)*2; 
            tPos.y += Math.cos(time*0.5 + data.randomPhase)*2;
            
            // 如果在看照片，背景粒子往后推，变暗/变小
            if (activePhoto) {
                tPos.multiplyScalar(1.5); // 散更远
                tScale.multiplyScalar(0.5);
            }
        }
        mesh.position.lerp(tPos, 0.08);
        mesh.scale.lerp(tScale, 0.08);
    });

    // --- B. 更新照片卡片 ---
    photoCards.forEach(mesh => {
        const data = mesh.userData;
        let tPos = new THREE.Vector3();
        let tScale = data.baseScale.clone();
        let tRot = mesh.rotation.clone(); // 默认保持当前旋转

        if (mesh === activePhoto) {
            // === 选中态 ===
            // 飞到屏幕正前方，绝对位置
            // 这里我们不需要 lookAt(camera)，因为 camera 没动，我们直接把 rotation 归零即可正对屏幕
            tPos.set(0, 0, CONFIG.camZ - 40); 
            tScale.multiplyScalar(3.5 * inputState.zoomLevel); // 应用缩放
            
            // 强制重置旋转为 0 (正对)
            mesh.rotation.set(0, 0, 0);
            
            // 使用更快的插值
            mesh.position.lerp(tPos, 0.1);
            mesh.scale.lerp(tScale, 0.1);
            // 选中的不自转
            
        } else {
            // === 非选中态 ===
            // 跟随环境 (树/散)
            if (envState === 'TREE') {
                tPos.copy(data.treePos);
                tScale.multiplyScalar(0.6); // 树上的照片小一点
            } else {
                tPos.copy(data.explodePos);
                if (activePhoto) tPos.multiplyScalar(2.0); // 避让选中的照片
            }
            
            // 应用悬停放大
            tScale.multiplyScalar(data.hoverScale);

            // 自转
            mesh.rotation.x += data.rotSpeed.x;
            mesh.rotation.y += data.rotSpeed.y;

            mesh.position.lerp(tPos, 0.08);
            mesh.scale.lerp(tScale, 0.08);
        }
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
async function initMediaPipe() {
    const video = document.getElementById('input_video');
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        enableMouseMode("MOUSE MODE ACTIVE");
        return;
    }

    try {
        const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
        hands.setOptions({maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6});

        hands.onResults(results => {
            if (!isCameraMode) return; 

            if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                const lm = results.multiHandLandmarks[0];
                
                // 如果没看照片，手控制视角
                if (!activePhoto) {
                    inputState.x = 1.0 - lm[9].x; 
                    inputState.y = lm[9].y;
                }

                const tips = [8, 12, 16, 20];
                let avgDist = 0;
                tips.forEach(i => avgDist += Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y));
                inputState.isFist = (avgDist / 4) < 0.22;
                
                const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
                inputState.isPinch = pinchDist < 0.05;
                
                // 捏合缩放
                if (inputState.isPinch && activePhoto) {
                    let scale = (pinchDist - 0.02) * 40.0;
                    inputState.zoomLevel = Math.max(0.5, Math.min(3.0, scale));
                }

                // 握拳打断照片查看
                if (inputState.isFist) {
                    activePhoto = null;
                }
            }
        });

        const cam = new Camera(video, {
            onFrame: async () => { await hands.send({image: video}); },
            width: 640, height: 480
        });
        
        await cam.start();
        isCameraMode = true;
        document.getElementById('hint-cam').classList.add('active');
        document.getElementById('hint-mouse').classList.remove('active');
        const loader = document.getElementById('loader');
        if(loader) { loader.style.opacity = 0; setTimeout(() => loader.remove(), 500); }

    } catch (err) {
        enableMouseMode("CAMERA FAILED - MOUSE MODE");
    }
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