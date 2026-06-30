// schemaTypes/blogPostType.ts
import {defineField, defineType} from 'sanity'

export const blogPostType = defineType({
  name: 'blogPost',
  title: 'Blog Posts',
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
      name: 'method',
      title: 'Method',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'method'}]}],
    }),

    defineField({
      name: 'region',
      title: 'Region',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'region'}]}],
    }),

    defineField({
      name: 'spot',
      title: 'Spot',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'spot'}]}],
    }),


   defineField({
      name: 'structure',
      title: 'Structure',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'structure'}]}],
    }),


       defineField({
      name: 'approach',
      title: 'Approach',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'approach'}]}],
    }),


           defineField({
      name: 'season',
      title: 'Season',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'season'}]}],
    }),


           defineField({
      name: 'techniqueRetrieve',
      title: 'Technique',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'techniqueRetrieve'}]}],
    }),


    defineField({
      name: 'lureGearCategory',
      title: 'Lure Gear Category',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'lureGearCategory'}]}],
    }),


    defineField({
      name: 'parentLure',
      title: 'Parent Lure',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'parentLure'}]}],
    }),


   defineField({
      name: 'targetSpecies',
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
      type: 'array',
      of: [
        {type: 'block'},
        {type: 'image', options: {hotspot: true}},
        {type: 'richTableBlock'},
      ],
    }),
  ],
  preview: {
    select: {title: 'name'},
  },
})
