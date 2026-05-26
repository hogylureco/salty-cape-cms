// schemaTypes/techniqueRetrieveType.ts
import {defineField, defineType} from 'sanity'

export const techniqueRetrieveType = defineType({
  name: 'techniqueRetrieve',
  title: 'Technique Retrieve',
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
      name: 'featuredDiagramUrl',
      title: 'Featured Diagram URL',
      type: 'url',
      validation: (Rule) => Rule.required().uri({
      scheme: ['http', 'https'],
  }),
}),
    defineField({
      name: 'zone',
      title: 'Zone',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'zone'}]}],
    }),
    defineField({
      name: 'method',
      title: 'Method',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'method'}]}],
    }),
    defineField({
      name: 'targetspecies',
      title: 'Target Species',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'targetSpecies'}]}],
    }),
    defineField({
      name: 'baitfish',
      title: 'Baitfish',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'baitfish'}]}],
    }),
        defineField({
      name: 'platform',
      title: 'Platform',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'platform'}]}],
    }),
        defineField({
      name: 'parentlure',
      title: 'Parent Lure',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'parentLure'}]}],
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
