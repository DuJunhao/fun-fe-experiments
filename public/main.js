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
    ctx.fillStyle = '#111'; ctx.fillRect(0,0,512,680);
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 10; ctx.strokeRect(20,20,472,640);
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
        console.warn("Using offline mode", e);
        if(loaderText) loaderText.innerText = "OFFLINE MODE";
        for(let i=1; i<=6; i++) imageList.push(`christa/${i}.jpg`);
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
    
    if (!inputState.mouseLockedPhoto) {
        const hit = getIntersectedPhoto(event.clientX, event.clientY);
        document.body.style.cursor = hit ? 'pointer' : 'default';
        if(hit) {
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
    const leafTex = createCrossTexture('#90EE90', '#006400');
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
    const candyGeo = new THREE.CylinderGeometry(0.3, 0.3, 3.5, 12); 
    const starGeo = new THREE.OctahedronGeometry(1.8); 
    const topStarGeo = new THREE.OctahedronGeometry(4.5);
    const lightBulbGeo = new THREE.SphereGeometry(0.6, 8, 8);

    const hatConeGeo = new THREE.ConeGeometry(1.2, 3, 16);
    const hatBrimGeo = new THREE.TorusGeometry(1.2, 0.3, 12, 24);
    const stockLegGeo = new THREE.CylinderGeometry(0.8, 0.8, 2.5, 12);
    const stockFootGeo = new THREE.CylinderGeometry(0.8, 0.9, 1.5, 12);

    const baseCount = CONFIG.particleCount - 150; 
    
    // 1. 普通装饰
    for(let i=0; i<baseCount; i++) {
        let mesh;
        const type = Math.random();

        if (type < 0.60) {
            mesh = new THREE.Mesh(leafGeo, matLeaf);
            mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
            mesh.scale.setScalar(0.8 + Math.random() * 0.5);
            initParticle(mesh, 'LEAF', i);
        } else {
            if (type < 0.70) {
                mesh = new THREE.Mesh(sphereGeo, Math.random() > 0.5 ? matGold : matRedShiny);
            } else if (type < 0.80) {
                mesh = new THREE.Mesh(giftGeo, matGift);
                mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
            } else if (type < 0.88) {
                mesh = new THREE.Mesh(candyGeo, matCandy);
                mesh.rotation.set((Math.random()-0.5),(Math.random()-0.5), Math.random()*Math.PI);
            } else if (type < 0.93) {
                mesh = new THREE.Mesh(starGeo, matGold);
                mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, 0);
            } else if (type < 0.97) {
                const group = new THREE.Group();
                const cone = new THREE.Mesh(hatConeGeo, matRedShiny);
                const brim = new THREE.Mesh(hatBrimGeo, matWhite);
                brim.position.y = -1.5; brim.rotation.x = Math.PI/2;
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
            if(!mesh.isGroup) mesh.scale.setScalar(scaleVar);
            initParticle(mesh, 'DECOR', i);
        }
        scene.add(mesh);
        particles.push(mesh);
    }

    // 2. 灯带
   const ribbonCount = 600; 
    const ribbonGeo = new THREE.BoxGeometry(2.5, 0.4, 0.8); // 扁长方体模拟光带片段
    // 使用高亮发光材质
    const matRibbon = new THREE.MeshBasicMaterial({ 
        color: 0xFFD700, // 金色
    }); 

    for(let i = 0; i < ribbonCount; i++) {
        const mesh = new THREE.Mesh(ribbonGeo, matRibbon);
        
        // 标记类型为 RIBBON，稍后在动画中会用到这个标记来隐藏它
        initParticle(mesh, 'RIBBON', i + 10000); 

        // --- 螺旋数学计算 ---
        const progress = i / ribbonCount; 
        
        // 圈数：例如 6 圈 (6 * 2PI)
        const angle = progress * Math.PI * 12; 
        
        // 高度：从下往上
        const y = (progress - 0.5) * CONFIG.treeHeight; 
        
        // 半径：随着高度升高，半径变小 (圆锥形)
        // 底部半径约 50，顶部半径约 2
        const radius = (1.0 - progress) * 45 + 5; 

        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        // 设置树形态的目标位置
        mesh.userData.treePos.set(x, y, z);
        
        // --- 关键：计算朝向让光带平滑 ---
        // 计算下一个点的坐标，让当前粒子“看向”下一个点，形成连贯的带子
        const nextProgress = (i + 1) / ribbonCount;
        const nextAngle = nextProgress * Math.PI * 12;
        const nextY = (nextProgress - 0.5) * CONFIG.treeHeight;
        const nextRadius = (1.0 - nextProgress) * 45 + 5;
        const nextPos = new THREE.Vector3(
            Math.cos(nextAngle) * nextRadius, 
            nextY, 
            Math.sin(nextAngle) * nextRadius
        );
        
        mesh.lookAt(nextPos);
        
        // 修正旋转，让扁平面朝外 (根据具体几何体轴向微调，这里通常不需要大改，或者转90度)
        // BoxGeometry默认不需要额外旋转即可形成带状，如有扭曲可调整下方代码：
        // mesh.rotateZ(Math.PI / 2); 

        // 存储计算好的旋转角度，以便在组成树的时候恢复
        mesh.userData.treeRot = mesh.rotation.clone();

        scene.add(mesh);
        particles.push(mesh);
    }

    // 3. 树顶星星
    const topStarMesh = new THREE.Mesh(topStarGeo, matTopStar);
    initParticle(topStarMesh, 'TOP_STAR', 20000);
    // 强制位于最顶端
    topStarMesh.userData.treePos.set(0, CONFIG.treeHeight / 2 + 2, 0);
    topStarMesh.userData.rotSpeed = {x: 0, y: 0.02, z: 0};
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
        group.userData = {type: 'PHOTO', idx: i, hoverScale: 1.0};
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
    const treePos = new THREE.Vector3(Math.cos(angle)*r, (h-0.5)*CONFIG.treeHeight, Math.sin(angle)*r);
    
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
            type: 'TEXT', treePos: new THREE.Vector3(0, CONFIG.treeHeight/2 + 18, 0),
            explodePos: explodePos, rotSpeed: {x:0, y:0.01, z:0},
            baseScale: new THREE.Vector3(1,1,1), randomPhase: 0
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
    ctx.fillRect(center - thickness/2, 0, thickness, size);
    ctx.fillRect(0, center - thickness/2, size, thickness);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter; 
    return tex;
}

// ================= 4. 动画循环 =================
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
    
    // 1. 【修改点】降低公转速度 (0.0005 比之前的 0.0025 慢很多)
    // 并且我们不再旋转整个 scene，而是累加这个角度，手动算粒子位置
    globalRot -= 0.0005; 

    // 2. 鼠标上下移动控制俯仰角 (X轴) 依然保留作用于 scene
    const targetRotX = (inputState.y - 0.5) * 0.5;
    scene.rotation.x += (targetRotX - scene.rotation.x) * 0.05;
    
    // 确保 scene.rotation.y 归零，因为我们改为手动旋转粒子了
    scene.rotation.y = 0; 

    particles.forEach(mesh => {
        const data = mesh.userData;
        let tPos = new THREE.Vector3();
        let tScale = data.baseScale.clone(); // 获取基础缩放
        
        // 粒子自转 (原有逻辑)
        mesh.rotation.x += data.rotSpeed.x;
        mesh.rotation.y += data.rotSpeed.y;

        // --- A. 计算“基准位置” ---
        if (targetState === 'TREE') {
            tPos.copy(data.treePos);
            
            // 如果是光带，不需要上下浮动，也不需要自转，需要保持连贯
            if (data.type === 'RIBBON') {
                 // 恢复到初始计算的旋转角度，保证光带平滑
                 if (data.treeRot) mesh.rotation.copy(data.treeRot);
            } else {
                 // 其他装饰物保持原有浮动效果
                 tPos.y += Math.sin(time*2 + data.randomPhase) * 1.0; 
            }
            
            if(data.type === 'PHOTO') tScale.multiplyScalar(0.6); 
        } 
        else if (targetState === 'EXPLODE') {
            // ... (原有逻辑) ...
            tPos.copy(data.explodePos);
            tPos.x += Math.sin(time*0.5 + data.randomPhase)*2; 
            tPos.y += Math.cos(time*0.5 + data.randomPhase)*2;
        }
        else if (targetState === 'PHOTO') {
            // ... (原有逻辑) ...
            if (data.type === 'PHOTO' && data.idx === activePhotoIdx) {
                // ...
            } else {
                tPos.copy(data.explodePos).multiplyScalar(2.0); 
            }
        }

        // ==========================================
        // 新增修改：控制光带的显隐
        // ==========================================
        if (data.type === 'RIBBON') {
            if (targetState === 'TREE') {
                // 在树形态下，保持原大
                tScale.set(1, 1, 1);
            } else {
                // 在分散(EXPLODE) 或 照片(PHOTO) 模式下，直接隐藏
                tScale.set(0, 0, 0);
            }
        }
        // ==========================================

        // ... (后续原有的 B. 应用公转 & lerp 逻辑保持不变) ...
        
        const isActivePhoto = (targetState === 'PHOTO' && data.type === 'PHOTO' && data.idx === activePhotoIdx);

        if (isActivePhoto) {
            // ... (原有逻辑) ...
            tPos.set(0, 0, CONFIG.camZ - 50); 
            mesh.lookAt(camera.position); 
            mesh.rotation.set(0, 0, 0);
            tScale.multiplyScalar(inputState.zoomLevel); 
        } else {
            // ... (原有逻辑) ...
            tPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), globalRot);
            
            if (data.type === 'PHOTO' && targetState !== 'PHOTO') {
                 tScale.multiplyScalar(data.hoverScale);
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
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        enableMouseMode("MOUSE MODE (NO API)");
        return;
    }
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
    try {
        const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
        hands.setOptions({maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6});

        hands.onResults(results => {
            if (!isCameraMode) return; 
            if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                const lm = results.multiHandLandmarks[0];
                if (activePhotoIdx === -1) {
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
                    const now = Date.now();
                    if (now - inputState.lastPinchTime > 1000 && activePhotoIdx === -1) {
                        activePhotoIdx = Math.floor(Math.random() * photos.length);
                        inputState.lastPinchTime = now;
                    }
                    let scale = (pinchDist - 0.02) * 40.0;
                    inputState.zoomLevel = Math.max(1.5, Math.min(8.0, scale));
                }
                if (inputState.isFist) activePhotoIdx = -1;
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