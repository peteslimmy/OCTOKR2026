import { Award, BarChart3, Bell, Building2, CalendarCheck, CheckCircle2, ClipboardCheck, Clock, FileText, Globe, Heart, Layers, Lightbulb, LineChart, Lock, Rocket, Settings, ShieldCheck, Sparkles, Star, Target, Users, Wallet, Zap, type LucideIcon } from "lucide-react";
import type { IconName } from "@/lib/site-content";

/** The fixed set of icons an administrator can pick from. */
export const ICONS: Record<IconName, LucideIcon> = {
  target: Target, calendar: CalendarCheck, clipboard: ClipboardCheck, shield: ShieldCheck, wallet: Wallet, chart: BarChart3, lock: Lock, users: Users, rocket: Rocket, zap: Zap, globe: Globe, layers: Layers,
  trend: LineChart, bell: Bell, file: FileText, check: CheckCircle2, clock: Clock, star: Star, heart: Heart, building: Building2, award: Award, lightbulb: Lightbulb, settings: Settings, sparkles: Sparkles,
};
export const ICON_LABELS: Record<IconName, string> = {
  target: "Target", calendar: "Calendar", clipboard: "Clipboard", shield: "Shield", wallet: "Wallet", chart: "Bar chart", lock: "Lock", users: "People", rocket: "Rocket", zap: "Lightning", globe: "Globe", layers: "Layers",
  trend: "Trend line", bell: "Bell", file: "Document", check: "Check", clock: "Clock", star: "Star", heart: "Heart", building: "Building", award: "Award", lightbulb: "Idea", settings: "Settings", sparkles: "Sparkles",
};
