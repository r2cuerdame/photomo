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
    const btnResetView = document.getElementById('btn-reset-view');
    const fileMain = document.getElementById('file-upload-main');
    const fileToolbar = document.getElementById('file-upload-toolbar');
    const emptyState = document.getElementById('empty-state');
    const toolBtns = document.querySelectorAll('.tool-btn');
    const intensityInput = document.getElementById('intensity');
    const intensityVal = document.getElementById('intensity-val');
    const brushSizeInput = document.getElementById('brush-size');
    const brushSizeVal = document.getElementById('brush-size-val');
    const brushSizeContainer = document.getElementById('brush-size-container');
    const canvasInner = document.getElementById('canvas-inner');
    const canvasWrapper = document.getElementById('canvas-wrapper');

    // State
    let imageLoaded = false;
    let currentTool = 'rect'; // 'rect' or 'brush'

    // Undo / Redo (stored as small patches of the changed area, not full-canvas snapshots)
    const MAX_HISTORY = 20;
    let history = [];   // { x, y, data: ImageData }
    let redoStack = []; // { x, y, data: ImageData }

    // Snapshot of the untouched image at working resolution (used by compare)
    const originalCanvas = document.createElement('canvas');
    const originalCtx = originalCanvas.getContext('2d');

    // Drawing State
    let isDrawing = false;
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let lastX = 0;
    let lastY = 0;
    let strokeBounds = null; // dirty area of the current stroke in canvas coords

    // Pan & Zoom State
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isPinching = false;
    let initialPinchDist = 1;
    let initialScale = 1;
    let lastPanCenter = null;
    let isMousePanning = false;
    let lastMousePan = null;

    // Mosaic Buffer & Mask
    const mosaicBufferCanvas = document.createElement('canvas');
    const mosaicBufferCtx = mosaicBufferCanvas.getContext('2d');
    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d');
    let mosaicPattern = null;

    function updateTransform() {
        canvasInner.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        const transformed = scale !== 1 || panX !== 0 || panY !== 0;
        btnResetView.classList.toggle('hidden', !imageLoaded || !transformed);
    }

    function resetView() {
        scale = 1;
        panX = 0;
        panY = 0;
        updateTransform();
    }

    btnResetView.addEventListener('click', resetView);

    // Setup Tools
    toolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toolBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTool = btn.dataset.tool;
            brushSizeContainer.classList.toggle('hidden', currentTool !== 'brush');
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
        const input = e.target;
        const file = input.files && input.files[0];
        if (!file) return;

        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            initCanvas(img);
            imageLoaded = true;

            // Reset state
            history = [];
            redoStack = [];
            updateButtons();

            emptyState.classList.add('hidden');
            btnSave.disabled = false;
            btnCompare.classList.remove('hidden');
            btnCompare.disabled = false;

            showToast('사진을 불러왔습니다.');
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            showToast('이미지를 불러올 수 없습니다. 다른 파일을 선택해 주세요.');
        };
        img.src = url;

        // Allow selecting the same file again later
        input.value = '';
    }

    function initCanvas(img) {
        const MAX_DIMENSION = 1600;
        let width = img.width;
        let height = img.height;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            const ratio = width / height;
            if (width > height) {
                width = MAX_DIMENSION;
                height = MAX_DIMENSION / ratio;
            } else {
                height = MAX_DIMENSION;
                width = MAX_DIMENSION * ratio;
            }
        }

        width = Math.round(width);
        height = Math.round(height);

        mainCanvas.width = width;
        mainCanvas.height = height;
        uiCanvas.width = width;
        uiCanvas.height = height;
        maskCanvas.width = width;
        maskCanvas.height = height;
        mosaicBufferCanvas.width = width;
        mosaicBufferCanvas.height = height;
        originalCanvas.width = width;
        originalCanvas.height = height;

        mainCtx.drawImage(img, 0, 0, width, height);
        originalCtx.drawImage(img, 0, 0, width, height);

        resizeCanvasInner();
        resetView();
    }

    function resizeCanvasInner() {
        if (!imageLoaded) return;
        const wrapperW = canvasWrapper.clientWidth;
        const wrapperH = canvasWrapper.clientHeight;
        if (!wrapperW || !wrapperH) return;

        const imgRatio = mainCanvas.width / mainCanvas.height;
        const wrapperRatio = wrapperW / wrapperH;

        let displayW, displayH;
        if (imgRatio > wrapperRatio) {
            displayW = wrapperW;
            displayH = wrapperW / imgRatio;
        } else {
            displayH = wrapperH;
            displayW = wrapperH * imgRatio;
        }

        canvasInner.style.width = displayW + 'px';
        canvasInner.style.height = displayH + 'px';
    }

    // Refit whenever the surrounding layout changes (window resize, toolbar growing, etc.)
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(resizeCanvasInner).observe(canvasWrapper);
    }
    window.addEventListener('resize', resizeCanvasInner);

    // Canvas Interaction
    function getMousePos(evt) {
        const rect = uiCanvas.getBoundingClientRect();
        const scaleX = uiCanvas.width / rect.width;
        const scaleY = uiCanvas.height / rect.height;

        let clientX = evt.clientX;
        let clientY = evt.clientY;

        if (evt.touches && evt.touches.length > 0) {
            // Get position for drawing (always first touch)
            clientX = evt.touches[0].clientX;
            clientY = evt.touches[0].clientY;
        }

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function trackBounds(x, y) {
        if (!strokeBounds) {
            strokeBounds = { minX: x, minY: y, maxX: x, maxY: y };
        } else {
            if (x < strokeBounds.minX) strokeBounds.minX = x;
            if (y < strokeBounds.minY) strokeBounds.minY = y;
            if (x > strokeBounds.maxX) strokeBounds.maxX = x;
            if (y > strokeBounds.maxY) strokeBounds.maxY = y;
        }
    }

    function boundsToRect(pad) {
        if (!strokeBounds) return null;
        const x0 = Math.max(0, Math.floor(strokeBounds.minX - pad));
        const y0 = Math.max(0, Math.floor(strokeBounds.minY - pad));
        const x1 = Math.min(mainCanvas.width, Math.ceil(strokeBounds.maxX + pad));
        const y1 = Math.min(mainCanvas.height, Math.ceil(strokeBounds.maxY + pad));
        if (x1 - x0 < 1 || y1 - y0 < 1) return null;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    function generateMosaicBuffer() {
        const w = mainCanvas.width;
        const h = mainCanvas.height;
        const intensity = parseInt(intensityInput.value, 10);

        const smallC = document.createElement('canvas');
        const scW = Math.ceil(w / intensity);
        const scH = Math.ceil(h / intensity);
        smallC.width = scW;
        smallC.height = scH;
        smallC.getContext('2d').drawImage(mainCanvas, 0, 0, scW, scH);

        mosaicBufferCtx.imageSmoothingEnabled = false;
        mosaicBufferCtx.clearRect(0, 0, w, h);
        mosaicBufferCtx.drawImage(smallC, 0, 0, scW, scH, 0, 0, scW * intensity, scH * intensity);

        mosaicPattern = uiCtx.createPattern(mosaicBufferCanvas, 'no-repeat');
    }

    function renderRealtimePreviewRect(startX, startY, w, h) {
        uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
        uiCtx.fillStyle = mosaicPattern;
        uiCtx.fillRect(startX, startY, w, h);
    }

    function drawSegment(ctx, x0, y0, x1, y1) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
    }

    function cancelActiveStroke() {
        if (!isDrawing) return;
        isDrawing = false;
        strokeBounds = null;
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
    }

    function getPinchDist(e) {
        return Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        ) || 1; // guard against zero distance
    }

    function getPinchCenter(e) {
        return {
            x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
            y: (e.touches[0].clientY + e.touches[1].clientY) / 2
        };
    }

    function startDraw(e) {
        if (!imageLoaded) return;

        // Distinguish drawing vs pinch-zooming
        if (e.type.startsWith('touch')) {
            if (e.touches.length === 2) {
                cancelActiveStroke();
                isPinching = true;
                initialPinchDist = getPinchDist(e);
                initialScale = scale;
                lastPanCenter = getPinchCenter(e);
                return;
            } else if (e.touches.length > 2) {
                return;
            }
        }

        if (isPinching || isMousePanning) return;
        if (e.type === 'mousedown' && e.button !== 0) return; // only left button draws

        e.preventDefault(); // Prevent scrolling on touch

        const pos = getMousePos(e);
        startX = currentX = lastX = pos.x;
        startY = currentY = lastY = pos.y;
        isDrawing = true;
        strokeBounds = null;
        trackBounds(pos.x, pos.y);

        // Generate pre-rendered mosaic for real-time preview
        generateMosaicBuffer();

        // Clear mask and any leftover overlay (e.g. compare view)
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);

        if (currentTool === 'brush') {
            const size = parseInt(brushSizeInput.value, 10);

            // Setup UI Brush
            uiCtx.lineCap = 'round';
            uiCtx.lineJoin = 'round';
            uiCtx.lineWidth = size;
            uiCtx.strokeStyle = mosaicPattern;
            drawSegment(uiCtx, startX, startY, startX, startY);

            // Setup Mask Brush
            maskCtx.lineCap = 'round';
            maskCtx.lineJoin = 'round';
            maskCtx.lineWidth = size;
            maskCtx.strokeStyle = 'rgba(0, 0, 0, 1)';
            drawSegment(maskCtx, startX, startY, startX, startY);
        }
    }

    function draw(e) {
        if (isPinching && e.type.startsWith('touch') && e.touches.length === 2) {
            e.preventDefault();
            const currentDist = getPinchDist(e);
            const currentCenter = getPinchCenter(e);

            const rect = canvasWrapper.getBoundingClientRect();

            // Zoom center relative to the untransformed canvas box
            // (canvas-inner is flex-centered inside the wrapper, so its layout
            //  offset must be subtracted for zoom-about-point math to hold)
            const cx = currentCenter.x - rect.left - canvasInner.offsetLeft;
            const cy = currentCenter.y - rect.top - canvasInner.offsetTop;

            const scaleFactor = currentDist / initialPinchDist;
            const newScale = Math.max(0.5, Math.min(initialScale * scaleFactor, 10));

            const dx = currentCenter.x - lastPanCenter.x;
            const dy = currentCenter.y - lastPanCenter.y;

            panX = cx - (cx - panX) * (newScale / scale) + dx;
            panY = cy - (cy - panY) * (newScale / scale) + dy;
            scale = newScale;

            lastPanCenter = currentCenter;
            updateTransform();
            return;
        }

        if (!isDrawing) return;
        e.preventDefault();

        const pos = getMousePos(e);
        currentX = pos.x;
        currentY = pos.y;
        trackBounds(currentX, currentY);

        if (currentTool === 'rect') {
            // Update mask
            maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
            maskCtx.fillStyle = 'rgba(0,0,0,1)';
            const w = currentX - startX;
            const h = currentY - startY;
            maskCtx.fillRect(startX, startY, w, h);

            renderRealtimePreviewRect(startX, startY, w, h);

            // Draw high-contrast border on top of mosaic preview
            uiCtx.lineWidth = 3;
            uiCtx.setLineDash([8, 8]);

            // Draw a dark border under the white one for high contrast
            uiCtx.strokeStyle = '#000000';
            uiCtx.lineDashOffset = 8;
            uiCtx.strokeRect(startX, startY, w, h);

            uiCtx.strokeStyle = '#ffffff';
            uiCtx.lineDashOffset = 0;
            uiCtx.strokeRect(startX, startY, w, h);

            uiCtx.setLineDash([]); // Reset line dash
        } else if (currentTool === 'brush') {
            uiCtx.strokeStyle = mosaicPattern;
            drawSegment(uiCtx, lastX, lastY, currentX, currentY);
            drawSegment(maskCtx, lastX, lastY, currentX, currentY);

            lastX = currentX;
            lastY = currentY;
        }
    }

    function endDraw(e) {
        if (isPinching) {
            if (e.touches && e.touches.length < 2) {
                isPinching = false;
            }
            return;
        }

        if (!isDrawing) return;
        if (e.cancelable) e.preventDefault();
        isDrawing = false;

        uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);

        const w = currentX - startX;
        const h = currentY - startY;

        // If it's a tiny click for rect, do nothing
        if (currentTool === 'rect' && Math.abs(w) < 5 && Math.abs(h) < 5) {
            strokeBounds = null;
            return;
        }

        let pad;
        if (currentTool === 'rect') {
            // Rebuild the mask as a clean rect (preview borders never touch it)
            maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
            maskCtx.fillStyle = 'rgba(0,0,0,1)';
            maskCtx.fillRect(startX, startY, w, h);
            pad = 2;
        } else {
            pad = parseInt(brushSizeInput.value, 10) / 2 + 2;
        }

        const patchRect = boundsToRect(pad);
        strokeBounds = null;
        if (!patchRect) return;

        // Save only the changed area for undo
        saveState(patchRect);

        // Bake the mosaic using maskCanvas to ensure robust compositing
        const finalC = document.createElement('canvas');
        finalC.width = mainCanvas.width;
        finalC.height = mainCanvas.height;
        const fCtx = finalC.getContext('2d');

        fCtx.drawImage(maskCanvas, 0, 0);
        fCtx.globalCompositeOperation = 'source-in';
        fCtx.drawImage(mosaicBufferCanvas, 0, 0);

        mainCtx.drawImage(finalC, 0, 0);
    }

    // Desktop panning with the middle mouse button
    function startMousePan(e) {
        if (!imageLoaded) return;
        if (e.button !== 1) return;
        e.preventDefault();
        cancelActiveStroke();
        isMousePanning = true;
        lastMousePan = { x: e.clientX, y: e.clientY };
        canvasWrapper.classList.add('panning');
    }

    function onWindowMouseMove(e) {
        if (isMousePanning) {
            e.preventDefault();
            panX += e.clientX - lastMousePan.x;
            panY += e.clientY - lastMousePan.y;
            lastMousePan = { x: e.clientX, y: e.clientY };
            updateTransform();
            return;
        }
        draw(e);
    }

    function onWindowMouseUp(e) {
        if (isMousePanning) {
            isMousePanning = false;
            canvasWrapper.classList.remove('panning');
            return;
        }
        endDraw(e);
    }

    // Attach events for mouse and touch.
    // mousemove/mouseup live on window so strokes survive leaving the canvas.
    uiCanvas.addEventListener('mousedown', startDraw);
    canvasWrapper.addEventListener('mousedown', startMousePan);
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);

    uiCanvas.addEventListener('touchstart', startDraw, { passive: false });
    uiCanvas.addEventListener('touchmove', draw, { passive: false });
    uiCanvas.addEventListener('touchend', endDraw, { passive: false });
    uiCanvas.addEventListener('touchcancel', endDraw, { passive: false });

    // Mouse Wheel Zoom
    canvasWrapper.addEventListener('wheel', (e) => {
        if (!imageLoaded) return;
        e.preventDefault();

        const rect = canvasWrapper.getBoundingClientRect();
        const cx = e.clientX - rect.left - canvasInner.offsetLeft;
        const cy = e.clientY - rect.top - canvasInner.offsetTop;

        const zoomIntensity = 0.1;
        const wheel = e.deltaY < 0 ? 1 : -1;
        const newScale = Math.max(0.5, Math.min(scale * Math.exp(wheel * zoomIntensity), 10));

        panX = cx - (cx - panX) * (newScale / scale);
        panY = cy - (cy - panY) * (newScale / scale);
        scale = newScale;

        updateTransform();
    }, { passive: false });

    // Prevent Double-Tap Zoom and Default Context Menu
    document.addEventListener('dblclick', function (event) {
        event.preventDefault();
    }, { passive: false });

    // Prevent zooming on iOS Safari when double tapping,
    // but let rapid taps on buttons/controls through (e.g. mashing undo)
    let lastTouchEnd = 0;
    document.addEventListener('touchend', function (event) {
        const now = Date.now();
        if (now - lastTouchEnd <= 300 && !event.target.closest('button, label, input, a')) {
            if (event.cancelable) event.preventDefault();
        }
        lastTouchEnd = now;
    }, { passive: false });

    // Undo / Redo System (patch-based: stores only the changed region)
    function saveState(rect) {
        history.push({
            x: rect.x,
            y: rect.y,
            data: mainCtx.getImageData(rect.x, rect.y, rect.w, rect.h)
        });
        if (history.length > MAX_HISTORY) history.shift();
        redoStack = [];
        updateButtons();
    }

    btnUndo.addEventListener('click', () => {
        if (history.length === 0 || isDrawing) return;
        const patch = history.pop();
        redoStack.push({
            x: patch.x,
            y: patch.y,
            data: mainCtx.getImageData(patch.x, patch.y, patch.data.width, patch.data.height)
        });
        mainCtx.putImageData(patch.data, patch.x, patch.y);
        updateButtons();
    });

    btnRedo.addEventListener('click', () => {
        if (redoStack.length === 0 || isDrawing) return;
        const patch = redoStack.pop();
        history.push({
            x: patch.x,
            y: patch.y,
            data: mainCtx.getImageData(patch.x, patch.y, patch.data.width, patch.data.height)
        });
        mainCtx.putImageData(patch.data, patch.x, patch.y);
        updateButtons();
    });

    function updateButtons() {
        btnUndo.disabled = history.length === 0;
        btnRedo.disabled = redoStack.length === 0;
    }

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            cancelActiveStroke();
            return;
        }
        if (!(e.ctrlKey || e.metaKey)) return;

        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
            e.preventDefault();
            btnUndo.click();
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
            e.preventDefault();
            btnRedo.click();
        } else if (key === 's') {
            e.preventDefault();
            btnSave.click();
        }
    });

    // Compare Original
    function showOriginal() {
        if (!imageLoaded) return;
        uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
        uiCtx.drawImage(originalCanvas, 0, 0);
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
