#include "fsapi.h"

// common.h מביא את windows.h, שעליו wincrypt.h נשען.
#include "common.h"
#include "paths.h"

#include <wincrypt.h>

namespace otz::fsapi {
namespace {

// מזהה קובץ פתוח שנסגר מעצמו — כל מסלולי היציאה כאן מרובים, ו-handle
// שנשכח פתוח בווינדוס חוסם מחיקה והחלפה של הקובץ.
class ScopedHandle {
 public:
  explicit ScopedHandle(HANDLE handle) : handle_(handle) {}
  ~ScopedHandle() {
    if (handle_ != INVALID_HANDLE_VALUE && handle_ != nullptr) {
      CloseHandle(handle_);
    }
  }
  ScopedHandle(const ScopedHandle&) = delete;
  ScopedHandle& operator=(const ScopedHandle&) = delete;

  HANDLE get() const { return handle_; }
  bool valid() const { return handle_ != INVALID_HANDLE_VALUE && handle_ != nullptr; }

 private:
  HANDLE handle_;
};

std::wstring Describe(const std::wstring& what, const std::wstring& path) {
  return what + L" (" + path + L"): " + MessageForError(GetLastError());
}

// FILETIME הוא 100ns מאז 1601; JS רוצה מילישניות מאז 1970.
long long FileTimeToUnixMs(const FILETIME& time) {
  ULARGE_INTEGER value;
  value.LowPart = time.dwLowDateTime;
  value.HighPart = time.dwHighDateTime;
  // 11644473600 שניות בין 1601 ל-1970.
  constexpr unsigned long long kEpochDelta = 116444736000000000ULL;
  if (value.QuadPart < kEpochDelta) return 0;
  return static_cast<long long>((value.QuadPart - kEpochDelta) / 10000ULL);
}

bool ReadWholeFile(const std::wstring& path, std::string& out, std::wstring& error) {
  ScopedHandle file(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ,
                                nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL,
                                nullptr));
  if (!file.valid()) {
    error = Describe(L"פתיחת הקובץ נכשלה", path);
    return false;
  }

  LARGE_INTEGER size;
  if (!GetFileSizeEx(file.get(), &size)) {
    error = Describe(L"קריאת גודל הקובץ נכשלה", path);
    return false;
  }
  // קובץ טקסט של החנות הוא קטלוג או מניפסט. תקרה שמונעת מקובץ ענק
  // שהוצבע עליו בטעות למחוק את הזיכרון.
  constexpr long long kMaxTextBytes = 64LL * 1024 * 1024;
  if (size.QuadPart > kMaxTextBytes) {
    error = L"הקובץ גדול מדי לקריאה כטקסט: " + path;
    return false;
  }

  out.resize(static_cast<size_t>(size.QuadPart));
  size_t done = 0;
  while (done < out.size()) {
    DWORD read = 0;
    const DWORD want = static_cast<DWORD>(
        (out.size() - done) > 0x10000000 ? 0x10000000 : (out.size() - done));
    if (!ReadFile(file.get(), out.data() + done, want, &read, nullptr)) {
      error = Describe(L"קריאת הקובץ נכשלה", path);
      return false;
    }
    if (read == 0) break;  // נחתך תחתנו — מחזירים את מה שנקרא
    done += read;
  }
  out.resize(done);
  return true;
}

}  // namespace

Result ReadText(const std::wstring& path) {
  std::string bytes;
  std::wstring error;
  if (!ReadWholeFile(path, bytes, error)) return Result::Fail(error);

  // BOM של UTF-8 — ראו `PluginManifestReader` בגרסת ה-Flutter.
  std::string_view text(bytes);
  if (text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF &&
      static_cast<unsigned char>(text[1]) == 0xBB &&
      static_cast<unsigned char>(text[2]) == 0xBF) {
    text.remove_prefix(3);
  }
  return Result::Ok(JsonString(text));
}

