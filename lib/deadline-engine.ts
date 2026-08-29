import { DeadlineRules, DeadlineStatus } from "../types";

export const DEFAULT_DEADLINE_RULES: DeadlineRules = {
  healthyMinDays: 61,
  watchMinDays: 31,
  urgentMinDays: 11,
  criticalMinDays: 0,
  criticalMaxDays: 10,
};

/**
 * Pure mechanics: Calculates whole calendar days remaining between a reference date and a target date.
 * Returns null if the target date is invalid or undefined.
 */
export function getDaysRemaining(targetDate?: string, fromDate?: string): number | null {
  if (!targetDate) return null;
  const target = new Date(`${targetDate}T23:59:59`);
  if (isNaN(target.getTime())) return null;

  let refDate: Date;
  if (fromDate) {
    refDate = new Date(`${fromDate}T00:00:00`);
  } else {
    const now = new Date();
    refDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  return Math.ceil((target.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Pure mechanics: Evaluates semantic deadline status (Healthy, Watch, Urgent, Critical, Expired, No Deadline)
 * given a target date and threshold configuration rules.
 */
export function getDeadlineStatus(
  targetDate?: string,
  rules: DeadlineRules = DEFAULT_DEADLINE_RULES,
  fromDate?: string
): DeadlineStatus {
  if (!targetDate || targetDate.trim() === "" || targetDate.toLowerCase() === "continuous") {
    return "No Deadline";
  }

  const days = getDaysRemaining(targetDate, fromDate);
  if (days === null) return "No Deadline";

  if (days < 0) return "Expired";
  if (days >= rules.criticalMinDays && days <= rules.criticalMaxDays) return "Critical";
  if (days >= rules.urgentMinDays && days < rules.watchMinDays) return "Urgent";
  if (days >= rules.watchMinDays && days < rules.healthyMinDays) return "Watch";
  return "Healthy";
}

/**
 * Semantic styling dictionary mapping deadline statuses to accessible Tailwind classes.
 */
export function getDeadlineClasses(status: DeadlineStatus) {
  switch (status) {
    case "Healthy":
      return {
        badge:
          "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
        left: "border-l-emerald-500",
        indicator: "bg-emerald-500",
        text: "text-emerald-700 dark:text-emerald-400",
        bg: "bg-emerald-500/10",
      };
    case "Watch":
      return {
        badge:
          "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
        left: "border-l-amber-400",
        indicator: "bg-amber-400",
        text: "text-amber-700 dark:text-amber-400",
        bg: "bg-amber-500/10",
      };
    case "Urgent":
      return {
        badge:
          "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
        left: "border-l-orange-500",
        indicator: "bg-orange-500",
        text: "text-orange-700 dark:text-orange-400",
        bg: "bg-orange-500/10",
      };
    case "Critical":
      return {
        badge:
          "border-red-400 bg-red-100 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 font-semibold",
        left: "border-l-red-600",
        indicator: "bg-red-600 animate-pulse",
        text: "text-red-600 dark:text-red-400 font-semibold",
        bg: "bg-red-500/15",
      };
    case "Expired":
      return {
        badge:
          "border-red-900 bg-red-950 text-white dark:border-red-700 dark:bg-red-900 font-bold",
        left: "border-l-red-950",
        indicator: "bg-red-900",
        text: "text-red-700 dark:text-red-300 font-bold",
        bg: "bg-red-950/20",
      };
    default:
      return {
        badge:
          "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400",
        left: "border-l-slate-300 dark:border-l-slate-700",
        indicator: "bg-slate-400",
        text: "text-slate-600 dark:text-slate-400",
        bg: "bg-slate-500/10",
      };
  }
}
