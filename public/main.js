import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

console.log("🚀 VERSION: FINAL NO-ALERT FIX LOADED");

// ================= 配置 =================
const CONFIG = {
    particleCount: 600, 
    bucketXmlUrl: "https://storage.googleapis.com/beautiful-days/?prefix=christa/", 
    publicBaseUrl: "https://static.refinefuture.com/", 
    treeHeight: 90,
    explodeRadius: 150,
    camZ: 130,
    colors: { 
        gold: 0xFFD700,
        red: 0xC41E3A,    
        green: 0x2F4F4F,  
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

const inputState = {
    x: 0.5, y: 0.5,
    isFist: false,
    mouseLockedPhoto: false,
    isPinch: false,
    zoomLevel: 3.5 
};

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

// 占位图
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
const loadingTex = createTextTexture("LOADING...");

// ================= 1. 启动入口 =================
async function fetchBucketPhotos() {
    const loaderText = document.getElementById('loader-text');
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
        if(loaderText) loaderText.innerText = `FOUND ${imageList.length} MOMENTS`;
    } catch (e) {
        console.warn("Using offline mode", e);
        if(loaderText) loaderText.innerText = "OFFLINE MODE";
        for(let i=1; i<=6; i++) imageList.push(`christa/${i}.jpg`);
    }
    
    // 初始化 3D 场景
    initThree();
    // 尝试初始化摄像头 (带预检查)
    initMediaPipeSafe(); 
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
        while(hitObj && hitObj !== scene) {
            if (hitObj.userData && hitObj.userData.type === 'PHOTO') return hitObj;
            hitObj = hitObj.parent;
        }
    }
    return null;
}

function onGlobalMouseMove(event) {
    // 始终更新鼠标坐标
    inputState.x = event.clientX / window.innerWidth;
    inputState.y = event.clientY / window.innerHeight;
    
    if (!inputState.mouseLockedPhoto) {
        const hit = getIntersectedPhoto(event.clientX, event.clientY);
        document.body.style.cursor = hit ? 'pointer' : 'default';
    }
}

