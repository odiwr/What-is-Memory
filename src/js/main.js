import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; // Added GLTFLoader

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

gsap.registerPlugin(ScrollTrigger);

// 1. Core Setup
const canvas = document.querySelector('#webgl-canvas');
const scene = new THREE.Scene();
const sizes = { width: window.innerWidth, height: window.innerHeight };
const camera = new THREE.PerspectiveCamera(45, sizes.width / sizes.height, 0.1, 1000);
camera.position.set(0, 0, 15);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const palette = ['#3a7a59', '#57179e', '#cc9b2c', '#cc9b2c', '#cc9b2c', '#cc9b2c', '#1948bd', '#e2d2eb'].map(hex => new THREE.Color(hex));

// --- POST-PROCESSING PIPELINE ---
const composer = new EffectComposer(renderer);

// 1. Render the base 3D scene
const renderScene = new RenderPass(scene, camera);
composer.addPass(renderScene);

// 2. Add Bloom (Glow Aura)
// INCREASED: threshold (0.5) so dim things don't glow, radius (0.8) for combined glow
const bloomPass = new UnrealBloomPass(new THREE.Vector2(sizes.width, sizes.height), .8, 0.8, .3);
composer.addPass(bloomPass);

// 3. Custom Dot Overlay Shader Pass
const DotOverlayShader = {
    uniforms: {
        tDiffuse: { value: null }, // The previously rendered frame (Scene + Bloom)
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(sizes.width, sizes.height) }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform vec2 uResolution;
        varying vec2 vUv;

        // Pseudo-random noise function for the jitter
        float random(vec2 st) {
            return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
        }

        void main() {
            // Get the base scene colors
            vec4 sceneColor = texture2D(tDiffuse, vUv);
            
            // Calculate how bright this specific pixel is
            float luminance = dot(sceneColor.rgb, vec3(0.299, 0.587, 0.114));

            // Set up a grid for the dots
            vec2 screenCoord = vUv * uResolution;
            float dotScale = 4.0; // Increase this to make the dots larger

            // Create a fast, microscopic jitter effect 
            // Snaps the time to discrete steps so it looks like film grain/analog jitter
            float timeStep = floor(uTime * 12.0); 
            vec2 jitter = vec2(
                (random(vUv + timeStep) - 0.5) * 2.5,
                (random(vUv - timeStep) - 0.5) * 2.5
            );

            // Apply jitter to the grid
            vec2 gridUv = (screenCoord + jitter) / dotScale;
            vec2 localUv = fract(gridUv) - 0.5;

            // Draw a soft circle inside each grid cell
            float dotShape = 1.0 - smoothstep(0.1, 0.35, length(localUv));

            // MASKING: Only make the dots visible if the scene underneath is bright (glowing)
            // The brighter the 3D scene, the more opaque the dots become
            float dotVisibility = smoothstep(0.1, 0.8, luminance);
            
            // Mix the white dots with the scene based on the mask
            vec3 finalColor = sceneColor.rgb + (vec3(1.0) * dotShape * dotVisibility * 0.4);

            gl_FragColor = vec4(finalColor, sceneColor.a);
        }
    `
};

const dotPass = new ShaderPass(DotOverlayShader);
composer.addPass(dotPass);
// --------------------------------

// Update your core setup area:
const cameraGroup = new THREE.Group();
scene.add(cameraGroup);
cameraGroup.add(camera);

// Mouse tracking variables
const cursor = { x: 0, y: 0 };
let targetX = 0;
let targetY = 0;
const windowHalfX = sizes.width / 2;
const windowHalfY = sizes.height / 2;

// Ensure pointer-events are configured correctly in CSS so the canvas receives this
window.addEventListener('mousemove', (event) => {
    cursor.x = (event.clientX - windowHalfX) * 0.0005; // Adjust multiplier for sensitivity
    cursor.y = (event.clientY - windowHalfY) * 0.0005;
});

// 2. Triangle Geometry
const r = 0.04;
const thickness = 0.01;
const v0 = new THREE.Vector3(r, r, r);
const v1 = new THREE.Vector3(-r, -r, r);
const v2 = new THREE.Vector3(-r, r, -r);
const v3 = new THREE.Vector3(r, -r, -r);
const edges = [[v0, v1], [v0, v2], [v0, v3], [v1, v2], [v1, v3], [v2, v3]];
const edgeGeometries = [];

edges.forEach(edge => {
    const start = edge[0];
    const end = edge[1];
    const distance = start.distanceTo(end);
    const cylinder = new THREE.CylinderGeometry(thickness, thickness, distance, 3);
    const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const axis = new THREE.Vector3().subVectors(end, start).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    cylinder.applyQuaternion(quaternion);
    cylinder.translate(center.x, center.y, center.z);
    edgeGeometries.push(cylinder);
});

const baseGeometry = mergeGeometries(edgeGeometries);
const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });

// 3. Custom GPU Shaders
const customUniforms = {
    uTime: { value: 0 },
    uFormProgress: { value: 0 }
};

material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = customUniforms.uTime;
    shader.uniforms.uFormProgress = customUniforms.uFormProgress;

    shader.vertexShader = `
        uniform float uTime;
        uniform float uFormProgress;
        attribute float aRotationSpeed;
        attribute vec3 aRotationAxis;
        attribute vec3 aRandomOffset; 
        
        mat4 rotationMatrix(vec3 axis, float angle) {
            axis = normalize(axis);
            float s = sin(angle);
            float c = cos(angle);
            float oc = 1.0 - c;
            return mat4(oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s, 0.0,
                        oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s, 0.0,
                        oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c, 0.0,
                        0.0, 0.0, 0.0, 1.0);
        }
    ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        
        vec4 targetWorldPos = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float dist = distance(cameraPosition, targetWorldPos.xyz);
        
        float expScale = exp(-(dist - 10.0) * 0.15); 
        float scale = clamp(expScale, 0.0, 1.0);
        
        mat4 localRot = rotationMatrix(aRotationAxis, uTime * aRotationSpeed);
        transformed = (localRot * vec4(transformed * scale, 1.0)).xyz;
        
        transformed += aRandomOffset * (1.0 - uFormProgress);
        `
    );
};
// 4. Load & Pre-Process Data
const gltfLoader = new GLTFLoader();

// Load both the Earth JSON and the custom Blender GLB simultaneously
Promise.all([
    fetch('/src/data/earthData.json').then(response => response.json()),
    gltfLoader.loadAsync('src/data/triangle.glb') // UPDATE THIS PATH
]).then(([earthData, gltf]) => {
    
    // --- EARTH DATA PROCESSING ---
    let minR = Infinity;
    earthData.forEach(p => {
        const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
        if (r < minR) minR = r;
    });

    const finalData = [];
    earthData.forEach((point, index) => {
        const r = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z);
        const isOcean = r < (minR + 0.15);

        if (isOcean) {
            if (index % 2 !== 0 || Math.random() > 0.04) return;
            const jitter = 0.6;
            finalData.push({
                x: point.x + (Math.random() - 0.5) * jitter,
                y: point.y + (Math.random() - 0.5) * jitter,
                z: point.z + (Math.random() - 0.5) * jitter
            });
        } else {
            finalData.push(point);
        }
    });

    const instanceCount = finalData.length;
    const instancedMesh = new THREE.InstancedMesh(baseGeometry, material, instanceCount);
    const rotationSpeeds = new Float32Array(instanceCount);
    const rotationAxes = new Float32Array(instanceCount * 3);
    const randomOffsets = new Float32Array(instanceCount * 3);
    const dummy = new THREE.Object3D();
    const modelScale = 1.35;

    finalData.forEach((point, i) => {
        dummy.position.set(point.x * modelScale, point.y * modelScale, point.z * modelScale);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);

        rotationSpeeds[i] = 0.5 + Math.random() * 2.0;
        const randomAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        rotationAxes[i * 3] = randomAxis.x;
        rotationAxes[i * 3 + 1] = randomAxis.y;
        rotationAxes[i * 3 + 2] = randomAxis.z;

        randomOffsets[i * 3] = (Math.random() - 0.5) * 80;
        randomOffsets[i * 3 + 1] = (Math.random() - 0.5) * 80;
        randomOffsets[i * 3 + 2] = (Math.random() - 0.5) * 80;

        // Clone the color so we don't modify the global palette array
        const baseColor = palette[Math.floor(Math.random() * palette.length)].clone();
        
        // Push the color into HDR values so it triggers the Bloom pass intensely
        baseColor.multiplyScalar(3.0); 
        instancedMesh.setColorAt(i, baseColor);
    });
    instancedMesh.instanceMatrix.needsUpdate = true;

    instancedMesh.geometry.setAttribute('aRotationSpeed', new THREE.InstancedBufferAttribute(rotationSpeeds, 1));
    instancedMesh.geometry.setAttribute('aRotationAxis', new THREE.InstancedBufferAttribute(rotationAxes, 3));
    instancedMesh.geometry.setAttribute('aRandomOffset', new THREE.InstancedBufferAttribute(randomOffsets, 3));

    const earthContainer = new THREE.Group();
    instancedMesh.rotation.z = Math.PI;
    earthContainer.add(instancedMesh);
    scene.add(earthContainer);
    window.earthMesh = earthContainer;

    // -------------------------------------------------------------------
    // FOREGROUND/BACKGROUND AMBIENT PARTICLES (USING GLB)
    // -------------------------------------------------------------------
    
    // --- EASY CONTROLS ---
    const ambientConfig = {
        count: 250,           // Total number of ambient particles
        glowIntensity: 1.9,   // Must be > 0.9 to glow. (Earth is at 3.0 for reference)
        boxX: 20,             // Total Width (Left to Right)
        boxY: 20,             // Total Height (Top to Bottom)
        boxZ: 20,             // Total Depth (Front to Back)
        centerZ: 5            // Shifts the whole box forward/backward (Camera is at Z: 15)
    };
    // ---------------------

    let particleGeom;
    gltf.scene.traverse((child) => {
        if (child.isMesh && !particleGeom) {
            particleGeom = child.geometry.clone();
            particleGeom.center(); 
        }
    });

    const uniqueAmbientPalette = ['#3a7a59', '#57179e', '#cc9b2c', '#1948bd', '#e2d2eb'].map(hex => new THREE.Color(hex));

    const particleMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending 
    });

    particleMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = customUniforms.uTime;

        shader.vertexShader = `
            uniform float uTime;
            attribute float aParticleSpeed;
            attribute vec3 aParticleAxis;
            attribute float aPhase;
            varying float vDistance;

            mat4 rotationMatrix(vec3 axis, float angle) {
                axis = normalize(axis);
                float s = sin(angle);
                float c = cos(angle);
                float oc = 1.0 - c;
                return mat4(oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s, 0.0,
                            oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s, 0.0,
                            oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c, 0.0,
                            0.0, 0.0, 0.0, 1.0);
            }
        ` + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `
            mat4 localRot = rotationMatrix(aParticleAxis, uTime * aParticleSpeed);
            vec3 localPos = (localRot * vec4(transformed, 1.0)).xyz;
            
            vec4 instanceWorldPos = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            float distToCam = distance(cameraPosition, instanceWorldPos.xyz);
            
            float oscAmount = exp(-distToCam * 0.15) * 1.5; 
            
            vec3 oscillation = vec3(
                sin(uTime * 0.05 + aPhase),
                cos(uTime * 0.04 + aPhase),
                sin(uTime * 0.06 - aPhase)
            ) * oscAmount;
            
            vec4 worldPosition = modelMatrix * instanceMatrix * vec4(localPos, 1.0);
            worldPosition.xyz += oscillation;
            
            vec4 mvPosition = viewMatrix * worldPosition;
            gl_Position = projectionMatrix * mvPosition;
            
            vDistance = -mvPosition.z; 
            `
        );

        shader.fragmentShader = `
            varying float vDistance;
        ` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            `
            #include <opaque_fragment>
            
            float depthOpacity = smoothstep(1.0, 5.0, vDistance);
            float backFade = exp(-(vDistance - 5.0) * 0.04); 
            
            float finalAlpha = depthOpacity * clamp(backFade, 0.0, 1.0) * 0.35;
            
            gl_FragColor = vec4(gl_FragColor.rgb, finalAlpha);
            `
        );
    };

    const particleMesh = new THREE.InstancedMesh(particleGeom, particleMat, ambientConfig.count);
    const pDummy = new THREE.Object3D();

    const pRotSpeeds = new Float32Array(ambientConfig.count);
    const pRotAxes = new Float32Array(ambientConfig.count * 3);
    const pPhases = new Float32Array(ambientConfig.count);

    for (let i = 0; i < ambientConfig.count; i++) {
        
        // Spawn strictly inside the X, Y, Z controls
        pDummy.position.x = (Math.random() - 0.5) * ambientConfig.boxX;
        pDummy.position.y = (Math.random() - 0.5) * ambientConfig.boxY;
        pDummy.position.z = ambientConfig.centerZ + ((Math.random() - 0.5) * ambientConfig.boxZ);

        const distFromCam = Math.abs(15 - pDummy.position.z);

        let pScale = 0.05 + (Math.random() * 0.05);  
        pScale += Math.exp(-distFromCam * 0.2) * 0.15; 

        pDummy.scale.set(pScale, pScale, pScale);
        pDummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        pDummy.updateMatrix();
        particleMesh.setMatrixAt(i, pDummy.matrix);
        
        // Apply the adjustable glow
        const ambientColor = uniqueAmbientPalette[Math.floor(Math.random() * uniqueAmbientPalette.length)].clone();
        ambientColor.multiplyScalar(ambientConfig.glowIntensity); 
        particleMesh.setColorAt(i, ambientColor);
        
        pRotSpeeds[i] = (Math.random() - 0.5) * 0.15;

        const ax = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        pRotAxes[i * 3] = ax.x;
        pRotAxes[i * 3 + 1] = ax.y;
        pRotAxes[i * 3 + 2] = ax.z;

        pPhases[i] = Math.random() * Math.PI * 2.0;
    }

    particleMesh.geometry.setAttribute('aParticleSpeed', new THREE.InstancedBufferAttribute(pRotSpeeds, 1));
    particleMesh.geometry.setAttribute('aParticleAxis', new THREE.InstancedBufferAttribute(pRotAxes, 3));
    particleMesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(pPhases, 1));

    scene.add(particleMesh);
    window.particleMesh = particleMesh;

    window.sceneStates = [
        { rotX: -1.60, rotY: 0.08, rotZ: 3.00, posX: 2.38, posY: -2.57, posZ: 3.62 },  
        { rotX: 0.2, rotY: 0, rotZ: 0, posX: -3, posY: -2.57, posZ: 3.62 },
        { rotX: 0.8, rotY: 3.14, rotZ: 0, posX: 3, posY: -2.57, posZ: 3.62 },
        { rotX: 0, rotY: -1.57, rotZ: 0, posX: -3, posY: -2.57, posZ: 3.62 },
        { rotX: 0, rotY: 3.14, rotZ: 0, posX: 3, posY: -2.57, posZ: 3.62 },
        { rotX: -0.8, rotY: 3.14, rotZ: 0, posX: -3, posY: -2.57, posZ: 3.62 },
        { rotX: -1.57, rotY: 0, rotZ: 0, posX: 3, posY: -2.57, posZ: 3.62 },
        { rotX: -0.5, rotY: 0, rotZ: 0, posX: -3, posY: -2.57, posZ: 3.62 }
    ];

    window.earthMesh.position.set(window.sceneStates[0].posX, window.sceneStates[0].posY, window.sceneStates[0].posZ);
    window.earthMesh.rotation.set(window.sceneStates[0].rotX, window.sceneStates[0].rotY, window.sceneStates[0].rotZ);

    initGSAPScrollytelling();
});

// 5. Loading Splash Screen & Assembly Animation
const splashScreen = document.getElementById('splash-screen');
const splashStatus = document.getElementById('splash-status');

setTimeout(() => {
    splashStatus.innerText = "Complete";

    gsap.to(splashScreen, {
        yPercent: -100,
        opacity: 0,
        duration: 1.2,
        ease: "power3.inOut",
        delay: 0.4,
        onComplete: () => {
            splashScreen.remove();

            gsap.to(customUniforms.uFormProgress, {
                value: 1,
                // FIX 3A: Reduced duration from 3.5 to 2.8 (1.25x faster)
                duration: 2.8,
                ease: "power2.inOut"
            });
        }
    });
}, 1500);

gsap.to('.main-header, .hero-content', {
    y: -50,
    opacity: 0,
    scrollTrigger: { trigger: ".scroll-container", start: "top top", end: "600px top", scrub: true }
});

function initGSAPScrollytelling() {
    const tl = gsap.timeline({
        // FIX 3B: Reduced scrub from 2.5 to 2.0 (1.25x faster scrolling)
        scrollTrigger: { trigger: ".scroll-container", start: "top top", end: "bottom bottom", scrub: 2.0 }
    });

    window.sceneStates.slice(1).forEach((state) => {
        tl.to(window.earthMesh.position, { x: state.posX, y: state.posY, ease: "sine.inOut" }, ">");
        tl.to(window.earthMesh.rotation, { x: state.rotX, y: state.rotY, z: state.rotZ, ease: "sine.inOut" }, "<");
    });
}

const clock = new THREE.Clock();
let previousTime = 0;

const tick = () => {
    const elapsedTime = clock.getElapsedTime();
    const deltaTime = elapsedTime - previousTime;
    previousTime = elapsedTime;

    customUniforms.uTime.value = elapsedTime;
    
    // Update the dot shader time for the jitter effect
    dotPass.uniforms.uTime.value = elapsedTime;

    // Smooth Mouse Parallax applied to the Camera Group
    targetX = cursor.x * 2;
    targetY = cursor.y * 2;

    cameraGroup.position.x += (targetX - cameraGroup.position.x) * 0.05;
    cameraGroup.position.y += (-targetY - cameraGroup.position.y) * 0.05;

    if (window.earthMesh) {
        window.earthMesh.position.y += Math.sin(elapsedTime) * 0.001;
    }

    // USE THE COMPOSER INSTEAD OF THE RENDERER
    composer.render();
    
    window.requestAnimationFrame(tick);
};

tick();


window.addEventListener('resize', () => {
    sizes.width = window.innerWidth;
    sizes.height = window.innerHeight;

    camera.aspect = sizes.width / sizes.height;
    camera.updateProjectionMatrix();

    renderer.setSize(sizes.width, sizes.height);
    
    // Update post-processing pipeline on resize
    composer.setSize(sizes.width, sizes.height);
    dotPass.uniforms.uResolution.value.set(sizes.width, sizes.height);
});
