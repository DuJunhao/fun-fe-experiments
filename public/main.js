import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

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
        emissiveGold: 0xAA8800
    }
};

// ================= 全局变量 =================
let scene, camera, renderer, composer;
let particles = []; 
let photos = []; // 存储照片Mesh，用于射线检测
let targetState = 'EXPLODE'; 
let activePhotoIdx = -1;
let imageList = []; 
let isCameraMode = false;

const raycaster = new THREE.Raycaster();
const mouseVector = new THREE.Vector2();

// 输入状态
const inputState = {
    x: 0.5, y: 0.5,
    isFist: false,        // 聚合信号
    mouseLockedPhoto: false // 锁定信号
};

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

// ================= 1. 启动入口 =================
async function fetchBucketPhotos() {
    const loaderText = document.getElementById('loader-text');
    try {
        if(loaderText) loaderText.innerText = "SCANNING CLOUD MEMORIES...";
        
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
        console.warn("Using offline mode", e);
        if(loaderText) loaderText.innerText = "USING OFFLINE MODE";
        for(let i=1; i<=6; i++) imageList.push(`christa/${i}.jpg`);
    }

    initThree();
    initMediaPipe(); 
}

// ================= 2. 核心交互逻辑 (重写修复版) =================

// 辅助函数：根据鼠标位置，强制检测有没有点到照片
// 返回找到的 Photo Mesh，如果没找到返回 null
function getIntersectedPhoto(clientX, clientY) {
    // 1. 转换鼠标坐标
    const mv = new THREE.Vector2();
    mv.x = (clientX / window.innerWidth) * 2 - 1;
    mv.y = -(clientY / window.innerHeight) * 2 + 1;

    // 2. 发射射线
    raycaster.setFromCamera(mv, camera);
    // recursive: true 确保即使点到边框(子物体)也能检测到
    const intersects = raycaster.intersectObjects(photos, true);

    if (intersects.length > 0) {
        let hitObj = intersects[0].object;
        
        // 3. 向上查找：如果你点到了边框，就找它的父级（照片主体）
        // 我们的照片结构是 Mesh(Photo) -> Children(Border)
        // 所以如果 hitObj 没有 userData.type，就看看它的 parent
        if (hitObj.userData && hitObj.userData.type === 'PHOTO') {
            return hitObj;
        } else if (hitObj.parent && hitObj.parent.userData && hitObj.parent.userData.type === 'PHOTO') {
            return hitObj.parent;
        }
    }
    return null;
}

function onGlobalMouseMove(event) {
    // 更新鼠标位置用于视角旋转
    mouseVector.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouseVector.y = -(event.clientY / window.innerHeight) * 2 + 1;

    if (!isCameraMode) {
        inputState.x = event.clientX / window.innerWidth;
        inputState.y = event.clientY / window.innerHeight;
    }
    
    // 鼠标悬停高亮逻辑 (仅视觉效果，不影响逻辑)
    // 只有在没锁定的情况下才高亮，省资源
    if (!inputState.mouseLockedPhoto) {
        const hit = getIntersectedPhoto(event.clientX, event.clientY);
        if (hit) {
            document.body.style.cursor = 'pointer';
            // 简单的临时高亮
            hit.children.forEach(c => {
                if(c.material && c.material.emissive) c.material.emissiveIntensity = 2.0;
            });
        } else {
            document.body.style.cursor = 'default';
            // 恢复所有照片亮度 (粗略恢复，防止卡住)
            photos.forEach(p => {
                p.children.forEach(c => {
                    if(c.material && c.material.emissive) c.material.emissiveIntensity = 0.8;
                });
            });
        }
    }
}

