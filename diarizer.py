"""
diarizer.py — 說話者分離模組
使用 webrtcvad 偵測語音活動、librosa MFCC + sklearn 分群，
自動標註不同說話者。

流程:
1. 載入音檔 → 取 16kHz mono 音訊數據
2. webrtcvad 切割語音片段 (移除靜音)
3. 每個片段提取 MFCC 特徵
4. Agglomerative Clustering 分群
5. 回傳帶說話者標籤的語音段落
"""

import os
import collections
import struct
import wave
import numpy as np
import webrtcvad
from sklearn.cluster import AgglomerativeClustering
from sklearn.preprocessing import StandardScaler
from typing import Optional

from logger import get_logger, log_entry, log_exit, log_error

_log = get_logger('diarizer')

# 設定
SAMPLE_RATE = 16000
FRAME_DURATION_MS = 30     # VAD 幀長 (10/20/30ms)
VAD_AGGRESSIVENESS = 1     # VAD 敏感度 (0=最寬鬆, 3=最嚴格)
MIN_SPEECH_DURATION_MS = 500   # 最小語音片段長度 (ms)
MAX_SPEECH_DURATION_MS = 10000 # 最大語音片段長度 (ms)，超過則切分
SILENCE_PADDING_MS = 300       # 語音片段前後填充的靜音 (ms)


def _read_wave(path: str) -> tuple[np.ndarray, int]:
    """讀取 WAV 檔，回傳 (音訊數據, 採樣率)"""
    with wave.open(path, 'rb') as wf:
        num_channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        framerate = wf.getframerate()
        num_frames = wf.getnframes()
        raw_data = wf.readframes(num_frames)
    
    # 轉為 numpy array
    dtype = {1: np.int8, 2: np.int16, 4: np.int32}[sample_width]
    samples = np.frombuffer(raw_data, dtype=dtype)
    
    # 如果是立體聲，取左聲道
    if num_channels > 1:
        samples = samples[::num_channels]
    
    return samples, framerate


def _convert_to_16bit_mono(samples: np.ndarray, orig_sr: int) -> np.ndarray:
    """確保音訊為 16kHz 16-bit 單聲道"""
    # 重新採樣至 16kHz
    if orig_sr != SAMPLE_RATE:
        from scipy import signal
        samples = signal.resample_poly(
            samples.astype(np.float64),
            SAMPLE_RATE,
            orig_sr
        ).astype(np.int16)
    
    # 轉為 16-bit
    if samples.dtype != np.int16:
        max_val = np.iinfo(np.int16).max
        samples = (samples.astype(np.float64) / np.max(np.abs(samples)) * max_val).astype(np.int16)
    
    return samples


def _vad_segment(samples: np.ndarray) -> list[list[int]]:
    """
    使用 webrtcvad 偵測語音活動，回傳語音段落 [start_sample, end_sample] 列表
    
    Args:
        samples: 16kHz 16-bit mono 音訊數據
    
    Returns:
        list of [start, end] sample index pairs
    """
    vad = webrtcvad.Vad(VAD_AGGRESSIVENESS)
    
    frame_size = int(SAMPLE_RATE * FRAME_DURATION_MS / 1000)
    frames = []
    
    # 切分為 VAD 幀
    for i in range(0, len(samples) - frame_size + 1, frame_size):
        frame = samples[i:i + frame_size]
        frame_bytes = frame.tobytes()
        is_speech = vad.is_speech(frame_bytes, SAMPLE_RATE)
        frames.append(is_speech)
    
    # 合併連續的語音幀為段落
    segments = []
    in_speech = False
    start_frame = 0
    
    for i, is_speech in enumerate(frames):
        if is_speech and not in_speech:
            start_frame = i
            in_speech = True
        elif not is_speech and in_speech:
            end_frame = i
            segment_duration_ms = (end_frame - start_frame) * FRAME_DURATION_MS
            
            if segment_duration_ms >= MIN_SPEECH_DURATION_MS:
                # 前後填充 padding
                padding_samples = int(SAMPLE_RATE * SILENCE_PADDING_MS / 1000)
                start_sample = max(0, start_frame * frame_size - padding_samples)
                end_sample = min(len(samples), end_frame * frame_size + padding_samples)
                segments.append([start_sample, end_sample])
            
            in_speech = False
    
    # 處理最後一段語音
    if in_speech:
        padding_samples = int(SAMPLE_RATE * SILENCE_PADDING_MS / 1000)
        start_sample = max(0, start_frame * frame_size - padding_samples)
        end_sample = len(samples)
        segments.append([start_sample, end_sample])
    
    # 合併過近的片段
    if len(segments) > 1:
        merged = [segments[0]]
        for seg in segments[1:]:
            prev = merged[-1]
            gap = seg[0] - prev[1]
            if gap < SAMPLE_RATE * 0.3:  # 間隔小於 0.3 秒則合併
                merged[-1][1] = seg[1]
            else:
                merged.append(seg)
        segments = merged
    
    return segments


