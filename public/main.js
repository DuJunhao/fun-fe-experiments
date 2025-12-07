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
let photos = [];
let targetState = 'EXPLODE'; 
let activePhotoIdx = -1;
let imageList = []; 
let isCameraMode = false; // 标记是否使用摄像头

const raycaster = new THREE.Raycaster();
const mouseVector = new THREE.Vector2();
let hoveredPhoto = null;

const inputState = {
    x: 0.5, y: 0.5,
    isFist: false,        // 聚合信号
    mouseLockedPhoto: false, // 是否锁定查看照片
    isPinch: false
};

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

// ================= 1. 数据获取 (启动入口) =================
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
        console.warn("XML Load failed, using fallback.", e);
        if(loaderText) loaderText.innerText = "USING OFFLINE MODE";
        // 备用数据，防止白屏
        for(let i=1; i<=6; i++) imageList.push(`christa/${i}.jpg`);
    }

    // 数据准备好后，启动 3D 场景和摄像头
    initThree();
    initMediaPipe(); 
}

// ================= 2. 交互逻辑 (已修复) =================
function onGlobalMouseMove(event) {
    mouseVector.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouseVector.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // 如果没摄像头，或者在鼠标模式下，更新 inputState
    if (!isCameraMode) {
        inputState.x = event.clientX / window.innerWidth;
        inputState.y = event.clientY / window.innerHeight;
    }
    
    // 只有在未锁定的情况下才进行射线检测（节省性能，防止跳变）
    if (!inputState.mouseLockedPhoto) {
        checkIntersection();
    }
}

function checkIntersection() {
    raycaster.setFromCamera(mouseVector, camera);
    const intersects = raycaster.intersectObjects(photos);

    if (intersects.length > 0) {
        if (hoveredPhoto !== intersects[0].object) {
            // 恢复上一个高亮
            if(hoveredPhoto) hoveredPhoto.children[0].material.emissiveIntensity = 1;
            
            hoveredPhoto = intersects[0].object;
            document.body.style.cursor = 'pointer';
            hoveredPhoto.children[0].material.emissiveIntensity = 4; // 高亮选中
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
    if (event.button !== 0) return; // 只响应左键

    if (hoveredPhoto) {
        // [情况1] 点击了照片 -> 强制锁定
        inputState.mouseLockedPhoto = true;
        activePhotoIdx = hoveredPhoto.userData.idx;
        inputState.isFist = false; // 确保不触发聚合
        updateStatusText("MEMORY LOCKED", "#00ffff");
    } else {
        // [情况2] 点击了空白处
        if (inputState.mouseLockedPhoto) {
            // 如果之前是锁定的 -> 解锁
            inputState.mouseLockedPhoto = false;
            activePhotoIdx = -1;
            updateStatusText("GALAXY MODE");
        } else {
            // 如果之前没锁定 -> 开始聚合 (长按效果)
            inputState.isFist = true;
            updateStatusText("FORMING TREE", "#FFD700");
        }
    }
}

function onGlobalMouseUp(event) {
    // 只有在没锁定照片时，松开鼠标才取消聚合
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
    container.appendChild(renderer.domElement);

    // 灯光
    const ambient = new THREE.AmbientLight(0x111111, 1);
    scene.add(ambient);
    const mainLight = new THREE.DirectionalLight(0xFFF5E1, 3);
    mainLight.position.set(50, 50, 50);
    scene.add(mainLight);
    const centerLight = new THREE.PointLight(0xFFD700, 5, 150);
    scene.add(centerLight);
    
    // 辉光后期
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.05; bloomPass.strength = 1.6; bloomPass.radius = 0.5;
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    createObjects();
    createMerryChristmas(); // 创建高级文字

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mousedown', onGlobalMouseDown);
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('resize', onWindowResize);
    
    animate();
}

// --- 高级感 3D 文字 ---
function createMerryChristmas() {
    const loader = new FontLoader();
    loader.load('https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json', function (font) {
        
        // 奢华金材质
        const textMat = new THREE.MeshPhysicalMaterial({
            color: CONFIG.colors.gold,
            metalness: 1.0, 
            roughness: 0.15,
            emissive: CONFIG.colors.emissiveGold, 
            emissiveIntensity: 0.6,
            clearcoat: 1.0
        });

        const settings = {
            font: font, size: 5, height: 1.2, 
            curveSegments: 12, bevelEnabled: true, 
            bevelThickness: 0.3, bevelSize: 0.15, bevelSegments: 3
        };

        const merryGeo = new TextGeometry('MERRY', settings);
        const chrisGeo = new TextGeometry('CHRISTMAS', settings);
        
        // 居中
        merryGeo.computeBoundingBox();
        chrisGeo.computeBoundingBox();
        const mOff = -0.5 * (merryGeo.boundingBox.max.x - merryGeo.boundingBox.min.x);
        const cOff = -0.5 * (chrisGeo.boundingBox.max.x - chrisGeo.boundingBox.min.x);

        const mMesh = new THREE.Mesh(merryGeo, textMat);
        mMesh.position.set(mOff, 6, 0);

        const cMesh = new THREE.Mesh(chrisGeo, textMat);
        cMesh.position.set(cOff, -4, 0);

        const group = new THREE.Group();
        group.add(mMesh);
        group.add(cMesh);

        // 位置设定
        const treeTop = new THREE.Vector3(0, CONFIG.treeHeight/2 + 18, 0);
        const explodePos = new THREE.Vector3(0, CONFIG.treeHeight + 50, 0); // 散开时在正上方高处

        group.userData = {
            type: 'TEXT',
            treePos: treeTop,
            explodePos: explodePos,
            rotSpeed: {x:0, y:0.01, z:0},
            baseScale: new THREE.Vector3(1,1,1),
            randomPhase: 0
        };

        group.position.copy(explodePos);
        scene.add(group);
        particles.push(group);
    });
}

function createObjects() {
    // 材质
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
    const borderGeo = new THREE.BoxGeometry(9.4, 12.4, 0.5);
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
        border.position.z = -0.3;
        mesh.add(border);
        
        initParticle(mesh, 'PHOTO', i);
        scene.add(mesh);
        particles.push(mesh);
        photos.push(mesh);
    });
}

