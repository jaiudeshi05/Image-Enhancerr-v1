// ── Real-ESRGAN Frontend ─────────────────────────────────────────────────────
(() => {
    "use strict";

    // ── DOM references ───────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);

    const uploadZone       = $("uploadZone");
    const fileInput        = $("fileInput");
    const controls         = $("controls");
    const previewImage     = $("previewImage");
    const previewBadge     = $("previewBadge");
    const fileName         = $("fileName");
    const fileSize         = $("fileSize");
    const removeBtn        = $("removeBtn");
    const enhanceBtn       = $("enhanceBtn");
    const uploadSection    = $("uploadSection");
    const progressSection  = $("progressSection");
    const resultSection    = $("resultSection");
    const originalSize     = $("originalSize");
    const enhancedSize     = $("enhancedSize");
    const originalImg      = $("originalImg");
    const enhancedImg      = $("enhancedImg");
    const downloadBtn      = $("downloadBtn");
    const newBtn           = $("newBtn");
    const statusBadge      = $("statusBadge");
    const comparisonWrapper = $("comparisonWrapper");
    const comparisonOverlay = $("comparisonOverlay");
    const comparisonSlider  = $("comparisonSlider");

    let selectedFile = null;
    let selectedScale = 4;
    let enhancedBlobUrl = null;
    let originalBlobUrl = null;

    // ── Health check ─────────────────────────────────────────────────────────
    async function checkHealth() {
        try {
            const res = await fetch("/api/health");
            const data = await res.json();
            statusBadge.className = "status-badge " + (data.model_loaded ? "online" : "offline");
            statusBadge.querySelector(".status-text").textContent =
                data.model_loaded ? `Model ready · ${data.device.toUpperCase()}` : "Model loading…";
        } catch {
            statusBadge.className = "status-badge offline";
            statusBadge.querySelector(".status-text").textContent = "Server offline";
        }
    }
    checkHealth();
    setInterval(checkHealth, 15000);

    // ── File selection ───────────────────────────────────────────────────────
    uploadZone.addEventListener("click", () => fileInput.click());
    uploadZone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
    });

    // Drag & drop
    ["dragenter", "dragover"].forEach(evt =>
        uploadZone.addEventListener(evt, (e) => { e.preventDefault(); uploadZone.classList.add("drag-over"); })
    );
    ["dragleave", "drop"].forEach(evt =>
        uploadZone.addEventListener(evt, () => uploadZone.classList.remove("drag-over"))
    );
    uploadZone.addEventListener("drop", (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith("image/")) handleFile(file);
    });

    fileInput.addEventListener("change", () => {
        if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    function handleFile(file) {
        if (file.size > 10 * 1024 * 1024) {
            alert("Image is too large (max 10 MB)");
            return;
        }
        selectedFile = file;

        // Preview
        const url = URL.createObjectURL(file);
        previewImage.src = url;

        const img = new Image();
        img.onload = () => {
            previewBadge.textContent = `${img.width}×${img.height}`;
        };
        img.src = url;

        fileName.textContent = file.name;
        fileSize.textContent = formatBytes(file.size);

        uploadZone.style.display = "none";
        controls.style.display = "flex";
        controls.classList.add("fade-in");
    }

    removeBtn.addEventListener("click", resetUpload);

    function resetUpload() {
        selectedFile = null;
        fileInput.value = "";
        uploadZone.style.display = "";
        controls.style.display = "none";
        controls.classList.remove("fade-in");
    }

    // ── Scale selection ──────────────────────────────────────────────────────
    document.querySelectorAll(".scale-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelector(".scale-btn.active")?.classList.remove("active");
            btn.classList.add("active");
            selectedScale = parseFloat(btn.dataset.scale);
        });
    });

    // ── Enhance ──────────────────────────────────────────────────────────────
    enhanceBtn.addEventListener("click", async () => {
        if (!selectedFile) return;

        showSection("progress");

        const formData = new FormData();
        formData.append("file", selectedFile);

        try {
            const res = await fetch(`/api/enhance?outscale=${selectedScale}`, {
                method: "POST",
                body: formData,
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: "Unknown error" }));
                throw new Error(err.detail || `Server error ${res.status}`);
            }

            const origSize = res.headers.get("X-Original-Size") || "—";
            const enhSize = res.headers.get("X-Enhanced-Size") || "—";

            const blob = await res.blob();

            // Clean up old URLs
            if (enhancedBlobUrl) URL.revokeObjectURL(enhancedBlobUrl);
            if (originalBlobUrl) URL.revokeObjectURL(originalBlobUrl);

            enhancedBlobUrl = URL.createObjectURL(blob);
            originalBlobUrl = URL.createObjectURL(selectedFile);

            originalSize.textContent = origSize;
            enhancedSize.textContent = enhSize;
            originalImg.src = originalBlobUrl;
            enhancedImg.src = enhancedBlobUrl;

            // Wait for images to load before showing
            await Promise.all([
                new Promise((r) => { enhancedImg.onload = r; }),
                new Promise((r) => { originalImg.onload = r; }),
            ]);

            // Fix overlay image sizing — match the enhanced image dimensions
            const enhW = enhancedImg.naturalWidth;
            const enhH = enhancedImg.naturalHeight;
            comparisonWrapper.style.aspectRatio = `${enhW} / ${enhH}`;
            originalImg.style.width = comparisonWrapper.offsetWidth + "px";
            originalImg.style.height = comparisonWrapper.offsetHeight + "px";
            originalImg.style.objectFit = "cover";

            setSliderPosition(50);
            showSection("result");
        } catch (err) {
            alert("Enhancement failed: " + err.message);
            showSection("upload");
        }
    });

    // ── Comparison slider ────────────────────────────────────────────────────
    let isDragging = false;

    function setSliderPosition(percent) {
        percent = Math.max(0, Math.min(100, percent));
        comparisonOverlay.style.width = percent + "%";
        comparisonSlider.style.left = percent + "%";

        // Keep the original image filling the full width
        const wrapperWidth = comparisonWrapper.offsetWidth;
        if (wrapperWidth > 0) {
            originalImg.style.width = wrapperWidth + "px";
        }
    }

    function getSliderPercent(e) {
        const rect = comparisonWrapper.getBoundingClientRect();
        const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
        return (x / rect.width) * 100;
    }

    comparisonWrapper.addEventListener("mousedown", (e) => { isDragging = true; setSliderPosition(getSliderPercent(e)); });
    comparisonWrapper.addEventListener("touchstart", (e) => { isDragging = true; setSliderPosition(getSliderPercent(e)); }, { passive: true });

    window.addEventListener("mousemove", (e) => { if (isDragging) setSliderPosition(getSliderPercent(e)); });
    window.addEventListener("touchmove", (e) => { if (isDragging) setSliderPosition(getSliderPercent(e)); }, { passive: true });

    window.addEventListener("mouseup", () => { isDragging = false; });
    window.addEventListener("touchend", () => { isDragging = false; });

    // Recalc on resize
    window.addEventListener("resize", () => {
        if (resultSection.style.display !== "none" && comparisonWrapper.offsetWidth > 0) {
            originalImg.style.width = comparisonWrapper.offsetWidth + "px";
            originalImg.style.height = comparisonWrapper.offsetHeight + "px";
        }
    });

    // ── Download ─────────────────────────────────────────────────────────────
    downloadBtn.addEventListener("click", () => {
        if (!enhancedBlobUrl) return;
        const a = document.createElement("a");
        a.href = enhancedBlobUrl;
        a.download = "enhanced_" + (selectedFile?.name || "image") + ".png";
        a.click();
    });

    // ── New Image ────────────────────────────────────────────────────────────
    newBtn.addEventListener("click", () => {
        resetUpload();
        showSection("upload");
    });

    // ── Helpers ──────────────────────────────────────────────────────────────
    function showSection(name) {
        uploadSection.style.display = name === "upload" ? "" : "none";
        progressSection.style.display = name === "progress" ? "" : "none";
        resultSection.style.display = name === "result" ? "" : "none";

        if (name === "result") resultSection.classList.add("fade-in");
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }
})();
