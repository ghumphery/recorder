"""
recorder.py — 錄音模組
使用 sounddevice 錄製麥克風輸入，支援 Opus 壓縮儲存，
避免單檔過大（預設最長 60 分鐘）。
"""

import os
import wave
import tempfile
import numpy as np
import sounddevice as sd
import soundfile as sf
from pydub import AudioSegment
from typing import Optional, Callable

from logger import get_logger, log_entry, log_exit, log_error

_log = get_logger('recorder')

# 錄音設定
SAMPLE_RATE = 16000  # 16kHz 單聲道
CHANNELS = 1
MAX_DURATION_MINUTES = 60  # 最長錄音時間（分鐘）
SAMPLE_WIDTH = 2  # 16-bit

# 全域變數：當前錄音狀態
_recording = False
_audio_buffer: list[np.ndarray] = []
_stream: Optional[sd.InputStream] = None


def list_input_devices() -> list[dict]:
    """列出所有可用的輸入裝置"""
    devices = sd.query_devices()
    input_devices = []
    for i, dev in enumerate(devices):
        if dev['max_input_channels'] > 0:
            input_devices.append({
                'index': i,
                'name': dev['name'],
                'channels': dev['max_input_channels'],
                'default_samplerate': dev['default_samplerate'],
            })
    return input_devices


def start_recording(callback: Optional[Callable] = None):
    """開始錄音 (非阻塞)"""
    global _recording, _audio_buffer, _stream
    log_entry(_log, 'start_recording')
    if _recording:
        _log.warning("已在錄音中，忽略重複呼叫")
        return
    
    _recording = True
    _audio_buffer = []
    
    def audio_callback(indata, frames, time_info, status):
        global _audio_buffer
        if _recording:
            _audio_buffer.append(indata.copy())
        if callback:
            callback(indata, frames, time_info, status)
    
    _stream = sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype='int16',
        callback=audio_callback,
    )
    _stream.start()
    _log.info("錄音串流已啟動")
    log_exit(_log, 'start_recording')


def stop_recording() -> Optional[str]:
    """停止錄音，儲存為 Opus 格式，回傳檔案路徑"""
    global _recording, _audio_buffer, _stream
    log_entry(_log, 'stop_recording')
    if not _recording:
        _log.warning("尚未開始錄音，無法停止")
        return None
    
    _recording = False
    
    # 安全關閉串流
    try:
        if _stream is not None:
            _stream.stop()
            _stream.close()
            _log.debug("錄音串流已關閉")
    except Exception as e:
        _log.warning(f"關閉串流時發生非致命錯誤: {e}")
    finally:
        _stream = None
    
    sd.stop()
    
    if not _audio_buffer:
        _log.warning("音訊 buffer 為空，無資料可儲存")
        return None
    
    try:
        audio_data = np.concatenate(_audio_buffer, axis=0)
    except ValueError as e:
        log_error(_log, 'stop_recording', e, "合併音訊 buffer 失敗")
        return None
    _audio_buffer = []
    
    result = _save_audio(audio_data)
    log_exit(_log, 'stop_recording', f"儲存至 {os.path.basename(result) if result else 'None'}")
    return result


def _save_audio(audio_data: np.ndarray) -> str:
    """
    將音訊資料儲存為 Opus 格式
    先存為臨時 WAV，再用 pydub 轉為 Opus
    
    Args:
        audio_data: numpy array of int16 audio samples
    
    Returns:
        儲存的 Opus 檔案路徑
    """
    # 限制時長
    max_samples = SAMPLE_RATE * 60 * MAX_DURATION_MINUTES
    if len(audio_data) > max_samples:
        audio_data = audio_data[:max_samples]
    
    # 先寫入臨時 WAV
    temp_wav = os.path.join(tempfile.gettempdir(), 'recoder_temp.wav')
    sf.write(temp_wav, audio_data, SAMPLE_RATE, subtype='PCM_16')
    
    # 轉為 Opus 壓縮
    audio = AudioSegment.from_wav(temp_wav)
    os.remove(temp_wav)
    
    # 儲存到 assets 目錄
    import time
    from pathlib import Path
    
    output_dir = Path(__file__).parent / 'assets'
    output_dir.mkdir(exist_ok=True)
    
    timestamp = time.strftime('%Y%m%d_%H%M%S')
    output_path = str(output_dir / f'recording_{timestamp}.wav')
    
    # 儲存為 WAV（faster-whisper 直接處理 WAV 最穩定）
    audio.export(output_path, format='wav', parameters=['-acodec', 'pcm_s16le', '-ar', str(SAMPLE_RATE), '-ac', '1'])
    
    # 同時儲存 Opus 壓縮版（供使用者自行取用，檔案更小）
    opus_path = str(output_dir / f'recording_{timestamp}.opus')
    audio.export(opus_path, format='opus', bitrate='24k')
    
    return output_path


def load_audio(file_path: str) -> Optional[str]:
    """
    載入外部音檔，轉換為 16kHz 單聲道 WAV 格式供辨識使用
    如果原始檔案已是 WAV 格式且符合規格，直接使用
    
    Args:
        file_path: 原始音檔路徑
    
    Returns:
        轉換後的 WAV 檔案路徑，失敗回傳 None
    """
    try:
        ext = os.path.splitext(file_path)[1].lower()
        
        # 如果已經是 16kHz mono WAV，直接使用
        if ext == '.wav':
            import struct
            with wave.open(file_path, 'rb') as wf:
                if wf.getframerate() == SAMPLE_RATE and wf.getnchannels() == CHANNELS:
                    return file_path
        
        # 其他格式需要轉換
        audio = AudioSegment.from_file(file_path)
        audio = audio.set_frame_rate(SAMPLE_RATE).set_channels(CHANNELS).set_sample_width(SAMPLE_WIDTH)
        
        from pathlib import Path
        output_dir = Path(__file__).parent / 'assets'
        output_dir.mkdir(exist_ok=True)
        
        basename = os.path.splitext(os.path.basename(file_path))[0]
        output_path = str(output_dir / f'{basename}_converted.wav')
        
        audio.export(output_path, format='wav')
        return output_path
    except Exception as e:
        print(f"載入音檔失敗: {e}")
        return None


def get_audio_duration(file_path: str) -> float:
    """取得音檔長度（秒）"""
    try:
        audio = AudioSegment.from_file(file_path)
        return len(audio) / 1000.0
    except Exception:
        return 0.0