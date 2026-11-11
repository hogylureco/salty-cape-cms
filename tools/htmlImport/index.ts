import type {Tool} from 'sanity'
import {CodeIcon} from '@sanity/icons/Code'
import {HtmlImport} from './HtmlImport'

export const htmlImportTool: Tool = {
  name: 'html-import',
  title: 'Import HTML',
  icon: CodeIcon,
  component: HtmlImport,
}
