import React from "react";

const COPY = {
  spelling: {
    title: "Spelling errors",
    subtitle: "Office name and govt body checked against a reference list",
    note: "Needs the approved spelling reference list for office names and govt bodies before matching logic can run.",
  },
  translations: {
    title: "Pending translations",
    subtitle: "OH, PE and VIF translation backlog",
    note: "Needs the person and office translation files to build the pending-count logic per category.",
  },
  alerts: {
    title: "Upcoming deadlines",
    subtitle: "Date-based alerts for items nearing their due date",
    note: "Will scan tenure end dates and flag anything within a configurable window as an upcoming deadline.",
  },
};

export default function PlaceholderPage({ pageKey }) {
  const copy = COPY[pageKey] || { title: pageKey, subtitle: "", note: "Not yet built." };
  return (
    <div>
      <div className="topbar">
        <div><h2>{copy.title}</h2><p>{copy.subtitle}</p></div>
      </div>
      <div className="placeholder-card">
        <b>Awaiting inputs</b>
        {copy.note}
      </div>
    </div>
  );
}
