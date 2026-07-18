/* Displays the entry in days.json that matches the visitor's local month and day. */
(() => {
  "use strict";

  async function showTodayDescription() {
    const description = document.getElementById("dailyDescription");
    const dateLabel = document.getElementById("dailyDate");
    if (!description || !dateLabel) return;

    try {
      const response = await fetch("days.json");
      if (!response.ok) throw new Error("Unable to load days.json");

      const days = await response.json();
      const today = new Date();
      const month = today.getMonth() + 1;
      const day = today.getDate();
      const match = days.find(({ date }) => {
        const [, entryMonth, entryDay] = date.split("-").map(Number);
        return entryMonth === month && entryDay === day;
      });

      if (!match) {
        description.textContent = "No fact is available for today.";
        return;
      }

      const [year, entryMonth, entryDay] = match.date.split("-").map(Number);
      dateLabel.textContent = new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric"
      }).format(new Date(year, entryMonth - 1, entryDay));
      description.textContent = match.event_disruption;
    } catch (error) {
      console.error("Could not load today's fact:", error);
      description.textContent = "Today’s biotech history fact is unavailable.";
    }
  }

  document.addEventListener("DOMContentLoaded", showTodayDescription);
})();
