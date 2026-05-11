// schemaTypes/baitfishType.ts
import {defineField, defineType} from 'sanity'

export const baitfishType = defineType({
  name: 'baitfish',
  title: 'Baitfish',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Common Name',
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
      name: 'scientificName',
      title: 'Scientific Name',
      type: 'string',
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'text',
    }),
    defineField({
      name: 'image',
      title: 'Image',
      type: 'image',
      options: {hotspot: true},
      fields: [
        defineField({name: 'alt', title: 'Alt Text', type: 'string'}),
      ],
    }),
    defineField({
      name: 'season',
      title: 'Peak Season',
      type: 'string',
    }),
  ],
  preview: {
    select: {title: 'name', subtitle: 'scientificName', media: 'image'},
  },
})