#include "webres.h"

#include <compressapi.h>

#include "common.h"

namespace otz {
namespace {

#pragma pack(push, 1)
struct WebBundleHeader {
  char magic[8];
  uint32_t algorithm;   // אלגוריתם ה-Compression API (LZMS)
  uint32_t file_count;
  uint64_t raw_size;    // גודל הגוש אחרי פרישה
};
#pragma pack(pop)

// פורש את הגוש הדחוס דרך Compression API של ווינדוס — אותו מסלול בדיוק
// שהוכיח את עצמו ב-`windows_stub/stub.c`, ומאותה סיבה: בלי תהליך חיצוני,
// בלי קובץ זמני, ובלי שאף נתיב יעבור המרת קידוד.
bool Decompress(const uint8_t* compressed, size_t compressed_size,
                uint32_t algorithm, uint64_t raw_size,
                std::vector<uint8_t>& out) {
  DECOMPRESSOR_HANDLE decompressor = nullptr;
  if (!CreateDecompressor(algorithm, nullptr, &decompressor)) return false;

  out.resize(static_cast<size_t>(raw_size));
  SIZE_T produced = 0;
  const BOOL ok = ::Decompress(decompressor, const_cast<uint8_t*>(compressed),
                               compressed_size, out.data(), out.size(), &produced);
  CloseDecompressor(decompressor);

  // גודל שאינו מה שהכותרת הצהירה פירושו חבילה פגומה, ולא "פרשנו חלק".
  return ok && produced == raw_size;
}

// קריאה בטוחה מתוך הגוש הפרוש: כל שדה נבדק מול הגודל שנותר, כדי
// שחבילה קטועה תיפול כאן ולא בגישה מחוץ לתחום.
class Cursor {
 public:
  Cursor(const uint8_t* data, size_t size) : data_(data), size_(size) {}

  bool ReadU32(uint32_t& value) {
    if (size_ - offset_ < sizeof(uint32_t)) return false;
    memcpy(&value, data_ + offset_, sizeof(uint32_t));
    offset_ += sizeof(uint32_t);
    return true;
  }

  bool ReadBytes(size_t count, const uint8_t*& start) {
    if (size_ - offset_ < count) return false;
    start = data_ + offset_;
    offset_ += count;
    return true;
  }

  size_t offset() const { return offset_; }

 private:
  const uint8_t* data_;
  size_t size_;
  size_t offset_ = 0;
};

}  // namespace

bool WebBundle::LoadFromResource(HMODULE module, int resource_id) {
  HRSRC resource = FindResourceW(module, MAKEINTRESOURCEW(resource_id), RT_RCDATA);
  if (resource == nullptr) return false;

  const DWORD resource_size = SizeofResource(module, resource);
  HGLOBAL loaded = LoadResource(module, resource);
  if (loaded == nullptr || resource_size < sizeof(WebBundleHeader)) return false;

  const auto* bytes = static_cast<const uint8_t*>(LockResource(loaded));
  if (bytes == nullptr) return false;

  WebBundleHeader header{};
  memcpy(&header, bytes, sizeof(header));
  if (memcmp(header.magic, kWebBundleMagic, sizeof(kWebBundleMagic)) != 0) {
    return false;
  }

  std::vector<uint8_t> raw;
  if (!Decompress(bytes + sizeof(header), resource_size - sizeof(header),
                  header.algorithm, header.raw_size, raw)) {
    return false;
  }

  // הגוש הפרוש: מונה, ואחריו טבלת רשומות, ואחריה התוכן באותו סדר.
  Cursor cursor(raw.data(), raw.size());
  uint32_t count = 0;
  if (!cursor.ReadU32(count) || count != header.file_count) return false;

  struct Entry {
    std::string path;
    uint32_t size;
  };
  std::vector<Entry> entries;
  entries.reserve(count);

  for (uint32_t i = 0; i < count; ++i) {
    uint32_t path_bytes = 0;
    uint32_t data_bytes = 0;
    if (!cursor.ReadU32(path_bytes) || !cursor.ReadU32(data_bytes)) return false;
    const uint8_t* path_start = nullptr;
    if (!cursor.ReadBytes(path_bytes, path_start)) return false;
    entries.push_back(
        {std::string(reinterpret_cast<const char*>(path_start), path_bytes),
         data_bytes});
  }

  for (const auto& entry : entries) {
    const uint8_t* start = nullptr;
    if (!cursor.ReadBytes(entry.size, start)) return false;
    files_.emplace(entry.path, std::vector<uint8_t>(start, start + entry.size));
  }

  return true;
}

const std::vector<uint8_t>* WebBundle::Find(std::string_view relative_path) const {
  const auto it = files_.find(relative_path);
  return it == files_.end() ? nullptr : &it->second;
}

std::wstring ContentTypeFor(std::string_view path) {
  const size_t dot = path.rfind('.');
  const std::string_view ext = dot == std::string_view::npos
                                   ? std::string_view{}
                                   : path.substr(dot + 1);

  // ל-HTML‏, CSS ו-JS נמסר גם `charset=utf-8`: בלעדיו ה-WebView2 מנחש
  // קידוד, והעברית יוצאת ג'יבריש.
  if (ext == "html" || ext == "htm") return L"text/html; charset=utf-8";
  if (ext == "css") return L"text/css; charset=utf-8";
  if (ext == "js" || ext == "mjs") return L"text/javascript; charset=utf-8";
  if (ext == "json") return L"application/json; charset=utf-8";
  if (ext == "svg") return L"image/svg+xml";
  if (ext == "png") return L"image/png";
  if (ext == "jpg" || ext == "jpeg") return L"image/jpeg";
  if (ext == "webp") return L"image/webp";
  if (ext == "gif") return L"image/gif";
  if (ext == "ico") return L"image/x-icon";
  if (ext == "woff2") return L"font/woff2";
  if (ext == "woff") return L"font/woff";
  if (ext == "ttf") return L"font/ttf";
  if (ext == "txt") return L"text/plain; charset=utf-8";
  return L"application/octet-stream";
}

}  // namespace otz
