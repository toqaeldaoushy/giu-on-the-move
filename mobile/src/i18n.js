// Languages: the driver screens can be shown in Arabic (right to left); riders and the
// transportation office use English. The text in the app is the key: tr('Start trip') gives the
// Arabic text when the driver chose Arabic, otherwise the English text itself.
import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AR = {
  // Greeting and roles
  'Hi, {name}': 'أهلاً، {name}',
  Driver: 'سائق',
  Rider: 'راكب',
  'Transportation office': 'مكتب النقل',

  // Profile menu
  Appearance: 'المظهر',
  'Same as phone': 'مثل الهاتف',
  Light: 'فاتح',
  Night: 'ليلي',
  Language: 'اللغة',
  'Log out': 'تسجيل الخروج',
  Close: 'إغلاق',
  Back: 'رجوع',
  'Profile and settings': 'الحساب والإعدادات',

  // Directions, status labels and trip names
  'To campus': 'إلى الجامعة',
  'From campus': 'من الجامعة',
  'Not started': 'لم تبدأ',
  'On the road': 'في الطريق',
  Finished: 'انتهت',
  Cancelled: 'ملغاة',
  'On time': 'في الموعد',
  Delayed: 'متأخرة',
  Arrived: 'وصلت',
  'Morning inbound': 'رحلة الصباح إلى الجامعة',
  'Mid-morning inbound': 'رحلة الضحى إلى الجامعة',
  'Afternoon departure': 'رحلة الظهر من الجامعة',
  'Evening departure': 'رحلة العصر من الجامعة',
  'Late evening departure': 'رحلة المساء من الجامعة',

  // Driver home
  'Your next trip': 'رحلتك القادمة',
  'Trip on the road': 'الرحلة في الطريق',
  'Open trip': 'فتح الرحلة',
  'Open and start': 'افتح وابدأ',
  'Bus {number}': 'أتوبيس {number}',
  'No bus assigned yet': 'لم يُحدَّد أتوبيس بعد',
  'You have no trips assigned today. Pull down to check again.': 'لا توجد رحلات مخصصة لك اليوم. اسحب الشاشة لأسفل للتحديث.',
  'My trips today': 'رحلاتي اليوم',
  'Trip {code}': 'رحلة {code}',
  'New time (usually {time})': 'موعد جديد (عادةً {time})',

  // Driver trip
  'No bus assigned yet. Contact the transportation office.': 'لم يُحدَّد أتوبيس بعد. تواصل مع مكتب النقل.',
  'Start trip': 'ابدأ الرحلة',
  'Press when the bus leaves. Riders will start to see it on the map.': 'اضغط عند تحرك الأتوبيس. سيبدأ الطلاب في رؤيته على الخريطة.',
  'Location sharing is paused': 'مشاركة الموقع متوقفة مؤقتًا',
  'Sharing the bus location': 'جارٍ مشاركة موقع الأتوبيس',
  'Riders still see the last position that was sent.': 'يرى الطلاب آخر موقع تم إرساله.',
  'A new position is sent every 30 seconds. Keep this screen open.': 'يُرسَل موقع جديد كل 30 ثانية. اترك هذه الشاشة مفتوحة.',
  'Last sent {time} · {stored} stored · {failed} failed': 'آخر إرسال {time} · {stored} محفوظ · {failed} فشل',
  'Last send failed: {error}': 'فشل آخر إرسال: {error}',
  'GPS: {error}': 'GPS: {error}',
  'Resume sharing': 'استئناف المشاركة',
  'Pause sharing': 'إيقاف المشاركة مؤقتًا',
  'Report a problem': 'الإبلاغ عن مشكلة',
  'What is the problem?': 'ما المشكلة؟',
  'Traffic delay': 'تأخير بسبب الزحام',
  Breakdown: 'عطل',
  'Bus is full': 'الأتوبيس ممتلئ',
  Other: 'أخرى',
  'Note (optional), e.g. accident near the ring road': 'ملاحظة (اختياري)، مثلًا: حادثة قرب الطريق الدائري',
  Cancel: 'إلغاء',
  Send: 'إرسال',
  'End trip': 'إنهاء الرحلة',
  'Press when the bus reaches the last stop.': 'اضغط عند وصول الأتوبيس إلى آخر محطة.',
  'This trip is finished.': 'انتهت هذه الرحلة.',
  'This trip was cancelled by the transportation office.': 'ألغى مكتب النقل هذه الرحلة.',
  'Trip started. Keep this screen open: the bus position is sent every 30 seconds.': 'بدأت الرحلة. اترك هذه الشاشة مفتوحة: يُرسَل موقع الأتوبيس كل 30 ثانية.',
  'End this trip?': 'إنهاء هذه الرحلة؟',
  'Riders will see that the bus has arrived.': 'سيرى الطلاب أن الأتوبيس وصل.',
  'Not yet': 'ليس بعد',
  'Trip ended. Thank you.': 'انتهت الرحلة. شكرًا لك.',
  'Choose what the problem is.': 'اختر نوع المشكلة.',
  'Problem sent to the transportation office.': 'تم إرسال المشكلة إلى مكتب النقل.',
  'The app needs your location to show the bus to riders. Allow location and try again.':
    'يحتاج التطبيق إلى موقعك ليعرض الأتوبيس للطلاب. اسمح بالوصول إلى الموقع وحاول مرة أخرى.',
  'Location is off for this app. Allow it in the phone settings, or riders will not see the bus.':
    'الموقع مغلق لهذا التطبيق. فعّله من إعدادات الهاتف، وإلا فلن يرى الطلاب الأتوبيس.',

  'Seats on the bus': 'المقاعد في الأتوبيس',
  'Tap when it changes. Riders see it at once.': 'اضغط عندما يتغير الوضع. يراه الطلاب فورًا.',
  'Seats free': 'متاحة',
  'A few seats': 'قليلة',
  Full: 'ممتلئ',

  // Messages from the server that a driver can see
  'This trip is not assigned to you': 'هذه الرحلة ليست مخصصة لك',
  'No bus is assigned to this trip yet': 'لم يُحدَّد أتوبيس لهذه الرحلة بعد',
  'The assigned bus is not active': 'الأتوبيس المحدد خارج الخدمة',
  'You or the bus already have a trip in progress': 'لديك أنت أو الأتوبيس رحلة جارية بالفعل',
  'This trip is already in progress': 'هذه الرحلة جارية بالفعل',
  'This trip is already completed': 'هذه الرحلة انتهت بالفعل',
  'This trip is already cancelled': 'هذه الرحلة ملغاة',
  'Server error': 'خطأ في الخادم',
  'Seat availability can only be set during the trip': 'يمكن تحديد المقاعد أثناء الرحلة فقط',
};

