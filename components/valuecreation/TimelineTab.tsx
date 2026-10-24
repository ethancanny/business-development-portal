"use client";

/**
 * Legacy import path — the pre-redesign "timeline" tab (100-day list
 * + Gantt) is now the §7 HundredDayTab (phase swimlanes, progress
 * ring, today marker) in the workspace's 100-Day Plan group. This
 * shim keeps any existing import of TimelineTab working.
 */

export { default } from "@/components/valuecreation/HundredDayTab";
