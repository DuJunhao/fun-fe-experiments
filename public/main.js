import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// ================= 配置 =================
const CONFIG = {
    particleCount: 700, 
    bucketXmlUrl: "https://storage.googleapis.com/beautiful-days/?prefix=christa/", 
    publicBaseUrl: "https://static.refinefuture.com/", 
    treeHeight: 90,
    explodeRadius: 160,
    camZ: 130, // 相机位置
    colors: { 
        gold: 0xFFD700,
        red: 0xC41E3A,    
        green: 0x0B3d0B,  
        white: 0xFFFFFF,
        emissiveGold: 0xFFAA00
    }
};

// ================= 全局变量 =================
let scene, camera, renderer, composer;
let particles = []; 
let photos = []; 
let activePhoto = null; // 当前选中的照片对象
let imageList = []; 
let isCameraMode = false;

const raycaster = new THREE.Raycaster();
const mouseVector = new THREE.Vector2();

const inputState = {
    x: 0.5, y: 0.5,
    isFist: false,
    isPinch: false,
    lastPinchTime: 0
};

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

// 占位图
function createTextTexture(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 680;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111'; ctx.fillRect(0,0,512,680);
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 20; ctx.strokeRect(0,0,512,680);
    ctx.font = 'bold 50px Arial'; ctx.fillStyle = '#888'; ctx.textAlign = 'center';
    ctx.fillText(text, 256, 340);
    return new THREE.CanvasTexture(canvas);
}
const loadingTex = createTextTexture("LOADING...");

// ================= 1. 启动入口 =================
async function fetchBucketPhotos() {
    const loaderText = document.getElementById('loader-text');
    setTimeout(() => {
        const loader = document.getElementById('loader');
        if(loader) { loader.style.opacity = 0; setTimeout(() => loader.remove(), 500); }
    }, 2500);

    try {
        if(loaderText) loaderText.innerText = "SCANNING MEMORIES...";
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
        if(loaderText) loaderText.innerText = `LOADED ${imageList.length} PHOTOS`;
    } catch (e) {
        console.warn("Offline mode", e);
        if(loaderText) loaderText.innerText = "OFFLINE MODE";
        for(let i=1; i<=6; i++) imageList.push(`christa/${i}.jpg`);
    }
    
    initThree();
    setTimeout(initMediaPipeSafe, 100);
}

// ================= 2. 交互逻辑 (鼠标) =================

function getIntersectedPhoto(clientX, clientY) {
    const mv = new THREE.Vector2();
    mv.x = (clientX / window.innerWidth) * 2 - 1;
    mv.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mv, camera);
    const intersects = raycaster.intersectObjects(photos, true);
    
    if (intersects.length > 0) {
        let hitObj = intersects[0].object;
        while(hitObj && hitObj !== scene) {
            if (hitObj.userData && hitObj.userData.type === 'PHOTO') return hitObj;
            hitObj = hitObj.parent;
        }
    }
    return null;
}

function onGlobalMouseMove(event) {
    inputState.x = event.clientX / window.innerWidth;
    inputState.y = event.clientY / window.innerHeight;
    
    if (!activePhoto) {
        const hit = getIntersectedPhoto(event.clientX, event.clientY);
        document.body.style.cursor = hit ? 'pointer' : 'default';
        // 悬停微动
        photos.forEach(p => {
            p.userData.hoverScale = (p === hit) ? 1.2 : 1.0;
        });
    } else {
        document.body.style.cursor = 'default';
    }
}

function onGlobalMouseDown(event) {
    if (event.button !== 0) return; 
    const hit = getIntersectedPhoto(event.clientX, event.clientY);

    if (hit) {
        // [点击照片] 选中并放大
        activePhoto = hit;
        inputState.isFist = false; 
        updateStatusText("MEMORY LOCKED", "#00ffff");
    } else {
        // [点击空白]
        if (activePhoto) {
            activePhoto = null; // 关闭照片
            updateStatusText("GALAXY MODE");
        } else {
            inputState.isFist = true; // 聚合
            updateStatusText("FORMING TREE", "#FFD700");
        }
    }
}