function onGlobalMouseDown(event) {
    if (event.button !== 0) return; // 只左键

    // 【核心修复】点击瞬间，立刻重新检测点到了谁
    // 不依赖 mousemove 的缓存，确保精准
    const targetPhoto = getIntersectedPhoto(event.clientX, event.clientY);

    if (targetPhoto) {
        // --- 场景 A：确实点到了照片 ---
        console.log("Locked Photo:", targetPhoto.userData.idx);
        inputState.mouseLockedPhoto = true; // 开启锁定模式
        activePhotoIdx = targetPhoto.userData.idx; // 记录 ID
        inputState.isFist = false; // 强制关闭聚合
        updateStatusText("MEMORY LOCKED", "#00ffff");
    } else {
        // --- 场景 B：点到了空白处 ---
        if (inputState.mouseLockedPhoto) {
            // 如果之前是锁定状态 -> 现在解锁
            inputState.mouseLockedPhoto = false;
            activePhotoIdx = -1;
            updateStatusText("GALAXY MODE");
        } else {
            // 如果之前没锁定 -> 开始聚合 (长按)
            inputState.isFist = true;
            updateStatusText("FORMING TREE", "#FFD700");
        }
    }
}

function onGlobalMouseUp(event) {
    // 只有在“非锁定”状态下，松开鼠标才取消聚合
    // 这样如果你锁定了照片，松开鼠标照片依然会在面前
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
    container.appendChild(renderer.domElement);

    // 灯光
    const ambient = new THREE.AmbientLight(0x111111, 1);
    scene.add(ambient);
    const mainLight = new THREE.DirectionalLight(0xFFF5E1, 3);
    mainLight.position.set(50, 50, 50);
    scene.add(mainLight);
    const centerLight = new THREE.PointLight(0xFFD700, 5, 150);
    scene.add(centerLight);
    
    // 后期辉光
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.05; bloomPass.strength = 1.6; bloomPass.radius = 0.5;
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    createObjects();
    createMerryChristmas();

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mousedown', onGlobalMouseDown);
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('resize', onWindowResize);
    
    animate();
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

function createObjects() {
    const matGold = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.gold, metalness: 1.0, roughness: 0.2, emissive: CONFIG.colors.emissiveGold, emissiveIntensity: 0.3 });
    const matRed = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.6, roughness: 0.3, emissive: CONFIG.colors.red, emissiveIntensity: 0.2 });

    // 装饰球
    const sphereGeo = new THREE.SphereGeometry(1.2, 16, 16);
    for(let i=0; i<CONFIG.particleCount; i++) {
        const mat = Math.random() > 0.5 ? matGold : matRed;
        const mesh = new THREE.Mesh(sphereGeo, mat);
        initParticle(mesh, 'DECOR', i);
        scene.add(mesh);
        particles.push(mesh);
    }

    // 照片
    const photoGeo = new THREE.PlaneGeometry(9, 12);
    const borderGeo = new THREE.BoxGeometry(9.4, 12.4, 0.5); // 边框略大
    const borderMat = matGold.clone(); borderMat.emissiveIntensity = 0.8;
    
    imageList.forEach((filename, i) => {
        const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
        const url = CONFIG.publicBaseUrl + filename;
        
        textureLoader.load(url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            mat.map = tex; mat.needsUpdate = true;
        });

        const mesh = new THREE.Mesh(photoGeo, mat);
        const border = new THREE.Mesh(borderGeo, borderMat);
        border.position.z = -0.1; // 边框稍微靠后一点，避免Z-fighting，但也可能挡住点击
        mesh.add(border); // 边框是子物体
        
        initParticle(mesh, 'PHOTO', i);
        scene.add(mesh);
        particles.push(mesh);
        photos.push(mesh); // 存入 photos 数组用于检测
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

// ================= 4. 动画循环 (修复状态机) =================
function updateLogic() {
    // 优先级: 锁定照片 > 握拳/长按 > 默认散开
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
        
        // 自转
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
            // 查看照片模式
            if (data.type === 'PHOTO' && data.idx === activePhotoIdx) {
                // 是选中的这张：飞到脸前
                tPos.set(0, 0, CONFIG.camZ - 40); 
                mesh.lookAt(camera.position); 
                mesh.rotation.set(0,0,0);
                tScale.multiplyScalar(3.5); 
            } else {
                // 其他的：全部退散
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

// ================= 5. MediaPipe (容错) =================
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
        } else {
            if(isCameraMode) inputState.isFist = false;
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