"""
Real-ESRGAN Image Enhancement API
FastAPI endpoint that uses a trained RRDBNet (Real-ESRGAN tiny) model
to upscale images by 4x.
"""

import io
import cv2
import torch
import numpy as np
from pathlib import Path
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from basicsr.archs.rrdbnet_arch import RRDBNet
from realesrgan import RealESRGANer

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Real-ESRGAN Image Enhancer",
    description="Upload an image and get a 4× super-resolved version using Real-ESRGAN",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load model at startup ────────────────────────────────────────────────────
MODEL_DIR = Path(__file__).parent / "model"
MODEL_PATH = MODEL_DIR / "net_g_latest.pth"

upsampler = None


@app.on_event("startup")
def load_model():
    global upsampler

    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Model weights not found at {MODEL_PATH}. "
            "Place 'net_g_latest.pth' in the 'model/' directory."
        )

    model = RRDBNet(
        num_in_ch=3,
        num_out_ch=3,
        num_feat=64,
        num_block=6,
        num_grow_ch=32,
        scale=4,
    )

    use_half = torch.cuda.is_available()

    upsampler = RealESRGANer(
        scale=4,
        model_path=str(MODEL_PATH),
        model=model,
        tile=400,
        tile_pad=10,
        pre_pad=0,
        half=use_half,
    )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"✓ Real-ESRGAN model loaded on {device}")


# ── Serve frontend ───────────────────────────────────────────────────────────
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        return HTMLResponse("<h1>Frontend not found</h1>", status_code=404)
    return HTMLResponse(index_path.read_text(encoding="utf-8"))


# ── API endpoints ────────────────────────────────────────────────────────────
@app.post("/api/enhance")
async def enhance_image(
    file: UploadFile = File(...),
    outscale: float = Query(default=4.0, ge=1.0, le=4.0, description="Output upscale factor"),
):
    """
    Upload an image file and receive the 4× enhanced version.
    Supports JPEG, PNG, BMP, WEBP.
    """
    if upsampler is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    # Validate file type
    allowed = {"image/jpeg", "image/png", "image/bmp", "image/webp"}
    if file.content_type not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {file.content_type}. Allowed: {', '.join(allowed)}",
        )

    # Read and decode image
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:  # 10 MB limit
        raise HTTPException(status_code=400, detail="Image too large (max 10 MB)")

    np_arr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if img is None:
        raise HTTPException(status_code=400, detail="Could not decode image")

    h, w = img.shape[:2]
    if h > 2000 or w > 2000:
        raise HTTPException(
            status_code=400,
            detail=f"Image too large ({w}×{h}). Max input dimension is 2000px.",
        )

    # Enhance
    try:
        output, _ = upsampler.enhance(img, outscale=outscale)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Enhancement failed: {str(e)}")

    # Encode output as PNG
    success, encoded = cv2.imencode(".png", output)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to encode output image")

    return StreamingResponse(
        io.BytesIO(encoded.tobytes()),
        media_type="image/png",
        headers={
            "Content-Disposition": "attachment; filename=enhanced.png",
            "X-Original-Size": f"{w}x{h}",
            "X-Enhanced-Size": f"{output.shape[1]}x{output.shape[0]}",
        },
    )


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "model_loaded": upsampler is not None,
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "model_path": str(MODEL_PATH),
    }


# ── Run directly ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
