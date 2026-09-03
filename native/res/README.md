# native/res

הנכסים שנצרבים לתוך ה-exe כ-resource.

* **`app_icon.ico`** — האייקון של קובץ ההרצה, בשש מידות (256…16).
  ווינדוס בוחרת ביניהן לפי ההקשר, וקובץ עם מידה אחת נראה מטושטש בכל
  השאר. נצרב ע"י `native/src/app.rc`.

⚠️ **אין לערוך אותו ביד.** שניהם — הוא והאייקון שבשורת הכותרת
(`native/web/img/app_icon.png`) — נבנים **ממקור אחד** ע"י
`tool/make_app_icon.ps1`, כדי שאייקון קובץ ההרצה והאייקון שבחלון לא
ייפרדו:

```powershell
tool\make_app_icon.ps1 -Source C:\path\to\icon.png
```