function initParticle(mesh, type, idx) {
    // 树形：圆锥螺旋
    const h = Math.random();
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

    mesh.userData = {
        type, idx, treePos, explodePos,
        rotSpeed: {x:Math.random()*0.02, y:Math.random()*0.02, z:Math.random()*0.02},
        baseScale: mesh.scale.clone(),
        randomPhase: Math.random() * 10
    };
    mesh.position.copy(explodePos);
}

// ================= 4. 动画循环 =================
function updateLogic() {
    // 状态机优先级: 鼠标锁定 > 手势/长按聚合 > 默认散开
    if (inputState.mouseLockedPhoto) {
        targetState = 'PHOTO';
    } else if (inputState.isFist) {
        targetState = 'TREE';
    } else {
        targetState = 'EXPLODE';
    }

    const time = Date.now() * 0.001;
    
    // 场景随鼠标轻微转动 (在非锁定状态下)
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
        
        // 自身旋转
        mesh.rotation.x += data.rotSpeed.x;
        mesh.rotation.y += data.rotSpeed.y;

        if (targetState === 'TREE') {
            tPos.copy(data.treePos);
            // 呼吸效果
            tPos.y += Math.sin(time*2 + data.randomPhase) * 1.0; 
            // 树上的照片变小一点，避免遮挡
            if(data.type === 'PHOTO') tScale.multiplyScalar(0.6); 
        } 
        else if (targetState === 'EXPLODE') {
            tPos.copy(data.explodePos);
            // 漂浮效果
            tPos.x += Math.sin(time*0.5 + data.randomPhase)*2; 
            tPos.y += Math.cos(time*0.5 + data.randomPhase)*2;
        }
        else if (targetState === 'PHOTO') {
            if (data.type === 'PHOTO' && data.idx === activePhotoIdx) {
                // 选中的照片：飞到屏幕正前方
                tPos.set(0, 0, CONFIG.camZ - 40); 
                mesh.lookAt(camera.position); // 朝向相机
                mesh.rotation.set(0,0,0);     // 停止自转
                tScale.multiplyScalar(3.5);   // 放大
            } else {
                // 其他物体：退后并散开
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

// ================= 5. MediaPipe (错误处理版) =================
function initMediaPipe() {
    const video = document.getElementById('input_video');
    
    // 1. 检查浏览器是否支持
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn("Browser API not supported");
        enableMouseMode("MOUSE MODE ACTIVE");
        return;
    }

    const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
    hands.setOptions({maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6});

    hands.onResults(results => {
        if (!isCameraMode) return; 

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const lm = results.multiHandLandmarks[0];
            
            // 只有没锁定照片时，手势才能控制视角
            if (!inputState.mouseLockedPhoto) {
                inputState.x = 1.0 - lm[9].x; 
                inputState.y = lm[9].y;
            }

            // 握拳检测
            const tips = [8, 12, 16, 20];
            let avgDist = 0;
            tips.forEach(i => avgDist += Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y));
            
            // 握拳触发聚合
            inputState.isFist = (avgDist / 4) < 0.22;
        } else {
            // 没有手时取消握拳状态
            if(isCameraMode) inputState.isFist = false;
        }
    });

    const cam = new Camera(video, {
        onFrame: async () => { await hands.send({image: video}); },
        width: 640, height: 480
    });
    
    // 2. 尝试启动摄像头，被拒绝或失败则切鼠标模式
    cam.start()
        .then(() => {
            isCameraMode = true;
            document.getElementById('hint-cam').classList.add('active');
            document.getElementById('hint-mouse').classList.remove('active');
            // 移除加载动画
            const loader = document.getElementById('loader');
            if(loader) {
                loader.style.opacity = 0;
                setTimeout(() => loader.remove(), 500);
            }
        })
        .catch(err => {
            console.error("Camera Init Failed (User denied or no cam):", err);
            enableMouseMode("CAMERA FAILED - MOUSE MODE");
        });
}

function enableMouseMode(msg) {
    isCameraMode = false;
    updateStatusText(msg);
    document.getElementById('hint-cam').classList.remove('active');
    document.getElementById('hint-mouse').classList.add('active');
    
    const loader = document.getElementById('loader');
    if(loader) {
        loader.style.opacity = 0;
        setTimeout(() => loader.remove(), 500);
    }
}

// ================= 启动 =================
fetchBucketPhotos();