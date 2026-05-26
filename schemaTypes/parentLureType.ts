// schemaTypes/parentLureType.ts
import {defineField, defineType} from 'sanity'

export const parentLureType = defineType({
  name: 'parentLure',
  title: 'Parent Lure',
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
  name: 'lParentURL',
  title: 'Parent URL',
  type: 'url',
  validation: (Rule) => Rule.required().uri({
    scheme: ['http', 'https'],
  }),
}),

    
    defineField({
      name: 'description',
      title: 'Description',
      type: 'text',
    }),
  ],
  preview: {
    select: {title: 'name'},
  },
})