Result WriteTextAtomic(const std::wstring& path, const std::string& utf8_text) {
  const size_t slash = path.find_last_of(L"\\/");
  if (slash != std::wstring::npos && !CreateDirectories(path.substr(0, slash))) {
    return Result::Fail(Describe(L"יצירת התיקייה נכשלה", path));
  }

  const std::wstring temp = path + L".tmp";
  {
    ScopedHandle file(CreateFileW(temp.c_str(), GENERIC_WRITE, 0, nullptr,
                                  CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!file.valid()) return Result::Fail(Describe(L"פתיחה לכתיבה נכשלה", temp));

    size_t done = 0;
    while (done < utf8_text.size()) {
      DWORD written = 0;
      const DWORD want = static_cast<DWORD>(
          (utf8_text.size() - done) > 0x10000000 ? 0x10000000
                                                 : (utf8_text.size() - done));
      // `written == 0` בלי שגיאה הוא כתיבה שאינה מתקדמת (כונן שהתמלא
      // מדווח כך על חלק מהמערכות), ובלי הבדיקה הזאת הלולאה מסתובבת
      // לנצח על ה-thread של הפעולה. אותו שיקול כמו ב-`WriteAll`
      // שב-overlay.cpp.
      if (!WriteFile(file.get(), utf8_text.data() + done, want, &written,
                     nullptr) ||
          written == 0) {
        return Result::Fail(Describe(L"כתיבה נכשלה", temp));
      }
      done += written;
    }
    if (!FlushFileBuffers(file.get())) {
      return Result::Fail(Describe(L"סגירת הקובץ נכשלה", temp));
    }
  }
  // ה-handle נסגר לפני ההחלפה: בווינדוס handle פתוח חוסם אותה.
  if (!MoveFileExW(temp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING)) {
    const std::wstring error = Describe(L"החלפת הקובץ נכשלה", path);
    DeleteFileW(temp.c_str());
    return Result::Fail(error);
  }
  return Result::Ok("true");
}

Result PathKind(const std::wstring& path) {
  const DWORD attributes = GetFileAttributesW(path.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES) return Result::Ok(JsonString("none"));
  return Result::Ok(JsonString((attributes & FILE_ATTRIBUTE_DIRECTORY) != 0
                                   ? "dir"
                                   : "file"));
}

Result Stat(const std::wstring& path) {
  WIN32_FILE_ATTRIBUTE_DATA data{};
  if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data)) {
    return Result::Fail(Describe(L"קריאת פרטי הקובץ נכשלה", path));
  }
  ULARGE_INTEGER size;
  size.LowPart = data.nFileSizeLow;
  size.HighPart = data.nFileSizeHigh;
  return Result::Ok(JsonObject({
      {"size", JsonNumber(static_cast<long long>(size.QuadPart))},
      {"modified", JsonNumber(FileTimeToUnixMs(data.ftLastWriteTime))},
      {"dir", JsonBool((data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0)},
  }));
}

Result ListDir(const std::wstring& path) {
  WIN32_FIND_DATAW found{};
  const std::wstring pattern = JoinPath(path, L"*");
  HANDLE search = FindFirstFileExW(pattern.c_str(), FindExInfoBasic, &found,
                                   FindExSearchNameMatch, nullptr,
                                   FIND_FIRST_EX_LARGE_FETCH);
  if (search == INVALID_HANDLE_VALUE) {
    const DWORD error = GetLastError();
    // תיקייה שאינה קיימת אינה שגיאה — היא פשוט ריקה.
    if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) {
      return Result::Ok("[]");
    }
    return Result::Fail(Describe(L"קריאת התיקייה נכשלה", path));
  }

  std::vector<std::string> items;
  do {
    const std::wstring_view name(found.cFileName);
    if (name == L"." || name == L"..") continue;

    ULARGE_INTEGER size;
    size.LowPart = found.nFileSizeLow;
    size.HighPart = found.nFileSizeHigh;
    items.push_back(JsonObject({
        {"name", JsonString(name)},
        {"dir", JsonBool((found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0)},
        {"size", JsonNumber(static_cast<long long>(size.QuadPart))},
        {"modified", JsonNumber(FileTimeToUnixMs(found.ftLastWriteTime))},
    }));
  } while (FindNextFileW(search, &found));
  FindClose(search);

  return Result::Ok(JsonArray(items));
}

Result MakeDirs(const std::wstring& path) {
  if (!CreateDirectories(path)) {
    return Result::Fail(Describe(L"יצירת התיקייה נכשלה", path));
  }
  return Result::Ok("true");
}

Result DeleteFileAt(const std::wstring& path) {
  if (DeleteFileW(path.c_str())) return Result::Ok("true");
  const DWORD error = GetLastError();
  // המצב המבוקש הושג — הקובץ אינו שם.
  if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) {
    return Result::Ok("true");
  }
  return Result::Fail(Describe(L"מחיקת הקובץ נכשלה", path));
}

