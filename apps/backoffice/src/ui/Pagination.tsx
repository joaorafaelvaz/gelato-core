export function Pagination({ page, pageCount, onPage }: {
  page: number
  pageCount: number
  onPage: (p: number) => void
}) {
  if (pageCount <= 1) return null
  return (
    <div className="pagination">
      <button disabled={page <= 0} onClick={() => onPage(page - 1)}>‹</button>
      <span>{page + 1} / {pageCount}</span>
      <button disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>›</button>
    </div>
  )
}
