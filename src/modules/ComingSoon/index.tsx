interface ComingSoonProps {
  title: string;
  summary: string;
  bullets: string[];
}

export function ComingSoon({ title, summary, bullets }: ComingSoonProps) {
  return (
    <section className="module-placeholder">
      <header className="module-header">
        <h2>{title}</h2>
      </header>
      <div className="module-placeholder-card">
        <div className="module-placeholder-tag">Coming Soon</div>
        <p className="module-placeholder-summary">{summary}</p>
        <ul className="module-placeholder-list">
          {bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
