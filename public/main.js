import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

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
        red: 0xC41E3A,    // 圣诞红
        green: 0x2F4F4F,  // 深绿
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
    isPinch: false
};

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

// 占位图生成
function createPlaceholderTexture(idx) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 680;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#eee'; ctx.fillRect(0,0,512,680);
    ctx.fillStyle = '#333'; ctx.fillRect(20,20,472,472);
    ctx.font = '40px Arial'; ctx.fillStyle = '#000'; ctx.textAlign = 'center';
    ctx.fillText(`Loading...`, 256, 600);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

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
            if (key.match(/\.(jpg|jpeg|png)$/i) && !key.endsWith('/')) {
                imageList.push(key);
            }
        }
        if (imageList.length === 0) throw new Error("No images found");
        
        if(loaderText) loaderText.innerText = `FOUND ${imageList.length} MOMENTS`;
        
    } catch (e) {
        console.warn("Using fallback mode", e);
        if(loaderText) loaderText.innerText = "OFFLINE MODE";
        for(let i=1; i<=6; i++) imageList.push(`christa/${i}.jpg`);
    }

    initThree();
    initMediaPipe(); 
}

// ================= 2. 交互逻辑 (修复) =================

function getIntersectedPhoto(clientX, clientY) {
    const mv = new THREE.Vector2();
    mv.x = (clientX / window.innerWidth) * 2 - 1;
    mv.y = -(clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mv, camera);
    // 检测所有照片对象 (photos 数组里存的是 Group)
    const intersects = raycaster.intersectObjects(photos, true);

    if (intersects.length > 0) {
        // 向上寻找直到找到 Group 根节点
        let obj = intersects[0].object;
        while (obj) {
            if (obj.userData && obj.userData.type === 'PHOTO') return obj;
            obj = obj.parent;
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
    
    // 只有未锁定时才显示高亮光标
    if (!inputState.mouseLockedPhoto) {
        const hit = getIntersectedPhoto(event.clientX, event.clientY);
        document.body.style.cursor = hit ? 'pointer' : 'default';
    }
}

function onGlobalMouseDown(event) {
    if (event.button !== 0) return; // 左键

    const targetPhoto = getIntersectedPhoto(event.clientX, event.clientY);

    if (targetPhoto) {
        // --- 点击了照片 ---
        inputState.mouseLockedPhoto = true;
        activePhotoIdx = targetPhoto.userData.idx;
        inputState.isFist = false; 
        updateStatusText("MEMORY LOCKED", "#00ffff");
    } else {
        // --- 点击了空白处 ---
        if (inputState.mouseLockedPhoto) {
            // 如果之前锁定了，现在解锁
            inputState.mouseLockedPhoto = false;
            activePhotoIdx = -1;
            updateStatusText("GALAXY MODE");
        } else {
            // 如果没锁定，开始聚合
            inputState.isFist = true;
            updateStatusText("FORMING TREE", "#FFD700");
        }
    }
}

function onGlobalMouseUp(event) {
    // 只有在没锁定照片时，松开鼠标才停止聚合
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
    scene.fog = new THREE.FogExp2(0x000000, 0.001);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = CONFIG.camZ;

    renderer = new THREE.WebGLRenderer({ antialias: true, stencil: false, depth: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // 使用 AcesFilmic 色调映射，让高光更柔和
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1; 
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambient);
    const mainLight = new THREE.DirectionalLight(0xFFF5E1, 3);
    mainLight.position.set(20, 50, 50);
    scene.add(mainLight);
    const centerLight = new THREE.PointLight(0xFFD700, 5, 150);
    scene.add(centerLight);
    
    // 后期辉光 (Bloom)
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.2; // 提高阈值，防止照片发光
    bloomPass.strength = 1.5; 
    bloomPass.radius = 0.5;
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    createChristmasObjects();
    createMerryChristmas();

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mousedown', onGlobalMouseDown);
    window.addEventListener('mouseup', onGlobalMouseUp);
    // 右键辅助
    window.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        inputState.mouseLockedPhoto = false;
        inputState.isFist = false;
        activePhotoIdx = -1;
        updateStatusText("GALAXY MODE");
    });
    window.addEventListener('resize', onWindowResize);
    
    animate();
}

// ================= 核心：生成圣诞元素 (代码建模) =================
function createChristmasObjects() {
    // 1. 材质库
    // 物理材质用于装饰物，产生金属光泽
    const matGold = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.gold, metalness: 0.8, roughness: 0.2, emissive: CONFIG.colors.emissiveGold, emissiveIntensity: 0.2 });
    const matRed = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.6, roughness: 0.3, emissive: 0x550000, emissiveIntensity: 0.2 });
    const matGreen = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.green, metalness: 0.2, roughness: 0.8 }); // 哑光绿
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }); // 绒毛感
    const matCandyRed = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.2 }); // 糖果红
    const matCandyWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, emissive: 0x222222 }); // 糖果白(微亮)

    // 2. 批量生成装饰粒子
    for(let i=0; i<CONFIG.particleCount; i++) {
        let mesh;
        const type = Math.random();

        if (type < 0.3) {
            // [球体] 金/红
            const geo = new THREE.SphereGeometry(1.2, 16, 16);
            mesh = new THREE.Mesh(geo, Math.random()>0.5 ? matGold : matRed);
        } else if (type < 0.5) {
            // [礼物盒] 正方体 + 十字丝带
            const group = new THREE.Group();
            const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), Math.random()>0.5 ? matRed : matGreen);
            // 丝带
            const ribbon1 = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.4, 2.1), matGold);
            const ribbon2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.1, 2.1), matGold);
            group.add(box); group.add(ribbon1); group.add(ribbon2);
            mesh = group;
        } else if (type < 0.7) {
            // [糖果棍] 简单的红白相间圆柱
            const group = new THREE.Group();
            const segHeight = 0.8;
            for(let j=0; j<4; j++) {
                const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, segHeight, 8), j%2===0 ? matCandyRed : matCandyWhite);
                cyl.position.y = (j - 1.5) * segHeight;
                group.add(cyl);
            }
            mesh = group;
            mesh.rotation.z = Math.random() * Math.PI; // 随机倒
        } else if (type < 0.85) {
            // [圣诞帽] 圆锥 + 圆环
            const group = new THREE.Group();
            const cone = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.5, 16), matRed);
            const brim = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.4, 8, 16), matWhite);
            brim.position.y = -1.2; brim.rotation.x = Math.PI/2;
            const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5), matWhite);
            ball.position.y = 1.25;
            group.add(cone); group.add(brim); group.add(ball);
            mesh = group;
        } else {
            // [星星] 金色八面体
            mesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.5), matGold);
        }

        // 随机缩放
        const s = 0.8 + Math.random() * 0.5;
        mesh.scale.set(s,s,s);
        
        initParticle(mesh, 'DECOR', i);
        scene.add(mesh);
        particles.push(mesh);
    }

    // === 3. 生成照片 (修复版) ===
    // 边框几何体
    const frameGeo = new THREE.BoxGeometry(9.6, 12.6, 0.5); 
    // 边框材质：使用 Standard 材质，emissive 设为黑，防止发光
    const frameMat = new THREE.MeshStandardMaterial({
        color: 0xB8860B, // 暗金色
        metalness: 0.6,
        roughness: 0.4,
        emissive: 0x000000 
    });

    const photoGeo = new THREE.PlaneGeometry(9, 12);

    imageList.forEach((filename, i) => {
        // 照片容器 Group
        const group = new THREE.Group();
        group.userData.type = 'PHOTO'; // 标记在 Group 上
        group.userData.idx = i;

        // 照片本体 (MeshBasicMaterial 确保原本色彩)
        const mat = new THREE.MeshBasicMaterial({ 
            map: createPlaceholderTexture(i), 
            side: THREE.DoubleSide 
        });
        const photoMesh = new THREE.Mesh(photoGeo, mat);
        photoMesh.position.z = 0.26; // 稍微在边框前面一点点

        // 边框
        const border = new THREE.Mesh(frameGeo, frameMat);
        border.position.z = 0;

        group.add(border);
        group.add(photoMesh);

        // 异步加载真实图片
        const url = CONFIG.publicBaseUrl + filename;
        textureLoader.load(url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            mat.map = tex; 
            mat.needsUpdate = true;
        });

        initParticle(group, 'PHOTO', i);
        scene.add(group);
        particles.push(group);
        photos.push(group); // 存入 photos 供射线检测
    });
}

