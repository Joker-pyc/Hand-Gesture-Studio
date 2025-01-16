let handPose;
let video;
let hands = [];
let isDrawing = false;
let drawingPath = [];
let mainCanvas;
let drawingBuffer;
let lastDrawTime = 0;
const DRAW_THROTTLE = 16;
const MIN_STROKE_WEIGHT = 2;
const MAX_STROKE_WEIGHT = 40;
const SMOOTHING_FACTOR = 0.5;
let lastX = 0;
let lastY = 0;
let currentStrokeWeight = 4;

// Three.js variables
let scene, camera, renderer, controls;
let handMeshes = [];
let isWireframe = false;
let deviceHeight = window.innerHeight;
let deviceWidth = window.innerWidth+ deviceHeight/1.5;


const CONFIG = {
    canvas: {
        width: deviceWidth,
        height: deviceHeight
    },
    handpose: {
        backend: 'webgl',
        maxHands: 2,
        detectionConfidence: 0.8,
        trackingConfidence: 0.8
    },
    drawing: {
        strokeColor: [255, 0, 0],
        pointSize: 10
    },
    landmarks: {
        connections: [
            [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
            [0, 5], [5, 6], [6, 7], [7, 8], // Index
            [5, 9], [9, 10], [10, 11], [11, 12], // Middle
            [9, 13], [13, 14], [14, 15], [15, 16], // Ring
            [13, 17], [17, 18], [18, 19], [19, 20], // Pinky
            [0, 17], [5, 9], [9, 13], [13, 17] // Palm
        ]
    }
};

function preload() {
    handPose = ml5.handPose(CONFIG.handpose);
}

function resizeCanvas() {
  CONFIG.canvas.width = window.innerWidth;
  CONFIG.canvas.height = window.innerHeight;
  mainCanvas.size(CONFIG.canvas.width, CONFIG.canvas.height);
  drawingBuffer.resizeCanvas(CONFIG.canvas.width, CONFIG.canvas.height);
}

window.addEventListener('resize', resizeCanvas);

function setup() {
    const canvas = createCanvas(CONFIG.canvas.width, CONFIG.canvas.height);
    canvas.parent('canvas-container');
    drawingBuffer = createGraphics(CONFIG.canvas.width, CONFIG.canvas.height);
    setupVideo();
    initializeHandPose();
    setupThreeJS();
    drawingBuffer.smooth();

    // Setup UI controls
    document.getElementById('toggle-wireframe').addEventListener('click', toggleWireframe);
    document.getElementById('reset-view').addEventListener('click', resetCamera);
}

function setupThreeJS() {
    // Initialize Three.js scene
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, 340/340, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(340, 340);
    document.getElementById('threejs-container').appendChild(renderer.domElement);

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 10, 10);
    scene.add(directionalLight);

    // Setup camera and controls
    camera.position.set(0, 0, 30);
 

    // Create hand meshes
    for (let i = 0; i < CONFIG.handpose.maxHands; i++) {
        const handGeometry = new THREE.SphereGeometry(0.5, 32, 32);
        const handMaterial = new THREE.MeshPhongMaterial({
            color: i === 0 ? 0x00ff00 : 0xffff00,
            wireframe: isWireframe
        });
        const joints = [];
        for (let j = 0; j < 21; j++) {
            const mesh = new THREE.Mesh(handGeometry, handMaterial);
            scene.add(mesh);
            joints.push(mesh);
        }
        handMeshes.push(joints);
    }

    animate();
}

function animate() {
    requestAnimationFrame(animate);
   
    renderer.render(scene, camera);
}

function updateHandMeshes() {
    if (!hands.length) return;

    hands.forEach((hand, index) => {
        const joints = handMeshes[index];
        const keypoints = hand.keypoints;

        keypoints.forEach((point, i) => {
            // Convert 2D coordinates to 3D space
            const x = (point.x - CONFIG.canvas.width/2) * 0.05;
            const y = -(point.y - CONFIG.canvas.height/2) * 0.05;
            const z = 0;

            joints[i].position.set(x, y, z);
        });

        // Update camera to face the hand center
        const centerPoint = getHandCenter(keypoints);
        const targetPosition = new THREE.Vector3(
            (centerPoint.x - CONFIG.canvas.width/2) * 0.05,
            -(centerPoint.y - CONFIG.canvas.height/2) * 0.05,
            0
        );
        camera.lookAt(targetPosition);
    });
}

function getHandCenter(keypoints) {
    const palm = keypoints[0];
    const middle = keypoints[9];
    return {
        x: (palm.x + middle.x) / 2,
        y: (palm.y + middle.y) / 2
    };
}

function toggleWireframe() {
    isWireframe = !isWireframe;
    handMeshes.forEach(joints => {
        joints.forEach(mesh => {
            mesh.material.wireframe = isWireframe;
        });
    });
}

