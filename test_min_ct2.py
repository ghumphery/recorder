#!/usr/bin/env python3
"""
最小化測試：逐步加入 PyQt5 找出衝突點。
"""

import os
import sys
import faulthandler
import traceback

base_dir = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else os.path.dirname(os.path.abspath(__file__))

_fh_log = open(os.path.join(base_dir, 'faulthandler_min.log'), 'a', encoding='utf-8')
faulthandler.enable(_fh_log)

def _write_crash(msg):
    with open(os.path.join(base_dir, 'crash_min.log'), 'a', encoding='utf-8') as f:
        f.write(msg + '\n')

try:
    print("=== 逐步測試 PyQt5 + ctranslate2 ===")
    sys.stdout.flush()

    print("1. 載入 faster_whisper...")
    sys.stdout.flush()
    os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'
    from faster_whisper import WhisperModel
    print("   OK")

    print("2. 載入 WhisperModel (tiny)...")
    sys.stdout.flush()
    model_dir = os.path.join(base_dir, 'model', 'tiny')
    model_source = model_dir if os.path.exists(model_dir) and os.listdir(model_dir) else 'tiny'
    model = WhisperModel(
        model_source,
        device='cpu',
        compute_type='int8',
        cpu_threads=os.cpu_count() or 4,
        num_workers=1,
    )
    print("   OK")

    print("3. 載入 PyQt5.QtCore...")
    sys.stdout.flush()
    from PyQt5.QtCore import Qt
    print("   OK")

    print("4. 載入 PyQt5.QtGui...")
    sys.stdout.flush()
    from PyQt5.QtGui import QFont
    print("   OK")

    print("5. 載入 PyQt5.QtWidgets...")
    sys.stdout.flush()
    from PyQt5.QtWidgets import QApplication
    print("   OK")

    print("6. 初始化 QApplication...")
    sys.stdout.flush()
    app = QApplication(sys.argv)
    print("   OK")

    print("7. 全部測試通過！")
    with open(os.path.join(base_dir, 'test_min_ct2.log'), 'a', encoding='utf-8') as f:
        f.write("逐步測試通過\n")
except Exception as e:
    _write_crash(f"Exception: {e}\n{traceback.format_exc()}")
    print(f"FAILED at step: {e}")