def _extract_features(samples: np.ndarray, segments: list[list[int]]) -> np.ndarray:
    """
    對每個語音片段提取 MFCC 特徵
    
    Args:
        samples: 音訊數據
        segments: 語音段落列表 [[start, end], ...]
    
    Returns:
        features: 每個片段的特徵向量 (n_segments, n_features)
    """
    import librosa
    
    # 轉為 float32 給 librosa
    audio_float = samples.astype(np.float32) / np.iinfo(np.int16).max
    
    features = []
    for start, end in segments:
        segment = audio_float[start:end]
        
        if len(segment) < SAMPLE_RATE * 0.3:  # 太短的片段跳過
            features.append(None)
            continue
        
        try:
            # 提取 MFCC (13 coefficients) + delta + delta-delta
            mfcc = librosa.feature.mfcc(
                y=segment,
                sr=SAMPLE_RATE,
                n_mfcc=13,
                n_fft=512,
                hop_length=256,
            )
            delta = librosa.feature.delta(mfcc)
            delta2 = librosa.feature.delta(mfcc, order=2)
            
            # 取每個係數的平均值與標準差
            feat = np.concatenate([
                np.mean(mfcc, axis=1),
                np.std(mfcc, axis=1),
                np.mean(delta, axis=1),
                np.std(delta, axis=1),
                np.mean(delta2, axis=1),
                np.std(delta2, axis=1),
            ])
            features.append(feat)
        except Exception as e:
            print(f"特徵提取失敗 (片段 {start}-{end}): {e}")
            features.append(None)
    
    # 過濾無效片段
    valid_idx = [i for i, f in enumerate(features) if f is not None]
    if len(valid_idx) < 2:
        return np.array([]), valid_idx
    
    valid_features = np.array([features[i] for i in valid_idx])
    return valid_features, valid_idx


def _cluster_speakers(features: np.ndarray, n_clusters: Optional[int] = None) -> tuple[np.ndarray, int]:
    """
    使用 Agglomerative Clustering 對語音片段進行說話者分群
    
    Args:
        features: 特徵矩陣 (n_samples, n_features)
        n_clusters: 分群數量，None 則自動推斷
    
    Returns:
        labels: 每個片段的群組標籤
        n_clusters: 實際分群數
    """
    # 標準化
    scaler = StandardScaler()
    features_scaled = scaler.fit_transform(features)
    
    # 自動推斷群數 (最多 min(5, n_samples))
    max_clusters = min(5, len(features))
    if n_clusters is None:
        from sklearn.metrics import silhouette_score
        best_score = -1
        best_n = 2
        
        for n in range(2, max_clusters + 1):
            if n >= len(features):
                break
            clusterer = AgglomerativeClustering(n_clusters=n, linkage='ward')
            labels = clusterer.fit_predict(features_scaled)
            
            if len(set(labels)) > 1:  # 需要至少兩個群
                score = silhouette_score(features_scaled, labels)
                if score > best_score:
                    best_score = score
                    best_n = n
        
        n_clusters = best_n
    
    # 最終分群
    clusterer = AgglomerativeClustering(n_clusters=n_clusters, linkage='ward')
    labels = clusterer.fit_predict(features_scaled)
    
    return labels, n_clusters


