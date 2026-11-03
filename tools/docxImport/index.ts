import type {Tool} from 'sanity'
import {DocumentWordIcon} from '@sanity/icons/DocumentWord'
import {DocxImport} from './DocxImport'

export const docxImportTool: Tool = {
  name: 'docx-import',
  title: 'Import Word Doc',
  icon: DocumentWordIcon,
  component: DocxImport,
}
