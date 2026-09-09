import { useId } from "react";
import type { ReactNode } from "react";

interface PageProps {
  breadcrumb?: ReactNode;
  title?: string;
  summary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function Page({ breadcrumb, title, summary, actions, children }: PageProps) {
  const headingId = useId();

  return (
    <section className="page" aria-labelledby={title === undefined ? undefined : headingId}>
      {breadcrumb}
      {title === undefined ? null : (
        <div className="page-head">
          <div className="page-titles">
            <h1 id={headingId}>{title}</h1>
            {summary === undefined ? null : <p className="page-summary">{summary}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

interface SectionProps {
  title: string;
  level?: 2 | 3;
  actions?: ReactNode;
  children: ReactNode;
}

export function Section({ title, level = 2, actions, children }: SectionProps) {
  const headingId = useId();
  const Heading = level === 3 ? "h3" : "h2";

  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section-head">
        <Heading id={headingId}>{title}</Heading>
        {actions}
      </div>
      {children}
    </section>
  );
}