function resetCamera() {
    camera.position.set(0, 0, 30);
    camera.lookAt(0, 0, 0);
    controls.reset();
}

function setupVideo() {
    video = createCapture(VIDEO);
    video.size(CONFIG.canvas.width, CONFIG.canvas.height);
    video.hide();
}

function initializeHandPose() {
    handPose.detectStart(video, (results) => {
        hands = results;
        updateStatusPanel();
        updateHandMeshes();
    });
}

function updateStatusPanel() {
    const drawingStatus = document.getElementById('drawing-status');
    const sizeStatus = document.getElementById('size-status');
    
    drawingStatus.textContent = `Drawing: ${isDrawing ? 'Active' : 'Inactive'}`;
    sizeStatus.textContent = `Stroke Size: ${Math.round(currentStrokeWeight)}`;
    
    drawingStatus.previousElementSibling.style.background = 
        isDrawing ? '#4CAF50' : '#ff4444';
}

function draw() {
    push();
    translate(width, 0);
    scale(-1, 1);
    image(video, 0, 0, width, height);
    pop();

    image(drawingBuffer, 0, 0);

    if (hands.length > 0) {
        hands.forEach((hand, index) => {
            drawHandLandmarks(hand, index);
        });
        processHands();
    }
}

function drawHandLandmarks(hand, index) {
    const keypoints = hand.keypoints;
    
    // Draw connections
    push();
    stroke(index === 0 ? '#00ff00' : '#ffff00');
    strokeWeight(2);
    
    CONFIG.landmarks.connections.forEach(([i, j]) => {
        const [x1, y1] = [width - keypoints[i].x, keypoints[i].y];
        const [x2, y2] = [width - keypoints[j].x, keypoints[j].y];
        line(x1, y1, x2, y2);
    });
    pop();

    // Draw landmarks
    push();
    fill(index === 0 ? '#00ff00' : '#ffff00');
    noStroke();
    keypoints.forEach(point => {
        circle(width - point.x, point.y, 5);
    });
    pop();
}

function processHands() {
    const drawingHand = hands[0];
    processDrawingHand(drawingHand);

    if (hands.length > 1) {
        const controlHand = hands[1];
        processControlHand(controlHand);
    }
}

function processDrawingHand(hand) {
    const indexTip = hand.keypoints[8];
    const adjustedPosition = createVector(width - indexTip.x, indexTip.y);
    
    const isDrawingPosition = checkDrawingPosition(hand);
    handleDrawing(isDrawingPosition, adjustedPosition);
}

function processControlHand(hand) {
    const thumb = hand.keypoints[4];
    const index = hand.keypoints[8];
    
    const distance = dist(thumb.x, thumb.y, index.x, index.y);
    const newWeight = map(distance, 20, 200, MIN_STROKE_WEIGHT, MAX_STROKE_WEIGHT);
    currentStrokeWeight = lerp(currentStrokeWeight, 
        constrain(newWeight, MIN_STROKE_WEIGHT, MAX_STROKE_WEIGHT), 0.1);
}

function checkDrawingPosition(hand) {
    const indexTip = hand.keypoints[8].y;
    const indexMCP = hand.keypoints[5].y;
    const middleTip = hand.keypoints[12].y;
    
    return (indexTip < indexMCP) && (middleTip > indexMCP);
}

function handleDrawing(isDrawingPosition, position) {
    const currentTime = millis();
    
    if (isDrawingPosition) {
        if (!isDrawing) {
            startNewDrawing(position);
        } else if (currentTime - lastDrawTime > DRAW_THROTTLE) {
            continueDrawing(position);
        }
    } else {
        isDrawing = false;
    }
}

function startNewDrawing(position) {
    isDrawing = true;
    drawingPath = [];
    lastX = position.x;
    lastY = position.y;
    drawingPath.push(createVector(position.x, position.y));
}

function continueDrawing(position) {
    const smoothX = lerp(lastX, position.x, SMOOTHING_FACTOR);
    const smoothY = lerp(lastY, position.y, SMOOTHING_FACTOR);
    
    drawingBuffer.push();
    drawingBuffer.stroke(...CONFIG.drawing.strokeColor);
    drawingBuffer.strokeWeight(currentStrokeWeight);
    drawingBuffer.line(lastX, lastY, smoothX, smoothY);
    drawingBuffer.pop();
    
    lastX = smoothX;
    lastY = smoothY;
    lastDrawTime = millis();
    
    drawingPath.push(createVector(smoothX, smoothY));
}

function keyPressed() {
    if (key === 'c' || key === 'C') {
        clearCanvas();
    }
}

function clearCanvas() {
    drawingBuffer.clear();
    drawingPath = [];
    isDrawing = false;
}

function windowResized() {
    resizeCanvas(CONFIG.canvas.width, CONFIG.canvas.height);
}