import {set, type ObjectInputProps} from 'sanity'
import {Card, Stack, Text} from '@sanity/ui'
import {useCallback, useRef} from 'react'

export function JsonImportField(props: ObjectInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        const data = JSON.parse(text)

        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          alert('JSON must be a single object (not an array or primitive).')
          return
        }

        // Patch each top-level field from the JSON onto the document
        Object.entries(data).forEach(([key, value]) => {
          props.onChange(set(value, [key]))
        })
      } catch (err) {
        alert('Failed to parse JSON: ' + (err as Error).message)
      }

      // Reset so the same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [props],
  )

  return (
    <Stack space={4}>
      <Card padding={3} radius={2} tone="primary" border>
        <Stack space={3}>
          <Text size={1} weight="semibold">
            Import from JSON
          </Text>
          <Text size={1} muted>
            Upload a .json file to pre-populate the fields below. Matching field
            names will be overwritten.
          </Text>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFile}
          />
        </Stack>
      </Card>
      {props.renderDefault(props)}
    </Stack>
  )
}