function onGlobalMouseDown(event) {
    if (event.button !== 0) return; // 只左键

    const targetPhoto = getIntersectedPhoto(event.clientX, event.clientY);

    if (targetPhoto) {
        // [点击照片] -> 强制锁定
        inputState.mouseLockedPhoto = true;
        activePhotoIdx = targetPhoto.userData.idx;
        inputState.isFist = false; 
        inputState.zoomLevel = 4.0; // 重置缩放
        updateStatusText("MEMORY LOCKED", "#00ffff");
    } else {
        // [点击空白]
        if (inputState.mouseLockedPhoto) {
            // 解锁
            inputState.mouseLockedPhoto = false;
            activePhotoIdx = -1;
            updateStatusText("GALAXY MODE");
        } else {
            // 聚合
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
    // 关闭 ToneMapping，防止照片变色/过曝
    renderer.toneMapping = THREE.NoToneMapping; 
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    const mainLight = new THREE.DirectionalLight(0xFFF5E1, 2);
    mainLight.position.set(20, 50, 50);
    scene.add(mainLight);
    
    // 辉光配置
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.8; 
    bloomPass.strength = 1.0; 
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
    // 材质
    const matGold = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.gold, metalness: 0.9, roughness: 0.1, emissive: CONFIG.colors.emissiveGold, emissiveIntensity: 1.0 });
    const matRed = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.7, roughness: 0.15, emissive: 0x550000, emissiveIntensity: 0.5 });
    const matGreen = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.green, metalness: 0.1, roughness: 0.8 });
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }); 
    const matCandy = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.white, metalness: 0.3, roughness: 0.4, emissive: 0xFFFFFF, emissiveIntensity: 0.5 });

    // 几何体
    const sphereGeo = new THREE.SphereGeometry(1.3, 24, 24); 
    const giftGeo = new THREE.BoxGeometry(2.2, 2.2, 2.2); 
    const candyGeo = new THREE.CylinderGeometry(0.3, 0.3, 3.5, 12); 
    const starGeo = new THREE.OctahedronGeometry(1.8); 

    const hatConeGeo = new THREE.ConeGeometry(1.2, 3, 16);
    const hatBrimGeo = new THREE.TorusGeometry(1.2, 0.3, 12, 24);
    const stockLegGeo = new THREE.CylinderGeometry(0.8, 0.8, 2.5, 12);
    const stockFootGeo = new THREE.CylinderGeometry(0.8, 0.9, 1.5, 12);

    for(let i=0; i<CONFIG.particleCount; i++) {
        let mesh;
        const type = Math.random();

        if (type < 0.3) {
            mesh = new THREE.Mesh(sphereGeo, Math.random() > 0.5 ? matGold : matRed);
        } else if (type < 0.5) {
            const group = new THREE.Group();
            const box = new THREE.Mesh(giftGeo, Math.random() > 0.5 ? matRed : matGreen);
            group.add(box);
            mesh = group;
        } else if (type < 0.65) {
            mesh = new THREE.Mesh(candyGeo, matCandy);
            mesh.rotation.set((Math.random()-0.5),(Math.random()-0.5), Math.random()*Math.PI);
        } else if (type < 0.80) {
            mesh = new THREE.Mesh(starGeo, matGold);
            mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, 0);
        } else if (type < 0.90) {
            const group = new THREE.Group();
            const cone = new THREE.Mesh(hatConeGeo, matRed);
            const brim = new THREE.Mesh(hatBrimGeo, matWhite);
            brim.position.y = -1.5; brim.rotation.x = Math.PI/2;
            group.add(cone); group.add(brim);
            mesh = group;
        } else {
            const group = new THREE.Group();
            const leg = new THREE.Mesh(stockLegGeo, matRed);
            const foot = new THREE.Mesh(stockFootGeo, matRed);
            foot.rotation.x = Math.PI / 2; foot.position.set(0, -1.25, 0.5);
            const cuff = new THREE.Mesh(hatBrimGeo, matWhite);
            cuff.position.y = 1.25; cuff.rotation.x = Math.PI / 2; cuff.scale.set(0.8, 0.8, 0.8);
            mesh.add(leg); mesh.add(foot); mesh.add(cuff);
            mesh.rotation.set(Math.random()*0.5, Math.random()*Math.PI, 0);
        }
        
        const scaleVar = 0.8 + Math.random() * 0.4;
        mesh.scale.set(scaleVar, scaleVar, scaleVar);
        initParticle(mesh, 'DECOR', i);
        scene.add(mesh);
        particles.push(mesh);
    }

    // === 照片卡片 (Basic材质：绝对清晰) ===
    const photoGeo = new THREE.PlaneGeometry(9, 12);
    const borderGeo = new THREE.BoxGeometry(9.6, 12.6, 0.2); 
    const borderMat = new THREE.MeshBasicMaterial({ color: 0xdaa520 }); 
    
    imageList.forEach((filename, i) => {
        const mat = new THREE.MeshBasicMaterial({ 
            map: loadingTex, 
            side: THREE.DoubleSide
        });
        
        const url = CONFIG.publicBaseUrl + filename;
        textureLoader.load(url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            mat.map = tex; mat.needsUpdate = true;
        }, undefined, () => {
            mat.map = createTextTexture("LOAD FAILED");
        });

        const mesh = new THREE.Mesh(photoGeo, mat);
        mesh.userData.type = 'PHOTO';
        mesh.userData.idx = i;

        const border = new THREE.Mesh(borderGeo, borderMat);
        border.position.z = -0.2; 
        mesh.add(border);
        
        initParticle(mesh, 'PHOTO', i);
        scene.add(mesh);
        particles.push(mesh);
        photos.push(mesh); 
    });
}

function initParticle(mesh, type, idx) {
    const h = Math.random();
    const angle = h * Math.PI * 25 + idx * 0.1; 
    const r = (1.05 - h) * 40; 
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
        const textMat = new THREE.MeshBasicMaterial({ color: CONFIG.colors.gold });
        const settings = { font: font, size: 5, height: 1.0, curveSegments: 12 };

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
                tScale.multiplyScalar(inputState.zoomLevel); 
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

// ================= 5. MediaPipe (无Alert防崩版) =================
// 这个函数现在极其谨慎，任何错误都会静默处理，绝不弹窗
async function initMediaPipeSafe() {
    const video = document.getElementById('input_video');
    
    // 1. 基础API检查
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        enableMouseMode("MOUSE MODE (NO API)");
        return;
    }

    // 2. 物理设备检查：如果没有摄像头设备，直接切鼠标，不调用Camera库
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = devices.some(device => device.kind === 'videoinput');
        if (!hasCamera) {
            enableMouseMode("MOUSE MODE (NO CAM)");
            return;
        }
    } catch (e) {
        enableMouseMode("MOUSE MODE (ENUM FAIL)");
        return;
    }

    // 3. 只有确认有设备了，才加载 MediaPipe
    try {
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
                const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
                inputState.isPinch = pinchDist < 0.05;
                if (inputState.isPinch) {
                    let scale = (pinchDist - 0.02) * 40.0;
                    inputState.zoomLevel = Math.max(1.5, Math.min(8.0, scale));
                }
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