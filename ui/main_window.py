"""
main_window.py — PyQt5 主視窗
提供錄音、匯入、辨識、說話者標註、匯出等功能。
"""

import os
import sys
from pathlib import Path
from typing import Optional

from PyQt5.QtCore import Qt, QTimer, pyqtSignal, QObject, QThread
from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QTextEdit, QLabel, QComboBox, QProgressBar,
    QFileDialog, QMessageBox, QInputDialog, QStatusBar, QSplitter,
    QFrame, QGroupBox, QListWidget, QListWidgetItem, QAbstractItemView,
    QMenu, QAction,
)
from PyQt5.QtGui import QFont, QTextCursor, QColor, QTextCharFormat, QIcon

from logger import get_logger, log_entry, log_exit, log_error
from main import VERSION

# UI 模組日誌
_log = get_logger('ui.main_window')


class WorkerSignals(QObject):
    """工作線程信號 (需指定 parent 確保 Qt 生命週期安全)"""
    progress = pyqtSignal(float)
    finished = pyqtSignal(list)
    error = pyqtSignal(str)
    download_progress = pyqtSignal(float)
    download_finished = pyqtSignal()
    download_error = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)


class DownloadWorker(QThread):
    """後台模型下載工作線程 (QThread)"""
    def __init__(self, model_size):
        super().__init__()
        self.model_size = model_size
        self.signals = WorkerSignals(parent=self)
        self._log = get_logger('ui.download')
        log_entry(self._log, 'DownloadWorker.__init__', model_size=model_size)
    
    def run(self):
        log_entry(self._log, 'run', model_size=self.model_size)
        try:
            from transcriber import download_model
            
            def _progress(p):
                self.signals.download_progress.emit(p)
            
            success = download_model(self.model_size, progress_callback=_progress)
            
            if success:
                self.signals.download_finished.emit()
                log_exit(self._log, 'run', 'OK')
            else:
                self.signals.download_error.emit("模型下載失敗，請檢查網路連線")
                log_exit(self._log, 'run', 'FAIL')
        except Exception as e:
            log_error(self._log, 'run', e)
            self.signals.download_error.emit(str(e))


class TranscriptionWorker(QThread):
    """後台辨識工作線程 (QThread)"""
    def __init__(self, audio_path, model_size):
        super().__init__()
        self.audio_path = audio_path
        self.model_size = model_size
        self.signals = WorkerSignals(parent=self)
        self._log = get_logger('ui.worker')
        log_entry(self._log, 'TranscriptionWorker.__init__', audio_path=audio_path, model_size=model_size)
    
    def run(self):
        log_entry(self._log, 'run', audio_path=self.audio_path)
        try:
            import io
            import sys
            from transcriber import transcribe
            from diarizer import diarize, merge_with_transcription

            # PyInstaller --windowed 模式下 stdout/stderr 為 None，某些底層 C++ 庫
            # (ctranslate2/faster-whisper) 若嘗試輸出可能導致進程直接崩潰。
            # 在整個 worker 執行期間將 stdout/stderr 重定向到 StringIO，完成後還原。
            old_stdout = sys.stdout
            old_stderr = sys.stderr
            sys.stdout = io.StringIO()
            sys.stderr = io.StringIO()

            try:
                # 先執行說話者分離
                self._log.info("開始說話者分離...")
                segments = diarize(self.audio_path)
                self._log.info(f"說話者分離完成，片段數: {len(segments) if segments else 0}")

                # 執行語音辨識
                self._log.info("開始語音辨識...")

                def _progress_callback(p):
                    self._log.debug(f"辨識進度: {p:.2%}")
                    self.signals.progress.emit(p * 0.8)  # 辨識佔 80%

                transcription = transcribe(
                    self.audio_path,
                    model_size=self.model_size,
                    progress_callback=_progress_callback,
                )

                if transcription is None:
                    self.signals.error.emit("語音辨識失敗")
                    self._log.error("語音辨識回傳 None")
                    log_exit(self._log, 'run', "FAIL")
                    return

                # 合併結果
                self._log.info(f"合併說話者標籤，共 {len(transcription)} 句")
                self.signals.progress.emit(0.9)
                results = merge_with_transcription(segments, transcription)

                self.signals.progress.emit(1.0)
                self.signals.finished.emit(results)
                log_exit(self._log, 'run', f"OK ({len(results)} 句)")
            finally:
                sys.stdout = old_stdout
                sys.stderr = old_stderr
        except Exception as e:
            log_error(self._log, 'run', e)
            self.signals.error.emit(str(e))


