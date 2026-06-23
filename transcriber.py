"""
transcriber.py — 語音辨識模組
使用 whisper.cpp CLI (whisper-cli.exe) 將音檔轉為文字含時間戳。
完全隔離進程，無 DLL 衝突問題。
支援 tiny / base / small 三種模型 (GGML 格式)。
"""

import json
import os
import subprocess
import sys
import shutil
from pathlib import Path
from typing import Optional, Callable

from logger import get_logger, log_entry, log_exit, log_error

_log = get_logger('transcriber')

# 可用模型列表 (GGML 格式)
AVAILABLE_MODELS = ['tiny', 'base', 'small']

# 預設模型
DEFAULT_MODEL = 'tiny'

# 模型大小 (MB) — GGML 格式
_MODEL_SIZES = {'tiny': 77, 'base': 148, 'small': 488}

# 模型存放目錄：專案根目錄 / exe 目錄下的 model/
if getattr(sys, 'frozen', False):
    _BASE_DIR = Path(sys.executable).parent
else:
    _BASE_DIR = Path(__file__).parent
MODEL_DIR = _BASE_DIR / 'model'

# whisper CLI 路徑
if getattr(sys, 'frozen', False):
    _CLI_DIR = Path(sys.executable).parent / 'whisper_cli'
else:
    _CLI_DIR = _BASE_DIR / 'whisper_cli'

_WHISPER_CLI = _CLI_DIR / 'whisper-cli.exe'


def _get_model_path(model_size: str) -> Path:
    """取得 GGML 模型在 model/ 目錄下的路徑"""
    return MODEL_DIR / f'ggml-{model_size}.bin'


def is_model_cached(model_size: str = DEFAULT_MODEL) -> bool:
    """
    檢查指定 GGML 模型是否已下載到 model/ 目錄

    Args:
        model_size: 模型大小 (tiny / base / small)

    Returns:
        True 如果模型檔案存在
    """
    model_path = _get_model_path(model_size)
    return model_path.exists() and model_path.stat().st_size > 0


def get_model_size_mb(model_size: str) -> int:
    """取得 GGML 模型大小 (MB)"""
    return _MODEL_SIZES.get(model_size, 77)


def _get_hf_repo_filename(model_size: str) -> tuple[str, str]:
    """
    取得 Hugging Face repo_id 和檔名
    GGML 模型從 ggerganov/whisper.cpp 下載
    """
    repo_id = "ggerganov/whisper.cpp"
    filename = f"ggml-{model_size}.bin"
    return repo_id, filename


def download_model(
    model_size: str = DEFAULT_MODEL,
    progress_callback: Optional[Callable[[float], None]] = None,
) -> bool:
    """
    下載 GGML 模型到 model/ 目錄，支援進度回呼

    Args:
        model_size: 模型大小 (tiny / base / small)
        progress_callback: 進度回呼 (0.0~1.0)

    Returns:
        True 下載成功, False 失敗
    """
    log_entry(_log, 'download_model', model_size=model_size)
    try:
        model_path = _get_model_path(model_size)
        MODEL_DIR.mkdir(parents=True, exist_ok=True)

        repo_id, filename = _get_hf_repo_filename(model_size)
        _log.info(f"下載 GGML 模型 {model_size} 從 {repo_id}/{filename} 到 {model_path}")

        # 使用 huggingface_hub 下載
        from huggingface_hub import hf_hub_download

        # 重定向 stdout/stderr 避免 tqdm 問題
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        import io
        sys.stdout = io.StringIO()
        sys.stderr = io.StringIO()

        try:
            downloaded = hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                local_dir=str(MODEL_DIR),
                local_dir_use_symlinks=False,
                resume_download=True,
            )
            # 複製到正確位置
            if downloaded and os.path.exists(downloaded):
                shutil.copy2(downloaded, str(model_path))
        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr

        if not model_path.exists() or model_path.stat().st_size == 0:
            _log.error(f"模型下載失敗: {model_path}")
            log_exit(_log, 'download_model', 'FAILED')
            return False

        if progress_callback:
            progress_callback(1.0)

        _log.info(f"GGML 模型 {model_size} 下載完成 ({model_path.stat().st_size / 1024 / 1024:.1f} MB)")
        log_exit(_log, 'download_model', 'OK')
        return True

    except Exception as e:
        log_error(_log, 'download_model', e)
        return False


