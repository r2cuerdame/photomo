document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const mainCanvas = document.getElementById('main-canvas');
    const mainCtx = mainCanvas.getContext('2d');
    const uiCanvas = document.getElementById('ui-canvas');
    const uiCtx = uiCanvas.getContext('2d');
    
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    const btnSave = document.getElementById('btn-save');
    const btnCompare = document.getElementById('btn-compare');
    const fileMain = document.getElementById('file-upload-main');
    const fileToolbar = document.getElementById('file-upload-toolbar');
    const emptyState = document.getElementById('empty-state');
    const toolBtns = document.querySelectorAll('.tool-btn');
    const intensityInput = document.getElementById('intensity');
    const intensityVal = document.getElementById('intensity-val');
    const brushSizeInput = document.getElementById('brush-size');
    const brushSizeVal = document.getElementById('brush-size-val');
    const brushSizeContainer = document.getElementById('brush-size-container');
    
    // State
    let originalImage = null;
    let imageLoaded = false;
    let history = [];
    let redoStack = [];
    let currentTool = 'rect'; // 'rect' or 'brush'
    
    // Drawing State
    let isDrawing = false;
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    
    // Offscreen Mask Canvas
    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d');

    // Setup Tools
    toolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toolBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTool = btn.dataset.tool;
            if (currentTool === 'brush') {
                brushSizeContainer.style.display = 'flex';
            } else {
                brushSizeContainer.style.display = 'none';
            }
        });
    });

    // Intensity & Size Change
    intensityInput.addEventListener('input', (e) => {
        intensityVal.textContent = e.target.value;
    });
    brushSizeInput.addEventListener('input', (e) => {
        brushSizeVal.textContent = e.target.value;
    });

    // File Upload Handlers
    fileMain.addEventListener('change', handleImageUpload);
    fileToolbar.addEventListener('change', handleImageUpload);

    function handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                originalImage = img;
                initCanvas(img);
                imageLoaded = true;
                
                // Reset state
                history = [];
                redoStack = [];
                updateButtons();
                
                emptyState.classList.add('hidden');
                btnSave.disabled = false;
                btnCompare.disabled = false;
                
                showToast('사진을 불러왔습니다.');
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    function initCanvas(img) {
        // Find max size to fit within wrapper while maintaining aspect ratio
        const wrapper = document.querySelector('.canvas-wrapper');
        const maxWidth = wrapper.clientWidth || window.innerWidth * 0.95;
        const maxHeight = wrapper.clientHeight || window.innerHeight * 0.7;
        
        // We will set the internal resolution to match the image exactly,
        // CSS will handle scaling it down to fit.
        const width = img.width;
        const height = img.height;
        
        mainCanvas.width = width;
        mainCanvas.height = height;
        uiCanvas.width = width;
        uiCanvas.height = height;
        maskCanvas.width = width;
        maskCanvas.height = height;
        
        mainCtx.drawImage(img, 0, 0);
    }

    // Canvas Interaction
    function getMousePos(evt) {
        const rect = uiCanvas.getBoundingClientRect();
        const scaleX = uiCanvas.width / rect.width;
        const scaleY = uiCanvas.height / rect.height;
        
        let clientX = evt.clientX;
        let clientY = evt.clientY;
        
        if (evt.touches && evt.touches.length > 0) {
            clientX = evt.touches[0].clientX;
            clientY = evt.touches[0].clientY;
        }

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function startDraw(e) {
        if (!imageLoaded) return;
        e.preventDefault(); // Prevent scrolling on touch
        
        const pos = getMousePos(e);
        startX = pos.x;
        startY = pos.y;
        currentX = pos.x;
        currentY = pos.y;
        isDrawing = true;
        
        // Clear mask
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
        
        if (currentTool === 'brush') {
            const size = parseInt(brushSizeInput.value);
            
            // Setup UI Brush
            uiCtx.lineCap = 'round';
            uiCtx.lineJoin = 'round';
            uiCtx.lineWidth = size;
            uiCtx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
            uiCtx.beginPath();
            uiCtx.moveTo(startX, startY);
            uiCtx.lineTo(startX, startY);
            uiCtx.stroke();
            
            // Setup Mask Brush
            maskCtx.lineCap = 'round';
            maskCtx.lineJoin = 'round';
            maskCtx.lineWidth = size;
            maskCtx.strokeStyle = 'rgba(0, 0, 0, 1)';
            maskCtx.beginPath();
            maskCtx.moveTo(startX, startY);
            maskCtx.lineTo(startX, startY);
            maskCtx.stroke();
        }
    }

    function draw(e) {
        if (!isDrawing) return;
        e.preventDefault();
        
        const pos = getMousePos(e);
        currentX = pos.x;
        currentY = pos.y;
        
        if (currentTool === 'rect') {
            uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
            uiCtx.fillStyle = 'rgba(99, 102, 241, 0.2)';
            uiCtx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
            uiCtx.lineWidth = 2;
            
            const w = currentX - startX;
            const h = currentY - startY;
            
            uiCtx.fillRect(startX, startY, w, h);
            uiCtx.strokeRect(startX, startY, w, h);
        } else if (currentTool === 'brush') {
            uiCtx.lineTo(currentX, currentY);
            uiCtx.stroke();
            
            maskCtx.lineTo(currentX, currentY);
            maskCtx.stroke();
        }
    }

    function endDraw(e) {
        if (!isDrawing) return;
        e.preventDefault();
        isDrawing = false;
        
        uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
        
        const w = currentX - startX;
        const h = currentY - startY;
        
        // If it's a tiny click, do nothing
        if (currentTool === 'rect' && Math.abs(w) < 5 && Math.abs(h) < 5) return;
        
        saveState();
        
        if (currentTool === 'rect') {
            maskCtx.fillStyle = 'rgba(0,0,0,1)';
            maskCtx.fillRect(startX, startY, w, h);
        }
        
        applyMosaic();
    }

    // Attach events for mouse and touch
    uiCanvas.addEventListener('mousedown', startDraw);
    uiCanvas.addEventListener('mousemove', draw);
    uiCanvas.addEventListener('mouseup', endDraw);
    uiCanvas.addEventListener('mouseout', (e) => {
        if (isDrawing) endDraw(e);
    });

    uiCanvas.addEventListener('touchstart', startDraw, { passive: false });
    uiCanvas.addEventListener('touchmove', draw, { passive: false });
    uiCanvas.addEventListener('touchend', endDraw, { passive: false });
    uiCanvas.addEventListener('touchcancel', endDraw, { passive: false });

    // Prevent Double-Tap Zoom and Default Context Menu
    document.addEventListener('dblclick', function(event) {
        event.preventDefault();
    }, { passive: false });
    
    // Prevent zooming on iOS Safari when double tapping
    let lastTouchEnd = 0;
    document.addEventListener('touchend', function(event) {
        const now = (new Date()).getTime();
        if (now - lastTouchEnd <= 300) {
            event.preventDefault();
        }
        lastTouchEnd = now;
    }, { passive: false });

    // Mosaic Application
    function applyMosaic() {
        const w = mainCanvas.width;
        const h = mainCanvas.height;
        const intensity = parseInt(intensityInput.value);
        
        // Create full mosaic
        const smallC = document.createElement('canvas');
        const scW = Math.ceil(w / intensity);
        const scH = Math.ceil(h / intensity);
        smallC.width = scW;
        smallC.height = scH;
        smallC.getContext('2d').drawImage(mainCanvas, 0, 0, scW, scH);
        
        const mosaicC = document.createElement('canvas');
        mosaicC.width = w;
        mosaicC.height = h;
        const mCtx = mosaicC.getContext('2d');
        mCtx.imageSmoothingEnabled = false;
        mCtx.drawImage(smallC, 0, 0, scW, scH, 0, 0, scW * intensity, scH * intensity);
        
        // Apply mask
        const finalC = document.createElement('canvas');
        finalC.width = w;
        finalC.height = h;
        const fCtx = finalC.getContext('2d');
        
        fCtx.drawImage(maskCanvas, 0, 0);
        fCtx.globalCompositeOperation = 'source-in';
        fCtx.drawImage(mosaicC, 0, 0);
        
        // Draw to main canvas
        mainCtx.drawImage(finalC, 0, 0);
    }

    // Undo / Redo System
    function saveState() {
        history.push(mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height));
        // Keep max 20 history states
        if (history.length > 20) history.shift();
        redoStack = [];
        updateButtons();
    }

    btnUndo.addEventListener('click', () => {
        if (history.length > 0) {
            redoStack.push(mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height));
            const prevState = history.pop();
            mainCtx.putImageData(prevState, 0, 0);
            updateButtons();
        }
    });

    btnRedo.addEventListener('click', () => {
        if (redoStack.length > 0) {
            history.push(mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height));
            const nextState = redoStack.pop();
            mainCtx.putImageData(nextState, 0, 0);
            updateButtons();
        }
    });

    function updateButtons() {
        btnUndo.disabled = history.length === 0;
        btnRedo.disabled = redoStack.length === 0;
    }

    // Compare Original
    let compareTimeout;
    
    function showOriginal() {
        if (!imageLoaded || !originalImage) return;
        uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
        uiCtx.drawImage(originalImage, 0, 0, uiCanvas.width, uiCanvas.height);
        btnCompare.classList.add('active');
    }
    
    function hideOriginal() {
        if (!imageLoaded) return;
        uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
        btnCompare.classList.remove('active');
    }

    btnCompare.addEventListener('mousedown', showOriginal);
    btnCompare.addEventListener('mouseup', hideOriginal);
    btnCompare.addEventListener('mouseleave', hideOriginal);
    
    btnCompare.addEventListener('touchstart', (e) => { e.preventDefault(); showOriginal(); }, { passive: false });
    btnCompare.addEventListener('touchend', (e) => { e.preventDefault(); hideOriginal(); }, { passive: false });
    btnCompare.addEventListener('touchcancel', hideOriginal);

    // Save Image
    btnSave.addEventListener('click', async () => {
        if (!imageLoaded) return;
        
        try {
            const fileName = `photomo_${new Date().getTime()}.png`;
            const dataUrl = mainCanvas.toDataURL('image/png');
            
            // Try using Web Share API (Better for Mobile)
            if (navigator.share) {
                try {
                    // Convert DataURL to File object
                    const res = await fetch(dataUrl);
                    const blob = await res.blob();
                    const file = new File([blob], fileName, { type: 'image/png' });
                    
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            files: [file],
                            title: 'PhotoMo 이미지 저장',
                        });
                        showToast('공유/저장 메뉴가 열렸습니다.');
                        return; // Exit if share is successful
                    }
                } catch (err) {
                    console.log('Share API failed or was cancelled', err);
                    // Fallback to normal download
                }
            }
            
            // Fallback for Desktop or if Share API fails
            const link = document.createElement('a');
            link.download = fileName;
            link.href = dataUrl;
            link.click();
            showToast('사진이 다운로드 폴더에 저장되었습니다.');
        } catch (e) {
            showToast('저장 중 오류가 발생했습니다.');
            console.error(e);
        }
    });

    // Toast Utility
    function showToast(msg) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }
});
