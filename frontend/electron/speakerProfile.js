// v1.23.0: Speaker Profile Database
//   持久化儲存每位已知講者的 speaker embedding centroid (按 modelKey 分開)
//   支援 supervised speaker recognition + 跨錄音 speaker-aware 搜尋
//
// 設計原則：
//   1. 每個 profile 標記 modelKey (camplus / resnet_se / ...)
//      不同模型的 embedding 維度不同 (192 / 256)，不能互比
//   2. centroid 是 trimmed mean (沿用 voiceprint.js v1.21.4 算法)
//   3. 儲存為 JSON 純文字 (使用者已確認不需要加密)
//   4. v1 結構，未來 v2 增加時走 migration

const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

const PROFILE_DB_VERSION = 1
const PROFILE_DB_PATH = path.join(os.homedir(), 'recoder', 'speaker_profiles.json')
const MIN_SAMPLES_FOR_PROFILE = 2       // 最少 2 個 samples 才能建 profile
const MIN_SAMPLES_FOR_RELIABLE = 3       // 3 個以上較可靠
const MAX_PROFILES = 200                  // 防止磁碟爆掉

function ensureDir() {
  const dir = path.dirname(PROFILE_DB_PATH)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function loadDb() {
  try {
    if (!fs.existsSync(PROFILE_DB_PATH)) {
      return { version: PROFILE_DB_VERSION, profiles: [] }
    }
    const raw = fs.readFileSync(PROFILE_DB_PATH, 'utf-8')
    const db = JSON.parse(raw)
    if (!db || typeof db !== 'object' || !Array.isArray(db.profiles)) {
      console.warn('[speakerProfile] speaker_profiles.json 結構損壞，重置為空')
      return { version: PROFILE_DB_VERSION, profiles: [] }
    }
    // 自動 migrate 未來版本
    if (!db.version) db.version = PROFILE_DB_VERSION
    return db
  } catch (e) {
    console.error('[speakerProfile] 讀取失敗:', e.message)
    return { version: PROFILE_DB_VERSION, profiles: [] }
  }
}

function saveDb(db) {
  try {
    ensureDir()
    fs.writeFileSync(PROFILE_DB_PATH, JSON.stringify(db, null, 2), 'utf-8')
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function newId() {
  return crypto.randomUUID()
}

/**
 * 列出所有 profiles（可選 filter）
 * @param {object} filter { modelKey?, name? }
 */
function listProfiles(filter = {}) {
  const db = loadDb()
  let profiles = db.profiles
  if (filter.modelKey) {
    profiles = profiles.filter(p => p.modelKey === filter.modelKey)
  }
  if (filter.name) {
    const q = String(filter.name).toLowerCase()
    profiles = profiles.filter(p => p.name.toLowerCase().includes(q))
  }
  return profiles
}

/**
 * 取得單一 profile
 * @param {string} id
 */
function getProfile(id) {
  const db = loadDb()
  return db.profiles.find(p => p.id === id) || null
}

/**
 * 取得相同 modelKey + 同名稱的 profile (用於避免重複)
 * @param {string} name
 * @param {string} modelKey
 */
function getProfileByName(name, modelKey) {
  const db = loadDb()
  return db.profiles.find(p => p.name === name && p.modelKey === modelKey) || null
}

/**
 * 取得相同 modelKey 的所有 profiles (用於 supervised identification)
 * @param {string} modelKey
 */
function getProfilesByModel(modelKey) {
  return listProfiles({ modelKey })
}

/**
 * 儲存或更新 profile
 * @param {object} profile { name, modelKey, dim, centroid, samples, internalCoherence, source? }
 * @returns { success, id, error? }
 */
function saveProfile(profile) {
  try {
    if (!profile || !profile.name || !profile.modelKey) {
      return { success: false, error: 'profile 缺少 name 或 modelKey' }
    }
    if (!Array.isArray(profile.centroid) || profile.centroid.length === 0) {
      return { success: false, error: 'centroid 必須是非空陣列' }
    }
    if (profile.dim && profile.centroid.length !== profile.dim) {
      return { success: false, error: `centroid 長度 (${profile.centroid.length}) 與 dim (${profile.dim}) 不符` }
    }
    if (!profile.dim) profile.dim = profile.centroid.length
    if (profile.samples === undefined) profile.samples = 0
    if (profile.internalCoherence === undefined) profile.internalCoherence = 1.0
    if (!profile.source) profile.source = 'manual'

    const db = loadDb()
    const now = new Date().toISOString()
    // 檢查重名（同 modelKey）
    const existing = db.profiles.find(p => p.name === profile.name && p.modelKey === profile.modelKey)
    if (existing) {
      // 更新
      existing.centroid = profile.centroid
      existing.dim = profile.dim
      existing.samples = profile.samples
      existing.internalCoherence = profile.internalCoherence
      existing.source = profile.source
      existing.updatedAt = now
      saveDb(db)
      return { success: true, id: existing.id, updated: true }
    }
    if (db.profiles.length >= MAX_PROFILES) {
      return { success: false, error: `已達上限 ${MAX_PROFILES} 個 profiles，請先刪除部分` }
    }
    // 新增
    const newP = {
      id: newId(),
      name: profile.name,
      modelKey: profile.modelKey,
      dim: profile.dim,
      centroid: profile.centroid,
      samples: profile.samples,
      internalCoherence: profile.internalCoherence,
      source: profile.source,
      createdAt: now,
      updatedAt: now,
    }
    db.profiles.push(newP)
    saveDb(db)
    return { success: true, id: newP.id, updated: false }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 重新命名 profile
 * @param {string} id
 * @param {string} newName
 */
function renameProfile(id, newName) {
  try {
    const db = loadDb()
    const p = db.profiles.find(x => x.id === id)
    if (!p) return { success: false, error: 'profile 不存在' }
    if (!newName || !newName.trim()) return { success: false, error: '新名稱不可為空' }
    // 檢查重名
    const dup = db.profiles.find(x => x.id !== id && x.name === newName.trim() && x.modelKey === p.modelKey)
    if (dup) return { success: false, error: '已有同名 profile' }
    p.name = newName.trim()
    p.updatedAt = new Date().toISOString()
    saveDb(db)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 刪除 profile
 * @param {string} id
 */
function deleteProfile(id) {
  try {
    const db = loadDb()
    const before = db.profiles.length
    db.profiles = db.profiles.filter(p => p.id !== id)
    if (db.profiles.length === before) {
      return { success: false, error: 'profile 不存在' }
    }
    saveDb(db)
    return { success: true, removed: before - db.profiles.length }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 取得 profile 資料庫路徑（用於 UI 顯示）
 */
function getDbPath() {
  return PROFILE_DB_PATH
}

/**
 * 取得 profile 統計
 */
function getStats() {
  const db = loadDb()
  const byModel = {}
  for (const p of db.profiles) {
    byModel[p.modelKey] = (byModel[p.modelKey] || 0) + 1
  }
  return {
    total: db.profiles.length,
    byModel,
    dbPath: PROFILE_DB_PATH,
  }
}

module.exports = {
  PROFILE_DB_VERSION,
  PROFILE_DB_PATH,
  MIN_SAMPLES_FOR_PROFILE,
  MIN_SAMPLES_FOR_RELIABLE,
  MAX_PROFILES,
  listProfiles,
  getProfile,
  getProfileByName,
  getProfilesByModel,
  saveProfile,
  renameProfile,
  deleteProfile,
  getDbPath,
  getStats,
}