// schemaTypes/lureCatalogType.ts
import {defineField, defineType} from 'sanity'

export const lureCatalogType = defineType({
  name: 'lureCatalog',
  title: 'Lure Catalog Field',
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
      name: 'l.parent',
      title: 'Parent Lure',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'parentLure'}]}],
    }),
      defineField({
      name: 'master-lure-category',
      title: 'Master Lure Category',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'lureGearCategory'}]}],
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
