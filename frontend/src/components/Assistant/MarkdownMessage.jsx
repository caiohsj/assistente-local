import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renderiza Markdown das respostas do assistente (negrito, listas, código,
 * tabelas etc.). HTML cru não é interpretado — o react-markdown escapa por
 * padrão — e links abrem em nova aba com `noopener`.
 */
export default function MarkdownMessage({ content = "" }) {
  return (
    <div className="assistant-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href, ...props }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
