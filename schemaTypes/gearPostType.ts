// schemaTypes/gearPostType.ts
import {defineField, defineType} from 'sanity'

export const gearPostType = defineType({
  name: 'gearPost',
  title: 'Gear Posts',
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
      name: 'zone',
      title: 'Zone',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'zone'}]}],
    }),
            defineField({
      name: 'targetSpecies',
      title: 'Target Species',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'targetSpecies'}]}],
    }),
     defineField({
      name: 'method',
      title: 'Method',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'method'}]}],
    }),
    defineField({
      name: 'platform',
      title: 'Platform',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'platform'}]}],
    }),
        defineField({
      name: 'parentLure',
      title: 'Parent Lure',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'parentLure'}]}],
    }),
            defineField({
      name: 'lureGearCategory',
      title: 'Lure Gear Category',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'lureGearCategory'}]}],
    }),
                defineField({
      name: 'season',
      title: 'Season',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'season'}]}],
    }),
                    defineField({
      name: 'baitfish',
      title: 'Baitfish',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'baitfish'}]}],
    }),
                    defineField({
      name: 'microSeason',
      title: 'Micro Season',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'microSeason'}]}],
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'array',
      of: [
        {type: 'block'},
        {type: 'image', options: {hotspot: true}},
        {type: 'richTableBlock'},
      ],
    }),
  ],
  preview: {
    select: {title: 'name', subtitle: 'region.name'},
  },
})
