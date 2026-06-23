#!/usr/bin/env python3
"""
Recoder — AI 會議記錄程式 (離線版)
使用 faster-whisper 語音辨識 + 說話者分離 (VAD + MFCC clustering)
完全離線運作，無需網路。

Electron + Vue.js 前端版本。
"""

import os
import sys
import threading
import time
from pathlib import Path

# 版本號 (語意化版本)
VERSION = "1.1.0"


def _setup_stdio_for_windowed():
    """
    PyInstaller --windowed 模式下，C 層級的 stdout/stderr file descriptor 無效。
    將 fd 1/2 重定向到一個持續開啟的真實檔案。
    """
    if not (getattr(sys, 'frozen', False) and sys.platform == 'win32'):
        return

    try:
        base_dir = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else os.path.dirname(os.path.abspath(__file__))
        log_path = os.path.join(base_dir, 'stdio_redirect.log')
        _stdio_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND)
        os.dup2(_stdio_fd, 1)
        os.dup2(_stdio_fd, 2)
        _stdio_file = open(log_path, 'a', encoding='utf-8', errors='replace')
        sys.stdout = _stdio_file
        sys.stderr = _stdio_file
    except Exception:
        try:
            _devnull_fd = os.open(os.devnull, os.O_WRONLY)
            os.dup2(_devnull_fd, 1)
            os.dup2(_devnull_fd, 2)
            os.close(_devnull_fd)
        except Exception:
            pass


_setup_stdio_for_windowed()


def start_backend():
    """啟動 Flask 後端伺服器（主執行緒執行）"""
    from backend.server import run_server
    print(f"Recoder v{VERSION} — 啟動後端伺服器 http://127.0.0.1:5199")
    run_server(host='127.0.0.1', port=5199, debug=False)


def main():
    # 確保可以正確 import 專案模組
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    
    # 直接在主執行緒啟動 Flask（blocking call）
    # Flask 的 threaded=True 會自動處理多請求
    start_backend()


if __name__ == '__main__':
    main()