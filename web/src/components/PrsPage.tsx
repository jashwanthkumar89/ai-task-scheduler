import { useEffect, useState } from "react";
import { marked } from "marked";
import { api } from "../api";

interface Pr {
  repo: string;
  number: number;
  title: string;
  url: string;
  draft: boolean;
  updatedAt: string;
  author: string;
}

interface Review {
  repo: string;
  number: number;
  status: "running" | "success" | "failed" | "timeout";
  started_at: string;
  output: string | null;
  error_message: string | null;
  note_file: string | null;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const reviewKey = (pr: Pr) => `${pr.repo}#${pr.number}`;

function openNote(file: string) {
  window.history.pushState({}, "", `/notes?note=${encodeURIComponent(file)}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function PrTable({
  prs,
  showAuthor,
  reviews,
  onReview,
}: {
  prs: Pr[];
  showAuthor?: boolean;
  reviews: Map<string, Review>;
  onReview: (pr: Pr) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (prs.length === 0) return <p className="hint">None.</p>;
  return (
    <table className="pr-table">
      <tbody>
        {prs.map((pr) => {
          const key = reviewKey(pr);
          const review = reviews.get(key);
          return [
            <tr key={pr.url}>
              <td className="pr-repo">{pr.repo}</td>
              <td>
                <a href={pr.url} target="_blank" rel="noreferrer">
                  #{pr.number} {pr.title}
                </a>
                {pr.draft && <span className="badge">draft</span>}
              </td>
              {showAuthor && <td className="pr-meta">{pr.author}</td>}
              <td className="pr-meta">{fmtDate(pr.updatedAt)}</td>
              <td>
                <button
                  className="secondary small"
                  disabled={review?.status === "running"}
                  onClick={() => onReview(pr)}
                >
                  {review?.status === "running" ? "Reviewing..." : "Review"}
                </button>
                {review && review.status !== "running" && (
                  <button
                    className="secondary small"
                    onClick={() => setExpanded(expanded === key ? null : key)}
                  >
                    {expanded === key ? "Hide" : `Result (${review.status})`}
                  </button>
                )}
              </td>
            </tr>,
            expanded === key && review ? (
              <tr key={`${pr.url}-review`}>
                <td colSpan={5}>
                  {review.error_message && <p className="error">{review.error_message}</p>}
                  {review.note_file && (
                    <p>
                      <a
                        href={`/notes?note=${encodeURIComponent(review.note_file)}`}
                        onClick={(e) => {
                          e.preventDefault();
                          openNote(review.note_file!);
                        }}
                      >
                        Open as note
                      </a>
                    </p>
                  )}
                  {review.output && (
                    <div
                      className="note-content markdown"
                      dangerouslySetInnerHTML={{ __html: marked.parse(review.output) as string }}
                    />
                  )}
                </td>
              </tr>
            ) : null,
          ];
        })}
      </tbody>
    </table>
  );
}

export function PrsPage() {
  const [data, setData] = useState<{ mine: Pr[]; reviewRequested: Pr[] } | null>(null);
  const [reviews, setReviews] = useState<Map<string, Review>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .getPrs()
      .then((d) => {
        // gh search intermittently returns empty lists; keep last good data.
        const empty = d.mine.length === 0 && d.reviewRequested.length === 0;
        setData((prev) => (empty && prev ? prev : d));
      })
      .catch((e) => setError(e.message));
    api
      .listPrReviews()
      .then((rows) => setReviews(new Map(rows.map((r) => [`${r.repo}#${r.number}`, r]))))
      .catch(() => {});
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  // Poll review states faster while any are running.
  const anyRunning = [...reviews.values()].some((r) => r.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => {
      api
        .listPrReviews()
        .then((rows) => setReviews(new Map(rows.map((r) => [`${r.repo}#${r.number}`, r]))))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const onReview = async (pr: Pr) => {
    try {
      await api.reviewPr(pr);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div>
      <div className="task-list-header">
        <h2>Pull requests</h2>
        <button className="secondary small" onClick={load}>Refresh</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="hint">Loading...</p>}
      {data && (
        <>
          <h3>Needs my review ({data.reviewRequested.length})</h3>
          <PrTable prs={data.reviewRequested} showAuthor reviews={reviews} onReview={onReview} />
          <h3>Opened by me ({data.mine.length})</h3>
          <PrTable prs={data.mine} reviews={reviews} onReview={onReview} />
        </>
      )}
    </div>
  );
}