# ── 反 hallucination 去重輔助函式 ──────────────────────────────

def _normalize_text_for_compare(text: str) -> str:
    """去除空白、標點、保留中英文字元，用於相似度比對"""
    import re
    if not text:
        return ''
    # 去除所有空白、標點符號、數字，僅保留中英文字元
    cleaned = re.sub(r'[\s\W\d_]+', '', text.lower(), flags=re.UNICODE)
    return cleaned


def _text_similarity(a: str, b: str) -> float:
    """計算兩個文字的相似度 (Jaccard, 0.0~1.0)"""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    set_a = set(a)
    set_b = set(b)
    if not set_a or not set_b:
        return 0.0
    intersection = set_a & set_b
    union = set_a | set_b
    return len(intersection) / len(union)


def _deduplicate_repeats(results: list[dict], similarity_threshold: float = 0.7) -> list[dict]:
    """
    去除 whisper 模型 hallucination 造成的相鄰重複 segment

    whisper 在靜音或音樂片段會反覆產生相同的幻覺文字。
    本函式偵測連續高度相似的相鄰 segment，僅保留時間跨度最長的代表。

    Args:
        results: 原始辨識結果
        similarity_threshold: 判定為重複的相似度閾值

    Returns:
        去重後的結果
    """
    if len(results) <= 1:
        return results

    filtered = []
    for seg in results:
        text = seg.get('text', '').strip()
        norm = _normalize_text_for_compare(text)

        # 過濾空文字 / 太短 / 純標點
        if len(norm) < 2:
            continue

        # 檢查是否與最近一段高度相似
        is_repeat = False
        if filtered:
            prev = filtered[-1]
            prev_norm = _normalize_text_for_compare(prev.get('text', ''))
            sim = _text_similarity(prev_norm, norm)
            # 短文字 (≤ 12 字) 直接比對相等
            if len(norm) <= 12 or len(prev_norm) <= 12:
                if prev_norm == norm:
                    is_repeat = True
            else:
                # 長文字: Jaccard ≥ 閾值 且其中一段是另一段的子集
                # 加入子集檢查避免誤判不同主題的句子
                if sim >= similarity_threshold and (
                    norm in prev_norm or prev_norm in norm
                ):
                    is_repeat = True

            if is_repeat:
                # 保留時間跨度較長的那段
                prev_duration = prev['end'] - prev['start']
                curr_duration = seg['end'] - seg['start']
                if curr_duration > prev_duration:
                    filtered[-1] = seg
                continue

        filtered.append(seg)

    return filtered


