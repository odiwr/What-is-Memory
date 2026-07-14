import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// 1. Scene Setup
const canvas = document.querySelector('#webgl-canvas');
const scene = new THREE.Scene();

// 2. Camera Setup
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
};
const camera = new THREE.PerspectiveCamera(45, sizes.width / sizes.height, 0.1, 1000);
camera.position.set(0, 0, 15);
scene.add(camera);

// 3. Renderer Setup
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true, // Transparent to show the CSS background
    antialias: true
});
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// 4. Placeholder InstancedMesh (To be populated with brainData.json later)
// Using a basic Tetrahedron to mimic the "Dala" style geometry
const geometry = new THREE.TetrahedronGeometry(0.1, 0);
const material = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });

// Setting up 1000 instances temporarily
const instanceCount = 1000; 
const instancedMesh = new THREE.InstancedMesh(geometry, material, instanceCount);

// Randomly scatter the placeholder instances
const dummy = new THREE.Object3D();
for (let i = 0; i < instanceCount; i++) {
    dummy.position.x = (Math.random() - 0.5) * 10;
    dummy.position.y = (Math.random() - 0.5) * 10;
    dummy.position.z = (Math.random() - 0.5) * 10;
    
    // Add random rotation to each shape
    dummy.rotation.x = Math.random() * Math.PI;
    dummy.rotation.y = Math.random() * Math.PI;
    
    dummy.updateMatrix();
    instancedMesh.setMatrixAt(i, dummy.matrix);
}
scene.add(instancedMesh);

// 5. Animation Loop
const clock = new THREE.Clock();

const tick = () => {
    const elapsedTime = clock.getElapsedTime();

    // Macro rotation for the entire brain structure
    instancedMesh.rotation.y = elapsedTime * 0.05;
    instancedMesh.rotation.x = Math.sin(elapsedTime * 0.1) * 0.1;

    renderer.render(scene, camera);
    window.requestAnimationFrame(tick);
};

tick();

// 6. Handle Window Resizing
window.addEventListener('resize', () => {
    sizes.width = window.innerWidth;
    sizes.height = window.innerHeight;

    camera.aspect = sizes.width / sizes.height;
    camera.updateProjectionMatrix();

    renderer.setSize(sizes.width, sizes.height);
});