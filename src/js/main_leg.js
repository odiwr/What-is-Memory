import * as THREE from 'three'; 
import { gsap } from 'gsap'; 
import { ScrollTrigger } from 'gsap/ScrollTrigger'; 
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'; 
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; 

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

const cameraGroup = new THREE.Group(); 
scene.add(cameraGroup); 
cameraGroup.add(camera); 

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
const bloomPass = new UnrealBloomPass(new THREE.Vector2(sizes.width, sizes.height), .8, 0.8, .3); 
composer.addPass(bloomPass); 

// 3. Custom Dot Overlay Shader Pass
const DotOverlayShader = { 
    uniforms: { 
        tDiffuse: { value: null }, 
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

        float random(vec2 st) {
            return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
        }

        void main() {
            vec4 sceneColor = texture2D(tDiffuse, vUv);
            float luminance = dot(sceneColor.rgb, vec3(0.299, 0.587, 0.114));

            vec2 screenCoord = vUv * uResolution;
            float dotScale = 4.0; 

            float timeStep = floor(uTime * 12.0); 
            vec2 jitter = vec2(
                (random(vUv + timeStep) - 0.5) * 2.5,
                (random(vUv - timeStep) - 0.5) * 2.5
            );

            vec2 gridUv = (screenCoord + jitter) / dotScale;
            vec2 localUv = fract(gridUv) - 0.5;

            float dotShape = 1.0 - smoothstep(0.1, 0.35, length(localUv));
            float dotVisibility = smoothstep(0.1, 0.8, luminance);
            
            vec3 finalColor = sceneColor.rgb + (vec3(1.0) * dotShape * dotVisibility * 0.4);

            gl_FragColor = vec4(finalColor, sceneColor.a);
        }
    ` 
}; 

const dotPass = new ShaderPass(DotOverlayShader); 
composer.addPass(dotPass); 
// --------------------------------

// Mouse tracking variables
const cursor = { x: 0, y: 0 }; 
let targetX = 0; 
let targetY = 0; 
const windowHalfX = sizes.width / 2; 
const windowHalfY = sizes.height / 2; 

window.addEventListener('mousemove', (event) => { 
    cursor.x = (event.clientX - windowHalfX) * 0.0005; 
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

// 3. Custom GPU Shaders - UPGRADED FOR PHASE 2
const customUniforms = {
    uTime: { value: 0 }, 
    uFormProgress: { value: 0 }, 
    uExplodeProgress: { value: 0 }, 
    uExplodeY: { value: -1.0 }, // NEW: Tracks the vertical sweep of the explosion
    uBlinkIntensity: { value: 0 }, 
    uDimIntensity: { value: 0.0 }, 
    uMorphToBrain: { value: 0 }, 
    uColorShift: { value: 0 }, 
    uOpacityShift: { value: 1.0 }, 
    uDissolveY: { value: -50.0 } 
};

material.onBeforeCompile = (shader) => { 
    shader.uniforms = { ...shader.uniforms, ...customUniforms }; //[cite: 19]

    // VERTEX SHADER UPDATE
    shader.vertexShader = `
        uniform float uTime; //[cite: 19]
        uniform float uFormProgress; //[cite: 19]
        uniform float uExplodeProgress; //[cite: 19]
        uniform float uExplodeY; //[cite: 19]
        uniform float uMorphToBrain; //[cite: 19]
        
        attribute float aRotationSpeed; //[cite: 19]
        attribute vec3 aRotationAxis; //[cite: 19]
        attribute vec3 aRandomOffset; //[cite: 19]
        attribute vec3 aBrainPosition; //[cite: 19]
        attribute vec3 aExplodeVector; //[cite: 19]
        attribute float aBlinkFlag; //[cite: 19]
        
        varying float vPosY; //[cite: 19]
        varying float vDist; //[cite: 19]
        varying float vBlinkFlag; //[cite: 19]
        
        mat4 rotationMatrix(vec3 axis, float angle) { //[cite: 19]
            axis = normalize(axis); //[cite: 19]
            float s = sin(angle); //[cite: 19]
            float c = cos(angle); //[cite: 19]
            float oc = 1.0 - c; //[cite: 19]
            return mat4(oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s, 0.0, //[cite: 19]
                        oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s, 0.0, //[cite: 19]
                        oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c, 0.0, //[cite: 19]
                        0.0, 0.0, 0.0, 1.0); //[cite: 19]
        } //[cite: 19]
    ` + shader.vertexShader; //[cite: 19]

    shader.vertexShader = shader.vertexShader.replace( //[cite: 19]
        '#include <begin_vertex>', //[cite: 19]
        `
        #include <begin_vertex> //[cite: 19]
        
        vBlinkFlag = aBlinkFlag; //[cite: 19]
        
        vec4 targetWorldPos = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0); //[cite: 19]
        float dist = distance(cameraPosition, targetWorldPos.xyz); //[cite: 19]
        vDist = dist; //[cite: 19]
        
        float expScale = exp(-(dist - 10.0) * 0.15);  //[cite: 19]
        float proximityScale = smoothstep(2.0, 12.0, dist); //[cite: 19]
        float scale = clamp(expScale, 0.0, 1.0) * (0.2 + 0.8 * proximityScale); //[cite: 19]
        
        mat4 localRot = rotationMatrix(aRotationAxis, uTime * aRotationSpeed); //[cite: 19]
        vec3 localTransformed = (localRot * vec4(transformed * scale, 1.0)).xyz; //[cite: 19]
        
        localTransformed += aRandomOffset * (1.0 - uFormProgress); //[cite: 19]
        vec3 targetMorphPos = mix(localTransformed, aBrainPosition + localTransformed, uMorphToBrain); //[cite: 19]
        
        // NEW: Creates a 6-unit vertical band. As uExplodeY sweeps up, vertices smoothly transition from 0.0 to 1.0
        float explodeFactor = 1.0 - smoothstep(uExplodeY - 6.0, uExplodeY, targetWorldPos.y);
        
        vec3 finalPos = targetMorphPos + (aExplodeVector * uExplodeProgress * explodeFactor); //[cite: 19]
        
        transformed = finalPos; //[cite: 19]
        
        vec4 worldPosForDissolve = modelMatrix * instanceMatrix * vec4(finalPos, 1.0); //[cite: 19]
        vPosY = worldPosForDissolve.y; //[cite: 19]
        `
    );

    // FRAGMENT SHADER UPDATE
    // (Leave your fragment shader block exactly as it is)
    shader.fragmentShader = `
        uniform float uColorShift; //[cite: 19]
        uniform float uOpacityShift; //[cite: 19]
        uniform float uBlinkIntensity; //[cite: 19]
        uniform float uDimIntensity; //[cite: 19]
        uniform float uTime; //[cite: 19]
        
        uniform float uDissolveY; //[cite: 19]
        varying float vPosY; //[cite: 19]
        varying float vDist; //[cite: 19]
        varying float vBlinkFlag; //[cite: 19]
    ` + shader.fragmentShader; //[cite: 19]

    shader.fragmentShader = shader.fragmentShader.replace( //[cite: 19]
        '#include <opaque_fragment>', //[cite: 19]
        `
        if (vPosY < uDissolveY) discard; //[cite: 19]
        
        #include <opaque_fragment> //[cite: 19]
        
        vec3 passionColor = vec3(1.0, 0.2, 0.6);  //[cite: 19]
        gl_FragColor.rgb = mix(gl_FragColor.rgb, passionColor, uColorShift); //[cite: 19]
        
        float proximityFade = smoothstep(3.0, 12.0, vDist); //[cite: 19]
        gl_FragColor.rgb *= (0.3 + 0.7 * proximityFade); //[cite: 19]
        
        float dimFactor = 1.0 - (uDimIntensity * (1.0 - vBlinkFlag)); //[cite: 19]
        gl_FragColor.rgb *= dimFactor; //[cite: 19]
        
        gl_FragColor.a *= uOpacityShift; //[cite: 19]

        float blink = (sin(uTime * 15.0) * 0.5 + 0.5) * uBlinkIntensity * vBlinkFlag; //[cite: 19]
        gl_FragColor.rgb += vec3(blink) * (0.3 + 0.7 * proximityFade); //[cite: 19]
        `
    );
};

// 4. Load & Pre-Process Data
const gltfLoader = new GLTFLoader();

Promise.all([
    fetch('/src/data/earthData.json').then(response => response.json()),
    gltfLoader.loadAsync('src/data/triangle.glb'),
    gltfLoader.loadAsync('src/data/brain.glb') 
]).then(([earthData, gltf, brainGltf]) => { 
    
    let brainGeom;
    brainGltf.scene.traverse((child) => {
        if (child.isMesh && !brainGeom) {
            brainGeom = child.geometry;
        }
    });
    
    const realBrainPositions = brainGeom.attributes.position.array;
    const brainVertexCount = realBrainPositions.length / 3;

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
    
    instancedMesh.frustumCulled = false;
    
    const rotationSpeeds = new Float32Array(instanceCount); 
    const rotationAxes = new Float32Array(instanceCount * 3); 
    const randomOffsets = new Float32Array(instanceCount * 3); 
    
    const brainPositions = new Float32Array(instanceCount * 3);
    const explodeVectors = new Float32Array(instanceCount * 3);

    const dummy = new THREE.Object3D(); 
    const modelScale = 1.35; 

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    earthData.forEach(p => {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    });
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;

    const blinkFlags = new Float32Array(instanceCount); 

    finalData.forEach((point, i) => { 
        dummy.position.set(point.x * modelScale, point.y * modelScale, point.z * modelScale); 
        dummy.updateMatrix(); 
        instancedMesh.setMatrixAt(i, dummy.matrix); 

        const brainIndex = (i % brainVertexCount) * 3; 
        const brainScale = 1.0;

        rotationSpeeds[i] = 0.5 + Math.random() * 2.0; 
        const randomAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(); 
        rotationAxes[i * 3] = randomAxis.x; 
        rotationAxes[i * 3 + 1] = randomAxis.y; 
        rotationAxes[i * 3 + 2] = randomAxis.z; 

        randomOffsets[i * 3] = (Math.random() - 0.5) * 80; 
        randomOffsets[i * 3 + 1] = (Math.random() - 0.5) * 80; 
        randomOffsets[i * 3 + 2] = (Math.random() - 0.5) * 80; 

        brainPositions[i * 3] = realBrainPositions[brainIndex] * brainScale;
        brainPositions[i * 3 + 1] = realBrainPositions[brainIndex + 1] * brainScale;
        brainPositions[i * 3 + 2] = realBrainPositions[brainIndex + 2] * brainScale;

        const v = new THREE.Vector3(point.x - centerX, point.y - centerY, point.z - centerZ).normalize();
        explodeVectors[i * 3] = v.x + (Math.random() * 0.5);
        explodeVectors[i * 3 + 1] = v.y + (Math.random() * 0.5);
        explodeVectors[i * 3 + 2] = v.z + (Math.random() * 0.5);

        const paletteIndex = Math.floor(Math.random() * palette.length);
        const baseColor = palette[paletteIndex].clone(); 
        baseColor.multiplyScalar(3.0);  
        instancedMesh.setColorAt(i, baseColor); 
        
        blinkFlags[i] = (paletteIndex === 0) ? 1.0 : 0.0;
    }); 
    instancedMesh.instanceMatrix.needsUpdate = true; 

    instancedMesh.geometry.setAttribute('aRotationSpeed', new THREE.InstancedBufferAttribute(rotationSpeeds, 1)); 
    instancedMesh.geometry.setAttribute('aRotationAxis', new THREE.InstancedBufferAttribute(rotationAxes, 3)); 
    instancedMesh.geometry.setAttribute('aRandomOffset', new THREE.InstancedBufferAttribute(randomOffsets, 3)); 
    instancedMesh.geometry.setAttribute('aBrainPosition', new THREE.InstancedBufferAttribute(brainPositions, 3));
    instancedMesh.geometry.setAttribute('aExplodeVector', new THREE.InstancedBufferAttribute(explodeVectors, 3));
    instancedMesh.geometry.setAttribute('aBlinkFlag', new THREE.InstancedBufferAttribute(blinkFlags, 1)); 

    const earthContainer = new THREE.Group(); 
    instancedMesh.rotation.z = Math.PI; 
    earthContainer.add(instancedMesh); 
    scene.add(earthContainer); 
    window.earthMesh = earthContainer; 

    window.earthMesh.position.set(2.38, -2.57, 3.62); 
    window.earthMesh.rotation.set(-1.60, 0.08, 3.00); 

    // -------------------------------------------------------------------
    // FOREGROUND/BACKGROUND AMBIENT PARTICLES (USING GLB)
    // -------------------------------------------------------------------
    
    const ambientConfig = { 
        count: 250, 
        glowIntensity: 1.9, 
        boxX: 20, 
        boxY: 20, 
        boxZ: 20, 
        centerZ: 5 
    }; 

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
        
        const ambientColor = uniqueAmbientPalette[Math.floor(Math.random() * uniqueAmbientPalette.length)].clone(); 
        ambientColor.multiplyScalar(ambientConfig.glowIntensity);  
        particleMesh.setColorAt(i, ambientColor); 
        
        pRotSpeeds[i] = (Math.random() - 0.5) * 1.5; 

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

    // 5. Memory Checking & Initialization
    const hasSeenAnimation = false; 

    if (hasSeenAnimation) {
        initImmediateEndState();
    } else {
        initSplashAndScrollytelling();
    }
}); 

function initImmediateEndState() {
    const splashScreen = document.getElementById('splash-screen');
    if (splashScreen) splashScreen.style.display = 'none';
    
    customUniforms.uFormProgress.value = 1;
    customUniforms.uMorphToBrain.value = 1; 
    customUniforms.uColorShift.value = 1.0; 
    customUniforms.uExplodeProgress.value = 0;
    
    cameraGroup.position.z = -10; 
}

function initSplashAndScrollytelling() {
    const splashScreen = document.getElementById('splash-screen'); 
    const splashStatus = document.getElementById('splash-status'); 

    setTimeout(() => { 
        if(splashStatus) splashStatus.innerText = "Complete"; 

        gsap.to(splashScreen, { 
            yPercent: -100, 
            opacity: 0, 
            duration: 1.2, 
            ease: "power3.inOut", 
            delay: 0.4, 
            onComplete: () => { 
                if(splashScreen) splashScreen.remove(); 

                gsap.to(customUniforms.uFormProgress, { 
                    value: 1, 
                    duration: 2.8, 
                    ease: "power2.inOut" 
                }); 
            } 
        }); 
    }, 1500); 

    // Phase 2 Timeline: 8 Specific Steps
    const tl = gsap.timeline({
        scrollTrigger: { 
            trigger: ".scroll-container", 
            start: "top top", 
            end: "bottom bottom", 
            scrub: 0.5,
            onLeave: () => localStorage.setItem('memoryMission_animationComplete', 'true')
        }
    });

    // Define strict timing constraints for the scroll mapped duration
    const mainDur = 1.0;
    const microDur = mainDur / 2.0;

    // Step 1: Default Current Scene (Serves as the immediate start trigger)
    tl.addLabel('step1');

    // Step 2 Setup
    tl.addLabel('step2')
      .to(customUniforms.uExplodeProgress, { value: 7.5, duration: 0.01 }, "step2") 
      // NEW: Lowered to 0.35 so the non-green vertices stay much brighter
      .to(customUniforms.uDimIntensity, { value: 0.35, ease: "none", duration: microDur * 4 }, "step2"); 

    // Micro-step 2a: Move, shrink, and explode bottom section
    tl.addLabel('step2a')
      .to(customUniforms.uExplodeY, { value: -4.0, ease: "none", duration: microDur }, 'step2a')
      .to(window.earthMesh.position, { x: 0.5, z: 4.5, ease: "none", duration: microDur }, 'step2a')
      .to(window.earthMesh.scale, { x: 0.85, y: 0.85, z: 0.85, ease: "none", duration: microDur }, 'step2a');

    // Micro-step 2b: Move, shrink, and explode lower-mid section
    tl.addLabel('step2b')
      .to(customUniforms.uExplodeY, { value: -0.5, ease: "none", duration: microDur }, 'step2b')
      .to(window.earthMesh.position, { x: -1.0, z: 5.0, ease: "none", duration: microDur }, 'step2b')
      .to(window.earthMesh.scale, { x: 0.7, y: 0.7, z: 0.7, ease: "none", duration: microDur }, 'step2b');

    // Micro-step 2c: Move, shrink, and explode upper-mid section
    tl.addLabel('step2c')
      .to(customUniforms.uExplodeY, { value: 3.0, ease: "none", duration: microDur }, 'step2c')
      .to(window.earthMesh.position, { x: -2.5, z: 5.5, ease: "none", duration: microDur }, 'step2c')
      .to(window.earthMesh.scale, { x: 0.55, y: 0.55, z: 0.55, ease: "none", duration: microDur }, 'step2c');

    // Micro-step 2d: Move, shrink, and explode top section
    tl.addLabel('step2d')
      .to(customUniforms.uExplodeY, { value: 15.0, ease: "none", duration: microDur }, 'step2d')
      .to(window.earthMesh.position, { x: -4.0, z: 6.0, ease: "none", duration: microDur }, 'step2d') // NEW: Less aggressive Z-depth
      .to(window.earthMesh.scale, { x: 0.4, y: 0.4, z: 0.4, ease: "none", duration: microDur }, 'step2d'); // NEW: Mesh shrinks as it approaches

    // Step 3: Specific nodes blinking (Movement strictly frozen)
    tl.addLabel('step3')
      .to(customUniforms.uBlinkIntensity, { value: 1.0, duration: mainDur / 4, yoyo: true, repeat: 3 }); 

    // Step 4: Reform to a brain 3D model
    tl.addLabel('step4')
      .to(customUniforms.uExplodeProgress, { value: 0, ease: "power2.in", duration: mainDur }) 
      .to(customUniforms.uMorphToBrain, { value: 1.0, ease: "power2.inOut", duration: mainDur }, "<") 
      .to(window.earthMesh.scale, { x: 1.0, y: 1.0, z: 1.0, ease: "power2.inOut", duration: mainDur }, "<") // NEW: Restores full scale for the brain
      .to(customUniforms.uDimIntensity, { value: 0.0, ease: "power2.inOut", duration: mainDur }, "<"); 

    // Step 5: Vertices low opacity
    tl.addLabel('step5')
      .to(customUniforms.uOpacityShift, { value: 0.3, ease: "power1.inOut", duration: mainDur });

    // Step 6: Explodes again (Pink passion)
    tl.addLabel('step6')
      .to(customUniforms.uColorShift, { value: 1.0, ease: "power1.inOut", duration: mainDur })
      .to(customUniforms.uExplodeProgress, { value: 8.0, ease: "expo.out", duration: mainDur }, "<");

    // Step 7: Reforms to segmented brain & colors return to normal
    tl.addLabel('step7')
      .to(customUniforms.uExplodeProgress, { value: 0, ease: "power2.in", duration: mainDur })
      .to(customUniforms.uColorShift, { value: 0.0, ease: "power2.inOut", duration: mainDur }, "<"); 

    // Step 8: Brain moves forward past camera
    tl.addLabel('step8')
      .to(cameraGroup.position, { z: -10, ease: "power2.in", duration: mainDur });
}

const clock = new THREE.Clock(); 
let previousTime = 0; 

const tick = () => { 
    const elapsedTime = clock.getElapsedTime(); 
    const deltaTime = elapsedTime - previousTime; 
    previousTime = elapsedTime; 

    customUniforms.uTime.value = elapsedTime; 
    
    dotPass.uniforms.uTime.value = elapsedTime; 

    targetX = cursor.x * 2; 
    targetY = cursor.y * 2; 

    cameraGroup.position.x += (targetX - cameraGroup.position.x) * 0.05; 
    cameraGroup.position.y += (-targetY - cameraGroup.position.y) * 0.05; 

    if (window.earthMesh) { 
        window.earthMesh.rotation.z += Math.sin(elapsedTime) * 0.0001;  
    } 

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
    
    composer.setSize(sizes.width, sizes.height); 
    dotPass.uniforms.uResolution.value.set(sizes.width, sizes.height); 
});