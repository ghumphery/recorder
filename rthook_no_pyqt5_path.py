"""
自訂 PyInstaller runtime hook：在 pyi_rth_pyqt5.py 執行後清除 PyQt5 目錄。
阻止 PyQt5/Qt5/bin 被加入 PATH 和 AddDllDirectory，
避免 ctranslate2 載入時 VC++ runtime DLL 版本衝突。
"""
import os
import sys

# 在 pyi_rth_pyqt5.py 執行後，立即從 PATH 移除 PyQt5 目錄
path_dirs = os.environ.get('PATH', '').split(os.pathsep)
filtered = [d for d in path_dirs if 'PyQt5' not in d and 'Qt5' not in d]
os.environ['PATH'] = os.pathsep.join(filtered)