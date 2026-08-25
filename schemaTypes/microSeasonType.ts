// schemaTypes/microSeasonType.ts
import {defineField, defineType} from 'sanity'

export const microSeasonType = defineType({
  name: 'microSeason',
  title: 'Micro Season',
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
  name: 'startDate',
  title: 'Start Date',
  type: 'date',
  options: {dateFormat: 'YYYY-MM-DD'},
}),
defineField({
  name: 'endDate',
  title: 'End Date',
  type: 'date',
  options: {dateFormat: 'YYYY-MM-DD'},
}),
defineField({
  name: 'seasons',
  title: 'Seasons',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'season'}], weak: true}],
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
