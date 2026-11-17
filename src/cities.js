// [arabic, english, lat, lng, tz] — tz omitted = Asia/Riyadh. Used offline for manual choice and nearest-city label.
const K = 'Asia/Riyadh';
export const CITIES = [
  ['مكة المكرمة', 'Makkah', 21.4225, 39.8262], ['المدينة المنورة', 'Madinah', 24.4672, 39.6111],
  ['الرياض', 'Riyadh', 24.7136, 46.6753], ['جدة', 'Jeddah', 21.4858, 39.1925], ['الدمام', 'Dammam', 26.4207, 50.0888],
  ['الخبر', 'Khobar', 26.2172, 50.1971], ['الظهران', 'Dhahran', 26.2361, 50.0393], ['القطيف', 'Qatif', 26.5196, 50.0115],
  ['الجبيل', 'Jubail', 27.0046, 49.646], ['رأس تنورة', 'Ras Tanura', 26.6436, 50.1597], ['الأحساء', 'Al-Ahsa', 25.3833, 49.5833],
  ['الطائف', 'Taif', 21.2703, 40.4158], ['تبوك', 'Tabuk', 28.3838, 36.555], ['أبها', 'Abha', 18.2164, 42.5053],
  ['خميس مشيط', 'Khamis Mushait', 18.3, 42.7333], ['بريدة', 'Buraydah', 26.326, 43.975], ['عنيزة', 'Unaizah', 26.084, 43.994],
  ['حائل', 'Hail', 27.5114, 41.7208], ['نجران', 'Najran', 17.4924, 44.1277], ['جازان', 'Jazan', 16.8892, 42.5511],
  ['الباحة', 'Al Bahah', 20.0129, 41.4677], ['عرعر', 'Arar', 30.9753, 41.0381], ['سكاكا', 'Sakaka', 29.9697, 40.2064],
  ['ينبع', 'Yanbu', 24.089, 38.0637], ['الخرج', 'Al Kharj', 24.1556, 47.312], ['حفر الباطن', 'Hafar Al-Batin', 28.4328, 45.9708],
  ['القريات', 'Al Qurayyat', 31.3317, 37.3428], ['المجمعة', "Al Majma'ah", 25.9039, 45.3456], ['الزلفي', 'Az Zulfi', 26.2994, 44.815],
  ['شقراء', 'Shaqra', 25.2481, 45.253], ['الدوادمي', 'Ad Dawadmi', 24.5077, 44.3924], ['عفيف', 'Afif', 23.9065, 42.9172],
  ['وادي الدواسر', 'Wadi ad-Dawasir', 20.4607, 44.781], ['شرورة', 'Sharurah', 17.4667, 47.1167], ['بيشة', 'Bisha', 20.0, 42.6],
  ['القنفذة', 'Al Qunfudhah', 19.1264, 41.0789], ['الليث', 'Al Lith', 20.15, 40.2667], ['رابغ', 'Rabigh', 22.7986, 39.0349],
  ['العلا', 'AlUla', 26.6085, 37.9232], ['الوجه', 'Al Wajh', 26.2455, 36.4525],
  ['الكويت', 'Kuwait City', 29.3759, 47.9774, 'Asia/Kuwait'], ['الدوحة', 'Doha', 25.2854, 51.531, 'Asia/Qatar'],
  ['المنامة', 'Manama', 26.2285, 50.586, 'Asia/Bahrain'], ['دبي', 'Dubai', 25.2048, 55.2708, 'Asia/Dubai'],
  ['أبوظبي', 'Abu Dhabi', 24.4539, 54.3773, 'Asia/Dubai'], ['مسقط', 'Muscat', 23.588, 58.3829, 'Asia/Muscat'],
  ['صنعاء', "Sana'a", 15.3694, 44.191, 'Asia/Aden'], ['عمّان', 'Amman', 31.9454, 35.9284, 'Asia/Amman'],
  ['القدس', 'Al-Quds', 31.7683, 35.2137, 'Asia/Jerusalem'], ['بيروت', 'Beirut', 33.8938, 35.5018, 'Asia/Beirut'],
  ['دمشق', 'Damascus', 33.5138, 36.2765, 'Asia/Damascus'], ['بغداد', 'Baghdad', 33.3152, 44.3661, 'Asia/Baghdad'],
  ['القاهرة', 'Cairo', 30.0444, 31.2357, 'Africa/Cairo'], ['الإسكندرية', 'Alexandria', 31.2001, 29.9187, 'Africa/Cairo'],
  ['الخرطوم', 'Khartoum', 15.5007, 32.5599, 'Africa/Khartoum'], ['طرابلس', 'Tripoli', 32.8872, 13.1913, 'Africa/Tripoli'],
  ['تونس', 'Tunis', 36.8065, 10.1815, 'Africa/Tunis'], ['الجزائر', 'Algiers', 36.7538, 3.0588, 'Africa/Algiers'],
  ['الرباط', 'Rabat', 34.0209, -6.8416, 'Africa/Casablanca'], ['الدار البيضاء', 'Casablanca', 33.5731, -7.5898, 'Africa/Casablanca'],
  ['نواكشوط', 'Nouakchott', 18.0735, -15.9582, 'Africa/Nouakchott'], ['مقديشو', 'Mogadishu', 2.0469, 45.3182, 'Africa/Mogadishu'],
  ['إسطنبول', 'Istanbul', 41.0082, 28.9784, 'Europe/Istanbul'], ['أنقرة', 'Ankara', 39.9334, 32.8597, 'Europe/Istanbul'],
  ['طهران', 'Tehran', 35.6892, 51.389, 'Asia/Tehran'], ['باكو', 'Baku', 40.4093, 49.8671, 'Asia/Baku'],
  ['طشقند', 'Tashkent', 41.2995, 69.2401, 'Asia/Tashkent'], ['كراتشي', 'Karachi', 24.8607, 67.0011, 'Asia/Karachi'],
  ['لاهور', 'Lahore', 31.5204, 74.3587, 'Asia/Karachi'], ['إسلام آباد', 'Islamabad', 33.6844, 73.0479, 'Asia/Karachi'],
  ['نيودلهي', 'New Delhi', 28.6139, 77.209, 'Asia/Kolkata'], ['مومباي', 'Mumbai', 19.076, 72.8777, 'Asia/Kolkata'],
  ['دكا', 'Dhaka', 23.8103, 90.4125, 'Asia/Dhaka'], ['كوالالمبور', 'Kuala Lumpur', 3.139, 101.6869, 'Asia/Kuala_Lumpur'],
  ['سنغافورة', 'Singapore', 1.3521, 103.8198, 'Asia/Singapore'], ['جاكرتا', 'Jakarta', -6.2088, 106.8456, 'Asia/Jakarta'],
  ['لاغوس', 'Lagos', 6.5244, 3.3792, 'Africa/Lagos'], ['نيروبي', 'Nairobi', -1.2921, 36.8219, 'Africa/Nairobi'],
  ['لندن', 'London', 51.5074, -0.1278, 'Europe/London'], ['باريس', 'Paris', 48.8566, 2.3522, 'Europe/Paris'],
  ['برلين', 'Berlin', 52.52, 13.405, 'Europe/Berlin'], ['مدريد', 'Madrid', 40.4168, -3.7038, 'Europe/Madrid'],
  ['روما', 'Rome', 41.9028, 12.4964, 'Europe/Rome'], ['موسكو', 'Moscow', 55.7558, 37.6173, 'Europe/Moscow'],
  ['نيويورك', 'New York', 40.7128, -74.006, 'America/New_York'], ['واشنطن', 'Washington', 38.9072, -77.0369, 'America/New_York'],
  ['شيكاغو', 'Chicago', 41.8781, -87.6298, 'America/Chicago'], ['لوس أنجلوس', 'Los Angeles', 34.0522, -118.2437, 'America/Los_Angeles'],
  ['تورونتو', 'Toronto', 43.6532, -79.3832, 'America/Toronto'], ['سيدني', 'Sydney', -33.8688, 151.2093, 'Australia/Sydney'],
].map(([ar, en, lat, lng, tz = K]) => ({ ar, en, lat, lng, tz }));

export function distanceKm(a, b, c, d) {
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}
export function nearestCity(lat, lng) {
  let best = null, bd = Infinity;
  for (const c of CITIES) { const dd = distanceKm(lat, lng, c.lat, c.lng); if (dd < bd) { bd = dd; best = c; } }
  return { city: best, km: bd };
}
