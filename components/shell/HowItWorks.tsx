import { YouThemLegend } from "./YouThemLegend";

const STEPS = [
  "We read public work for everyone here: LinkedIn, X, GitHub, talks, posts (via Bright Data).",
  "Each person becomes a graph of facts in FalkorDB; a shared graph links everyone by what they work on.",
  "Every suggestion cites the facts and shows the graph query behind it.",
];

export function HowItWorks() {
  return (
    <div className="w3-how">
      <p className="block-label">How it works</p>
      <ol className="w3-steps">
        {STEPS.map((step, index) => (
          <li key={step}>
            <span className="w3-num">{index + 1}</span>
            <p>{step}</p>
          </li>
        ))}
      </ol>
      <YouThemLegend />
    </div>
  );
}

export function Welcome() {
  return (
    <div className="w3-welcome">
      <p className="w3-sentence">
        Before you walk up to someone here, luckdragon tells you who to meet, why now, what you share, and what to say,
        and shows you the evidence.
      </p>
      <p className="pane-copy">Choose who you are with I am… to start</p>
    </div>
  );
}