const LANG_KEY = 'giu-lang';
const LangContext = createContext({ lang: 'en', rtl: false, canChoose: false, setLang: () => {}, tr: (s, v) => fill(s, v) });

function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
}

/**
 * role: the logged-in role. Only drivers can choose Arabic, and Arabic is their default;
 * the choice is kept on the phone.
 */
export function LangProvider({ role, children }) {
  const [saved, setSaved] = useState(null);
  useEffect(() => { AsyncStorage.getItem(LANG_KEY).then((v) => v && setSaved(v)).catch(() => {}); }, []);
  const canChoose = role === 'driver';
  const lang = canChoose ? (saved ?? 'ar') : 'en';
  const value = useMemo(() => ({
    lang,
    rtl: lang === 'ar',
    canChoose,
    setLang: (l) => { setSaved(l); AsyncStorage.setItem(LANG_KEY, l).catch(() => {}); },
    tr: (text, vars) => fill(lang === 'ar' ? (AR[text] ?? text) : text, vars),
  }), [lang, canChoose]);
  return createElement(LangContext.Provider, { value }, children);
}

export const useLang = () => useContext(LangContext);

/** Margins on the reading side: m(rtl).start(8) is marginLeft in English and marginRight in Arabic */
export function m(rtl) {
  return {
    start: (n) => (rtl ? { marginRight: n } : { marginLeft: n }),
    end: (n) => (rtl ? { marginLeft: n } : { marginRight: n }),
  };
}