function onGlobalMouseUp(event) {
    if (!activePhoto) {
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
    scene.fog = new THREE.FogExp2(0x000000, 0.001);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = CONFIG.camZ;

    renderer = new THREE.WebGLRenderer({ antialias: true, stencil: false, depth: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.NoToneMapping; 
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    const mainLight = new THREE.DirectionalLight(0xFFF5E1, 2);
    mainLight.position.set(20, 50, 50);
    scene.add(mainLight);
    const centerLight = new THREE.PointLight(0xFFD700, 5, 150);
    scene.add(centerLight);
    
    // 辉光配置
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.85; 
    bloomPass.strength = 1.2; 
    bloomPass.radius = 0.5;
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    createChristmasObjects();
    createMerryChristmas();

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mousedown', onGlobalMouseDown);
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('contextmenu', e => e.preventDefault());
    
    animate();
}

function createChristmasObjects() {
    const matGold = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.gold, metalness: 0.9, roughness: 0.1, emissive: CONFIG.colors.emissiveGold, emissiveIntensity: 2.0 });
    const matRed = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.7, roughness: 0.15, emissive: 0x550000, emissiveIntensity: 1.5 });
    const matGreen = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.green, metalness: 0.1, roughness: 0.8 });
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }); 
    const matCandy = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.white, metalness: 0.3, roughness: 0.4, emissive: 0xFFFFFF, emissiveIntensity: 1.2 });
    const matLeaf = new THREE.MeshLambertMaterial({ color: 0x2E8B57 }); 

    const sphereGeo = new THREE.SphereGeometry(1.3, 16, 16); 
    const giftGeo = new THREE.BoxGeometry(2.2, 2.2, 2.2); 
    const candyGeo = new THREE.CylinderGeometry(0.3, 0.3, 3.5, 12); 
    const starGeo = new THREE.OctahedronGeometry(1.8); 
    const leafGeo = new THREE.TetrahedronGeometry(2.0);

    // 装饰粒子
    for(let i=0; i<CONFIG.particleCount; i++) {
        let mesh;
        const type = Math.random();

        if (type < 0.50) { // 50% 树叶背景
            mesh = new THREE.Mesh(leafGeo, matLeaf);
            mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
        } else if (type < 0.65) {
            mesh = new THREE.Mesh(sphereGeo, Math.random() > 0.5 ? matGold : matRed);
        } else if (type < 0.80) {
            mesh = new THREE.Mesh(giftGeo, Math.random() > 0.5 ? matRed : matGreen);
            mesh.rotation.set(Math.random(), Math.random(), Math.random());
        } else if (type < 0.90) {
            mesh = new THREE.Mesh(candyGeo, matCandy);
            mesh.rotation.set((Math.random()-0.5),(Math.random()-0.5), Math.random()*Math.PI);
        } else {
            mesh = new THREE.Mesh(starGeo, matGold);
        }
        
        const scaleVar = 0.8 + Math.random() * 0.4;
        mesh.scale.set(scaleVar, scaleVar, scaleVar);
        initParticle(mesh, 'DECOR', i);
        scene.add(mesh);
        particles.push(mesh);
    }

    // === 照片卡片 ===
    const photoGeo = new THREE.PlaneGeometry(9, 12);
    const borderGeo = new THREE.BoxGeometry(9.6, 12.6, 0.5); 
    
    // 边框材质：高强度自发光，实现辉光边框
    const borderMat = new THREE.MeshPhysicalMaterial({
        color: CONFIG.colors.gold, metalness: 0.9, roughness: 0.1,
        emissive: CONFIG.colors.emissiveGold, emissiveIntensity: 2.0 // 亮边！
    });
    
    imageList.forEach((filename, i) => {
        const group = new THREE.Group();
        group.userData.type = 'PHOTO';
        group.userData.idx = i;
        group.userData.hoverScale = 1.0;

        const mat = new THREE.MeshBasicMaterial({ 
            map: loadingTex, 
            side: THREE.DoubleSide,
            toneMapped: false // 保证清晰
        });
        
        const url = CONFIG.publicBaseUrl + filename;
        textureLoader.load(url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            mat.map = tex; mat.needsUpdate = true;
        }, undefined, () => {
            mat.map = createTextTexture("FAILED");
        });

        const photoMesh = new THREE.Mesh(photoGeo, mat);
        photoMesh.position.z = 0.3; // 照片在前

        const border = new THREE.Mesh(borderGeo, borderMat);
        border.position.z = 0; // 边框在后

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
    const radiusMod = type === 'LEAF' ? 0.85 : 1.05; 
    const angle = h * Math.PI * 25 + idx * 0.1; 
    const r = ((1.05 - h) * 40) * radiusMod; 
    const treePos = new THREE.Vector3(Math.cos(angle)*r, (h-0.5)*CONFIG.treeHeight, Math.sin(angle)*r);
    
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const rad = 60 + Math.random() * CONFIG.explodeRadius;
    const explodePos = new THREE.Vector3(
        rad * Math.sin(phi) * Math.cos(theta),
        rad * Math.sin(phi) * Math.sin(theta),
        rad * Math.cos(phi)
    );

    mesh.userData = {
        type, idx, treePos, explodePos,
        rotSpeed: {x:Math.random()*0.02, y:Math.random()*0.02, z:Math.random()*0.02},
        baseScale: mesh.scale.clone(),
        randomPhase: Math.random() * 10
    };
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
            type: 'TEXT', treePos: new THREE.Vector3(0, CONFIG.treeHeight/2 + 18, 0),
            explodePos: explodePos, rotSpeed: {x:0, y:0.01, z:0},
            baseScale: new THREE.Vector3(1,1,1), randomPhase: 0
        };
        group.position.copy(explodePos);
        scene.add(group);
        particles.push(group);
    });
}

