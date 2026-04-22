"""
SmartMeter OCR Backend
FastAPI server — POST /upload
Accepts a water meter image, sends to OpenAI Vision, returns extracted digits.
"""

import os
import base64
import re
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from dotenv import load_dotenv

# ── Load environment variables ────────────────────────────────────────────────
load_dotenv()
API_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=API_KEY)

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="SmartMeter OCR API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # allow any origin (frontend on any port)
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ── OCR prompt ────────────────────────────────────────────────────────────────
METER_PROMPT = """You are reading a water meter dial.

Rules:
- Extract ONLY the main black/dark digits (the integer part of the reading).
- Ignore any red digits (these are the decimal/fraction part).
- Ignore any text, labels, units, or other markings.
- Return the digits ONLY as a plain number string (e.g. "1234" or "00567").
- Do NOT include units, spaces, commas, or any explanation.
- If you cannot read the meter clearly, return the string "error"."""


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    """
    Accept an image file, send to GPT-4o Vision, return extracted meter digits.
    Response: { "meter": "12345" }
    """
    # Validate content type
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image.")

    # Read and base64-encode the image
    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024:   # 10 MB limit
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB).")

    b64_image = base64.b64encode(image_bytes).decode("utf-8")
    mime = file.content_type  # e.g. "image/jpeg"

    # Call OpenAI Vision
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=32,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime};base64,{b64_image}",
                                "detail": "high",
                            },
                        },
                        {
                            "type": "text",
                            "text": METER_PROMPT,
                        },
                    ],
                }
            ],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {str(e)}")

    raw = response.choices[0].message.content.strip()

    # Sanitise: keep only numeric characters
    digits = re.sub(r"[^0-9]", "", raw)

    if not digits:
        # Return "error" so the frontend can show a fallback
        return {"meter": "error", "raw": raw}

    return {"meter": digits, "raw": raw}
