// מריץ משימות עם תקרת מקביליות. פורט של
// `packages/plugins_manager/lib/src/services/download_pool.dart`.
//
// **למה מקביליות דווקא כאן.** סנכרון החנות הוא עשרות קבצים *קטנים* —
// תמונה, צילומי מסך וקובץ `.otzplugin` לכל תוסף — וכל אחד מהם משלם סיבוב
// הלוך-חזור מלא לשרת. בטור, זמן ההמתנה הוא רוב הסנכרון; במקביל הוא נחלק.
//
// זו גם הסיבה שאין כאן פיצול של קובץ בודד לכמה חיבורים: הקבצים קטנים
// מכדי שזה יעזור.
//
// שגיאה במשימה עוצרת את *ההתחלה* של משימות נוספות, וממתינה לאלה שכבר
// רצות לפני שהיא נזרקת. משימות שאינן זורקות כלל (כמו הורדות התוספים,
// שמדווחות כשל כאזהרה) פשוט רצות עד הסוף.

/**
 * @param {Array<() => Promise<void>>} tasks
 * @param {number} maxConcurrent
 */
export async function runPooled(tasks, maxConcurrent) {
  if (tasks.length === 0) return;
  const limit = maxConcurrent < 1 ? 1 : maxConcurrent;

  let next = 0;
  let firstError = null;

  async function worker() {
    while (firstError === null && next < tasks.length) {
      const index = next++;
      try {
        await tasks[index]();
      } catch (error) {
        if (firstError === null) firstError = error;
        return;
      }
    }
  }

  const count = Math.min(tasks.length, limit);
  const workers = [];
  for (let i = 0; i < count; i++) workers.push(worker());
  await Promise.all(workers);

  if (firstError !== null) throw firstError;
}
