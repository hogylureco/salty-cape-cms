import {bulkJsonFieldImportTool} from './tools/BulkJsonFieldImport'

export default defineConfig({
  // ...
  tools: (prev) => [...prev, bulkJsonFieldImportTool],
})