function initParticle(mesh, type, idx) {
    const h = Math.random();
    // 树形：圆锥
    const angle = h * Math.PI * 20 + idx * 0.1; 
    const r = (1.0 - h) * 45 + 2; 
    const treePos = new THREE.Vector3(Math.cos(angle)*r, (h-0.5)*CONFIG.treeHeight, Math.sin(angle)*r);
    
    // 散开：球形
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
            color: CONFIG.colors.gold, metalness: 0.9, roughness: 0.2,
            emissive: CONFIG.colors.emissiveGold, emissiveIntensity: 0.6,
            clearcoat: 1.0
        });
        const settings = { font: font, size: 5, height: 1.2, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.1, bevelSegments: 3 };

        const merryGeo = new TextGeometry('MERRY', settings);
        const chrisGeo = new TextGeometry('CHRISTMAS', settings);
        merryGeo.center(); chrisGeo.center();

        const mMesh = new THREE.Mesh(merryGeo, textMat); mMesh.position.y = 6;
        const cMesh = new THREE.Mesh(chrisGeo, textMat); cMesh.position.y = -4;

        const group = new THREE.Group();
        group.add(mMesh); group.add(cMesh);

        const explodePos = new THREE.Vector3(0, CONFIG.treeHeight + 60, 0);
        group.userData = {
            treePos: new THREE.Vector3(0, CONFIG.treeHeight/2 + 15, 0),
            explodePos: explodePos, rotSpeed: {x:0,y:0.01,z:0},
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
        
        // 旋转
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
                // Group 需要重置旋转才能正对
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
            
            const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
            inputState.isPinch = pinchDist < 0.05;
            
            if (inputState.isFist || inputState.isPinch) {
                inputState.mouseLockedPhoto = false;
            }
        }
    });

    const cam = new Camera(video, {
        onFrame: async () => { await hands.send({image: video}); },
        width: 640, height: 480
    });
    
    // 静默处理摄像头失败
    cam.start()
        .then(() => {
            isCameraMode = true;
            document.getElementById('hint-cam').classList.add('active');
            document.getElementById('hint-mouse').classList.remove('active');
            const loader = document.getElementById('loader');
            if(loader) { loader.style.opacity = 0; setTimeout(() => loader.remove(), 500); }
        })
        .catch(err => {
            // 失败时不 Alert，直接切模式
            enableMouseMode("CAMERA NOT AVAILABLE");
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