#!/usr/bin/env python3
"""
完整模擬 Recoder 啟動流程的最小化 windowed 測試。
測試改變 import 順序：先 faster-whisper，再 PyQt5。
"""

import os
import sys
import faulthandler
import traceback

# 與 main.py 相同的強化 stdout/stderr 保護
if getattr(sys, 'frozen', False) and sys.platform == 'win32':
    try:
        base_dir = os.path.dirname(sys.executable)
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

base_dir = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else os.path.dirname(os.path.abspath(__file__))

# 啟用 faulthandler
_fh_log = open(os.path.join(base_dir, 'faulthandler.log'), 'a', encoding='utf-8')
faulthandler.enable(_fh_log)

def _write_crash(msg):
    with open(os.path.join(base_dir, 'crash.log'), 'a', encoding='utf-8') as f:
        f.write(msg + '\n')

try:
    from logger import get_logger
    _log = get_logger('test_full_windowed')
    _log.info("測試程式啟動")

    _log.info("先載入 faster-whisper / ctranslate2 ...")
    os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'
    from faster_whisper import WhisperModel

    model_dir = os.path.join(base_dir, 'model', 'tiny')
    model_source = model_dir if os.path.exists(model_dir) and os.listdir(model_dir) else 'tiny'

    model = WhisperModel(
        model_source,
        device='cpu',
        compute_type='int8',
        cpu_threads=os.cpu_count() or 4,
        num_workers=1,
    )
    _log.info("WhisperModel 載入成功")

    _log.info("再初始化 PyQt5 QApplication...")
    from PyQt5.QtWidgets import QApplication
    app = QApplication(sys.argv)

    _log.info("完整流程測試通過")
    with open(os.path.join(base_dir, 'test_full_windowed.log'), 'a', encoding='utf-8') as f:
        f.write("完整流程測試通過\n")
except Exception as e:
    _write_crash(f"Exception: {e}\n{traceback.format_exc()}")