// <table> -> richTableBlock. Built with the rich-table plugin's own converter, which pads short
// rows, numbers columnHeaders' cellIndex 0..n-1 and always emits columnHeaders (the grid is
// sized from them). This module decides the header row and converts each cell's HTML.
import {toRichTableBlock, type CellValue} from 'sanity-plugin-rich-table'
import type {DeserializerRule, TypedObject} from '@portabletext/block-tools'

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

// The cell's whole text is bold (Word "Label" cells come through mammoth as <p><strong>…</strong></p>).
export function isBoldCell(cell: Element): boolean {
  const all = clean(cell.textContent)
  if (!all) return false
  const bold = clean(
    Array.from(cell.querySelectorAll('strong, b'))
      .filter((el) => !el.parentElement?.closest('strong, b')) // count nested bold once
      .map((el) => el.textContent)
      .join(' '),
  )
  return bold === all
}

/** Rows of cells, colspan expanded so the grid is rectangular before conversion. */
export function tableGrid(table: Element): Element[][] {
  const rows = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table)
  return rows.map((tr) => {
    const out: Element[] = []
    for (const cell of Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH')) {
      out.push(cell)
      const span = Math.max(1, Number(cell.getAttribute('colspan')) || 1)
      // the spanned columns get an empty cell
      for (let i = 1; i < span; i++) out.push(cell.ownerDocument.createElement('td'))
    }
    return out
  })
}

/** 2 columns with a bold label in the first cell of at least 80% of the rows. */
export function isKeyValueTable(grid: Element[][]): boolean {
  const width = Math.max(0, ...grid.map((r) => r.length))
  if (width !== 2 || grid.length === 0) return false
  const bold = grid.filter((r) => r[0] && isBoldCell(r[0])).length
  return bold / grid.length >= 0.8
}

export interface TableOptions {
  /** Converts a cell's inner HTML to the cell's Portable Text. */
  cellToBlocks: (html: string) => any[]
  warn?: (message: string) => void
}

export function toRichTable(table: Element, opts: TableOptions): TypedObject {
  const grid = tableGrid(table)
  const keyValue = isKeyValueTable(grid)
  // a header row needs at least one data row under it
  const hasColumnTitles = !keyValue && grid.length > 1
  const cell = (el: Element): CellValue => {
    if (el.querySelector('img')) opts.warn?.('A table cell contained an image; table cells only hold text, so it was left out.')
    return opts.cellToBlocks(el.innerHTML)
  }
  const value = toRichTableBlock(
    {
      headers: hasColumnTitles ? grid[0].map((c) => clean(c.textContent)) : null,
      rows: (hasColumnTitles ? grid.slice(1) : grid).map((r) => r.map(cell)),
    },
    {hasColumnTitles, hasRowTitles: false},
  )
  // the plugin sets `title: undefined` on rows / headers; drop the keys so the stored JSON is clean
  return JSON.parse(JSON.stringify(value))
}

export function tableRule(opts: TableOptions): DeserializerRule {
  return {
    deserialize(el) {
      if ((el as Element).tagName !== 'TABLE') return undefined
      return toRichTable(el as Element, opts)
    },
  }
}