def transcribe(
    audio_path: str,
    model_size: str = DEFAULT_MODEL,
    language: Optional[str] = None,
    progress_callback: Optional[Callable[[float], None]] = None,
) -> Optional[list[dict]]:
    """
    對音檔進行語音辨識，使用 whisper.cpp CLI

    Args:
        audio_path: 音檔路徑 (WAV/MP3/Opus 等)
        model_size: 模型大小
        language: 語言代碼 (None=自動偵測, 'zh'=中文, 'en'=英文)
        progress_callback: 進度回呼函式，參數為 0.0~1.0

    Returns:
        list of dict，每個 dict 包含:
            - 'start': 起始時間 (秒)
            - 'end': 結束時間 (秒)
            - 'text': 文字內容
            - 'confidence': 信心值 (whisper.cpp 不提供，固定 0.0)
        失敗回傳 None
    """
    log_entry(_log, 'transcribe', audio_path=audio_path, model_size=model_size, language=language)
    try:
        if not os.path.exists(audio_path):
            _log.error(f"音檔不存在: {audio_path}")
            log_exit(_log, 'transcribe', 'FILE_NOT_FOUND')
            return None

        model_path = _get_model_path(model_size)
        if not model_path.exists():
            _log.error(f"模型不存在: {model_path}，請先下載")
            log_exit(_log, 'transcribe', 'MODEL_NOT_FOUND')
            return None

        if not _WHISPER_CLI.exists():
            _log.error(f"whisper-cli 不存在: {_WHISPER_CLI}")
            log_exit(_log, 'transcribe', 'CLI_NOT_FOUND')
            return None

        # 使用絕對路徑
        abs_audio = os.path.abspath(audio_path)

        # 構建命令（使用 --output-json 讓 whisper-cli 自動產生 .wav.json）
        # 加入反 hallucination 參數：
        #   -ml 60          限制每段最大長度，避免長段無音訊時產生重複文字
        #   -nth 0.7        提高 no-speech 閾值，過濾靜音區段的幻覺輸出
        #   -wt  0.03       提高 word timestamp 閾值，過濾低信心字詞
        #   -bs 1 -bo 1     使用 greedy 解碼（beam_size=1, best_of=1），減少幻覺
        #   --suppress-nst  抑制非語音 token ([音樂]、(笑聲) 等)
        #   --no-fallback   禁用溫度回退，減少重複採樣
        cmd = [
            str(_WHISPER_CLI),
            '-m', str(model_path),
            '-f', abs_audio,
            '--output-json',
            '-l', language or 'auto',
            '-t', str(os.cpu_count() or 4),
            '-ml', '60',
            '-nth', '0.7',
            '-wt', '0.03',
            '-bs', '1',
            '-bo', '1',
            '--suppress-nst',
            '--no-fallback',
        ]
        _log.debug(f"執行命令: {' '.join(cmd)}")

        # 執行 CLI（隔離進程，無 DLL 衝突）
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,  # 最長 10 分鐘
        )

        # whisper-cli 會自動在音檔同名目錄產生 .wav.json
        expected_json = abs_audio + '.json'

        if result.returncode != 0:
            # 即使 returncode=0 有時也會有 error msg，檢查 JSON 是否存在
            if not os.path.exists(expected_json):
                _log.error(f"whisper-cli 失敗 (exit={result.returncode}): {result.stderr[:500]}")
                log_exit(_log, 'transcribe', f'CLI_ERROR ({result.returncode})')
                return None

        # 讀取 JSON 輸出
        if not os.path.exists(expected_json):
            _log.error(f"JSON 輸出檔不存在: {expected_json}")
            log_exit(_log, 'transcribe', 'OUTPUT_NOT_FOUND')
            return None

        with open(expected_json, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # 解析結果
        segments = data.get('transcription', [])
        results = []
        total_segments = len(segments)

        for i, seg in enumerate(segments):
            offsets = seg.get('offsets', {})
            start_ms = offsets.get('from', 0)
            end_ms = offsets.get('to', 0)

            result = {
                'start': round(start_ms / 1000, 2),
                'end': round(end_ms / 1000, 2),
                'text': seg.get('text', '').strip(),
                'confidence': 0.0,  # whisper.cpp 不提供 confidence
            }
            results.append(result)

            if progress_callback and total_segments > 0:
                progress_callback((i + 1) / total_segments)

        # 後處理：去除 whisper 模型的 hallucination 重複
        # 若相鄰 segment 文字高度相似，只保留時間跨度最長的那段
        results = _deduplicate_repeats(results)
        if progress_callback:
            progress_callback(1.0)

        _log.info(f"辨識完成，共 {len(results)} 句")
        log_exit(_log, 'transcribe', f"OK ({len(results)} 句)")
        return results

    except subprocess.TimeoutExpired:
        log_error(_log, 'transcribe', 'TIMEOUT')
        return None
    except Exception as e:
        log_error(_log, 'transcribe', e)
        return None