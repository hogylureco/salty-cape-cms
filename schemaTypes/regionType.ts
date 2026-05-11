// schemaTypes/regionType.ts
import {defineField, defineType} from 'sanity'

export const regionType = defineType({
  name: 'region',
  title: 'Region',
  type: 'document',
  fields: [
    defineField({
      name: 'id',
      title: 'ID',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {source: 'name', maxLength: 96},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'macroRegion',
      title: 'Macro Region',
      type: 'string',
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'text',
    }),
  ],
  preview: {
    select: {title: 'name', subtitle: 'macroRegion'},
  },
})
