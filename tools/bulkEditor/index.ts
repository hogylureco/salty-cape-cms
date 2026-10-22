import type {Tool} from 'sanity'
import {route} from 'sanity/router'
import {ThLargeIcon} from '@sanity/icons/ThLarge'
import {BulkEditorTool} from './BulkEditorTool'

export const bulkEditorTool: Tool = {
  name: 'bulk-editor',
  title: 'Bulk Editor',
  icon: ThLargeIcon,
  component: BulkEditorTool,
  // /bulk-editor/<document type>, so a view can be linked to.
  router: route.create('/', [route.create('/:type')]),
}