Result RemoveEmptyDirAt(const std::wstring& path) {
  if (RemoveDirectoryW(path.c_str())) return Result::Ok("true");
  const DWORD error = GetLastError();
  // המצב המבוקש הושג — התיקייה אינה שם.
  if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) {
    return Result::Ok("true");
  }
  // תיקייה שאינה ריקה אינה תקלה אלא תשובה: נשאר בה משהו שאין למחוק.
  // הקורא מתייחס ל-`false` כאל "השאר אותה", ולכן אין כאן `Fail` —
  // שגיאה הייתה מפילה את הגריעה כולה על שארית שאינה מזיקה.
  if (error == ERROR_DIR_NOT_EMPTY) return Result::Ok("false");
  return Result::Fail(Describe(L"מחיקת התיקייה נכשלה", path));
}

Result CopyFileTo(const std::wstring& from, const std::wstring& to) {
  const size_t slash = to.find_last_of(L"\\/");
  if (slash != std::wstring::npos && !CreateDirectories(to.substr(0, slash))) {
    return Result::Fail(Describe(L"יצירת תיקיית היעד נכשלה", to));
  }
  if (!CopyFileW(from.c_str(), to.c_str(), FALSE)) {
    return Result::Fail(Describe(L"העתקת הקובץ נכשלה", to));
  }
  return Result::Ok("true");
}

Result Rename(const std::wstring& from, const std::wstring& to) {
  const size_t slash = to.find_last_of(L"\\/");
  if (slash != std::wstring::npos && !CreateDirectories(to.substr(0, slash))) {
    return Result::Fail(Describe(L"יצירת תיקיית היעד נכשלה", to));
  }
  if (!MoveFileExW(from.c_str(), to.c_str(), MOVEFILE_REPLACE_EXISTING)) {
    return Result::Fail(Describe(L"העברת הקובץ נכשלה", to));
  }
  return Result::Ok("true");
}

Result ReadBase64(const std::wstring& path, uint64_t offset, uint32_t length) {
  // תקרה שמגנה על הזיכרון: הקוראים כאן מבקשים זנב EOCD, ספרייה מרכזית
  // ורשומת manifest — כולם קטנים.
  constexpr uint32_t kMaxChunk = 16u * 1024 * 1024;
  if (length > kMaxChunk) {
    return Result::Fail(L"בקשת קריאה גדולה מדי: " + std::to_wstring(length));
  }

  ScopedHandle file(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ,
                                nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL,
                                nullptr));
  if (!file.valid()) return Result::Fail(Describe(L"פתיחת הקובץ נכשלה", path));

  LARGE_INTEGER position;
  position.QuadPart = static_cast<long long>(offset);
  if (!SetFilePointerEx(file.get(), position, nullptr, FILE_BEGIN)) {
    return Result::Fail(Describe(L"מיקום בקובץ נכשל", path));
  }

  std::vector<uint8_t> buffer(length);
  size_t done = 0;
  while (done < buffer.size()) {
    DWORD read = 0;
    if (!ReadFile(file.get(), buffer.data() + done,
                  static_cast<DWORD>(buffer.size() - done), &read, nullptr)) {
      return Result::Fail(Describe(L"קריאת הקובץ נכשלה", path));
    }
    if (read == 0) break;  // סוף הקובץ לפני מה שהתבקש — מחזירים את הקיים
    done += read;
  }
  buffer.resize(done);

  // `CryptBinaryToStringA` ולא base64 תוצרת-בית: הוא במערכת, והוא נכון.
  DWORD encoded_size = 0;
  if (!CryptBinaryToStringA(buffer.data(), static_cast<DWORD>(buffer.size()),
                            CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr,
                            &encoded_size)) {
    return Result::Fail(L"קידוד base64 נכשל");
  }
  std::string encoded(encoded_size, '\0');
  if (!CryptBinaryToStringA(buffer.data(), static_cast<DWORD>(buffer.size()),
                            CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF,
                            encoded.data(), &encoded_size)) {
    return Result::Fail(L"קידוד base64 נכשל");
  }
  // הפונקציה מסיימת ב-NUL שנספר בגודל; JSON לא רוצה אותו.
  while (!encoded.empty() && encoded.back() == '\0') encoded.pop_back();

  return Result::Ok(JsonString(encoded));
}

}  // namespace otz::fsapi
