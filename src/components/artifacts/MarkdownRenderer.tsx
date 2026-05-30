import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'
import '@/styles/markdown.css'

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            return <>{children}</>
          },

          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const codeStr = String(children).replace(/\n$/, '')

            if (match) {
              return <CodeBlock code={codeStr} language={match[1]} />
            }

            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },

          a({ href, children }) {
            const handleClick = (e: React.MouseEvent) => {
              e.preventDefault()
              if (href) {
                window.api?.artifact?.openExternal?.(href) ??
                  window.open(href, '_blank')
              }
            }
            return (
              <a href={href} onClick={handleClick}>
                {children}
              </a>
            )
          },

          table({ children }) {
            return (
              <div className="markdown-table-wrapper">
                <table>{children}</table>
              </div>
            )
          },

          blockquote({ children }) {
            return <blockquote>{children}</blockquote>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
