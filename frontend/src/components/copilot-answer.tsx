import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Lightbulb } from "lucide-react";

const components: Components = {
  h1: ({ children }) => <h3 className="mb-3 mt-7 text-xl font-semibold tracking-tight text-slate-900 first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-3 mt-7 border-b border-slate-100 pb-2.5 text-[17px] font-semibold tracking-tight text-slate-900 first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-2.5 mt-6 text-[15px] font-semibold text-slate-900 first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mb-2 mt-5 text-sm font-semibold text-slate-900">{children}</h5>,
  p: ({ children }) => <p className="my-3 leading-[1.85] first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-600">{children}</em>,
  ul: ({ children }) => <ul className="my-4 list-disc space-y-2 pl-5 marker:text-indigo-400">{children}</ul>,
  ol: ({ children }) => <ol className="my-4 list-decimal space-y-2.5 pl-5 marker:font-semibold marker:text-indigo-600">{children}</ol>,
  li: ({ children }) => <li className="pl-1 leading-[1.8] [&>p]:my-1">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-5 flex gap-3 rounded-r-xl border-l-[3px] border-indigo-400 bg-indigo-50/60 px-4 py-4 text-slate-700">
    <Lightbulb aria-hidden="true" className="mt-1 size-4 shrink-0 text-indigo-500" />
    <div className="min-w-0 flex-1 [&>p]:my-0">{children}</div>
  </blockquote>,
  hr: () => <hr className="my-6 border-slate-100" />,
  table: ({ children }) => <div role="region" aria-label="Tabel ringkasan" tabIndex={0} className="my-5 overflow-x-auto rounded-xl border border-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400">
    <table className="w-full border-collapse text-left text-[13px]">{children}</table>
  </div>,
  thead: ({ children }) => <thead className="bg-slate-50 text-slate-700">{children}</thead>,
  th: ({ children }) => <th className="border-b border-slate-200 px-4 py-3 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-slate-100 px-4 py-3 align-top last:border-r-0">{children}</td>,
  a: ({ children }) => <span className="font-medium text-slate-700">{children}</span>,
  code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px] text-slate-700">{children}</code>,
  pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs">{children}</pre>,
};

export function CopilotAnswer({ answer }: { answer: string }) {
  return <div className="copilot-answer min-w-0 break-words text-[14px] leading-relaxed text-slate-600 sm:text-[15px]">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      allowedElements={["h1", "h2", "h3", "h4", "p", "strong", "em", "ul", "ol", "li", "blockquote", "hr", "table", "thead", "tbody", "tr", "th", "td", "a", "code", "pre", "br", "del"]}
      components={components}
    >{answer}</ReactMarkdown>
  </div>;
}