def diarize(
    audio_path: str,
    n_speakers: Optional[int] = None,
) -> Optional[list[dict]]:
    """
    執行說話者分離
    
    Args:
        audio_path: 音檔路徑 (16kHz mono WAV)
        n_speakers: 指定說話者數量，None 則自動推斷
    
    Returns:
        list of dict，每個 dict 包含:
            - 'start': 起始時間 (秒)
            - 'end': 結束時間 (秒)
            - 'speaker': 說話者 ID (如 'A', 'B', ...)
        若無法分群（語音片段太少），回傳 None
    """
    log_entry(_log, 'diarize', audio_path=audio_path, n_speakers=n_speakers)
    try:
        _log.info(f"開始說話者分離: {audio_path}")
        
        # 讀取音檔
        samples, orig_sr = _read_wave(audio_path)
        
        # 確保格式正確
        samples = _convert_to_16bit_mono(samples, orig_sr)
        
        # VAD 切割
        segments = _vad_segment(samples)
        _log.info(f"VAD 切割出 {len(segments)} 個語音片段")
        
        if len(segments) < 2:
            _log.warning("語音片段不足，跳過說話者分離")
            log_exit(_log, 'diarize', 'INSUFFICIENT_SEGMENTS')
            return None
        
        # 提取特徵
        features, valid_idx = _extract_features(samples, segments)
        
        if len(features) < 2:
            _log.warning("有效片段不足，跳過說話者分離")
            log_exit(_log, 'diarize', 'INSUFFICIENT_FEATURES')
            return None
        
        # 分群
        labels, n_clusters = _cluster_speakers(features, n_speakers)
        _log.info(f"分群完成: {n_clusters} 個說話者")
        
        # 建立結果
        speaker_names = {
            i: chr(ord('A') + i) for i in range(n_clusters)
        }
        
        results = []
        for i, idx in enumerate(valid_idx):
            start, end = segments[idx]
            speaker_id = speaker_names[labels[i]]
            results.append({
                'start': round(start / SAMPLE_RATE, 2),
                'end': round(end / SAMPLE_RATE, 2),
                'speaker': speaker_id,
            })
        
        log_exit(_log, 'diarize', f"OK ({n_clusters} 位說話者, {len(results)} 個片段)")
        return results
    
    except Exception as e:
        log_error(_log, 'diarize', e)
        return None


def merge_with_transcription(
    segments: list[dict],        # diarizer 輸出
    transcription: list[dict],   # transcriber 輸出 (含 start, end, text)
) -> list[dict]:
    """
    將說話者標籤與辨識結果合併
    每個辨識句子指派給時間上最重疊的說話者
    
    Args:
        segments: diarizer 的語音片段 (含 speaker 標籤)
        transcription: transcriber 的逐句結果 (含 start, end, text)
    
    Returns:
        list of dict，每個 dict 包含:
            - 'start': 起始時間 (秒)
            - 'end': 結束時間 (秒)
            - 'text': 文字內容
            - 'speaker': 說話者 ID
    """
    if not segments or not transcription:
        # 若無說話者分離結果，全部標為「未知」
        return [
            {
                'start': t['start'],
                'end': t['end'],
                'text': t['text'],
                'speaker': '?',
            }
            for t in transcription
        ]
    
    results = []
    for t in transcription:
        # 找出與此句子時間重疊最多的 speaker
        overlap_scores: dict[str, float] = {}
        t_start = t['start']
        t_end = t['end']
        
        for seg in segments:
            s_start = seg['start']
            s_end = seg['end']
            
            # 計算時間重疊
            overlap = max(0, min(t_end, s_end) - max(t_start, s_start))
            if overlap > 0:
                speaker = seg['speaker']
                overlap_scores[speaker] = overlap_scores.get(speaker, 0) + overlap
        
        if overlap_scores:
            best_speaker = max(overlap_scores, key=overlap_scores.get)
        else:
            best_speaker = '?'
        
        results.append({
            'start': t['start'],
            'end': t['end'],
            'text': t['text'],
            'speaker': best_speaker,
        })
    
    return results