// ================= 4. 动画循环 (核心修正) =================
function updateLogic() {
    let envState = 'EXPLODE';
    if (activePhoto) {
        envState = 'EXPLODE'; // 看照片时背景散开
    } else if (inputState.isFist) {
        envState = 'TREE';
    }

    // UI 反馈
    const statusEl = document.getElementById('status-text');
    if(activePhoto) statusEl.innerText = "MEMORY VIEW";
    else if(envState === 'TREE') statusEl.innerText = "CHRISTMAS TREE";
    else statusEl.innerText = "GALAXY MODE";

    const time = Date.now() * 0.001;
    
    // 视角控制
    const targetRotY = (activePhoto ? 0 : (inputState.x - 0.5) * 1.0);
    const targetRotX = (activePhoto ? 0 : (inputState.y - 0.5) * 0.5);
    scene.rotation.y += (targetRotY - scene.rotation.y) * 0.05;
    scene.rotation.x += (targetRotX - scene.rotation.x) * 0.05;

    // --- 粒子更新 ---
    particles.forEach(mesh => {
        const data = mesh.userData;
        
        // 如果是当前选中的照片，跳过普通逻辑，单独处理
        if (mesh === activePhoto) {
            // 【核心修正】计算最佳观看距离
            // 相机Z=130。把照片放到 Z=115，距离相机15。
            // 此时照片看起来非常大，且无遮挡。
            const targetPos = new THREE.Vector3(0, 0, CONFIG.camZ - 15); 
            
            mesh.lookAt(camera.position); 
            mesh.rotation.set(0, 0, 0); // 强制正对

            // 稍微放大一点点以适应屏幕比例
            const targetScale = data.baseScale.clone().multiplyScalar(1.5); 

            mesh.position.lerp(targetPos, 0.1);
            mesh.scale.lerp(targetScale, 0.1);
            return; // 结束当前循环
        }

        // 普通粒子逻辑
        let tPos = new THREE.Vector3();
        let tScale = data.baseScale.clone();

        // 悬停效果
        if (data.type === 'PHOTO') {
            tScale.multiplyScalar(data.hoverScale);
        }

        // 自转
        mesh.rotation.x += data.rotSpeed.x;
        mesh.rotation.y += data.rotSpeed.y;

        if (envState === 'TREE') {
            tPos.copy(data.treePos);
            tPos.y += Math.sin(time*2 + data.randomPhase) * 1.0; 
            if(data.type === 'PHOTO') tScale.multiplyScalar(0.6); 
        } 
        else { // EXPLODE
            tPos.copy(data.explodePos);
            tPos.x += Math.sin(time*0.5 + data.randomPhase)*2; 
            tPos.y += Math.cos(time*0.5 + data.randomPhase)*2;
            
            // 如果正在看其他照片，背景退后
            if (activePhoto) {
                tPos.multiplyScalar(1.5); 
                tScale.multiplyScalar(0.5);
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
async function initMediaPipeSafe() {
    const video = document.getElementById('input_video');
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("No API");
        }
        await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (e) {
        enableMouseMode("MOUSE MODE (NO CAM)");
        return;
    }

    try {
        const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
        hands.setOptions({maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6});

        hands.onResults(results => {
            if (!isCameraMode) return; 
            if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                const lm = results.multiHandLandmarks[0];
                
                // 如果没看照片，手控制光标
                if (!activePhoto) {
                    inputState.x = 1.0 - lm[9].x; 
                    inputState.y = lm[9].y;
                }

                // 握拳 = 聚合
                const tips = [8, 12, 16, 20];
                let avgDist = 0;
                tips.forEach(i => avgDist += Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y));
                inputState.isFist = (avgDist / 4) < 0.22;
                
                // 捏合 = 选中/切图
                const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
                inputState.isPinch = pinchDist < 0.05;

                if (inputState.isPinch) {
                    const now = Date.now();
                    if (now - inputState.lastPinchTime > 1000 && !activePhoto) {
                        // 捏合随机选中一张
                        activePhoto = photos[Math.floor(Math.random()*photos.length)];
                        inputState.lastPinchTime = now;
                    }
                }
                
                if (inputState.isFist) activePhoto = null;
            }
        });

        const cam = new Camera(video, {
            onFrame: async () => { await hands.send({image: video}); },
            width: 640, height: 480
        });
        
        cam.start().then(() => {
            isCameraMode = true;
            document.getElementById('hint-cam').classList.add('active');
            document.getElementById('hint-mouse').classList.remove('active');
            const loader = document.getElementById('loader');
            if(loader) { loader.style.opacity = 0; setTimeout(() => loader.remove(), 500); }
        }).catch(err => {
            enableMouseMode("MOUSE MODE (START FAIL)");
        });

    } catch (e) {
        enableMouseMode("MOUSE MODE (LIB FAIL)");
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