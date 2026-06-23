"""
logger.py — 日誌工具模組
所有 function 的 entry/exit/error 皆寫入 recoder.log，
包含時間戳、模組名、動作、結果。
"""

import os
import sys
import logging
from datetime import datetime
from pathlib import Path

# 日誌檔案路徑：exe 所在目錄（或專案根目錄）下的 app.log
if getattr(sys, 'frozen', False):
    # PyInstaller 打包後：exe 所在目錄
    _LOG_DIR = Path(sys.executable).parent
else:
    # 原始碼執行：專案根目錄
    _LOG_DIR = Path(__file__).parent
_LOG_FILE = _LOG_DIR / 'app.log'

# 日誌格式
_LOG_FORMAT = '%(asctime)s | %(levelname)-7s | %(name)-15s | %(message)s'
_DATE_FORMAT = '%Y-%m-%d %H:%M:%S'

# 快取已建立的 logger 避免重複設定
_loggers: dict[str, logging.Logger] = {}


def _setup_file_logger() -> logging.Logger:
    """設定 root logger，寫入檔案 + 輸出到 stderr"""
    root_logger = logging.getLogger('Recoder')
    
    if root_logger.handlers:
        return root_logger
    
    root_logger.setLevel(logging.DEBUG)
    
    # File handler — 寫入 recoder.log (append 模式)
    file_handler = logging.FileHandler(_LOG_FILE, mode='a', encoding='utf-8')
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(_LOG_FORMAT, _DATE_FORMAT))
    root_logger.addHandler(file_handler)
    
    return root_logger


def get_logger(name: str) -> logging.Logger:
    """
    取得指定名稱的 logger
    自動設定上層 handler，每個模組只需呼叫一次
    
    Args:
        name: 模組名稱 (例: 'recorder', 'transcriber', 'ui.main_window')
    
    Returns:
        logging.Logger 實例
    """
    if name in _loggers:
        return _loggers[name]
    
    # 確保 root logger 已設定
    _setup_file_logger()
    
    logger = logging.getLogger(f'Recoder.{name}')
    logger.setLevel(logging.DEBUG)
    logger.propagate = True  # 傳遞給 root handler
    
    _loggers[name] = logger
    return logger


def log_entry(logger: logging.Logger, func_name: str, **kwargs):
    """
    記錄 function entry
    
    Args:
        logger: logger 實例
        func_name: function 名稱
        **kwargs: 關鍵參數 (不含敏感資料)
    """
    params = ', '.join(f'{k}={v!r}' for k, v in kwargs.items()) if kwargs else ''
    logger.debug(f"▶ ENTRY {func_name}({params})")


def log_exit(logger: logging.Logger, func_name: str, result: str = "OK"):
    """
    記錄 function exit
    
    Args:
        logger: logger 實例
        func_name: function 名稱
        result: 結果描述 (預設 "OK")
    """
    logger.debug(f"◀ EXIT  {func_name} → {result}")


def log_error(logger: logging.Logger, func_name: str, error: Exception, context: str = ""):
    """
    記錄 function 錯誤
    
    Args:
        logger: logger 實例
        func_name: function 名稱
        error: 例外物件
        context: 額外上下文描述
    """
    msg = f"✖ ERROR {func_name}: {error}"
    if context:
        msg += f" ({context})"
    logger.error(msg, exc_info=True)


# 初始化時寫一條分隔線，方便區分每次執行
_init_logger = _setup_file_logger()
_init_logger.info(f"{'='*60}")
_init_logger.info(f"🚀 Recoder 啟動 — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
_init_logger.info(f"   Python: {sys.version.split()[0]}")
_init_logger.info(f"   路徑: {_LOG_DIR}")