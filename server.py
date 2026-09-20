"""FastAPI server for the MP3 Silence Remover web tool."""
import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import audio

BASE = os.path.dirname(os.path.abspath(__file__))

app = FastAPI(title="MP3 Silence Remover")


class PathReq(BaseModel):
    path: str


class AnalyzeReq(BaseModel):
    path: str
    min_silence_ms: int = 500
    silence_thresh_db: float = -35.0
    padding_ms: int = 200


class ProcessReq(BaseModel):
    path: str
    source_root: str
    min_silence_ms: int = 500
    silence_thresh_db: float = -35.0
    padding_ms: int = 200
    output_dir: str = ""
    overwrite: bool = False


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/scan")
def scan(req: PathReq):
    src = os.path.abspath(req.path)
    if not os.path.exists(src):
        return {"error": f"Path not found: {src}"}

    if os.path.isfile(src):
        files = [src]
    else:
        files = list(audio.iter_mp3s(src))

    out = [
        {
            "path": p,
            "name": os.path.basename(p),
            "rel": os.path.relpath(p, src) if os.path.isdir(src) else os.path.basename(p),
            "size": os.path.getsize(p),
        }
        for p in files
    ]
    return {"root": src, "count": len(out), "files": out}


@app.post("/api/analyze")
def analyze(req: AnalyzeReq):
    try:
        return audio.analyze_file(req.path, req.min_silence_ms,
                                  req.silence_thresh_db, req.padding_ms)
    except Exception as e:
        return {"error": str(e), "path": req.path}


@app.post("/api/process")
def process(req: ProcessReq):
    out = audio.resolve_output(req.path, req.source_root,
                               req.output_dir or None, req.overwrite)
    try:
        res = audio.process_file(req.path, out, req.min_silence_ms,
                                 req.silence_thresh_db, req.padding_ms,
                                 overwrite=req.overwrite)
    except Exception as e:
        return {"error": str(e), "path": req.path}
    res["path"] = req.path
    res["name"] = os.path.basename(req.path)
    return res


app.mount("/", StaticFiles(directory=os.path.join(BASE, "static"), html=True),
          name="static")
