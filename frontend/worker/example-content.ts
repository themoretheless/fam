import type { FamilyShelfItem, MemorableDate } from "./types";

export const EXAMPLE_FAMILY_SHELF: readonly FamilyShelfItem[] = [
  {
    id: "example-shelf-dinner",
    title: "Пример: приготовить ужин",
    emoji: "🍳",
    base_points: 20,
    hours: 12,
    repeat: false,
    interval_hours: null,
  },
  {
    id: "example-shelf-bedding",
    title: "Пример: сменить постельное бельё",
    emoji: "🛏️",
    base_points: 20,
    hours: 48,
    repeat: true,
    interval_hours: 168,
  },
];

export const EXAMPLE_MEMORABLE_DATES: readonly MemorableDate[] = [
  {
    id: "example-date-meeting",
    title: "Пример: день знакомства",
    date: "2024-02-14",
    kind: "meeting",
  },
  {
    id: "example-date-moving",
    title: "Пример: годовщина переезда",
    date: "2023-09-01",
    kind: "anniversary",
  },
];