class SpeakerListWidget(QWidget):
    """說話者列表與重新命名元件"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.speaker_colors = {}
        self.speaker_names = {}
        self._init_ui()
    
    def _init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        # 標題
        title = QLabel("👥 說話者")
        title.setStyleSheet("font-weight: bold; font-size: 13px; padding: 4px;")
        layout.addWidget(title)
        
        # 列表
        self.list_widget = QListWidget()
        self.list_widget.setContextMenuPolicy(Qt.CustomContextMenu)
        self.list_widget.customContextMenuRequested.connect(self._show_context_menu)
        layout.addWidget(self.list_widget)
    
    def update_speakers(self, results: list[dict]):
        """根據辨識結果更新說話者列表"""
        speakers = set()
        for r in results:
            speakers.add(r['speaker'])
        
        # 保留已知名稱
        old_names = self.speaker_names.copy()
        self.speaker_names = {s: old_names.get(s, s) for s in speakers}
        
        # 分配顏色
        colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336', '#00BCD4', '#795548', '#607D8B']
        self.speaker_colors = {
            s: colors[i % len(colors)] for i, s in enumerate(sorted(speakers))
        }
        
        self._refresh_list()
    
    def _refresh_list(self):
        """重新整理列表顯示"""
        self.list_widget.clear()
        for speaker, display_name in sorted(self.speaker_names.items()):
            color = self.speaker_colors.get(speaker, '#000000')
            item = QListWidgetItem(f"● {display_name}")
            item.setForeground(QColor(color))
            item.setData(Qt.UserRole, speaker)
            item.setToolTip(f"原始標籤: {speaker}")
            self.list_widget.addItem(item)
    
    def _show_context_menu(self, pos):
        """顯示右鍵選單 - 重新命名"""
        item = self.list_widget.itemAt(pos)
        if item is None:
            return
        
        speaker = item.data(Qt.UserRole)
        current_name = self.speaker_names.get(speaker, speaker)
        
        menu = QMenu()
        rename_action = menu.addAction(f"重新命名「{current_name}」")
        
        action = menu.exec_(self.list_widget.mapToGlobal(pos))
        if action == rename_action:
            self._rename_speaker(speaker, current_name)
    
    def _rename_speaker(self, speaker: str, current_name: str):
        """重新命名說話者"""
        new_name, ok = QInputDialog.getText(
            self, "重新命名說話者",
            "輸入新的名稱:",
            text=current_name,
        )
        if ok and new_name.strip():
            self.speaker_names[speaker] = new_name.strip()
            self._refresh_list()
    
    def get_display_name(self, speaker: str) -> str:
        """取得說話者的顯示名稱（經過重新命名）"""
        return self.speaker_names.get(speaker, speaker)
    
    def get_color(self, speaker: str) -> str:
        """取得說話者的顏色"""
        return self.speaker_colors.get(speaker, '#000000')


class MainWindow(QMainWindow):
    """主視窗"""
    
    # 視窗大小
    WINDOW_WIDTH = 900
    WINDOW_HEIGHT = 700
    
    def __init__(self):
        super().__init__()
        self.current_audio_path: Optional[str] = None
        self.transcription_results: Optional[list[dict]] = None
        self.is_recording = False
        self.recording_timer = QTimer()
        self.recording_seconds = 0
        
        self._init_ui()
        self._connect_signals()
        log_entry(_log, 'MainWindow.__init__')
        log_exit(_log, 'MainWindow.__init__')
    
    def _init_ui(self):
        """初始化 UI"""
        self.setWindowTitle(f"Recoder — AI 會議記錄 v{VERSION}")
        self.setMinimumSize(self.WINDOW_WIDTH, self.WINDOW_HEIGHT)
        
        # 主 widget
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)
        main_layout.setSpacing(8)
        main_layout.setContentsMargins(12, 12, 12, 12)
        
        # ---- 上方控制區 ----
        control_frame = QFrame()
        control_frame.setFrameShape(QFrame.StyledPanel)
        control_frame.setStyleSheet("""
            QFrame { background-color: #f5f5f5; border-radius: 6px; padding: 8px; }
        """)
        control_layout = QHBoxLayout(control_frame)
        
        # 錄音按鈕
        self.btn_record = QPushButton("🎙️ 開始錄音")
        self.btn_record.setMinimumHeight(40)
        self.btn_record.setStyleSheet("""
            QPushButton { 
                font-size: 14px; font-weight: bold; padding: 8px 20px;
                background-color: #F44336; color: white; border-radius: 6px;
            }
            QPushButton:hover { background-color: #D32F2F; }
            QPushButton:disabled { background-color: #ccc; }
        """)
        control_layout.addWidget(self.btn_record)
        
        # 匯入按鈕
        self.btn_import = QPushButton("📂 匯入音檔")
        self.btn_import.setMinimumHeight(40)
        self.btn_import.setStyleSheet("""
            QPushButton {
                font-size: 14px; padding: 8px 20px;
                background-color: #607D8B; color: white; border-radius: 6px;
            }
            QPushButton:hover { background-color: #455A64; }
        """)
        control_layout.addWidget(self.btn_import)
        
        # 模型選擇
        control_layout.addSpacing(20)
        model_label = QLabel("模型:")
        model_label.setStyleSheet("font-size: 13px;")
        control_layout.addWidget(model_label)
        
        self.combo_model = QComboBox()
        self.combo_model.addItems(['tiny', 'base', 'small'])
        self.combo_model.setCurrentText('tiny')
        self.combo_model.setToolTip("tiny=最快, small=最準")
        self.combo_model.setMinimumWidth(100)
        self.combo_model.setStyleSheet("padding: 4px; font-size: 13px;")
        control_layout.addWidget(self.combo_model)
        
        # 辨識按鈕
        self.btn_transcribe = QPushButton("🤖 開始辨識")
        self.btn_transcribe.setMinimumHeight(40)
        self.btn_transcribe.setEnabled(False)
        self.btn_transcribe.setStyleSheet("""
            QPushButton {
                font-size: 14px; font-weight: bold; padding: 8px 20px;
                background-color: #2196F3; color: white; border-radius: 6px;
            }
            QPushButton:hover { background-color: #1976D2; }
            QPushButton:disabled { background-color: #ccc; }
        """)
        control_layout.addWidget(self.btn_transcribe)
        
        # 匯出按鈕
        self.btn_export = QPushButton("💾 匯出")
        self.btn_export.setMinimumHeight(40)
        self.btn_export.setEnabled(False)
        self.btn_export.setStyleSheet("""
            QPushButton {
                font-size: 14px; padding: 8px 20px;
                background-color: #4CAF50; color: white; border-radius: 6px;
            }
            QPushButton:hover { background-color: #388E3C; }
            QPushButton:disabled { background-color: #ccc; }
        """)
        control_layout.addWidget(self.btn_export)
        
        control_layout.addStretch()
        main_layout.addWidget(control_frame)
        
        # ---- 錄音狀態 ----
        self.label_recording = QLabel("")
        self.label_recording.setAlignment(Qt.AlignCenter)
        self.label_recording.setStyleSheet("font-size: 14px; color: #F44336; font-weight: bold; padding: 4px;")
        main_layout.addWidget(self.label_recording)
        
        # ---- 進度條 ----
        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        self.progress_bar.setTextVisible(True)
        self.progress_bar.setStyleSheet("""
            QProgressBar {
                border: 1px solid #ccc; border-radius: 4px; text-align: center;
                height: 22px;
            }
            QProgressBar::chunk { background-color: #2196F3; border-radius: 3px; }
        """)
        main_layout.addWidget(self.progress_bar)
        
        # ---- 中央區 (說話者列表 + 逐字稿) ----
        splitter = QSplitter(Qt.Horizontal)
        
        # 左側：說話者
        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(0, 0, 0, 0)
        self.speaker_widget = SpeakerListWidget()
        left_layout.addWidget(self.speaker_widget)
        splitter.addWidget(left_panel)
        
        # 右側：逐字稿
        right_panel = QWidget()
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(0, 0, 0, 0)
        
        transcript_label = QLabel("📝 逐字稿")
        transcript_label.setStyleSheet("font-weight: bold; font-size: 13px; padding: 4px;")
        right_layout.addWidget(transcript_label)
        
        self.text_edit = QTextEdit()
        self.text_edit.setReadOnly(False)
        self.text_edit.setFont(QFont("Microsoft JhengHei", 11))
        self.text_edit.setStyleSheet("""
            QTextEdit {
                border: 1px solid #ddd; border-radius: 4px;
                padding: 8px; background-color: white;
            }
        """)
        right_layout.addWidget(self.text_edit)
        splitter.addWidget(right_panel)
        
        # 設定比例
        splitter.setSizes([200, 700])
        main_layout.addWidget(splitter, stretch=1)
        
        # ---- 狀態列 ----
        self.status_bar = QStatusBar()
        self.setStatusBar(self.status_bar)
        self.status_bar.showMessage("就緒")
        
        # 錄音計時器
        self.recording_timer = QTimer()
        self.recording_timer.timeout.connect(self._update_recording_time)
    
    def _connect_signals(self):
        """連接按鈕事件"""
        self.btn_record.clicked.connect(self._toggle_recording)
        self.btn_import.clicked.connect(self._import_audio)
        self.btn_transcribe.clicked.connect(self._start_transcription)
        self.btn_export.clicked.connect(self._export_result)
    
    def _toggle_recording(self):
        """切換錄音狀態"""
        if not self.is_recording:
            self._start_recording()
        else:
            self._stop_recording()
    
    def _start_recording(self):
        """開始錄音"""
        try:
            from recorder import start_recording
            start_recording()
            
            self.is_recording = True
            self.btn_record.setText("⏹️ 停止錄音")
            self.btn_import.setEnabled(False)
            self.btn_transcribe.setEnabled(False)
            self.btn_export.setEnabled(False)
            
            # 開始計時
            self.recording_seconds = 0
            self.recording_timer.start(1000)  # 每秒更新
            
            self.status_bar.showMessage("🎙️ 錄音中...")
        except Exception as e:
            QMessageBox.warning(self, "錄音失敗", f"無法開始錄音:\n{e}")
    
    def _stop_recording(self):
        """停止錄音"""
        from recorder import stop_recording
        
        self.recording_timer.stop()
        
        file_path = stop_recording()
        if file_path:
            self.current_audio_path = file_path
            self.btn_transcribe.setEnabled(True)
            self.status_bar.showMessage(f"✅ 錄音完成: {os.path.basename(file_path)}")
        else:
            self.status_bar.showMessage("⚠️ 錄音無資料")
        
        self.is_recording = False
        self.btn_record.setText("🎙️ 開始錄音")
        self.btn_import.setEnabled(True)
        self.label_recording.setText("")
    
    def _update_recording_time(self):
        """更新錄音時間顯示"""
        self.recording_seconds += 1
        mins, secs = divmod(self.recording_seconds, 60)
        time_str = f"{mins:02d}:{secs:02d}"
        
        # 檢查是否超時
        from recorder import MAX_DURATION_MINUTES
        max_secs = MAX_DURATION_MINUTES * 60
        if self.recording_seconds >= max_secs:
            self._stop_recording()
            QMessageBox.information(self, "錄音完成", f"已達到最大錄音時長 ({MAX_DURATION_MINUTES} 分鐘)")
            return
        
        self.label_recording.setText(f"🔴 錄音中 {time_str} / {MAX_DURATION_MINUTES}:00")
    
    def _import_audio(self):
        """匯入音檔"""
        file_path, _ = QFileDialog.getOpenFileName(
            self, "選擇音檔", "",
            "音訊檔案 (*.wav *.mp3 *.opus *.ogg *.flac *.m4a);;所有檔案 (*.*)"
        )
        if not file_path:
            return
        
        self.status_bar.showMessage(f"正在載入: {os.path.basename(file_path)}...")
        QApplication.processEvents()
        
        try:
            from recorder import load_audio
            wav_path = load_audio(file_path)
            
            if wav_path:
                self.current_audio_path = wav_path
                self.btn_transcribe.setEnabled(True)
                self.status_bar.showMessage(f"✅ 已匯入: {os.path.basename(file_path)}")
                
                # 顯示基本資訊
                import wave
                with wave.open(wav_path, 'rb') as wf:
                    duration = wf.getnframes() / wf.getframerate()
                mins, secs = divmod(int(duration), 60)
                self.text_edit.setText(f"📂 已匯入音檔: {os.path.basename(file_path)}\n"
                                      f"⏱️ 長度: {mins:02d}:{secs:02d}\n"
                                      f"━━━━━━━━━━━━━━━━━━\n"
                                      f"點擊「開始辨識」按鈕開始轉文字...")
            else:
                QMessageBox.warning(self, "匯入失敗", "無法載入此音檔")
        except Exception as e:
            QMessageBox.warning(self, "匯入失敗", f"載入音檔時發生錯誤:\n{e}")
    
    def _start_transcription(self):
        """開始辨識（後台執行）"""
        if not self.current_audio_path or not os.path.exists(self.current_audio_path):
            QMessageBox.warning(self, "無音檔", "請先錄音或匯入音檔")
            return
        
        model_size = self.combo_model.currentText()
        
        # 檢查模型是否已下載
        from transcriber import is_model_cached, get_model_size_mb
        if not is_model_cached(model_size):
            size_mb = get_model_size_mb(model_size)
            reply = QMessageBox.question(
                self,
                "下載辨識模型",
                f"語音辨識模型「{model_size}」尚未下載。\n\n"
                f"模型大小：約 {size_mb} MB\n"
                f"下載來源：Hugging Face Hub\n"
                f"存放位置：model/{model_size}/\n\n"
                f"是否要現在下載？（僅需下載一次）",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.Yes,
            )
            if reply == QMessageBox.No:
                _log.info(f"使用者取消下載模型 {model_size}")
                self.status_bar.showMessage("已取消辨識")
                return
            _log.info(f"使用者確認下載模型 {model_size} ({size_mb} MB)")
            
            # 禁用按鈕
            self.btn_transcribe.setEnabled(False)
            self.btn_record.setEnabled(False)
            self.btn_import.setEnabled(False)
            self.btn_export.setEnabled(False)
            
            # 顯示下載進度
            self.progress_bar.setVisible(True)
            self.progress_bar.setValue(0)
            self.progress_bar.setFormat("下載模型中... %p%")
            self.text_edit.setText(f"⏳ 正在下載語音辨識模型「{model_size}」...\n\n"
                                  f"模型大小：約 {size_mb} MB\n"
                                  f"存放位置：model/{model_size}/\n\n"
                                  f"請耐心等候，下載完成後將自動開始辨識。")
            self.status_bar.showMessage(f"正在下載模型 {model_size}...")
            
            # 啟動下載線程
            self.download_worker = DownloadWorker(model_size)
            self.download_worker.signals.download_progress.connect(self._on_download_progress)
            self.download_worker.signals.download_finished.connect(lambda: self._on_download_finished(model_size))
            self.download_worker.signals.download_error.connect(self._on_download_error)
            self.download_worker.start()
            return
        
        # 模型已存在，直接開始辨識
        self._begin_transcription(model_size)
    
    def _on_download_progress(self, value: float):
        """下載進度更新"""
        self.progress_bar.setValue(int(value * 100))
        self.progress_bar.setFormat(f"下載模型中... {int(value * 100)}%")
        self.status_bar.showMessage(f"正在下載模型... {int(value * 100)}%")
    
    def _on_download_finished(self, model_size: str):
        """下載完成，自動開始辨識"""
        _log.info(f"模型 {model_size} 下載完成，自動開始辨識")
        self.status_bar.showMessage("模型下載完成，開始辨識...")
        self._begin_transcription(model_size)
    
    def _on_download_error(self, error_msg: str):
        """下載失敗"""
        _log.error(f"模型下載失敗: {error_msg}")
        self.progress_bar.setVisible(False)
        self.text_edit.setText(f"❌ 模型下載失敗:\n{error_msg}\n\n"
                              f"請檢查網路連線後重試。")
        self.status_bar.showMessage("❌ 模型下載失敗")
        self.btn_transcribe.setEnabled(True)
        self.btn_record.setEnabled(True)
        self.btn_import.setEnabled(True)
    
    def _begin_transcription(self, model_size: str):
        """開始辨識（模型已就緒）"""
        # 禁用按鈕
        self.btn_transcribe.setEnabled(False)
        self.btn_record.setEnabled(False)
        self.btn_import.setEnabled(False)
        self.btn_export.setEnabled(False)
        
        # 顯示進度
        self.progress_bar.setVisible(True)
        self.progress_bar.setValue(0)
        self.progress_bar.setFormat("辨識中... %p%")
        self.text_edit.setText("⏳ 正在進行語音辨識與說話者分離...\n\n請耐心等候，這可能需要幾分鐘。")
        self.status_bar.showMessage("辨識中...")
        
        # 啟動工作線程
        self.worker = TranscriptionWorker(
            self.current_audio_path,
            model_size,
        )
        self.worker.signals.progress.connect(self._on_progress)
        self.worker.signals.finished.connect(self._on_transcription_done)
        self.worker.signals.error.connect(self._on_transcription_error)
        self.worker.start()
    
    def _on_progress(self, value: float):
        """進度更新"""
        self.progress_bar.setValue(int(value * 100))
        self.progress_bar.setVisible(True)
        if value > 0.8:
            self.status_bar.showMessage("正在合併說話者標籤...")
        elif value > 0:
            self.status_bar.showMessage(f"辨識中... {int(value * 100)}%")
    
    def _on_transcription_done(self, results: list[dict]):
        """辨識完成"""
        self.transcription_results = results
        
        # 更新說話者列表
        self.speaker_widget.update_speakers(results)
        
        # 顯示逐字稿
        self._display_transcription(results)
        
        # 啟用按鈕
        self.btn_transcribe.setEnabled(True)
        self.btn_record.setEnabled(True)
        self.btn_import.setEnabled(True)
        self.btn_export.setEnabled(True)
        
        # 隱藏進度
        self.progress_bar.setVisible(False)
        
        self.status_bar.showMessage(f"✅ 辨識完成！共 {len(results)} 句")
    
    def _on_transcription_error(self, error_msg: str):
        """辨識失敗"""
        self.text_edit.setText(f"❌ 辨識失敗:\n{error_msg}\n\n"
                              f"可能原因：\n"
                              f"1. 音檔格式不支援\n"
                              f"2. 模型下載失敗（首次使用需下載）\n"
                              f"3. 系統資源不足")
        
        self.btn_transcribe.setEnabled(True)
        self.btn_record.setEnabled(True)
        self.btn_import.setEnabled(True)
        self.btn_export.setEnabled(False)
        
        self.progress_bar.setVisible(False)
        self.status_bar.showMessage("❌ 辨識失敗")
    
    def _display_transcription(self, results: list[dict]):
        """在文字區顯示逐字稿（含說話者顏色）"""
        self.text_edit.clear()
        cursor = self.text_edit.textCursor()
        
        for r in results:
            # 時間戳
            start_m, start_s = divmod(int(r['start']), 60)
            end_m, end_s = divmod(int(r['end']), 60)
            timestamp = f"[{start_m:02d}:{start_s:02d} - {end_m:02d}:{end_s:02d}]"
            
            # 說話者
            speaker = r['speaker']
            display_name = self.speaker_widget.get_display_name(speaker)
            color = self.speaker_widget.get_color(speaker)
            
            # 時間戳格式
            fmt = QTextCharFormat()
            fmt.setForeground(QColor('#888888'))
            fmt.setFontPointSize(9)
            cursor.insertText(timestamp + " ", fmt)
            
            # 說話者格式
            fmt = QTextCharFormat()
            fmt.setForeground(QColor(color))
            fmt.setFontWeight(QFont.Bold)
            cursor.insertText(f"【{display_name}】 ", fmt)
            
            # 文字
            fmt = QTextCharFormat()
            fmt.setFontPointSize(11)
            cursor.insertText(r['text'], fmt)
            
            # 換行
            cursor.insertText("\n\n")
        
        self.text_edit.setTextCursor(cursor)
        self.text_edit.ensureCursorVisible()
    
    def _export_result(self):
        """匯出逐字稿"""
        if not self.transcription_results:
            QMessageBox.warning(self, "無資料", "尚無辨識結果可匯出")
            return
        
        # 選擇格式
        file_path, selected_filter = QFileDialog.getSaveFileName(
            self, "匯出逐字稿", "會議記錄",
            "純文字 (*.txt);;Markdown (*.md);;所有檔案 (*.*)"
        )
        if not file_path:
            return
        
        try:
            ext = os.path.splitext(file_path)[1].lower()
            
            if ext == '.md':
                content = self._format_as_markdown()
            else:
                content = self._format_as_text()
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            
            self.status_bar.showMessage(f"✅ 已匯出: {os.path.basename(file_path)}")
        except Exception as e:
            QMessageBox.warning(self, "匯出失敗", f"無法寫入檔案:\n{e}")
    
    def _format_as_text(self) -> str:
        """格式化為純文字"""
        lines = ["Recoder — AI 會議記錄", "=" * 40, ""]
        
        for r in self.transcription_results:
            start_m, start_s = divmod(int(r['start']), 60)
            end_m, end_s = divmod(int(r['end']), 60)
            
            speaker = r['speaker']
            display_name = self.speaker_widget.get_display_name(speaker)
            
            lines.append(f"[{start_m:02d}:{start_s:02d} - {end_m:02d}:{end_s:02d}]")
            lines.append(f"【{display_name}】 {r['text']}")
            lines.append("")
        
        return '\n'.join(lines)
    
    def _format_as_markdown(self) -> str:
        """格式化為 Markdown"""
        lines = ["# Recoder — AI 會議記錄", "", "| 時間 | 說話者 | 內容 |", "|------|--------|------|"]
        
        for r in self.transcription_results:
            start_m, start_s = divmod(int(r['start']), 60)
            end_m, end_s = divmod(int(r['end']), 60)
            
            speaker = r['speaker']
            display_name = self.speaker_widget.get_display_name(speaker)
            
            lines.append(
                f"| {start_m:02d}:{start_s:02d}~{end_m:02d}:{end_s:02d} | {display_name} | {r['text']} |"
            )
        
        lines.append("")
        return '\n'.join(lines)


def run():
    """啟動 GUI"""
    app = QApplication(sys.argv)
    app.setStyle('Fusion')
    
    # 全域樣式
    app.setStyleSheet("""
        QMainWindow { background-color: #fafafa; }
        QToolTip { font-size: 12px; }
    """)
    
    window = MainWindow()
    window.show()
    sys.exit(app.exec_())