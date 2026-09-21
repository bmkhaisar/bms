import React from "react";
import { parseMarkdownToBlocks, parseInlineSpans, type InlineSpan } from "./markdownDoc";

/**
 * React Component to render parsed Markdown cleanly with Tailwind CSS styling.
 * Unified with the vector PDF renderer to ensure preview and PDF layout parity.
 */
export function MarkdownRenderer({ content, className = "" }: { content: string; className?: string }) {
  const blocks = React.useMemo(() => parseMarkdownToBlocks(content || ""), [content]);

  if (!content || !content.trim()) {
    return (
      <div className={`text-xs text-muted-foreground italic ${className}`}>
        No content configured.
      </div>
    );
  }

  return (
    <div className={`space-y-3 text-xs leading-relaxed ${className}`}>
      {blocks.map((block, bIdx) => {
        switch (block.type) {
          case "HEADING": {
            if (block.level === 1) {
              return (
                <h3 key={bIdx} className="text-sm font-bold text-foreground border-b pb-1 pt-2">
                  <RenderSpans spans={block.spans} />
                </h3>
              );
            }
            if (block.level === 2) {
              return (
                <h4 key={bIdx} className="text-xs font-bold text-foreground pt-1.5 uppercase tracking-wide">
                  <RenderSpans spans={block.spans} />
                </h4>
              );
            }
            return (
              <h5 key={bIdx} className="text-xs font-semibold text-foreground pt-1">
                <RenderSpans spans={block.spans} />
              </h5>
            );
          }

          case "PARAGRAPH":
            return (
              <p key={bIdx} className="text-foreground/90">
                <RenderSpans spans={block.spans} />
              </p>
            );

          case "NUMBERED_LIST":
            return (
              <ol key={bIdx} className="space-y-1.5 list-none pl-0">
                {block.items.map((item, iIdx) => (
                  <li key={iIdx} className="flex items-start gap-2">
                    <span className="font-semibold text-primary shrink-0 w-5 text-right font-mono">
                      {item.index}.
                    </span>
                    <div className="flex-1 text-foreground/90">
                      <RenderSpans spans={item.spans} />
                    </div>
                  </li>
                ))}
              </ol>
            );

          case "BULLET_LIST":
            return (
              <ul key={bIdx} className="space-y-1 list-none pl-0">
                {block.items.map((item, iIdx) => (
                  <li key={iIdx} className="flex items-start gap-2">
                    <span className="text-primary shrink-0 text-base leading-none select-none">•</span>
                    <div className="flex-1 text-foreground/90">
                      <RenderSpans spans={item.spans} />
                    </div>
                  </li>
                ))}
              </ul>
            );

          case "TABLE":
            return (
              <div key={bIdx} className="overflow-x-auto rounded-lg border border-border/70 my-2">
                <table className="w-full text-left border-collapse">
                  {block.headers.length > 0 && (
                    <thead className="bg-muted/60 border-b border-border/70 text-foreground">
                      <tr>
                        {block.headers.map((h, hIdx) => (
                          <th key={hIdx} className="px-3 py-2 font-semibold text-[11px] uppercase tracking-wider">
                            <RenderSpans spans={block.headerSpans[hIdx] || [{ text: h }]} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody className="divide-y divide-border/40">
                    {block.rows.map((row, rIdx) => (
                      <tr key={rIdx} className={rIdx % 2 === 1 ? "bg-muted/20" : ""}>
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className={`px-3 py-2 text-foreground/90 ${
                              cIdx === 0 ? "font-semibold text-foreground bg-muted/10 w-1/3" : ""
                            }`}
                          >
                            <RenderSpans spans={block.rowSpans[rIdx]?.[cIdx] || [{ text: cell }]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}

export function InlineMarkdown({ text, className = "" }: { text: string; className?: string }) {
  const spans = React.useMemo(() => parseInlineSpans(text || ""), [text]);
  return <span className={className}><RenderSpans spans={spans} /></span>;
}

export function RenderSpans({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((s, idx) => {
        let el = <>{s.text}</>;
        if (s.bold) {
          el = <strong className="font-semibold text-foreground">{el}</strong>;
        }
        if (s.italic) {
          el = <em className="italic">{el}</em>;
        }
        return <React.Fragment key={idx}>{el}</React.Fragment>;
      })}
    </>
  );
}
