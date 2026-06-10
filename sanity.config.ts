import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'
import {BulkImportTool} from './tools/BulkImportTool'
import {richTablePlugin} from 'sanity-plugin-rich-table'
import {media} from 'sanity-plugin-media'
import {bulkJsonFieldImportTool} from './tools/BulkJsonFieldImportTool'

export default defineConfig({
  name: 'default',
  title: 'Salty Cape',

  projectId: 'y83nf1qy',
  dataset: 'production',

  plugins: [structureTool(), visionTool(), richTablePlugin({}), media()], 

  schema: {
    types: schemaTypes,
  },

  tools: [
    {
      name: 'bulk-import',
      title: 'Bulk Import',
      component: BulkImportTool,
    },
    bulkJsonFieldImportTool,
  ],
  
})



