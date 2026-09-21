/**
 * Parse raw TimeSpan string from .NET backend (e.g. "29.19:06:40.6018558", "19:06:40")
 * and return a readable Persian string.
 */
export function formatRemainingTime(rawTime?: string | null): string {
  if (!rawTime) return 'نامشخص';

  // Try .NET TimeSpan format: [days.]hours:minutes:seconds[.fraction]
  const dotNetMatch = rawTime.match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+)/);
  if (dotNetMatch) {
    const days = parseInt(dotNetMatch[1] || '0', 10);
    const hours = parseInt(dotNetMatch[2], 10);
    const minutes = parseInt(dotNetMatch[3], 10);
    // seconds ignored per spec

    if (days > 0) return `${days} روز و ${hours} ساعت`;
    if (hours > 0) return `${hours} ساعت و ${minutes} دقیقه`;
    return `${minutes} دقیقه`;
  }

  // Try PT duration (ISO 8601) e.g. PT23H59M59S
  const isoMatch = rawTime.match(/PT?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (isoMatch) {
    const h = parseInt(isoMatch[1] || '0', 10);
    const m = parseInt(isoMatch[2] || '0', 10);
    if (h > 0) return `${h} ساعت و ${m} دقیقه`;
    if (m > 0) return `${m} دقیقه`;
    return 'کمتر از ۱ دقیقه';
  }

  return rawTime;
}

/**
 * Map technical plan type/enum to engaging Persian title with emoji.
 */
export function formatPlanType(planType?: string): string {
  if (!planType) return 'اشتراک ویژه 🌟';

  const lower = planType.toLowerCase();

  if (lower.includes('freetrial') || lower.includes('trial') || lower.includes('trial24h')) {
    return 'تست رایگان هدیه 🎁';
  }
  if (lower.includes('paidmonthly') || lower.includes('monthly')) {
    return 'ویژه یک‌ماهه 🌟';
  }
  if (lower.includes('paidthreemonths') || lower.includes('threemonths') || lower.includes('3month')) {
    return 'ویژه سه‌ماهه 🚀';
  }
  if (lower.includes('paidsixmonths') || lower.includes('sixmonths') || lower.includes('6month')) {
    return 'ویژه شش‌ماهه 💎';
  }
  if (lower.includes('paidyearly') || lower.includes('yearly') || lower.includes('annual')) {
    return 'ویژه یک‌ساله 👑';
  }

  // Fallback: clean up the raw string, capitalize first letter
  const cleaned = planType
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
  return cleaned || 'اشتراک ویژه 🌟';
}

/**
 * Resolve a plan title using a fallback cascade:
 * plan.title || plan.name || `${durationDays} روزه` || 'اشتراک ویژه'
 */
export function resolvePlanTitle(plan: { title?: string; name?: string; durationDays?: number }): string {
  return plan.title || plan.name || (plan.durationDays ? `${plan.durationDays} روزه` : 'اشتراک ویژه');
}