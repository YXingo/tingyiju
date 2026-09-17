#!/usr/bin/env python3
"""听一句的本机静态站点与 Kokoro 语音服务。"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from socketserver import TCPServer
import webbrowser


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = int(os.environ.get("TINGYIJU_PORT", "8765"))
REPO_ID = "hexgrad/Kokoro-82M-v1.1-zh"
MODEL_VERSION = "Kokoro-82M-v1.1-zh"
SAMPLE_RATE = 24_000
ALLOWED_VOICES = frozenset({"zf_001", "zf_004", "zm_010", "zm_025"})
CACHE_DIR = Path.home() / ".cache" / "tingyiju" / "audio"


def normalize_request(payload: object) -> tuple[str, str, float]:
    if not isinstance(payload, dict):
        raise ValueError("请求格式不正确")
    text = payload.get("text")
    voice = payload.get("voice")
    speed = payload.get("speed", 1.0)
    if not isinstance(text, str) or not text.strip():
        raise ValueError("朗读文本不能为空")
    text = text.strip()
    if len(text) > 2_000:
        raise ValueError("单句不能超过 2000 个字符")
    if voice not in ALLOWED_VOICES:
        raise ValueError("音色不在允许列表中")
    if isinstance(speed, bool):
        raise ValueError("语速格式不正确")
    try:
        speed = round(float(speed), 2)
    except (TypeError, ValueError) as error:
        raise ValueError("语速格式不正确") from error
    if not 0.5 <= speed <= 1.5:
        raise ValueError("语速必须在 0.5 到 1.5 之间")
    return text, voice, speed


def audio_cache_path(text: str, voice: str, speed: float) -> Path:
    material = "\0".join((MODEL_VERSION, voice, f"{speed:.2f}", text))
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()
    return CACHE_DIR / digest[:2] / f"{digest}.wav"


class KokoroEngine:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pipeline = None
        self.device = None

    @property
    def loaded(self) -> bool:
        return self._pipeline is not None

    def _load(self) -> None:
        if self._pipeline is not None:
            return
        import torch
        from kokoro import KModel, KPipeline

        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        english = KPipeline(lang_code="a", repo_id=REPO_ID, model=False)

        def english_phonemes(text: str) -> str:
            return next(english(text)).phonemes

        model = KModel(repo_id=REPO_ID).to(self.device).eval()
        self._pipeline = KPipeline(
            lang_code="z",
            repo_id=REPO_ID,
            model=model,
            en_callable=english_phonemes,
        )
        print(f"Kokoro 已载入：{self.device}", flush=True)

    def synthesize(self, text: str, voice: str, speed: float) -> tuple[Path, bool]:
        target = audio_cache_path(text, voice, speed)
        if target.is_file():
            return target, True

        with self._lock:
            if target.is_file():
                return target, True
            self._load()
            import numpy as np
            import soundfile as sf

            chunks = []
            for result in self._pipeline(text, voice=voice, speed=speed):
                if result.audio is not None:
                    chunks.append(result.audio.detach().cpu().numpy())
            if not chunks:
                raise RuntimeError("模型没有生成音频")
            audio = np.concatenate(chunks).astype(np.float32)
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix(f".{threading.get_ident()}.tmp")
            try:
                sf.write(temporary, audio, SAMPLE_RATE, subtype="PCM_16", format="WAV")
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
            return target, False


ENGINE = KokoroEngine()


class LocalThreadingHTTPServer(ThreadingHTTPServer):
    """HTTPServer 默认会做反向 DNS；纯本机服务不需要，且在部分 macOS 上会卡住。"""

    def server_bind(self) -> None:
        TCPServer.server_bind(self)
        self.server_name = HOST
        self.server_port = self.server_address[1]


class TingYiJuHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "model": MODEL_VERSION, "loaded": ENGINE.loaded, "device": ENGINE.device},
            )
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path != "/api/tts":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "接口不存在"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 65_536:
                raise ValueError("请求大小不正确")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            text, voice, speed = normalize_request(payload)
            path, cache_hit = ENGINE.synthesize(text, voice, speed)
            size = path.stat().st_size
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(size))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Tingyiju-Cache", "hit" if cache_hit else "miss")
            self.end_headers()
            with path.open("rb") as audio_file:
                while chunk := audio_file.read(1024 * 1024):
                    self.wfile.write(chunk)
        except (ValueError, json.JSONDecodeError) as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as error:
            print(f"语音生成失败：{error!r}", flush=True)
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "语音生成失败，请在启动窗口查看原因"})


def main() -> None:
    server = LocalThreadingHTTPServer((HOST, PORT), TingYiJuHandler)
    url = f"http://{HOST}:{PORT}/"
    print(f"听一句已启动：{url}", flush=True)
    print("关闭这个终端窗口即可停止服务。", flush=True)
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("听一句已停止。", flush=True)


if __name__ == "__main__":
    main()
