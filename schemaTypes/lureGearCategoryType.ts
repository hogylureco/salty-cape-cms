// schemaTypes/lureGearCategoryType.ts
import {defineField, defineType} from 'sanity'

export const lureGearCategoryType = defineType({
  name: 'lureGearCategory',
  title: 'Lure Gear Category',
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
  name: 'imageURL',
  title: 'Image URL',
  type: 'url',
}),
        defineField({
  name: 'websitelink',
  title: 'Website Link',
  type: 'url',
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
      name: 'description',
      title: 'Description',
      type: 'text',
    }),
  ],
  preview: {
    select: {title: 'name'},
  },
})
