import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'
import {BulkImportTool} from './tools/BulkImportTool'

export default defineConfig({
  name: 'default',
  title: 'Salty Cape',

  projectId: 'y83nf1qy',
  dataset: 'production',

  plugins: [structureTool(), visionTool()],

  schema: {
    types: schemaTypes,
  },

  tools: [
    {
      name: 'bulk-import',
      title: 'Bulk Import',
      component: BulkImportTool,
    },
  ],
  
})
